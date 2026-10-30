import { afterEach, expect, test } from "bun:test"
import { Agent, Model } from "@opencode/plugin"
import type { SessionContext } from "@opencode/plugin/promise/session"
import { Session } from "@opencode/schema/session"
import { cleanupRepositories, repository, setup } from "./helpers"

afterEach(cleanupRepositories)

test("registers only in jj repositories and injects instructions", async () => {
  const { directory, root } = repository()
  expect((await setup(directory)).vcs).toBeUndefined()
  const plugin = await setup(root)
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
  expect(event.system[0].text).toContain("append --git")
})
