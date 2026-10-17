import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderStartupPageHtml } from '../lib/types/electron/startup-page.js'

/**
 * Executes the rendered player's inline script against a minimal fake DOM and a
 * fake `corumDesktop` bridge, then drives it the way the host does.
 *
 * Regex assertions on the template string are cheap but weak — they pass even if
 * the logic is wired up wrong. Running the script catches the failures that
 * actually matter: a looping segment being killed by its own duration watchdog, a
 * segment never advancing, or `finishStartup` never being called.
 */

/** Minimal DOM + video element sufficient for the player. */
function makeEnv() {
  const timers = new Map()
  let nextTimer = 1
  const calls = { finish: 0, retry: 0, closePreview: 0 }
  const videos = []

  class FakeVideo {
    constructor() {
      this.listeners = {}
      this.paused = true
      this.muted = true
      this.loop = false
      this.duration = 3
      this.src = ''
      this.currentTime = 0
      videos.push(this)
    }
    addEventListener(type, fn) {
      ;(this.listeners[type] ??= []).push(fn)
    }
    removeEventListener(type, fn) {
      this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== fn)
    }
    emit(type) {
      for (const fn of this.listeners[type] ?? []) fn({ type })
    }
    play() {
      this.paused = false
      // Real players fire loadedmetadata then playing; emulate that order.
      queueMicrotask(() => {
        this.emit('loadedmetadata')
        this.emit('playing')
      })
      return Promise.resolve()
    }
    pause() {
      this.paused = true
    }
    removeAttribute() {}
    load() {}
    remove() {}
  }

  const elements = new Map()
  const element = (id) => {
    if (!elements.has(id)) {
      elements.set(id, {
        id,
        textContent: '',
        hidden: false,
        disabled: false,
        listeners: {},
        addEventListener(type, fn) {
          ;(this.listeners[type] ??= []).push(fn)
        },
        append() {},
        remove() {},
      })
    }
    return elements.get(id)
  }

  const statusHandlers = []
  const fakeDocument = {
    getElementById: element,
    createElement: (tag) => {
      if (tag === 'video') return new FakeVideo()
      return {
        style: {},
        setAttribute() {},
        addEventListener() {},
        append() {},
        remove() {},
      }
    },
    addEventListener() {},
  }

  const bridge = {
    finishStartup: () => {
      calls.finish++
    },
    retryStartup: () => {
      calls.retry++
    },
    closeStartupPreview: () => {
      calls.closePreview++
    },
    onStartupStatus: (cb) => {
      statusHandlers.push(cb)
      return () => {}
    },
    getStartupStatus: () => Promise.resolve(undefined),
  }

  const fakeWindow = {
    corumDesktop: bridge,
    addEventListener() {},
  }

  const fakeSetTimeout = (fn, ms) => {
    const id = nextTimer++
    timers.set(id, { fn, ms })
    return id
  }

  return {
    /** Values the player script sees as globals. */
    sandbox: {
      document: fakeDocument,
      window: fakeWindow,
      matchMedia: () => ({ matches: false }),
      setTimeout: fakeSetTimeout,
      clearTimeout: (id) => timers.delete(id),
      requestAnimationFrame: () => 0,
      queueMicrotask,
      Promise,
      console,
      JSON,
      Number,
      Math,
      Date,
      Object,
      Array,
      String,
      Boolean,
      Error,
    },
    videos,
    calls,
    statusHandlers,
    timers,
    /** Fire every pending timer whose delay is <= `ms` (and mark the rest). */
    fireTimersAtLeast(ms) {
      for (const [id, t] of [...timers]) {
        if (t.ms >= ms) {
          timers.delete(id)
          t.fn()
        }
      }
    },
    pendingDelays: () => [...timers.values()].map((t) => t.ms),
    restore() {},
  }
}

const SEGMENTS = [
  { stage: 'env', file: 'segments/env.mp4' },
  { stage: 'mounting', file: 'segments/mounting.mp4' },
  { stage: 'ready', file: 'segments/ready.mp4' },
]

