import { runWsl } from './executor'

/**
 * WSL(默认发行版)home 目录对应的 Windows UNC 路径发现:
 * `\\wsl.localhost\<distro>\home\<user>`。
 * 文件型数据源(zcode/dsh/kimi 凭据)经此路径直读 WSL 文件系统。
 * 结果模块级缓存;失败返回 null,下次刷新重试(发行版可能稍后启动)。
 *
 * WSL VM 休眠后的冷启动期间,并发的多个 wsl.exe 调用可能有的成功有的失败
 * (启动竞态);因此失败后短暂延迟重试一次,而不是直接放弃。
 */
let cachedUncHome: string | null = null

async function probeWslHome(): Promise<string | null> {
  try {
    const { stdout } = await runWsl(
      ['bash', '-lc', 'echo "$WSL_DISTRO_NAME $HOME"'],
      30_000
    )
    // 输出形如 "Ubuntu-24.04 /home/user";交互 shell 警告行等噪声只认两段式行
    const line = stdout
      .trim()
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => /^[\w.+-]+ \/home\/\S+$/.test(l))
    if (!line) return null
    const [distro, home] = line.split(/\s+/)
    if (!distro || !home.startsWith('/home/')) return null
    // Linux 绝对路径直接拼在 \\wsl.localhost\<distro> 之后
    return `\\\\wsl.localhost\\${distro}${home.replace(/\//g, '\\')}`
  } catch {
    return null
  }
}

/** 共享进行中的探测,避免并发重复 spawn wsl.exe(冷启动竞态下雪上加霜) */
let inflightProbe: Promise<string | null> | null = null

export function getWslHomeUncPath(): Promise<string | null> {
  if (cachedUncHome) return Promise.resolve(cachedUncHome)
  if (!inflightProbe) {
    inflightProbe = (async () => {
      let result = await probeWslHome()
      if (!result) {
        // 冷启动竞态兜底:稍等重试一次(此时第一个调用通常已完成唤醒)
        await new Promise((r) => setTimeout(r, 3_000))
        result = await probeWslHome()
      }
      if (result) cachedUncHome = result
      inflightProbe = null
      return result
    })()
  }
  return inflightProbe
}

/** 仅供测试:清空缓存 */
export function resetWslHomeCacheForTest(): void {
  cachedUncHome = null
  cachedWslIp = null
}

let cachedWslIp: string | null = null

/**
 * WSL(默认发行版)的主机 IP(NAT 模式下 Windows 访问 WSL 内服务用;
 * mirrored/localhostForwarding 场景则直接走 127.0.0.1,调用方两者都试)。
 * 失败返回 null;结果缓存。
 */
export async function getWslIpAddress(): Promise<string | null> {
  if (cachedWslIp) return cachedWslIp
  try {
    const { stdout } = await runWsl(['bash', '-lc', 'hostname -I'], 15_000)
    const ip = stdout.trim().split(/\s+/)[0]
    if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
      cachedWslIp = ip
      return ip
    }
    return null
  } catch {
    return null
  }
}
