import { expect, test } from "bun:test"
import { instructions } from "../src/instructions"

test("requires an empty working copy after finalizing a commit", () => {
  expect(instructions).toContain("After committing or amending, always leave @ as a fresh, empty, undescribed working-copy commit")
  expect(instructions).toContain('Prefer jj commit -m "message"')
  expect(instructions).toContain("jj describe only changes a description")
  expect(instructions).toContain("run jj new afterward to create the empty child")
  expect(instructions).toContain("Do not create another child if @ is already an empty, undescribed child")
})

test("requires verification without sacrificing unrelated changes", () => {
  expect(instructions).toContain("verify the final state with jj status and jj diff --git")
  expect(instructions).toContain("the finalized commit must be its parent (@-)")
  expect(instructions).toContain("Never discard unrelated changes or commit them without authorization")
  expect(instructions).toContain("preserve them and report the blocker")
})

test("links stacked PRs on GitHub", () => {
  expect(instructions).toContain("link them with gh stack link so GitHub recognizes the stack")
  expect(instructions).toContain("in stack order, from bottom to top")
  expect(instructions).toContain("gh stack link cannot set PR titles or descriptions")
  expect(instructions).toContain("push the bookmarks with jj git push and create the PRs with gh pr create first")
  expect(instructions).toContain("Do not use other gh stack commands")
})
