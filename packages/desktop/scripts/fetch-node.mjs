/**
 * corum-desktop 打包脚本（阶段 2：物化 Node 运行时）。
 *
 * 宿主子进程需要真 Node（Electron 内嵌 Node 无法 boot 宿主树），
 * 打包时把它作为 extraResources 打进应用包的 Resources/node。
 *
 * 来源：从 nodejs.org 官方源（或 NODE_MIRROR 覆盖的镜像）下载并解压。
 *   - darwin/linux：node-v{ver}-{platform}-{arch}.tar.gz / .tar.xz
 *   - win32：node-v{ver}-win-{arch}.zip（nodejs 不提供 win 的 tar.gz）
 *
 * 平台与架构默认取自**当前运行环境**（`process.platform` / `process.arch`），
 * 可用 `CORUM_NODE_PLATFORM` / `CORUM_NODE_ARCH` 显式覆盖（交叉物化时用；
 * 注意跨平台物化只在「产物与运行环境同平台」时才有意义）。
 *
 * 用法：node packages/desktop/scripts/fetch-node.mjs [node-version] [--platform=win32] [--arch=x64]
 * 环境变量：
 *   NODE_MIRROR          node 下载镜像根（如 https://registry.npmmirror.com/-/binary/node）
 *   CORUM_NODE_PLATFORM  覆盖平台（darwin|linux|win32）
 *   CORUM_NODE_ARCH      覆盖架构（arm64|x64）
 *
 * **交叉物化必须显式指定平台**：默认取**运行环境**的 `process.platform`，所以在 Mac 上
 * 跑 Windows/Linux 的打包链会静默取到 darwin 的 Node 塞进包里（实测：`pack:win` 在
 * macOS 上产出的包里 `resources/node/bin/node` 是 Mach-O）。各平台的 `pack:*` 脚本因此
 * 都显式传 `--platform`；用 flag 而不是 `VAR=… cmd` 前缀，因为后者是 bash 语法、
 * 在 Windows `cmd` 下不生效（而这些脚本正是 Windows 主机要跑的）。
 * @module corum-desktop/scripts/fetch-node
 */

import { createWriteStream, existsSync, statSync } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { spawn } from 'node:child_process'

const root = resolve(import.meta.dirname, '..', '..', '..')
/** desktop 包根（脚本位置推导——2026-09 重命名后 packages/shell 已不存在）。 */
const DESKTOP_ROOT = resolve(import.meta.dirname, '..')
const NODE_DIR = join(DESKTOP_ROOT, 'build', 'node')
/** VC++ 可再发行安装包的暂存目录（随包内置，见 fetchVcRedist）。 */
const VC_REDIST_DIR = join(DESKTOP_ROOT, 'build', 'vcredist')
const VC_REDIST_NAME = 'vc_redist.x64.exe'

const DEFAULT_VERSION = 'v26.4.0'

/**
 * nodejs.org 的归档命名把「平台」写成 `win`（而非 `win32`），且 Windows 只有 zip。
 * @param platform - `process.platform` 取值。
 * @returns nodejs.org 归档名里的平台段与归档扩展名。
 */
function nodeArchiveKind(platform) {
  if (platform === 'win32') return { slug: 'win', ext: 'zip' }
  if (platform === 'darwin') return { slug: 'darwin', ext: 'tar.gz' }
  if (platform === 'linux') return { slug: 'linux', ext: 'tar.gz' }
  throw new Error(`fetch-node: 不支持的平台 ${platform}（darwin|linux|win32）`)
}

async function run(label, command, args, cwd) {
  await new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: cwd ?? process.cwd(), stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', (code) => (code === 0 ? resolveRun() : reject(new Error(`${label} exited ${code}`))))
  })
}

/** 解压：tar.gz 走系统 tar；zip 在 POSIX 走 unzip，Windows 走 Expand-Archive（系统 tar 可能是解不了 zip 的 GNU 版）。 */
async function extract(archive, ext, into) {
  // Windows 落盘路径是绝对盘符式（`D:\…`）：tar（GNU/bsdtar 皆带 rmt 客户端）
  // 会把 `D:` 当远程主机解析 ⇒ `Cannot connect to D`（CI win32 挂的真因；
  // EC2 上能过正是因为当时传的是相对路径）。一律切到归档所在目录，
  // 只传无冒号的相对路径；-C 本地 chdir 不走 rmt，保持原样即可。
  const cwd = dirname(archive)
  const file = basename(archive)
  if (ext === 'zip') {
    if (process.platform === 'win32') {
      // Windows 的 `tar` 可能是 Git 自带的 GNU tar（解不了 zip），且 PATH 里谁先谁后
      // 看环境脸色（CI runner 上就是 GNU 中了标）；Expand-Archive 系统自带
      // （PS 5.0+，绝对路径直调，不赌 PATH）。-LiteralPath 防通配符，-Force 覆盖。
      const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
      const powershell = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
      const q = (s) => `'${s.replace(/'/g, "''")}'`
      await run('extract node', powershell,
        ['-NoProfile', '-NonInteractive', '-Command',
          `Expand-Archive -LiteralPath ${q(archive)} -DestinationPath ${q(into)} -Force`])
      return
    }
    await run('extract node', 'unzip', ['-q', '-o', file, '-d', into], cwd)
    return
  }
  await run('extract node', 'tar', ['-xzf', file, '-C', into], cwd)
}

/**
 * Parse `--platform=` / `--arch=` flags and the optional positional version.
 *
 * Flags exist alongside the env vars because the packaging scripts must pin the
 * target platform *portably*: `CORUM_NODE_PLATFORM=win32 node …` is bash syntax
 * and does not work under Windows `cmd`, while these scripts are the ones a
 * Windows host runs.
 * @param argv - `process.argv.slice(2)`.
 * @returns The resolved version, platform, and arch.
 */
