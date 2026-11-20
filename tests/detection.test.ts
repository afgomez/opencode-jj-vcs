import { afterEach, expect, test } from "bun:test"
import { Agent, Model } from "@opencode/plugin"
import type { SessionContext } from "@opencode/plugin/promise/session"
import { Session } from "@opencode/schema/session"
import { instructions } from "../src/instructions"
import { cleanupRepositories, repository, setup } from "./helpers"

afterEach(cleanupRepositories)

test("does not register providers, hooks, or a default outside jj repositories", async () => {
  const { directory } = repository()
  expect(await setup(directory)).toEqual({ vcs: undefined, worktree: undefined, context: undefined, selected: undefined })
})

test("registers jj providers and injects the expected instructions", async () => {
  const { root } = repository()
  const plugin = await setup(root)
  expect(plugin.vcs?.id).toBe("jj")
  expect(plugin.worktree?.id).toBe("jj")
  expect(plugin.selected).toBe("jj")
  const event: SessionContext = {
    sessionID: Session.ID.create(),
    agent: Agent.ID.make("test"),
    model: Model.Ref.parse("opencode/test"),
    system: [],
    messages: [],
    options: {},
    tools: {},
  }
  if (!plugin.context) throw new Error("Context hook was not registered")
  await plugin.context(event)
  expect(instructions).toStartWith("This directory is in a Jujutsu (jj) repository.")
  expect(event.system).toEqual([{ type: "text", text: instructions }])
  expect(event.options).toEqual({})
})

test("adds the instructions to the Claude Agent harness system prompt", async () => {
  const { root } = repository()
  const plugin = await setup(root)
  if (!plugin.context) throw new Error("Context hook was not registered")
  const event = (claudeCodeInstructions: string): SessionContext => ({
    sessionID: Session.ID.create(),
    agent: Agent.ID.make("test"),
    model: Model.Ref.parse("claude-agent/claude-opus-5-5"),
    system: [],
    messages: [],
    options: { claudeCodeInstructions },
    tools: {},
  })

  const existing = event("Project instructions")
  await plugin.context(existing)
  expect(existing.options.claudeCodeInstructions).toBe(`Project instructions\n${instructions}`)

  const empty = event("")
  await plugin.context(empty)
  expect(empty.options.claudeCodeInstructions).toBe(instructions)
})
