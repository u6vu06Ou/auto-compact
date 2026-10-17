import type { EngineInterface, Register, Timer } from 'claude-code'

// Idle minutes after the main loop's last API request before auto-compacting.
// The API offers a five-minute and a one-hour cache lifetime, and the one-hour
// one is the longer-lived cache: compacting a little ahead of an hour of
// inactivity lets the summarization request re-read the cheap cache instead of
// reprocessing the full history, and 55 minutes leaves a small margin under
// that hour. Set AUTO_COMPACT_IDLE_MIN to change it.
const DEFAULT_IDLE_MIN = 55

// Model names that count as running on Anthropic. A custom endpoint or gateway
// can forward requests anywhere; compacting a conversation that runs on
// another provider buys nothing, so a custom endpoint only arms when the
// current model name looks like a Claude model. Set AUTO_COMPACT_PAID_MODELS
// to a different regex to widen or narrow this.
const DEFAULT_PAID_MODELS = 'claude|opus|sonnet|fable|haiku'

let eligible = false
let isCompacting = false
let timer: Timer | undefined

function disarm() {
  timer?.cancel()
  timer = undefined
}

// Env and timing are read once at session start, so arming the clock stays a
// plain synchronous call.
let cache: { minutes: number; idleMs: number; paidModels: RegExp } | undefined

async function load($: EngineInterface) {
  const min = Number(await $.env.get('AUTO_COMPACT_IDLE_MIN'))
  const src = (await $.env.get('AUTO_COMPACT_PAID_MODELS')) ?? DEFAULT_PAID_MODELS
  let paidModels: RegExp
  try {
    paidModels = new RegExp(src, 'i')
  } catch {
    paidModels = new RegExp(DEFAULT_PAID_MODELS, 'i')
  }
  const minutes = min > 0 ? min : DEFAULT_IDLE_MIN
  return { minutes, idleMs: minutes * 60_000, paidModels }
}

// The result of each attempt is written to ~/.claude/state/auto-compact/<sessionId>.json
// so a status line script can show when the conversation was last compacted
// (several windows may be open at once, hence one file per session). A write
// that fails never affects the compact itself.
async function record($: EngineInterface, status: 'ok' | 'skip' | 'fail', detail?: string) {
  try {
    const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
    if (!home) return
    const id = await $.session.id()
    const at = await $.clock.now()
    const path = `${home.replace(/\\/g, '/')}/.claude/state/auto-compact/${id}.json`
    await $.fs.write(path, JSON.stringify({ at, status, detail: detail ?? null }))
  } catch {
    // The status line only displays; a failed write is not worth blocking on.
  }
}

function arm($: EngineInterface) {
  if (!cache) return
  timer = $.clock.after(cache.idleMs, async () => {
    timer = undefined
    const baseUrl = (await $.env.get('ANTHROPIC_BASE_URL')) ?? ''
    const isDirect = baseUrl === '' || baseUrl.includes('api.anthropic.com')
    if (!cache) return
    if (!isDirect && !cache.paidModels.test(await $.session.model())) return
    isCompacting = true
    try {
      $.ui.toast(`Idle ${cache.minutes} min: auto-compacting while the prompt cache is still warm...`)
      const done = await $.session.compact()
      $.ui.toast('skip' in done ? `Auto-compact skipped: ${done.skip}` : 'Auto-compact complete')
      await record($, 'skip' in done ? 'skip' : 'ok', 'skip' in done ? String(done.skip) : undefined)
    } catch (err) {
      // A turn was already running (compact is refused while a turn runs):
      // that turn itself renews the cache. Any other reason is reported too,
      // not quietly swallowed.
      const msg = err instanceof Error ? err.message : String(err)
      $.ui.toast(`Auto-compact did not run: ${msg}`)
      await record($, 'fail', msg)
    } finally {
      isCompacting = false
    }
  })
}

export const register: Register = on => {
  eligible = false
  isCompacting = false
  cache = undefined
  disarm()

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    // Only sessions a person is watching get toasts; scheduled or headless
    // runs are left alone.
    eligible = e.isInteractive
    cache = await load($)
    disarm()
    return result
  })

  // The clock restarts at every main-loop API request (typed input, a subagent
  // report waking the main agent, a scheduled wake-up - all count), because
  // the cache is renewed by requests, not by typing. A subagent's own requests
  // don't count: those renew the subagent's own cache.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined || !eligible || isCompacting) return yield* next(e)
    disarm()
    try {
      return yield* next(e)
    } finally {
      arm($)
    }
  })
}
