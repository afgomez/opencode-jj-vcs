import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Plugin } from "@opencode/plugin"
import type { ModelHooks } from "@opencode/plugin/promise/registration"
import type { SessionContext, SessionHooks } from "@opencode/plugin/promise/session"
import type { VcsDefinition } from "@opencode/plugin/promise/vcs"
import type { WorktreeDefinition } from "@opencode/plugin/promise/worktree"
import plugin from "../src/index"

const directories: string[] = []

export function cleanupRepositories() {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
}

export function runJj(cwd: string, ...args: string[]) {
  return execFileSync("jj", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim()
}

export function repository(colocated = true) {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), "opencode-jj-test-"))
  directories.push(directory)
  const root = join(directory, "repo")
  mkdirSync(root)
  runJj(directory, "git", "init", colocated ? "--colocate" : "--no-colocate", root)
  return { directory, root, jj: (...args: string[]) => runJj(root, ...args) }
}

export async function setup(directory: string) {
  let vcs: VcsDefinition | undefined
  let worktree: WorktreeDefinition | undefined
  let context: ((event: SessionContext) => Promise<void> | void) | undefined
  let selected: string | undefined
  const registration = { dispose: async () => {} }
  const vcsTransform: Plugin.Context["vcs"]["transform"] = async (fn) => {
    fn({
      add: (value) => { vcs = value },
      default: {
        get: () => selected,
        set: (value) => { selected = value },
      },
    })
    return registration
  }
  const worktreeTransform: Plugin.Context["worktree"]["transform"] = async (fn) => {
    fn({ add: (value) => { worktree = value } })
    return registration
  }
  const hook: ModelHooks<Pick<SessionHooks, "context">> = async (_name, fn) => {
    context = fn
    return registration
  }
  const ctx = {
    location: { directory },
    vcs: { transform: vcsTransform },
    worktree: { transform: worktreeTransform },
    session: { hook },
  }
  // Only the capabilities used by this plugin are implemented by the test harness.
  await plugin.setup(ctx as Plugin.Context)
  return { vcs, worktree, context, selected }
}
