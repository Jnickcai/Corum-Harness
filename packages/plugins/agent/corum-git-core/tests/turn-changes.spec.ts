import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterAll, describe, expect, it } from 'vitest'
import { apply } from '../src/index.ts'

const scratch = mkdtempSync(join(tmpdir(), 'corum-turn-changes-'))
afterAll(() => {
  if (!resolve(scratch).startsWith(resolve(tmpdir()) + sep)) throw new Error('unsafe test cleanup')
  rmSync(scratch, { recursive: true, force: true })
})
let sequence = 0
function fixture() {
  const cwd = join(scratch, String(sequence++))
  mkdirSync(cwd)
  const git = (...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { stdio: 'pipe', encoding: 'utf8' })
  git('init', '-q')
  git('config', 'user.name', 'test')
  git('config', 'user.email', 'test@localhost')
  writeFileSync(join(cwd, 'tracked.txt'), 'original\n')
  git('add', '-A')
  git('commit', '-qm', 'initial')
  const session = { id: `test-${sequence}`, header: { cwd } }
  const steered: string[] = []
  const cards: { effectiveFiles: number; diffLines: string[] }[] = []
  const updates: string[] = []
  const agent = { session, steer: (m: { content: { text?: string }[] }) => steered.push(m.content.map(c => c.text ?? '').join('')) }
  const ctx = new Context()
  ctx.on('corum/commit-card/request' as never, ((request: typeof cards[number], next: () => unknown) => {
    cards.push(request)
    return next()
  }) as never)
  ctx.on('corum/commit-card/update' as never, ((update: { status: string }) => updates.push(update.status)) as never)
  apply(ctx)
  const start = (turn = 1) => ctx.emit('session/event' as never, session as never, { type: 'turn/start', data: { turn } } as never)
  const stop = (turn = 1) => ctx.parallel('agent/turn-stopping' as never, { agent, turn, signal: new AbortController().signal } as never)
  return { cwd, git, start, stop, steered, cards, updates, session }
}

