import type { VcsDefinition, VcsDiffInput } from "@opencode/plugin/promise/vcs"
import { runJj } from "./jj"

export function createVcsProvider(root: string): VcsDefinition {
  const run = (args: string[], signal: AbortSignal) => runJj(root, args, signal)

  const bookmarks = async (signal: AbortSignal) => {
    const output = await run(["bookmark", "list", "-T", 'name ++ "\\0"'], signal)
    return [...new Set(output.split("\0").filter(Boolean))]
  }

  const files = async (input: Pick<VcsDiffInput, "mode" | "base" | "context" | "maxOutputBytes">, signal: AbortSignal) => {
    const range = input.mode === "working"
      ? ["-r", "@"]
      : ["--from", input.base ?? "trunk()", "--to", input.mode === "committed" ? "@-" : "@"]
    const entries = (await run(["diff", ...range, "-T", 'status ++ "\\0" ++ path ++ "\\0"'], signal)).split("\0")
    const result = []
    let remaining = input.maxOutputBytes
    for (let i = 0; i + 1 < entries.length; i += 2) {
      const [kind, file] = [entries[i], entries[i + 1]]
      if (!file) continue
      const patch = await run(["diff", ...range, "--git", "--context", String(input.context), "--", `root-file:${JSON.stringify(file)}`], signal)
      const size = Buffer.byteLength(patch)
      if (size > remaining) break
      remaining -= size
      let additions = 0
      let deletions = 0
      let inHunk = false
      for (const line of patch.split("\n")) {
        if (line.startsWith("@@ ")) inHunk = true
        else if (inHunk && line.startsWith("+")) additions++
        else if (inHunk && line.startsWith("-")) deletions++
      }
      const status = kind === "added" ? "added" : kind === "removed" ? "deleted" : "modified"
      result.push({ file, patch, additions, deletions, status } as const)
    }
    return result
  }

  return {
    id: "jj",
    name: "Jujutsu",
    info: async (_scope, { signal }) => {
      let current = (await run([
        "log", "--ignore-working-copy", "-n", "1", "--no-graph",
        "-r", "coalesce(ancestors(present(@)) & bookmarks(), root())",
        "-T", 'if(root, "root()", bookmarks.join(" "))',
      ], signal)).trim()
      if (current === "root()") {
        current = (await run(["log", "--ignore-working-copy", "-r", "@", "--no-graph", "-T", "format_short_change_id_with_change_offset(self)"], signal)).trim()
      }
      return { provider: "jj", branch: { current, default: "trunk()" } }
    },
    base: async () => ({ name: "trunk()", ref: "trunk()", source: "default" }),
    branches: async (input, { signal }) => {
      const names = await bookmarks(signal)
      const filtered = input.search ? names.filter((name) => name.includes(input.search!)) : names
      return input.limit === undefined ? filtered : filtered.slice(0, input.limit)
    },
    status: async (_scope, { signal }) => {
      const changes = await files({ mode: "working", context: 3, maxOutputBytes: Number.POSITIVE_INFINITY }, signal)
      return changes.map(({ file, additions, deletions, status }) => ({ file, additions, deletions, status }))
    },
    diff: (input, { signal }) => files(input, signal),
  }
}
