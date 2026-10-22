/**
 * Windows 下的 VC++ 运行库（MSVC CRT）自检与自动安装。
 *
 * ## 这个问题为什么值得一个专门模块
 *
 * 缺 VC 运行库时，任何 MSVC 编译的 `.node` 原生模块都会以
 *
 *     code: ERR_DLOPEN_FAILED
 *     message: The specified module could not be found.
 *              \\?\...\index.win32-x64-msvc.node
 *
 * 失败 —— **文件明明在**（PE 头完好），报的却是「依赖的 DLL 找不到」。
 * 2026-10-22 在 Win10 上实测，这句话把我引到了「路径拼接 bug」的错误方向上，
 * 查了十几轮才由错误对象里的 `cause` 链定位到真因（缺 vcruntime140 等三项）。
 * 用户看到同样的话，几乎不可能自己想到「去装 VC++ 运行库」。
 *
 * ## 三段式处置（从「不需要」到「最坏情况」）
 *
 * 1. **不需要**：系统里已有全部必需 DLL（绝大多数用户，装了 VC Redist）。
 * 2. **自带**：打包时已把 CRT 放进 `Resources/node/`（`fetch-node.mjs` 的
 *    `stageVcRuntime`）。Windows 的 DLL 搜索顺序里**可执行文件目录优先于
 *    System32**，host 子进程由 `Resources/node/node.exe` 拉起，所以这一条就能
 *    让该进程树里的原生模块全部解析到 —— 用户什么都不用做。
 * 3. **自动安装**：前两条都不成立（既没装、包里也没带）时，用微软官方
 *    `vc_redist.x64.exe` 静默安装一次，装完由调用方重启应用。
 *
 * 第 3 步**默认需要用户同意**（`--accept` 语义）：它要下载 ~25MB 并以管理员权限
 * 改系统状态。无界面静默地做这件事不合适；所以只在用户上一次明确点过「安装」
 * 时自动执行，否则只把缺失项报出来并由 UI 询问。
 *
 * @module corum-desktop/electron/vc-runtime
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** MSVC CRT 里 `.node` 模块实际会用到的全部 DLL（含 C++ 标准库的 1/2 分区）。 */
export const REQUIRED_VC_DLLS: readonly string[] = [
  'vcruntime140.dll',
  'vcruntime140_1.dll',
  'msvcp140.dll',
  'msvcp140_1.dll',
  'msvcp140_2.dll',
]

/**
 * 缺了**这几项**才真的会失败；`msvcp140_1/2` 只是分区，部分模块不需要。
 * 判定期望值用这个子集，避免「只缺一个可选分区」就弹安装提示。
 */
export const CRITICAL_VC_DLLS: readonly string[] = [
  'vcruntime140.dll',
  'vcruntime140_1.dll',
  'msvcp140.dll',
]

/** 微软官方 VC++ 2015-2022 Redistributable（x64）的永久跳转地址。 */
export const VC_REDIST_URL = 'https://aka.ms/vs/17/release/vc_redist.x64.exe'

/**
 * 探测结果。`source` 说明每一类位置各缺什么，便于把原因写进日志/诊断包。
 */
export interface VcRuntimeProbe {
  /** 是否满足运行条件（系统有，或随包携带）。 */
  ok: boolean
  /** 关键 DLL 里仍然找不到的那些。 */
  missing: readonly string[]
  /** 在系统 System32 里找到的。 */
  inSystem32: readonly string[]
  /** 在随包目录（`Resources/node`）里找到的。 */
  inBundled: readonly string[]
}

/**
 * 检查 VC 运行库是否可用。
 *
 * 顺序与 Windows 的 DLL 解析顺序一致：**可执行文件目录（随包）优先**，其次系统。
 * 只要某个关键 DLL 在任一位置存在，就认为它能被解析到。
 *
 * @param opts.systemRoot - 系统根（默认取 `SystemRoot`，测试可注入）。
 * @param opts.bundledDir - 随包的 node 目录（含随包 DLL）；`undefined` = 非打包态或不可用。
 * @returns 探测结果；`ok=false` 时 `missing` 至少含一项关键 DLL。
 */
export function probeVcRuntime(opts: { systemRoot?: string; bundledDir?: string } = {}): VcRuntimeProbe {
  const systemRoot = opts.systemRoot ?? process.env.SystemRoot ?? 'C:\\Windows'
  const system32 = join(systemRoot, 'System32')
  const bundledDir = opts.bundledDir
  const inSystem32: string[] = []
  const inBundled: string[] = []
  const missing: string[] = []
  for (const dll of REQUIRED_VC_DLLS) {
    const systemHit = existsSync(join(system32, dll))
    const bundledHit = bundledDir !== undefined && existsSync(join(bundledDir, dll))
    if (systemHit) inSystem32.push(dll)
    if (bundledHit) inBundled.push(dll)
    // 关键项两侧都没有 ⇒ 记为缺失；非关键分区缺了也记，但不影响 ok。
    if (!systemHit && !bundledHit) missing.push(dll)
  }
  const criticalMissing = missing.filter(dll => CRITICAL_VC_DLLS.includes(dll))
  return {
    ok: criticalMissing.length === 0,
    missing: criticalMissing,
    inSystem32,
    inBundled,
  }
}