describe('#105 本轮提交提醒', () => {
  it('仅暂存轮前已有的改动，不提醒提交', async () => {
    const f = fixture()
    writeFileSync(join(f.cwd, 'tracked.txt'), 'before turn\n')
    f.start()
    f.git('add', 'tracked.txt')
    await f.stop()
    expect(f.steered).toEqual([])
    expect(f.cards).toEqual([])
  })

  it('已有脏文件在本轮再次改写，即使 porcelain 状态相同也提醒', async () => {
    const f = fixture()
    writeFileSync(join(f.cwd, 'tracked.txt'), 'before turn\n')
    f.start()
    writeFileSync(join(f.cwd, 'tracked.txt'), 'changed this turn\n')
    await f.stop()
    expect(f.steered).toHaveLength(1)
    expect(f.cards[0]?.effectiveFiles).toBe(1)
  })

  it('卡片数量、路径和 steer 只包含本轮文件，不包含旧文件', async () => {
    const f = fixture()
    writeFileSync(join(f.cwd, 'old-a.txt'), 'old a\n')
    writeFileSync(join(f.cwd, 'old-b.txt'), 'old b\n')
    f.start()
    writeFileSync(join(f.cwd, 'new.txt'), 'new\n')
    await f.stop()
    expect(f.cards[0]?.effectiveFiles).toBe(1)
    expect(f.cards[0]?.diffLines.join('\n')).toContain('new.txt')
    expect(f.steered[0]).not.toContain('old-a.txt')
    expect(f.steered[0]).not.toContain('old-b.txt')
  })

  it('缺少本轮开始快照时，不把历史改动作为本轮工作反复提醒', async () => {
    const f = fixture()
    writeFileSync(join(f.cwd, 'old.txt'), 'old\n')
    await f.stop(1)
    await f.stop(2)
    expect(f.steered).toEqual([])
  })

  it('不能把上一轮快照用于没有 turn/start 的下一轮', async () => {
    const f = fixture()
    f.start(1)
    writeFileSync(join(f.cwd, 'old.txt'), 'previous turn\n')
    await f.stop(1)
    await f.stop(2)
    expect(f.steered).toHaveLength(1)
  })

  it('同一轮提交完成后再进入停止钩子，不再产生第二张卡片', async () => {
    const f = fixture()
    f.start()
    writeFileSync(join(f.cwd, 'new.txt'), 'new\n')
    await f.stop()
    await f.stop()
    f.git('add', 'new.txt')
    f.git('commit', '-qm', 'feat: new')
    await f.stop()
    await f.stop()
    writeFileSync(join(f.cwd, 'later.txt'), 'later\n')
    await f.stop()
    expect(f.steered).toHaveLength(1)
    expect(f.cards).toHaveLength(1)
    expect(f.updates).toEqual(['progress', 'done'])
  })

  it('旧文件仍脏时，本轮文件提交后也能结算卡片', async () => {
    const f = fixture()
    writeFileSync(join(f.cwd, 'old.txt'), 'old\n')
    f.start()
    writeFileSync(join(f.cwd, 'new.txt'), 'new\n')
    await f.stop()
    f.git('add', 'new.txt')
    f.git('commit', '-qm', 'feat: new')
    await f.stop()
    expect(f.updates).toEqual(['progress', 'done'])
    f.start(2)
    await f.stop(2)
    expect(f.steered).toHaveLength(1)
  })

  it('展开未跟踪目录，能识别其中已有文件本轮的内容变化', async () => {
    const f = fixture()
    mkdirSync(join(f.cwd, 'notes'))
    writeFileSync(join(f.cwd, 'notes', '旧 文档.md'), 'before\n')
    f.start()
    writeFileSync(join(f.cwd, 'notes', '旧 文档.md'), 'after\n')
    await f.stop()
    expect(f.steered).toHaveLength(1)
    expect(f.cards[0]?.effectiveFiles).toBe(1)
    expect(f.cards[0]?.diffLines[0]).toContain('旧 文档.md')
  })

  it('深层产物变化与 ignored 文件不触发提交提醒', async () => {
    const f = fixture()
    writeFileSync(join(f.cwd, '.gitignore'), '*.log\n')
    f.git('add', '.gitignore')
    f.git('commit', '-qm', 'ignore logs')
    f.start()
    mkdirSync(join(f.cwd, 'pkg', 'lib'), { recursive: true })
    writeFileSync(join(f.cwd, 'pkg', 'lib', 'built.js'), 'build\n')
    writeFileSync(join(f.cwd, 'debug.log'), 'log\n')
    await f.stop()
    expect(f.steered).toEqual([])
  })

  it('删除、重命名以及源码修改正常提醒，构建目录不计入数量', async () => {
    const f = fixture()
    writeFileSync(join(f.cwd, 'rename.txt'), 'rename\n')
    writeFileSync(join(f.cwd, 'source.txt'), 'source\n')
    f.git('add', '-A')
    f.git('commit', '-qm', 'fixtures')
    f.start()
    unlinkSync(join(f.cwd, 'tracked.txt'))
    f.git('mv', 'rename.txt', '重命名 文档.txt')
    writeFileSync(join(f.cwd, 'source.txt'), 'changed source\n')
    mkdirSync(join(f.cwd, 'pkg', 'dist'), { recursive: true })
    writeFileSync(join(f.cwd, 'pkg', 'dist', 'bundle.js'), 'build\n')
    await f.stop()
    expect(f.cards[0]?.effectiveFiles).toBe(3)
    expect(f.steered[0]).toContain('tracked.txt')
    expect(f.steered[0]).toContain('重命名 文档.txt')
    expect(f.steered[0]).toContain('source.txt')
    expect(f.steered[0]).not.toContain('bundle.js')
  })

  it('仓库子目录作为工作区时，只统计目录内文件并给出工作区相对路径', async () => {
    const f = fixture()
    const subdir = join(f.cwd, 'sub')
    mkdirSync(subdir)
    writeFileSync(join(subdir, 'inside.txt'), 'before\n')
    f.git('add', '-A')
    f.git('commit', '-qm', 'subdir')
    f.session.header.cwd = subdir
    f.start()
    writeFileSync(join(subdir, 'inside.txt'), 'after\n')
    writeFileSync(join(f.cwd, 'outside.txt'), 'outside workspace\n')
    await f.stop()
    expect(f.cards[0]?.effectiveFiles).toBe(1)
    expect(f.cards[0]?.diffLines[0]).toBe(' M inside.txt')
    expect(f.steered[0]).not.toContain('outside.txt')
  })

  it('只取消暂存已有重命名，不算本轮修改', async () => {
    const f = fixture()
    f.git('mv', 'tracked.txt', 'renamed.txt')
    f.start()
    f.git('reset', '--', 'tracked.txt', 'renamed.txt')
    await f.stop()
    expect(f.steered).toEqual([])
  })

  it('同一文件只提交本轮部分后，保留轮前改动也能结算卡片', async () => {
    const f = fixture()
    const middle = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n')
    writeFileSync(join(f.cwd, 'tracked.txt'), `original\n${middle}\nend\n`)
    f.git('add', 'tracked.txt')
    f.git('commit', '-qm', 'multiline')
    writeFileSync(join(f.cwd, 'tracked.txt'), `old change\n${middle}\nend\n`)
    f.start()
    writeFileSync(join(f.cwd, 'tracked.txt'), `old change\n${middle}\nnew ending\n`)
    await f.stop()
    const blob = execFileSync('git', ['-C', f.cwd, 'hash-object', '-w', '--stdin'], {
      input: `original\n${middle}\nnew ending\n`, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
    f.git('update-index', '--cacheinfo', `100644,${blob},tracked.txt`)
    f.git('commit', '-qm', 'feat: only this turn')
    await f.stop()
    expect(f.updates).toEqual(['progress', 'done'])
    expect(f.git('diff')).toContain('+old change')
  })

  it('只提交了轮前部分、本轮内容仍未提交时，不能误报完成', async () => {
    const f = fixture()
    const middle = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n')
    writeFileSync(join(f.cwd, 'tracked.txt'), `original\n${middle}\nend\n`)
    f.git('add', 'tracked.txt')
    f.git('commit', '-qm', 'multiline')
    writeFileSync(join(f.cwd, 'tracked.txt'), `old change\n${middle}\nend\n`)
    f.git('add', 'tracked.txt')
    f.start()
    writeFileSync(join(f.cwd, 'tracked.txt'), `old change\n${middle}\nnew ending\n`)
    await f.stop()
    f.git('commit', '-qm', 'only old change')
    await f.stop()
    expect(f.updates).toEqual(['progress'])
    expect(f.git('diff')).toContain('+new ending')
  })
})
