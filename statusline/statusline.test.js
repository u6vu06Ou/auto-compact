'use strict'
// Hermetic tests for statusline/auto-compact-statusline.js:
// fake home (mkdtempSync), fake stdin (spawn), no network, no real state.

const test = require('node:test')
const assert = require('node:assert')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const script = path.join(__dirname, 'auto-compact-statusline.js')
const stateDir = home => path.join(home, '.claude', 'state', 'auto-compact')

function fakeHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-compact-test-'))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  return home
}

function run(home, stdin, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      env: { ...process.env, HOME: home, USERPROFILE: home, ...extraEnv },
    })
    let out = ''
    let err = ''
    child.stdout.on('data', c => { out += c })
    child.stderr.on('data', c => { err += c })
    child.on('error', reject)
    child.on('close', code => resolve({ code, out, err }))
    child.stdin.end(stdin)
  })
}

function hhmm(at) {
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
}

test('a completed compact shows as local time', async t => {
  const home = fakeHome(t)
  const at = new Date(Date.now() - 90 * 60 * 1000) // 90 minutes ago
  fs.mkdirSync(stateDir(home), { recursive: true })
  fs.writeFileSync(
    path.join(stateDir(home), 'sess-1.json'),
    JSON.stringify({ at: at.getTime(), status: 'ok', detail: null }))
  const r = await run(home, JSON.stringify({ session_id: 'sess-1' }))
  assert.strictEqual(r.code, 0)
  assert.strictEqual(r.out, `compacted ${hhmm(at)}\n`)
})

test('a recorded ISO string shows the same', async t => {
  const home = fakeHome(t)
  const at = new Date(Date.now() - 30 * 60 * 1000)
  fs.mkdirSync(stateDir(home), { recursive: true })
  fs.writeFileSync(
    path.join(stateDir(home), 'sess-2.json'),
    JSON.stringify({ at: at.toISOString(), status: 'ok', detail: null }))
  const r = await run(home, JSON.stringify({ session_id: 'sess-2' }))
  assert.strictEqual(r.code, 0)
  assert.strictEqual(r.out, `compacted ${hhmm(at)}\n`)
})

test('a skipped attempt is not shown', async t => {
  const home = fakeHome(t)
  fs.mkdirSync(stateDir(home), { recursive: true })
  fs.writeFileSync(
    path.join(stateDir(home), 'sess-3.json'),
    JSON.stringify({ at: Date.now(), status: 'skip', detail: 'a turn was already running' }))
  const r = await run(home, JSON.stringify({ session_id: 'sess-3' }))
  assert.strictEqual(r.code, 0)
  assert.strictEqual(r.out, '')
})

test('a failed attempt is not shown', async t => {
  const home = fakeHome(t)
  fs.mkdirSync(stateDir(home), { recursive: true })
  fs.writeFileSync(
    path.join(stateDir(home), 'sess-4.json'),
    JSON.stringify({ at: Date.now(), status: 'fail', detail: 'boom' }))
  const r = await run(home, JSON.stringify({ session_id: 'sess-4' }))
  assert.strictEqual(r.code, 0)
  assert.strictEqual(r.out, '')
})

test('no record yet: shows nothing', async t => {
  const home = fakeHome(t)
  const r = await run(home, JSON.stringify({ session_id: 'never-seen' }))
  assert.strictEqual(r.code, 0)
  assert.strictEqual(r.out, '')
})

test('stdin without a session id: shows nothing', async t => {
  const home = fakeHome(t)
  const r = await run(home, JSON.stringify({ model: 'x' }))
  assert.strictEqual(r.code, 0)
  assert.strictEqual(r.out, '')
})

test('stdin that is not JSON: exits clean, shows nothing', async t => {
  const home = fakeHome(t)
  const r = await run(home, 'not json at all')
  assert.strictEqual(r.code, 0)
  assert.strictEqual(r.out, '')
})

test('the exported helper matches the spawned output', async t => {
  const { statusLine } = require('./auto-compact-statusline.js')
  const home = fakeHome(t)
  const at = new Date(Date.now() - 45 * 60 * 1000)
  fs.mkdirSync(stateDir(home), { recursive: true })
  fs.writeFileSync(
    path.join(stateDir(home), 'sess-5.json'),
    JSON.stringify({ at: at.toISOString(), status: 'ok', detail: null }))
  assert.strictEqual(statusLine(home, 'sess-5'), `compacted ${hhmm(at)}`)
  assert.strictEqual(statusLine(home, 'nope'), '')
})
