import { afterEach, expect, mock, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

class OperationError extends Error {
  forceRequired: boolean
  constructor(input: { message: string; forceRequired: boolean }) {
    super(input.message)
    this.forceRequired = input.forceRequired
  }
}

mock.module("@opencode/plugin", () => ({
  Plugin: { define: (plugin: unknown) => plugin },
  Worktree: { OperationError },
}))

const { default: plugin } = await import("../src/index")
const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function repository() {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), "opencode-jj-test-"))
  directories.push(directory)
  const root = join(directory, "repo")
  mkdirSync(root)
  execFileSync("jj", ["git", "init", root], { stdio: "pipe" })
  return { directory, root }
}

async function setup(directory: string) {
  let vcs: any
  let worktree: any
  let context: any
  let selected: string | undefined
  await plugin.setup({
    location: { directory },
    vcs: { transform: async (fn: any) => fn({ add: (value: any) => { vcs = value }, default: { set: (value: string) => { selected = value } } }) },
    worktree: { transform: async (fn: any) => fn({ add: (value: any) => { worktree = value } }) },
    session: { hook: async (_name: string, fn: any) => { context = fn } },
  } as any)
  return { vcs, worktree, context, selected }
}

test("registers only in jj repositories and injects instructions", async () => {
  const { directory, root } = repository()
  expect((await setup(directory)).vcs).toBeUndefined()
  const plugin = await setup(root)
  expect(plugin.selected).toBe("jj")
  const event = { system: [] as { text: string }[] }
  plugin.context(event)
  expect(event.system[0].text).toContain("append --git")
})

test("reports bookmarks and uses configured trunk for branch diffs", async () => {
  const { root } = repository()
  const jj = (...args: string[]) => execFileSync("jj", args, { cwd: root, stdio: "pipe" })
  writeFileSync(join(root, "original"), "base\n")
  jj("bookmark", "create", "development", "-r", "@")
  jj("config", "set", "--repo", 'revset-aliases."trunk()"', "development")
  jj("new")
  writeFileSync(join(root, "new file"), "new\n")
  const { vcs } = await setup(root)
  const scope = { directory: root, worktree: root, canonical: root }
  const context = { signal: new AbortController().signal }
  expect((await vcs.info(scope, context)).branch.current).toBe("development")
  expect((await vcs.base(scope, context)).ref).toBe("trunk()")
  const diffs = await vcs.diff({ ...scope, mode: "branch", context: 3, maxOutputBytes: 10000 }, context)
  expect(diffs.map((diff: any) => diff.file)).toEqual(["new file"])
  expect(diffs[0].patch).toContain("diff --git")
})

test("manages workspaces and protects modified files", async () => {
  const { directory, root } = repository()
  const { worktree } = await setup(root)
  const context = { signal: new AbortController().signal }
  const target = join(directory, "workspace")
  await worktree.create({ sourceDirectory: root, directory: target }, context)
  expect((await worktree.list(root, context)).some((entry: any) => entry.directory === target)).toBe(true)
  writeFileSync(join(target, "changed"), "data\n")
  await expect(worktree.remove({ directory: target, force: false }, context)).rejects.toThrow("Workspace has changes")
  await worktree.remove({ directory: target, force: true }, context)
})
