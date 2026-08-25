import { spawn } from 'node:child_process'

export class CcusageRunError extends Error {
  constructor(
    message: string,
    readonly stderr: string,
    readonly exitCode: number | null
  ) {
    super(message)
    this.name = 'CcusageRunError'
  }
}

interface RunResult {
  stdout: string
  stderr: string
  exitCode: number | null
}

/**
 * 在 Windows 上执行可执行文件/shim。
 * npm/Volta 全局安装的 .cmd/.bat shim 必须经由 cmd.exe 执行;
 * 参数以数组传递,只对内部分叉的固定参数做引号包裹,不拼接用户输入。
 */
export function runExecutable(file: string, args: string[], timeoutMs = 60_000): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const isShim = /\.(cmd|bat)$/i.test(file)
    let command: string
    let commandArgs: string[]
    if (isShim) {
      // cmd.exe /s /c 的引号规则:整条命令必须再包一层引号,
      // 否则首段带引号的路径会被错误解析
      const inner = [`"${file}"`, ...args.map(quoteArg)].join(' ')
      command = 'cmd.exe'
      commandArgs = ['/d', '/s', '/c', `"${inner}"`]
    } else {
      command = file
      commandArgs = args
    }

    const child = spawn(command, commandArgs, {
      windowsHide: true,
      // cmd.exe 分支已自行完成引号包裹,禁止 Node 再次转义
      windowsVerbatimArguments: isShim
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []

    const timer = setTimeout(() => {
      child.kill()
      reject(new CcusageRunError(`ccusage invocation timed out after ${timeoutMs}ms`, '', null))
    }, timeoutMs)

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(new CcusageRunError(`failed to start ccusage: ${err.message}`, '', null))
    })
    child.on('close', (exitCode) => {
      clearTimeout(timer)
      resolve({
        stdout: Buffer.concat(stdout).toString('utf-8'),
        stderr: Buffer.concat(stderr).toString('utf-8'),
        exitCode
      })
    })
  })
}

function quoteArg(arg: string): string {
  return /[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg
}

/** 执行 ccusage 并返回 stdout;非零退出抛错(携带 stderr 摘要)。 */
export async function runCcusage(ccusagePath: string, args: string[], timeoutMs?: number): Promise<string> {
  const result = await runExecutable(ccusagePath, args, timeoutMs)
  if (result.exitCode !== 0) {
    throw new CcusageRunError(
      `ccusage exited with code ${result.exitCode}`,
      result.stderr.trim().slice(0, 2000),
      result.exitCode
    )
  }
  return result.stdout
}

/** 执行 ccusage 并把 stdout 解析为 JSON。 */
export async function runCcusageJson(ccusagePath: string, args: string[], timeoutMs?: number): Promise<unknown> {
  const stdout = await runCcusage(ccusagePath, args, timeoutMs)
  try {
    return JSON.parse(stdout)
  } catch {
    throw new CcusageRunError('ccusage did not return valid JSON', stdout.slice(0, 2000), null)
  }
}
