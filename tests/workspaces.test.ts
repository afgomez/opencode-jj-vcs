import { afterEach, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { existsSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { createWorkspaceStrategy } from "../src/workspaces"
import { cleanupRepositories, repository } from "./helpers"

afterEach(cleanupRepositories)

test("manages workspaces and protects modified files", async () => {
  const { directory, root } = repository()
  const worktree = createWorkspaceStrategy()
  const context = { signal: new AbortController().signal }
  const target = join(directory, "workspace")
  await worktree.create({ sourceDirectory: root, directory: target }, context)
  expect((await worktree.list(root, context)).some((entry) => entry.directory === target)).toBe(true)
  expect(existsSync(join(target, ".git"))).toBe(true)
  const reverse = await worktree.list(target, context)
  expect(reverse).toContainEqual({ directory: root, type: "root" })
  expect(reverse).toContainEqual({ directory: target, type: "worktree" })
  writeFileSync(join(target, "changed"), "data\n")
  await expect(worktree.remove({ directory: target, force: false }, context)).rejects.toThrow("Workspace has changes")
  await worktree.remove({ directory: target, force: true }, context)
})

test("protects ignored files and removes pristine workspaces", async () => {
  const { directory, root } = repository()
  writeFileSync(join(root, ".gitignore"), "ignored\n")
  execFileSync("jj", ["new"], { cwd: root, stdio: "pipe" })
  const worktree = createWorkspaceStrategy()
  const context = { signal: new AbortController().signal }
  const target = join(directory, "workspace")
  await worktree.create({ sourceDirectory: root, directory: target }, context)
  writeFileSync(join(target, "ignored"), "important")
  await expect(worktree.remove({ directory: target, force: false }, context)).rejects.toThrow("ignored or untracked")
  expect(existsSync(join(target, "ignored"))).toBe(true)
  await worktree.remove({ directory: target, force: true }, context)
  const clean = join(directory, "clean")
  await worktree.create({ sourceDirectory: root, directory: clean }, context)
  await worktree.remove({ directory: clean, force: false }, context)
  expect(existsSync(clean)).toBe(false)
})

test("protects changed workspace history and unmanaged workspaces", async () => {
  const { directory, root } = repository()
  const worktree = createWorkspaceStrategy()
  const context = { signal: new AbortController().signal }
  const target = join(directory, "workspace")
  await worktree.create({ sourceDirectory: root, directory: target }, context)
  execFileSync("jj", ["new"], { cwd: target, stdio: "pipe" })
  await expect(worktree.remove({ directory: target, force: false }, context)).rejects.toThrow("Workspace has changes")
  await worktree.remove({ directory: target, force: true }, context)
  const unmanaged = join(directory, "unmanaged")
  execFileSync("jj", ["workspace", "add", "--no-colocate", unmanaged], { cwd: root, stdio: "pipe" })
  expect((await worktree.list(root, context)).some((entry) => entry.directory === unmanaged)).toBe(false)
  await expect(worktree.remove({ directory: unmanaged, force: true }, context)).rejects.toThrow("not created by OpenCode")
  expect(existsSync(unmanaged)).toBe(true)
})

test("lists the default workspace from an older non-colocated managed workspace", async () => {
  const { directory, root } = repository()
  const worktree = createWorkspaceStrategy()
  const context = { signal: new AbortController().signal }
  const legacy = join(directory, "legacy")
  execFileSync("jj", ["workspace", "add", "--no-colocate", "--name", "legacy", legacy], { cwd: root, stdio: "pipe" })
  writeFileSync(join(legacy, ".jj", "opencode-workspace.json"), JSON.stringify({ version: 1, name: "legacy" }))
  const entries = await worktree.list(legacy, context)
  expect(entries).toContainEqual({ directory: root, type: "root" })
  expect(entries).toContainEqual({ directory: legacy, type: "worktree" })
  const child = join(directory, "child")
  await worktree.create({ sourceDirectory: legacy, directory: child }, context)
  expect(await worktree.list(child, context)).toContainEqual({ directory: root, type: "root" })
  await worktree.remove({ directory: child, force: false }, context)
})

test("creates and removes a colocated workspace from a non-colocated repository", async () => {
  const { directory, root } = repository(false)
  const worktree = createWorkspaceStrategy()
  const context = { signal: new AbortController().signal }
  const target = join(directory, "workspace")
  await worktree.create({ sourceDirectory: root, directory: target }, context)
  expect(existsSync(join(target, ".git"))).toBe(true)
  expect(await worktree.list(target, context)).toContainEqual({ directory: root, type: "root" })
  await worktree.remove({ directory: target, force: false }, context)
  expect(existsSync(target)).toBe(false)
})
