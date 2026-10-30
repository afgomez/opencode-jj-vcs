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
  expect(event.system).toEqual([{ type: "text", text: instructions }])
})
