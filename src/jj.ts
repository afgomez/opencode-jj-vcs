import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const maxBuffer = 16 * 1024 * 1024

export async function runJj(cwd: string, args: string[], signal: AbortSignal): Promise<string> {
  const { stdout } = await execFileAsync("jj", ["--no-pager", "--color", "never", ...args], {
    cwd, signal, maxBuffer,
  })
  return stdout
}

export async function findRepository(directory: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("jj", ["root"], { cwd: directory, timeout: 5000 })
    return stdout.trim()
  } catch {
    // jj is unavailable, this is not a jj repository, or detection failed.
    return undefined
  }
}
