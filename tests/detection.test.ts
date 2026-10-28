import { afterEach, expect, test } from "bun:test"
import { cleanupRepositories, repository, setup } from "./helpers"

afterEach(cleanupRepositories)

test("registers only in jj repositories and injects instructions", async () => {
  const { directory, root } = repository()
  expect((await setup(directory)).vcs).toBeUndefined()
  const plugin = await setup(root)
  expect(plugin.selected).toBe("jj")
  const event = { system: [] as { text: string }[] }
  plugin.context(event)
  expect(event.system[0].text).toContain("append --git")
})
