import { afterEach, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { cleanupRepositories, repository, setup } from "./helpers"

afterEach(cleanupRepositories)

test("uses the working-copy change ID when no bookmark is available", async () => {
  const { root } = repository()
  const expected = execFileSync("jj", ["log", "-r", "@", "--no-graph", "-T", "format_short_change_id_with_change_offset(self)"], { cwd: root, encoding: "utf8" }).trim()
  const { vcs } = await setup(root)
  const scope = { directory: root, worktree: root, canonical: root }
  expect((await vcs.info(scope, { signal: new AbortController().signal })).branch.current).toBe(expected)
  expect(expected.length).toBeGreaterThanOrEqual(8)
})

test("reading the fallback change ID does not snapshot the working copy", async () => {
  const { root } = repository()
  const jj = (...args: string[]) => execFileSync("jj", args, { cwd: root, encoding: "utf8" }).trim()
  const operation = () => jj("--ignore-working-copy", "op", "log", "--no-graph", "-n", "1", "-T", "id")
  const before = operation()
  writeFileSync(join(root, "unsnapshotted"), "pending\n")
  const { vcs } = await setup(root)
  const scope = { directory: root, worktree: root, canonical: root }
  await vcs.info(scope, { signal: new AbortController().signal })
  expect(operation()).toBe(before)
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

test("handles unusual filenames and respects the diff byte budget", async () => {
  const { root } = repository()
  const filename = 'a "quoted"\nfile'
  writeFileSync(join(root, filename), "hello\n")
  const { vcs } = await setup(root)
  const scope = { directory: root, worktree: root, canonical: root }
  const context = { signal: new AbortController().signal }
  const input = { ...scope, mode: "working", context: 3, maxOutputBytes: 10000 }
  const diffs = await vcs.diff(input, context)
  expect(diffs.map((diff: any) => diff.file)).toEqual([filename])
  expect(diffs[0].additions).toBe(1)
  expect(await vcs.diff({ ...input, maxOutputBytes: 1 }, context)).toEqual([])
})