/**
 * 需要向用户展示的人话说明（含「为什么」和「怎么办」）。
 *
 * 单独成函数而不是散落在 UI 里：同一段话要被启动诊断、日志、诊断包三处复用，
 * 而措辞如果分头维护，迟早只有一处更新。
 *
 * @param probe - {@link probeVcRuntime} 的结果。
 * @returns 多行说明文本。
 */
export function describeVcRuntimeProblem(probe: VcRuntimeProbe): string {
  return [
    '缺少 Windows 的 VC++ 运行库（MSVC CRT），部分原生模块无法加载。',
    `缺失：${probe.missing.join(', ')}`,
    '',
    '这会让终端、文件系统等依赖原生模块的功能失效，并报出',
    '「The specified module could not be found」（文件其实存在，缺的是它依赖的 DLL）。',
    '',
    `修复：安装 Microsoft Visual C++ 可再发行组件（${VC_REDIST_URL}），或让管理员运行：`,
    '  winget install --id Microsoft.VCRedist.2015+.x64 -e',
  ].join('\n')
}

/** 随包安装包的文件名（与 `packages/desktop/scripts/fetch-node.mjs` 的 fetchVcRedist 对齐）。 */
export const VC_REDIST_FILENAME = 'vc_redist.x64.exe'

/** 自动安装的结果。`installed` 为 true 时调用方应重启应用让原生模块重新加载。 */
export interface VcRuntimeInstallResult {
  /** 是否成功安装（MSI 退出码 0 或 1638「已装更新版本」都算成功）。 */
  installed: boolean
  /** 人话说明（成功/失败都会给，便于直接写进日志与诊断包）。 */
  message: string
  /** 进程退出码；未执行安装时为 undefined。 */
  exitCode?: number
}

/**
 * 用随包的官方安装包静默安装 VC++ 运行库。
 *
 * ## 参数语义（这是本模块唯一有「副作用」的地方，所以逐条写明）
 *
 * 安装包走微软自己的 `/install /quiet /norestart`：
 *   - `/quiet`     无 UI，不打断用户；
 *   - `/norestart` **绝不**替用户重启（重启与否由调用方/用户决定）；
 * 安装器需要管理员权限；主进程已由 Electron 以当前用户身份运行，因此这里通过
 * 安装器自身的 UAC 提权（`runas` 语义由安装器 manifest 声明，无需我们先提权）。
 *
 * ## 退出码
 *
 * VC Redist 安装器是 Burn 打包：
 *   - `0`    成功
 *   - `1638` 已安装**更新**版本（对我们等价于「不需要装」，算成功）
 *   - `3010` 成功但需要重启（`/norestart` 下也可能出现）⇒ 算成功，提示需重启
 * 其余一律视为失败，并把退出码原样带出。
 *
 * @param installerPath - 随包安装包的绝对路径；不存在时直接返回失败而不抛错
 *   （调用方据此展示「手动安装」引导，而不是让启动崩掉）。
 * @returns 安装结果。
 */
export async function installVcRuntime(installerPath: string): Promise<VcRuntimeInstallResult> {
  if (!existsSync(installerPath)) {
    return { installed: false, message: `随包的 VC++ 安装包不存在：${installerPath}` }
  }
  const { spawn } = await import('node:child_process')
  const args = ['/install', '/quiet', '/norestart']
  return await new Promise<VcRuntimeInstallResult>((resolve) => {
    let settled = false
    const finish = (result: VcRuntimeInstallResult): void => {
      if (settled) return
      settled = true
      resolve(result)
    }
    try {
      const child = spawn(installerPath, args, { stdio: 'ignore', windowsHide: true })
      child.on('error', (error) => {
        finish({ installed: false, message: `无法启动安装器：${String(error)}` })
      })
      child.on('exit', (code) => {
        const exitCode = code ?? -1
        if (exitCode === 0) {
          finish({ installed: true, message: 'VC++ 运行库安装成功。', exitCode })
          return
        }
        if (exitCode === 1638) {
          finish({ installed: true, message: '系统已有同版本或更新的 VC++ 运行库。', exitCode })
          return
        }
        if (exitCode === 3010) {
          finish({ installed: true, message: 'VC++ 运行库安装成功，需要重启系统后生效。', exitCode })
          return
        }
        // 1602 = 用户取消 UAC；1223 = 用户拒绝提权。这两种是「用户选择不装」，
        // 要与真正的失败区分开，否则日志会把用户的决定记成故障。
        if (exitCode === 1602 || exitCode === 1223) {
          finish({ installed: false, message: '用户取消了 VC++ 运行库安装。', exitCode })
          return
        }
        finish({ installed: false, message: `VC++ 运行库安装失败（退出码 ${exitCode}）。`, exitCode })
      })
    } catch (error) {
      finish({ installed: false, message: `VC++ 运行库安装异常：${String(error)}` })
    }
  })
}
