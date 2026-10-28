import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import { lstat, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises"
import { join, relative, resolve, sep } from "node:path"
import { promisify } from "node:util"
import { Plugin, Worktree } from "@opencode/plugin"
import type { VcsDefinition, VcsDiffInput } from "@opencode/plugin/promise/vcs"
import type { WorktreeDefinition } from "@opencode/plugin/promise/worktree"

const execFileAsync = promisify(execFile)

const instructions = `This directory is in a Jujutsu (jj) repository. Use jj, not git, for version control operations, even if the repository is colocated with Git. Prefer jj status, jj diff, and jj log when inspecting changes and history. When running jj commands where a diff is expected, such as jj diff or jj show, append --git to get Git-format diffs regardless of custom diff formatters. Jujutsu automatically tracks working-copy changes; there is no Git staging step. Do not run git commands unless the user explicitly requests them or there is no suitable jj equivalent. Preserve existing changes and avoid destructive operations unless explicitly authorized.`

const workspaceMarker = "opencode-workspace.json"

function workspaces(): WorktreeDefinition {
  const run = async (cwd: string, args: string[], signal: AbortSignal) => {
    const { stdout } = await execFileAsync("jj", ["--no-pager", "--color", "never", ...args], {
      cwd, signal, maxBuffer: 16 * 1024 * 1024,
    })
    return stdout
  }

  const workspaceList = async (cwd: string, signal: AbortSignal) => {
    const output = await run(cwd, ["workspace", "list", "-T", 'json({"name" => name, "root" => root}) ++ "\\n"'], signal)
    return output.split("\n").filter(Boolean).map((line) => JSON.parse(line) as { name: string; root: string | null })
  }

  const workingCopy = async (cwd: string, signal: AbortSignal) => JSON.parse(await run(cwd, [
    "log", "-r", "@", "--no-graph", "-T",
    'json({"empty" => empty, "description" => description, "change" => change_id, "parents" => parents.map(|p| p.commit_id())})',
  ], signal)) as { empty: boolean; description: string; change: string; parents: string[] }

  const managed = async (directory: string, name: string) => {
    try {
      const marker = JSON.parse(await readFile(join(directory, ".jj", workspaceMarker), "utf8"))
      return marker.name === name && marker.version === 1
    } catch {
      return false
    }
  }

  return {
    id: "jj",
    create: async (input, { signal }) => {
      const name = `opencode-${randomUUID()}`
      const args = ["workspace", "add", "--no-colocate", "--name", name]
      if (input.branch) args.push("--revision", input.branch)
      args.push("--", input.directory)
      await run(input.sourceDirectory, args, signal)
      const initial = await workingCopy(input.directory, signal)
      await writeFile(join(input.directory, ".jj", workspaceMarker), JSON.stringify({ version: 1, name, initial }), { flag: "wx" })
      return { directory: input.directory }
    },
    list: async (sourceDirectory, { signal }) => {
      const sourceRoot = (await run(sourceDirectory, ["root"], signal)).trim()
      const result: { directory: string; type: "root" | "worktree" }[] = [{ directory: sourceRoot, type: "root" }]
      for (const workspace of await workspaceList(sourceDirectory, signal)) {
        if (workspace.root && workspace.root !== sourceRoot && await managed(workspace.root, workspace.name)) {
          result.push({ directory: workspace.root, type: "worktree" })
        }
      }
      return result
    },
    remove: async (input, { signal }) => {
      const directory = resolve(input.directory)
      const stat = await lstat(directory)
      if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(directory) !== directory) {
        throw new Error("Refusing to remove a workspace through a symlink or non-directory")
      }
      const workspace = (await workspaceList(directory, signal)).find((entry) => entry.root === directory)
      if (!workspace || !await managed(directory, workspace.name)) {
        throw new Error("Refusing to remove a workspace not created by OpenCode")
      }

      if (!input.force) {
        const marker = JSON.parse(await readFile(join(directory, ".jj", workspaceMarker), "utf8"))
        const state = await workingCopy(directory, signal)
        if (!state.empty || state.description || state.change !== marker.initial?.change || JSON.stringify(state.parents) !== JSON.stringify(marker.initial?.parents)) {
          throw new Worktree.OperationError({ message: "Workspace has changes or a description", forceRequired: true })
        }
        const tracked = new Set((await run(directory, ["file", "list", "-T", 'json(path) ++ "\\n"'], signal)).split("\n").filter(Boolean).map((line) => JSON.parse(line) as string))
        const visit = async (dir: string): Promise<boolean> => {
          for (const entry of await readdir(dir, { withFileTypes: true })) {
            const path = join(dir, entry.name)
            const name = relative(directory, path).split(sep).join("/")
            if (name === ".jj") continue
            if (entry.isDirectory()) {
              if (![...tracked].some((file) => file.startsWith(`${name}/`)) || await visit(path)) return true
            } else if (!tracked.has(name)) return true
          }
          return false
        }
        if (await visit(directory)) {
          throw new Worktree.OperationError({ message: "Workspace contains ignored or untracked files", forceRequired: true })
        }
      }

      signal.throwIfAborted()
      await run(directory, ["workspace", "forget", "--", workspace.name], signal)
      await rm(directory, { recursive: true })
    },
  }
}

