import { runWsl } from './executor'
import type { DetectResult } from '../../shared/usage-model'

const VERSION_PATTERN = /(\d+\.\d+\.\d+(?:[-+][\w.]+)?)/
/** 发行版冷启动可达数十秒,探测给足余量但也不无限等 */
const PROBE_TIMEOUT_MS = 30_000
const VERSION_TIMEOUT_MS = 15_000

/** WSL 侧定位结果:reason 区分 WSL 未装 / 发行版内无 ccusage,供 Settings 状态行展示 */
export interface WslDetectResult extends DetectResult {
  reason?: string
}

/**
 * 定位默认发行版内的 ccusage,三步全部 fail-soft:
 * 1. `wsl.exe -e true` 确认 WSL 可用(未装 WSL / 无发行版在此失败)
 * 2. `bash -lc 'command -v ccusage'` 找路径;login shell 拿不到时(如 nvm 把
 *    PATH 放在 .bashrc)再试 `bash -ic` 交互式 shell
 * 3. `<路径> --version` 读版本
 */
export async function locateWslCcusage(): Promise<WslDetectResult> {
  const wslOk = await isWslAvailable()
  if (!wslOk) {
    return { found: false, reason: 'WSL is not installed or has no default distro' }
  }

  const path = await findCcusagePath()
  if (!path) {
    return { found: false, reason: 'ccusage was not found inside WSL' }
  }

  const version = await readVersion(path)
  if (!version) {
    return { found: false, reason: `ccusage at ${path} did not report a version` }
  }
  return { found: true, path, version }
}

async function isWslAvailable(): Promise<boolean> {
  try {
    await runWsl(['true'], PROBE_TIMEOUT_MS)
    return true
  } catch {
    return false
  }
}

async function findCcusagePath(): Promise<string | null> {
  // login shell 读 .profile/.bash_profile(Ubuntu 默认会 source .bashrc);
  // nvm 等仅在 .bashrc 里导出 PATH 时,再试交互式 shell 兜底。
  // WSL 默认把 Windows PATH 追加在末尾(appendWindowsPath),command -v 可能
  // 找到 /mnt/c/... 下挂载的 Windows 安装(如 Volta shim)——那不是 WSL 原生
  // 安装,执行会扫到 Windows 侧数据造成双算,必须排除。
  for (const shellArgs of [
    ['bash', '-lc', 'command -v ccusage'],
    ['bash', '-ic', 'command -v ccusage']
  ] as const) {
    try {
      const { stdout } = await runWsl([...shellArgs], PROBE_TIMEOUT_MS)
      const lines = stdout.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
      // 交互 shell 的提示行(job control 警告等)可能混入 stdout,只认绝对路径
      const path = lines.find((p) => p.startsWith('/') && !p.startsWith('/mnt/'))
      if (path) return path
    } catch {
      // 该 shell 形态失败(或 PATH 里没有),试下一个
    }
  }
  return null
}

async function readVersion(ccusagePath: string): Promise<string | null> {
  try {
    const { stdout } = await runWsl([ccusagePath, '--version'], VERSION_TIMEOUT_MS)
    const match = stdout.match(VERSION_PATTERN)
    return match ? match[1] : null
  } catch {
    return null
  }
}