/** Render + execute the player for a segment theme. */
async function boot({ preview = false, animationEnabled = true } = {}) {
  const html = renderStartupPageHtml({
    theme: { id: 'corum-segments', type: 'video', builtin: false, segments: SEGMENTS },
    animationEnabled,
    preview,
    platform: 'darwin',
  })
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1]
  const env = makeEnv()
  // Each boot gets its own VM context: the player declares `const` at top level,
  // so re-running it in a shared global scope would throw
  // "Identifier 'config' has already been declared".
  const { createContext, runInContext } = await import('node:vm')
  const context = createContext(env.sandbox)
  runInContext(script, context, { filename: 'player.js' })
  return { env, html, statusHandlers: env.statusHandlers, calls: env.calls }
}

/** Let the player's microtasks (and our fake `playing` event) run. */
const flush = () => new Promise((r) => realSetTimeout(r, 0))
const realSetTimeout = globalThis.setTimeout.bind(globalThis)

test('分段播放器：加载段真的被设为循环，ready 段不循环', async () => {
  const { env, statusHandlers } = await boot()
  try {
    statusHandlers[0]({ phase: 'loading', stage: 'env' })
    await flush()
    assert.equal(env.videos.length, 1, 'one reused <video> element')
    const v = env.videos[0]
    assert.equal(v.loop, true, 'env must loop')
    assert.equal(v.muted, true, 'loading segments stay muted')

    statusHandlers[0]({ phase: 'ready' })
    await flush()
    assert.equal(v.loop, false, 'ready must NOT loop')
    assert.equal(env.videos.length, 1, 'still reusing the same element')
  } finally {
    env.restore()
  }
})

test('分段播放器：循环段播放中不保留 duration 看门狗（否则会误判失败）', async () => {
  const { env, statusHandlers } = await boot()
  try {
    statusHandlers[0]({ phase: 'loading', stage: 'env' })
    await flush()
    // After metadata + playing, no duration-based failure timer may remain for a
    // looping segment. A 15s "did it load" timer is fine; 3s+10s is not.
    const delays = env.pendingDelays()
    assert.ok(
      !delays.some((d) => d >= 13 && d <= 14),
      `no duration watchdog for a looping segment, got ${JSON.stringify(delays)}`,
    )
  } finally {
    env.restore()
  }
})

test('分段播放器：ready 段 ended 才收尾，加载段 ended 不收尾', async () => {
  const { env, calls, statusHandlers } = await boot()
  try {
    statusHandlers[0]({ phase: 'loading', stage: 'env' })
    await flush()
    env.videos[0].emit('ended')
    assert.equal(calls.finish, 0, 'a loading segment ending must not finish boot')

    statusHandlers[0]({ phase: 'ready' })
    await flush()
    env.videos[0].emit('ended')
    assert.equal(calls.finish, 1, 'ready ending must finish boot exactly once')
  } finally {
    env.restore()
  }
})

test('分段播放器：ready 段解除静音（琶音）', async () => {
  const { env, statusHandlers } = await boot()
  try {
    statusHandlers[0]({ phase: 'loading', stage: 'mounting' })
    await flush()
    assert.equal(env.videos[0].muted, true)

    statusHandlers[0]({ phase: 'ready' })
    await flush()
    assert.equal(env.videos[0].muted, false, 'ready segment plays its arpeggio')
  } finally {
    env.restore()
  }
})

test('分段播放器：预览时全部不循环且静音', async () => {
  const { env, html } = await boot({ preview: true })
  try {
    assert.match(html, /"preview":true/)
    await flush()
    // Preview auto-starts the first segment.
    assert.ok(env.videos.length >= 1)
    for (const v of env.videos) {
      assert.equal(v.loop, false, 'preview must not loop')
      assert.equal(v.muted, true, 'preview stays muted')
    }
  } finally {
    env.restore()
  }
})

test('分段播放器：关闭动画时直接收尾，不创建 video', async () => {
  const { env, calls } = await boot({ animationEnabled: false })
  try {
    await flush()
    assert.equal(env.videos.length, 0, 'no media when the animation is disabled')
    assert.equal(calls.finish, 1, 'boot proceeds immediately')
  } finally {
    env.restore()
  }
})