function parseArgs(argv) {
  let version = DEFAULT_VERSION
  let platform = process.env.CORUM_NODE_PLATFORM ?? ''
  let arch = process.env.CORUM_NODE_ARCH ?? ''
  for (const arg of argv) {
    if (arg.startsWith('--platform=')) platform = arg.slice('--platform='.length)
    else if (arg.startsWith('--arch=')) arch = arg.slice('--arch='.length)
    else if (!arg.startsWith('--')) version = arg
  }
  return {
    version,
    platform: platform === '' ? process.platform : platform,
    arch: arch === '' ? process.arch : arch,
  }
}

async function main() {
  const { version, platform, arch } = parseArgs(process.argv.slice(2))
  const { slug, ext } = nodeArchiveKind(platform)

  await rm(NODE_DIR, { recursive: true, force: true })
  await mkdir(join(DESKTOP_ROOT, 'build'), { recursive: true })

  const name = `node-${version}-${slug}-${arch}`
  const mirror = (process.env.NODE_MIRROR ?? 'https://nodejs.org/dist').replace(/\/$/, '')
  const url = `${mirror}/${version}/${name}.${ext}`
  const archive = join(DESKTOP_ROOT, 'build', `${name}.${ext}`)

  if (!existsSync(archive)) {
    console.log(`[fetch-node] downloading ${url}`)
    const response = await fetch(url)
    if (!response.ok) throw new Error(`fetch-node: HTTP ${response.status} for ${url}`)
    await pipeline(response.body, createWriteStream(archive))
  } else {
    console.log(`[fetch-node] using cached ${archive}`)
  }

  await extract(archive, ext, join(DESKTOP_ROOT, 'build'))
  // 用 fs.rename 而不是 `mv`：Windows 上没有 POSIX `mv`，且同盘重命名是原子的。
  await rename(join(DESKTOP_ROOT, 'build', name), NODE_DIR)
  console.log(`[fetch-node] node runtime staged at ${NODE_DIR} (${slug}-${arch})`)

  // Windows：把 VC++ 可再发行安装包一并物化进产物（用户机器可能没装 VC Redist）。
  // 不是侧载 DLL —— 见 fetchVcRedist 的注释（实测推翻了「exe 旁放 DLL 就够」）。
  if (platform === 'win32') await fetchVcRedist()
}

/**
 * 下载微软官方 VC++ 可再发行安装包，暂存到 `build/vcredist/`，供打包内置。
 *
 * ## 为什么是「内置安装包」而不是「侧载 DLL」（2026-10-22 Win10 实测结论）
 *
 * 最初实现把 CRT 的 5 个 DLL 复制到 `build/node`（node.exe 旁），依据是「Windows
 * DLL 搜索顺序里 exe 目录优先」。**对照实验推翻了它**：把 System32 的 5 个 CRT DLL
 * 临时改名以模拟「未装 VC Redist」，结果是
 *
 *   - 系统 node（exe 旁无 DLL）  → `ERR_DLOPEN_FAILED`（预期内）
 *   - **随包 node（exe 旁有 DLL）→ 仍然 `ERR_DLOPEN_FAILED`**（假设错）
 *   - 把 DLL 放到**`.node` 模块所在目录** → `LOAD OK`（唯一有效路径）
 *
 * 也就是说 CRT 必须在**每个含 `.node` 的目录**里，而闭包里有几十个这样的目录
 * （`Resources/host/node_modules/**`），散落多份 DLL 既丑陋又容易在新增原生模块时漏掉。
 *
 * 更稳的做法是**让系统装上**：随包携带官方安装包，启动时检测缺失即静默安装一次。
 * 好处：
 *   - 覆盖**所有**原生模块（不挑 DLL 散在哪），也不受第三方包结构调整影响；
 *   - 一次安装，之后该机器上所有 MSVC 原生模块都正常（包括我们没预料到的）；
 *   - 安装包是微软官方签名的，用户/系统信任链完整。
 *
 * 代价是产物增大（x64 安装包约 25MB），只在 win32 目标下发生。
 *
 * ## 取源
 *
 * `https://aka.ms/vs/17/release/vc_redist.x64.exe` 是微软的永久跳转地址，始终指向
 * 最新的 2015-2022 合并版（`curl -L` 语义：跟随 302）。文件名固定，便于校验与复用。
 */
async function fetchVcRedist() {
  await mkdir(VC_REDIST_DIR, { recursive: true })
  const target = join(VC_REDIST_DIR, VC_REDIST_NAME)
  if (existsSync(target)) {
    console.log(`[fetch-node] using cached ${target}`)
    return
  }
  const url = process.env.CORUM_VC_REDIST_URL ?? 'https://aka.ms/vs/17/release/vc_redist.x64.exe'
  console.log(`[fetch-node] downloading VC++ redistributable: ${url}`)
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) throw new Error(`fetch-node: HTTP ${response.status} for ${url}`)
  await pipeline(response.body, createWriteStream(target))
  const size = statSync(target).size
  // 安装包实测约 25MB；明显偏小说明下到的是错误页（跳转失败时的 200 HTML）。
  if (size < 8 * 1024 * 1024) {
    throw new Error(`fetch-node: VC++ redistributable 尺寸异常（${size} 字节），疑似下载到错误页`)
  }
  console.log(`[fetch-node] VC++ redistributable staged at ${target} (${Math.round(size / 1024 / 1024)}MB)`)
}

await main().catch((error) => {
  console.error(error)
  process.exit(1)
})
