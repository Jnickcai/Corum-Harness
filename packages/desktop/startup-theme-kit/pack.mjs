import { readdir, readFile, lstat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zipSync } from 'fflate'
import { validateStartupThemeManifest } from '../lib/types/electron/startup-themes.js'

const [input, output] = process.argv.slice(2)
if (!input || !output) throw new Error('用法：node pack.mjs <主题目录> <输出.zip>')
const root = resolve(dirname(fileURLToPath(import.meta.url)), input)
const destination = resolve(output)
const inside = relative(root, destination)
if (!inside || (!isAbsolute(inside) && !inside.startsWith('..'))) throw new Error('ZIP 输出文件必须放在主题目录之外')
const files = {}
async function collect(dir, prefix = '') {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const name = `${prefix}${entry.name}`, path = resolve(dir, entry.name)
    if ((await lstat(path)).isSymbolicLink()) throw new Error('主题包不允许链接')
    if (entry.isDirectory()) await collect(path, `${name}/`)
    else if (entry.isFile()) files[name] = await readFile(path)
  }
}
await collect(root)
const manifest = validateStartupThemeManifest(JSON.parse(files['manifest.json']?.toString('utf8') ?? '{}'))
if (!files[manifest.entry]) throw new Error('主题入口文件不存在，请先放入动画或视频')
await writeFile(destination, zipSync(files))
console.log(`已生成主题包：${destination}`)
