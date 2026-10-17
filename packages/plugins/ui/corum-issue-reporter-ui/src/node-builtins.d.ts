/**
 * 最小化的 Node 内建类型面。
 *
 * 为什么需要：本包的 `tsconfig.json` 设了 `types: []`（UI 包不装整套 node 全局），
 * 而工作区里也没有任何一层能解析到本包的 `@types/node`。环境侦测要用到
 * `process` / `node:os` / `node:fs` / `node:module` 的**极少数**成员，为此拉进
 * 整套 node 类型既没必要也会污染渲染层上下文（`setTimeout` 等的 node 重载）。
 *
 * 纪律：这里**只声明本插件真正用到**的成员，多一个都不加——声明面越小，
 * 误用（比如有人顺手写 `process.cwd()` 把路径打进 issue 正文）越早暴露成编译错误。
 */

/** 进程（只声明环境侦测要读的四个字段面）。 */
declare const process: {
  readonly env: Record<string, string | undefined>
  readonly versions: Record<string, string | undefined>
  readonly arch: string
}

declare module 'node:module' {
  /**
   * 从某个模块 URL 出发造 require。
   * @param url - 起点（本插件用 `import.meta.url`）。
   * @returns 只需要 `resolve`（它不读文件、不留路径）。
   */
  export function createRequire(url: string | URL): { resolve(id: string): string }
}

declare module 'node:fs' {
  /**
   * 读文本文件。
   * @param path - 绝对路径。
   * @param encoding - 固定 utf8。
   * @returns 文件内容。
   */
  export function readFileSync(path: string, encoding: 'utf8'): string
}

declare module 'node:os' {
  /** `Windows_NT` / `Linux` / `Darwin`。 */
  export function type(): string
  /** 内核版本（Windows 下形如 `10.0.26200`）。 */
  export function release(): string
  /** 版本名（Windows 下形如 `Windows 11 Pro`；其余平台与 release 重复）。 */
  export function version(): string
  /** 物理内存总量（字节）。 */
  export function totalmem(): number
}
