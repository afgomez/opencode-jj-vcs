import { expect, test } from "bun:test"
import { instructions } from "../src/instructions"

test("requires an empty working copy after finalizing a commit", () => {
  expect(instructions).toContain("After committing or amending, leave @ as a new, empty, undescribed commit whose parent is the finalized commit")
  expect(instructions).toContain('Prefer jj commit -m "message"')
  expect(instructions).toContain("jj describe, jj squash, jj edit, or any other command that leaves @ on the finalized commit, run jj new afterward")
  expect(instructions).toContain("unless @ is already an empty, undescribed child of it")
})

test("requires verification without sacrificing unrelated changes", () => {
  expect(instructions).toContain("Before reporting the commit as done, confirm this with jj status")
  expect(instructions).toContain("If unrelated changes keep @ from being empty, keep them and tell the user")
  expect(instructions).toContain("do not discard them or commit them without permission")
})

test("links stacked PRs on GitHub", () => {
  expect(instructions).toContain("link them with gh stack link so GitHub recognizes the stack")
  expect(instructions).toContain("in stack order, from bottom to top")
  expect(instructions).toContain("gh stack link cannot set PR titles or descriptions")
  expect(instructions).toContain("push the bookmarks with jj git push and create the PRs with gh pr create first")
  expect(instructions).toContain("Do not use other gh stack commands")
})
