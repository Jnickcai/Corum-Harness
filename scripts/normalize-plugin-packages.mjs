/**
 * P0 package-field normalization for the plugin framework
 * (docs/plan/PLAN-2026-10-19-plugin-framework.md §3.2 / §A.3).
 *
 * One idempotent pass over every `packages/plugins/<group>/<name>/package.json`:
 *
 *   - `version`         → the root `package.json` version (single publish line,
 *                         §A.6: plugin packages follow the app version)
 *   - `publishConfig`   → `{ access: "public", registry: "https://registry.npmjs.org" }`
 *                         for every package we intend to publish
 *   - `private`         → removed for publishable packages, kept for the ones in
 *                         NOT_PUBLISHED (test placeholders)
 *   - `main`            → removed (spec §B.4 forbids it; `exports["."]` is the
 *                         single entry)
 *
 * Deliberately out of scope here: `exports` rewriting (the 4 `./src/**` sites are
 * package-specific and were fixed by hand in the same commit) and dependency
 * layering (§B.5). Those get their own guards in P1.
 *
 * Usage:
 *   node scripts/normalize-plugin-packages.mjs            # dry run (default)
 *   node scripts/normalize-plugin-packages.mjs --apply    # write
 *   node scripts/normalize-plugin-packages.mjs --check    # exit 1 when out of spec
 *
 * @module scripts/normalize-plugin-packages
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const PLUGIN_ROOT = join(ROOT, 'packages', 'plugins')
const PUBLISH_CONFIG = { access: 'public', registry: 'https://registry.npmjs.org' }

/**
 * Packages that stay out of npm forever (§A.2 「不发布」). They keep
 * `private: true` and get no `publishConfig`.
 *
 * The plan listed `corum-selftest-dev` / `corum-selftest-ui-dev` as well, but
 * those packages no longer exist in the tree (2026-10-20 survey: 48 plugin
 * packages, of which these 3 are the test placeholders).
 */
const NOT_PUBLISHED = new Set([
  '@corum/corum-ide-test-conversation-ui',
  '@corum/corum-ide-test-sidebar-ui',
  '@corum/corum-ide-test-statusbar-ui',
])

const args = new Set(process.argv.slice(2))
const apply = args.has('--apply')
const check = args.has('--check')

/** Every plugin package directory that carries a package.json. */
function packageDirs() {
  const out = []
  for (const group of readdirSync(PLUGIN_ROOT)) {
    const groupDir = join(PLUGIN_ROOT, group)
    if (!statSync(groupDir).isDirectory()) continue
    for (const name of readdirSync(groupDir)) {
      const dir = join(groupDir, name)
      if (!statSync(dir).isDirectory()) continue
      try {
        if (!statSync(join(dir, 'package.json')).isFile()) continue
      } catch {
        continue
      }
      out.push(dir)
    }
  }
  return out.sort()
}

/** Stable key order so a dry run and an apply produce the same bytes. */
function serialize(pkg) {
  return `${JSON.stringify(pkg, null, 2)}\n`
}

const rootVersion = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version

const changes = []
const violations = []

for (const dir of packageDirs()) {
  const file = join(dir, 'package.json')
  const before = readFileSync(file, 'utf8')
  const pkg = JSON.parse(before)
  const notes = []
  const publishable = !NOT_PUBLISHED.has(pkg.name)

  if (pkg.version !== rootVersion) {
    notes.push(`version ${pkg.version} → ${rootVersion}`)
    pkg.version = rootVersion
  }

  if (publishable) {
    if (pkg.private === true) {
      notes.push('private true → (removed)')
      delete pkg.private
    }
    if (JSON.stringify(pkg.publishConfig) !== JSON.stringify(PUBLISH_CONFIG)) {
      notes.push(`publishConfig → ${JSON.stringify(PUBLISH_CONFIG)}`)
      pkg.publishConfig = { ...PUBLISH_CONFIG }
    }
  } else {
    if (pkg.private !== true) {
      notes.push('private → true (test placeholder)')
      pkg.private = true
    }
    if (pkg.publishConfig !== undefined) {
      notes.push('publishConfig → (removed)')
      delete pkg.publishConfig
    }
  }

  if (pkg.main !== undefined) {
    notes.push(`main "${pkg.main}" → (removed)`)
    delete pkg.main
  }

  // `files`：不发源码与测试。**已存在的值不动**（个别包可能有 lib 之外的运行时资产）。
  // 依据：48 包全量扫描只有 `lib/`、`src/`、`tests/`、`scripts/`（构建脚本）与配置文件，
  // 无其它运行时资产；且已验证把 src/ 从包里移走后第三方类型解析仍成立
  // （`.d.ts` 里的 `./x.ts` 说明符由 TS 的 bundler 解析映射到 `.d.ts`）。
  if (publishable && pkg.files === undefined) {
    notes.push('files → ["lib"]')
    pkg.files = ['lib']
  }

  // Not auto-fixable here — reported so a stale path never reads as "clean".
  const exportsText = JSON.stringify(pkg.exports ?? {})
  if (exportsText.includes('./src/')) {
    violations.push(`${pkg.name}: exports still points into ./src/**`)
  }
  if (pkg.exports !== undefined && pkg.exports['./package.json'] === undefined) {
    violations.push(`${pkg.name}: exports lacks "./package.json" (spec §B.4)`)
  }

  if (notes.length === 0) continue
  changes.push({ name: pkg.name, notes })
  if (apply) writeFileSync(file, serialize(pkg))
}

const total = packageDirs().length
for (const change of changes) console.log(`~ ${change.name}: ${change.notes.join('; ')}`)

console.log(
  `\n${apply ? 'APPLIED' : 'DRY RUN'}: ${changes.length} of ${total} package(s) needed changes ` +
  `(root version ${rootVersion}, ${NOT_PUBLISHED.size} kept private).`,
)

if (violations.length > 0) {
  console.log('\nexports violations (fix by hand, spec §B.4):')
  for (const v of violations) console.log(`  ✗ ${v}`)
}

if (check) {
  const drift = changes.length > 0 || violations.length > 0
  if (drift) console.log('\n✗ package fields are out of spec (run with --apply to fix the fields)')
  process.exit(drift ? 1 : 0)
}
