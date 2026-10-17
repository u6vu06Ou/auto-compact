import { test, expect, mock } from 'claude-code/testing'

const MIN = 60 * 1000

async function setup($: any, on: any, env: Record<string, string>, model = 'claude-opus-5-5') {
  const clock = mock.clock(on)
  mock.env(on, env)
  let compacts = 0
  on('session.compact', () => {
    compacts++
    return { messages: [{ role: 'user', text: 'summary', toolUses: [] }] }
  })
  on('session.model', () => ({ value: model }))
  on('session.start', () => ({ cwd: '/x' }))
  on('turn.step', async function* (_: any, e: any) {
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  await $.session.start({ source: 'startup', cwd: '/x', surface: 'terminal', isInteractive: true, startedAt: 0 })
  // One API request; with an agentId this is the subagent's own request.
  const request = async (agentId?: string) => {
    const stream = $.turn.step({ turnId: 't', index: 0, model, messageCount: 3, ...(agentId ? { agentId } : {}) })
    for await (const _ of stream) { /* drain */ }
  }
  return { clock, request, count: () => compacts }
}

test('window open but never used: never compacts', async ($, on) => {
  const s = await setup($, on, {})
  await s.clock.advance(180 * MIN)
  expect(s.count()).toBe(0)
})

test('55 min after the last request: compacts once, not again', async ($, on) => {
  const s = await setup($, on, {})
  await s.request()
  await s.clock.advance(54 * MIN)
  expect(s.count()).toBe(0)
  await s.clock.advance(1 * MIN)
  expect(s.count()).toBe(1)
  await s.clock.advance(180 * MIN)
  expect(s.count()).toBe(1)
})

test('a subagent report waking the main agent retimes the clock', async ($, on) => {
  const s = await setup($, on, {})
  await s.request()
  await s.clock.advance(50 * MIN)
  await s.request() // the report lands, the main loop calls the API once more
  await s.clock.advance(54 * MIN)
  expect(s.count()).toBe(0)
  await s.clock.advance(1 * MIN)
  expect(s.count()).toBe(1)
})

test("a subagent's own request does not extend the main timer", async ($, on) => {
  const s = await setup($, on, {})
  await s.request()
  await s.clock.advance(50 * MIN)
  await s.request('agent-1')
  await s.clock.advance(5 * MIN)
  expect(s.count()).toBe(1)
})

test('custom endpoint serving another provider: never compacts', async ($, on) => {
  const s = await setup($, on, { ANTHROPIC_BASE_URL: 'http://127.0.0.1:8787' }, 'other-model')
  await s.request()
  await s.clock.advance(60 * MIN)
  expect(s.count()).toBe(0)
})

test('same endpoint serving a Claude model: compacts', async ($, on) => {
  const s = await setup($, on, { ANTHROPIC_BASE_URL: 'http://127.0.0.1:8787' }, 'opus[1m]')
  await s.request()
  await s.clock.advance(55 * MIN)
  expect(s.count()).toBe(1)
})

test('AUTO_COMPACT_IDLE_MIN: compacts after the configured minutes', async ($, on) => {
  const s = await setup($, on, { AUTO_COMPACT_IDLE_MIN: '30' })
  await s.request()
  await s.clock.advance(29 * MIN)
  expect(s.count()).toBe(0)
  await s.clock.advance(1 * MIN)
  expect(s.count()).toBe(1)
})

test('a completed compact writes time and result for the status line', async ($, on) => {
  const writes: { path: string; text: string }[] = []
  on('fs.write', (_: any, e: any) => { writes.push(e); return { value: undefined } })
  on('session.id', () => ({ value: 'sess-1' }))
  const s = await setup($, on, { USERPROFILE: 'C:/Users/U' })
  await s.request()
  await s.clock.advance(55 * MIN)
  expect(s.count()).toBe(1)
  expect(writes.length).toBe(1)
  expect(writes[0].path.split('\\').join('/')).toBe('C:/Users/U/.claude/state/auto-compact/sess-1.json')
  expect(JSON.parse(writes[0].text).status).toBe('ok')
})
