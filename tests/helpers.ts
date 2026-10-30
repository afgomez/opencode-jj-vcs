import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import plugin from "../src/index"

const directories: string[] = []

export function cleanupRepositories() {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
}

export function repository(colocated = true) {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), "opencode-jj-test-"))
  directories.push(directory)
  const root = join(directory, "repo")
  mkdirSync(root)
  execFileSync("jj", ["git", "init", colocated ? "--colocate" : "--no-colocate", root], { stdio: "pipe" })
  return { directory, root }
}

export async function setup(directory: string) {
  let vcs: any
  let worktree: any
  let context: any
  let selected: string | undefined
  await plugin.setup({
    location: { directory },
    vcs: { transform: async (fn: any) => fn({ add: (value: any) => { vcs = value }, default: { set: (value: string) => { selected = value } } }) },
    worktree: { transform: async (fn: any) => fn({ add: (value: any) => { worktree = value } }) },
    session: { hook: async (_name: string, fn: any) => { context = fn } },
  } as any)
  return { vcs, worktree, context, selected }
}
