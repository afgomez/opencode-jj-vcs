import { Plugin } from "@opencode/plugin"
import { instructions } from "./instructions"
import { findRepository } from "./jj"
import { createVcsProvider } from "./vcs"
import { createWorkspaceStrategy } from "./workspaces"

export default Plugin.define({
  id: "jj-support",
  async setup(ctx) {
    const root = await findRepository(ctx.location.directory)
    if (!root) return

    await ctx.vcs.transform((editor) => {
      editor.add(createVcsProvider(root))
      editor.default.set("jj")
    })
    await ctx.worktree.transform((editor) => {
      editor.add(createWorkspaceStrategy())
    })
    await ctx.session.hook("context", (event) => {
      event.system.push({ type: "text", text: instructions })
    })
  },
})