function provider(root: string): VcsDefinition {
  const run = async (args: string[], signal: AbortSignal, maxBuffer = 16 * 1024 * 1024) => {
    const { stdout } = await execFileAsync("jj", ["--no-pager", "--color", "never", ...args], {
      cwd: root,
      signal,
      maxBuffer,
    })
    return stdout
  }

  const bookmarks = async (signal: AbortSignal) => {
    const output = await run(["bookmark", "list", "-T", 'name ++ "\\0"'], signal)
    return [...new Set(output.split("\0").filter(Boolean))]
  }

  const files = async (input: Pick<VcsDiffInput, "mode" | "base" | "context" | "maxOutputBytes">, signal: AbortSignal) => {
    const range = input.mode === "working"
      ? ["-r", "@"]
      : ["--from", input.base ?? "trunk()", "--to", input.mode === "committed" ? "@-" : "@"]
    const entries = (await run(["diff", ...range, "-T", 'status ++ "\\0" ++ path ++ "\\0"'], signal)).split("\0")
    const result = []
    let remaining = input.maxOutputBytes
    for (let i = 0; i + 1 < entries.length; i += 2) {
      const [kind, file] = [entries[i], entries[i + 1]]
      if (!file) continue
      const patch = await run(["diff", ...range, "--git", "--context", String(input.context), "--", `root-file:${JSON.stringify(file)}`], signal)
      const size = Buffer.byteLength(patch)
      if (size > remaining) break
      remaining -= size
      let additions = 0
      let deletions = 0
      let inHunk = false
      for (const line of patch.split("\n")) {
        if (line.startsWith("@@ ")) inHunk = true
        else if (inHunk && line.startsWith("+")) additions++
        else if (inHunk && line.startsWith("-")) deletions++
      }
      const status = kind === "added" ? "added" : kind === "removed" ? "deleted" : "modified"
      result.push({ file, patch, additions, deletions, status } as const)
    }
    return result
  }

  return {
    id: "jj",
    name: "Jujutsu",
    info: async (_scope, { signal }) => {
      const current = (await run([
        "log", "--ignore-working-copy", "-n", "1", "--no-graph",
        "-r", "coalesce(ancestors(present(@)) & bookmarks(), root())",
        "-T", 'if(root, "root()", bookmarks.join(" "))',
      ], signal)).trim()
      return { provider: "jj", branch: { current, default: "trunk()" } }
    },
    base: async () => ({ name: "trunk()", ref: "trunk()", source: "default" }),
    branches: async (input, { signal }) => {
      const names = await bookmarks(signal)
      const filtered = input.search ? names.filter((name) => name.includes(input.search!)) : names
      return input.limit === undefined ? filtered : filtered.slice(0, input.limit)
    },
    status: async (_scope, { signal }) => {
      const changes = await files({ mode: "working", context: 3, maxOutputBytes: Number.POSITIVE_INFINITY }, signal)
      return changes.map(({ file, additions, deletions, status }) => ({ file, additions, deletions, status }))
    },
    diff: (input, { signal }) => files(input, signal),
  }
}

export default Plugin.define({
  id: "jj-support",
  async setup(ctx) {
    let root: string
    try {
      const result = await execFileAsync("jj", ["root"], {
        cwd: ctx.location.directory,
        timeout: 5000,
      })
      root = result.stdout.trim()
    } catch {
      // jj is unavailable, this is not a jj repository, or detection failed.
      return
    }

    await ctx.vcs.transform((editor) => {
      editor.add(provider(root))
      editor.default.set("jj")
    })

    await ctx.worktree.transform((editor) => {
      editor.add(workspaces())
    })

    await ctx.session.hook("context", (event) => {
      event.system.push({ type: "text", text: instructions })
    })
  },
})
