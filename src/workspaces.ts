import { randomUUID } from "node:crypto"
import { lstat, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises"
import { join, relative, resolve, sep } from "node:path"
import { Worktree } from "@opencode/plugin"
import type { WorktreeDefinition } from "@opencode/plugin/promise/worktree"
import { runJj } from "./jj"

const workspaceMarker = "opencode-workspace.json"

export function createWorkspaceStrategy(): WorktreeDefinition {
  const workspaceList = async (cwd: string, signal: AbortSignal) => {
    const output = await runJj(cwd, ["workspace", "list", "-T", 'json({"name" => name, "root" => root}) ++ "\\n"'], signal)
    return output.split("\n").filter(Boolean).map((line) => JSON.parse(line) as { name: string; root: string | null })
  }

  const workingCopy = async (cwd: string, signal: AbortSignal) => JSON.parse(await runJj(cwd, [
    "log", "-r", "@", "--no-graph", "-T",
    'json({"empty" => empty, "description" => description, "change" => change_id, "parents" => parents.map(|p| p.commit_id())})',
  ], signal)) as { empty: boolean; description: string; change: string; parents: string[] }

  const readMarker = async (directory: string) => {
    try {
      const marker = JSON.parse(await readFile(join(directory, ".jj", workspaceMarker), "utf8"))
      return marker.version === 1 ? marker : undefined
    } catch {
      return undefined
    }
  }

  return {
    id: "jj",
    create: async (input, { signal }) => {
      const name = `opencode-${randomUUID()}`
      const sourceRoot = (await runJj(input.sourceDirectory, ["root"], signal)).trim()
      const sourceMarker = await readMarker(sourceRoot)
      const originRoot = sourceMarker?.originRoot ?? (sourceMarker
        ? (await workspaceList(input.sourceDirectory, signal)).find((workspace) => workspace.name === "default")?.root
        : undefined) ?? sourceRoot
      const args = ["workspace", "add", "--colocate", "--name", name]
      if (input.branch) args.push("--revision", input.branch)
      args.push("--", input.directory)
      await runJj(input.sourceDirectory, args, signal)
      const initial = await workingCopy(input.directory, signal)
      await writeFile(join(input.directory, ".jj", workspaceMarker), JSON.stringify({ version: 1, name, initial, originRoot, colocated: true }), { flag: "wx" })
      return { directory: input.directory }
    },
    list: async (sourceDirectory, { signal }) => {
      const sourceRoot = (await runJj(sourceDirectory, ["root"], signal)).trim()
      const entries = await workspaceList(sourceDirectory, signal)
      const source = entries.find((workspace) => workspace.root === sourceRoot)
      const marker = source && await readMarker(sourceRoot)
      const isManaged = source && marker && marker.name === source.name
      const originRoot = isManaged ? (marker.originRoot ?? entries.find((workspace) => workspace.name === "default")?.root) : sourceRoot
      const result: { directory: string; type: "root" | "worktree" }[] = []
      for (const workspace of entries) {
        if (!workspace.root) continue
        if (workspace.root === originRoot) {
          result.push({ directory: workspace.root, type: "root" })
        } else if ((await readMarker(workspace.root))?.name === workspace.name) {
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
      const marker = await readMarker(directory)
      if (!workspace || marker?.name !== workspace.name) {
        throw new Error("Refusing to remove a workspace not created by OpenCode")
      }

      if (!input.force) {
        const state = await workingCopy(directory, signal)
        if (!state.empty || state.description || state.change !== marker.initial?.change || JSON.stringify(state.parents) !== JSON.stringify(marker.initial?.parents)) {
          throw new Worktree.OperationError({ message: "Workspace has changes or a description", forceRequired: true })
        }
        const tracked = new Set((await runJj(directory, ["file", "list", "-T", 'json(path) ++ "\\n"'], signal)).split("\n").filter(Boolean).map((line) => JSON.parse(line) as string))
        const visit = async (dir: string): Promise<boolean> => {
          for (const entry of await readdir(dir, { withFileTypes: true })) {
            const path = join(dir, entry.name)
            const name = relative(directory, path).split(sep).join("/")
            if (name === ".jj" || (name === ".git" && marker.colocated === true && entry.isFile())) continue
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
      await runJj(directory, ["workspace", "forget", "--", workspace.name], signal)
      await rm(directory, { recursive: true })
    },
  }
}
