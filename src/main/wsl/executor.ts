import { spawn } from 'node:child_process'

/**
 * 在 WSL(默认发行版)内执行命令。
 * `wsl.exe -e` 直接 execv,不经 shell,参数按原样透传;
 * Linux 程序的 stdout(UTF-8)原样返回,wsl.exe 自身的 UTF-16 输出只出现在错误路径。
 */
export class WslRunError extends Error {
  constructor(
    message: string,
    readonly stderr: string,
    readonly exitCode: number | null
  ) {
    super(message)
    this.name = 'WslRunError'
  }
}

interface RunResult {
  stdout: string
  stderr: string
  exitCode: number | null
}

/**
 * 执行 `wsl.exe -e <argv...>` 并收集输出。
 * 任何失败(WSL 未安装、无发行版、命令不存在、超时)都以 WslRunError 拒绝,
 * 由调用方 fail-soft 收敛,绝不影响 Windows 侧主链路。
 */
export function runWsl(argv: string[], timeoutMs = 60_000): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('wsl.exe', ['-e', ...argv], {
      windowsHide: true
    })

    const stdout: Buffer[] = []
    const stderr: Buffer[] = []

    const timer = setTimeout(() => {
      child.kill()
      reject(new WslRunError(`wsl invocation timed out after ${timeoutMs}ms`, '', null))
    }, timeoutMs)

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
    child.on('error', (err) => {
      clearTimeout(timer)
      // spawn 本身失败:wsl.exe 不存在(老版本 Windows)等
      reject(new WslRunError(`failed to start wsl.exe: ${err.message}`, '', null))
    })
    child.on('close', (exitCode) => {
      clearTimeout(timer)
      if (exitCode !== 0) {
        // wsl.exe 自身的报错(未装 WSL/无发行版)是 UTF-16,容错解码仅用于错误信息
        reject(
          new WslRunError(
            `wsl exited with code ${exitCode}`,
            decodeMaybeUtf16(Buffer.concat(stderr).toString('utf-8')),
            exitCode
          )
        )
        return
      }
      resolve({
        stdout: Buffer.concat(stdout).toString('utf-8'),
        stderr: Buffer.concat(stderr).toString('utf-8'),
        exitCode
      })
    })
  })
}

/** wsl.exe 的原生错误输出是 UTF-16LE,误按 UTF-8 解码会出现 \0 间隔;去掉空洞字符 */
function decodeMaybeUtf16(text: string): string {
  return text.replace(/\0/g, '').trim()
}

/** 执行 WSL 内命令并把 stdout 解析为 JSON。 */
export async function runWslJson(argv: string[], timeoutMs?: number): Promise<unknown> {
  const { stdout } = await runWsl(argv, timeoutMs)
  try {
    return JSON.parse(stdout)
  } catch {
    throw new WslRunError('wsl command did not return valid JSON', stdout.slice(0, 2000), null)
  }
}
