import { afterEach, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs"
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

test("removes pristine workspaces with nested tracked files and symlinks", async () => {
  const { directory, root } = repository()
  const nested = join(root, "nested dir", "deep")
  mkdirSync(nested, { recursive: true })
  writeFileSync(join(nested, "tracked"), "base\n")
  symlinkSync("tracked", join(nested, "tracked-link"))
  execFileSync("jj", ["new"], { cwd: root, stdio: "pipe" })
  const worktree = createWorkspaceStrategy()
  const context = { signal: new AbortController().signal }
  const target = join(directory, "workspace")
  await worktree.create({ sourceDirectory: root, directory: target }, context)
  expect(readFileSync(join(target, "nested dir", "deep", "tracked-link"), "utf8")).toBe("base\n")
  await worktree.remove({ directory: target, force: false }, context)
  expect(existsSync(target)).toBe(false)
})

test.each(["empty directory", "ignored file", "ignored symlink"])("protects nested %s beside tracked files", async (kind) => {
  const { directory, root } = repository()
  const nested = join("nested dir", "deep")
  mkdirSync(join(root, nested), { recursive: true })
  writeFileSync(join(root, nested, "tracked"), "base\n")
  writeFileSync(join(root, ".gitignore"), "ignored\n")
  execFileSync("jj", ["new"], { cwd: root, stdio: "pipe" })
  const worktree = createWorkspaceStrategy()
  const context = { signal: new AbortController().signal }
  const target = join(directory, "workspace")
  await worktree.create({ sourceDirectory: root, directory: target }, context)
  const external = join(directory, "important")
  writeFileSync(external, "preserve me\n")
  const extra = join(target, nested, kind === "empty directory" ? "empty" : "ignored")
  if (kind === "empty directory") mkdirSync(extra)
  else if (kind === "ignored symlink") symlinkSync(external, extra)
  else writeFileSync(extra, "important\n")
  await expect(worktree.remove({ directory: target, force: false }, context)).rejects.toThrow("ignored or untracked")
  expect(existsSync(extra)).toBe(true)
  await worktree.remove({ directory: target, force: true }, context)
  expect(existsSync(target)).toBe(false)
  expect(readFileSync(external, "utf8")).toBe("preserve me\n")
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

test("refuses removal through direct symlinks and symlinked ancestors even with force", async () => {
  const { directory, root } = repository()
  const worktree = createWorkspaceStrategy()
  const context = { signal: new AbortController().signal }
  const target = join(directory, "workspace")
  await worktree.create({ sourceDirectory: root, directory: target }, context)
  writeFileSync(join(target, "important"), "preserve me\n")
  const direct = join(directory, "workspace-link")
  symlinkSync(target, direct, "dir")
  const ancestor = join(directory, "directory-link")
  symlinkSync(directory, ancestor, "dir")
  for (const path of [direct, join(ancestor, "workspace")]) {
    for (const force of [false, true]) {
      await expect(worktree.remove({ directory: path, force }, context)).rejects.toThrow("through a symlink")
      expect(readFileSync(join(target, "important"), "utf8")).toBe("preserve me\n")
      expect(existsSync(path)).toBe(true)
    }
  }
  expect(await worktree.list(root, context)).toContainEqual({ directory: target, type: "worktree" })
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

test("preserves the original non-default workspace when nesting managed workspaces", async () => {
  const { directory, root } = repository()
  const worktree = createWorkspaceStrategy()
  const context = { signal: new AbortController().signal }
  const source = join(directory, "source")
  execFileSync("jj", ["workspace", "add", "--colocate", "--name", "source", source], { cwd: root, stdio: "pipe" })
  const parent = join(directory, "parent")
  await worktree.create({ sourceDirectory: source, directory: parent }, context)
  const child = join(directory, "child")
  await worktree.create({ sourceDirectory: parent, directory: child }, context)
  const entries = await worktree.list(child, context)
  expect(entries).toContainEqual({ directory: source, type: "root" })
  expect(entries).toContainEqual({ directory: parent, type: "worktree" })
  expect(entries).toContainEqual({ directory: child, type: "worktree" })
  expect(entries.some((entry) => entry.directory === root)).toBe(false)
  await worktree.remove({ directory: child, force: false }, context)
  await worktree.remove({ directory: parent, force: false }, context)
})

test("does not inherit an origin root from a marker owned by another workspace", async () => {
  const { directory, root } = repository()
  const worktree = createWorkspaceStrategy()
  const context = { signal: new AbortController().signal }
  const source = join(directory, "source")
  await worktree.create({ sourceDirectory: root, directory: source }, context)
  const markerPath = join(source, ".jj", "opencode-workspace.json")
  const marker = JSON.parse(readFileSync(markerPath, "utf8"))
  writeFileSync(markerPath, JSON.stringify({ ...marker, name: "another-workspace" }))
  expect(await worktree.list(source, context)).toEqual([{ directory: source, type: "root" }])
  const child = join(directory, "child")
  await worktree.create({ sourceDirectory: source, directory: child }, context)
  const entries = await worktree.list(child, context)
  expect(entries).toContainEqual({ directory: source, type: "root" })
  expect(entries).toContainEqual({ directory: child, type: "worktree" })
  expect(entries.some((entry) => entry.directory === root)).toBe(false)
  await worktree.remove({ directory: child, force: false }, context)
})

test("rejects malformed markers even when they name the current workspace", async () => {
  const { directory, root } = repository()
  const worktree = createWorkspaceStrategy()
  const context = { signal: new AbortController().signal }
  const target = join(directory, "workspace")
  await worktree.create({ sourceDirectory: root, directory: target }, context)
  const markerPath = join(target, ".jj", "opencode-workspace.json")
  const marker: Record<string, unknown> = JSON.parse(readFileSync(markerPath, "utf8"))
  const initial = { empty: true, description: "", change: "change", parents: ["parent"] }
  const invalidMarkers = [
    "{", "null", "[]",
    ...[
      { version: 2 },
      { name: 1 },
      { name: "" },
      { originRoot: 1 },
      { originRoot: "relative/path" },
      { originRoot: null },
      { colocated: "true" },
      { colocated: null },
      { initial: null },
      { initial: [] },
      { initial: { ...initial, empty: "true" } },
      { initial: { ...initial, description: false } },
      { initial: { ...initial, change: "" } },
      { initial: { ...initial, change: 1 } },
      { initial: { ...initial, parents: "parent" } },
      { initial: { ...initial, parents: [1] } },
      { initial: {} },
    ].map((fields) => JSON.stringify({ ...marker, ...fields })),
  ]
  for (const contents of invalidMarkers) {
    writeFileSync(markerPath, contents)
    expect(await worktree.list(root, context), contents).toEqual([{ directory: root, type: "root" }])
    for (const force of [false, true]) {
      await expect(worktree.remove({ directory: target, force }, context), contents).rejects.toThrow("not created by OpenCode")
    }
    expect(existsSync(target), contents).toBe(true)
  }
  const child = join(directory, "child")
  await worktree.create({ sourceDirectory: target, directory: child }, context)
  expect(await worktree.list(child, context)).toContainEqual({ directory: target, type: "root" })
  await worktree.remove({ directory: child, force: false }, context)
})

test("persists compact baselines and accepts older initial state fields", async () => {
  const { directory, root } = repository()
  const worktree = createWorkspaceStrategy()
  const context = { signal: new AbortController().signal }
  const target = join(directory, "workspace")
  await worktree.create({ sourceDirectory: root, directory: target }, context)
  const markerPath = join(target, ".jj", "opencode-workspace.json")
  const marker: { initial: { change: string; parents: string[] } } = JSON.parse(readFileSync(markerPath, "utf8"))
  expect(marker.initial).toEqual({ change: expect.any(String), parents: [expect.any(String)] })
  writeFileSync(markerPath, JSON.stringify({ ...marker, initial: { ...marker.initial, empty: true, description: "" } }))
  expect(await worktree.list(root, context)).toContainEqual({ directory: target, type: "worktree" })
  await worktree.remove({ directory: target, force: false }, context)
  expect(existsSync(target)).toBe(false)
})

test("requires force to remove a valid legacy marker without initial state", async () => {
  const { directory, root } = repository()
  const worktree = createWorkspaceStrategy()
  const context = { signal: new AbortController().signal }
  const target = join(directory, "workspace")
  await worktree.create({ sourceDirectory: root, directory: target }, context)
  const markerPath = join(target, ".jj", "opencode-workspace.json")
  const marker: Record<string, unknown> = JSON.parse(readFileSync(markerPath, "utf8"))
  writeFileSync(markerPath, JSON.stringify({ version: 1, name: marker.name }))
  expect(await worktree.list(root, context)).toContainEqual({ directory: target, type: "worktree" })
  await expect(worktree.remove({ directory: target, force: false }, context)).rejects.toThrow("Workspace has changes")
  expect(existsSync(target)).toBe(true)
  await worktree.remove({ directory: target, force: true }, context)
  expect(existsSync(target)).toBe(false)
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
