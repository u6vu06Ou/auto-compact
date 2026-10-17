'use strict';

// Feeds the status line segment script a fake stdin against a fake state
// directory, then checks what it prints. Run with: node --test statusline/

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const script = path.join(__dirname, 'auto-compact-statusline.js');

// A throwaway home directory with ~/.claude/state/auto-compact/ inside it.
function fakeHome(t) {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-compact-test-'));
  const dir = path.join(state, '.claude', 'state', 'auto-compact');
  fs.mkdirSync(dir, { recursive: true });
  t.after(() => { fs.rmSync(state, { recursive: true, force: true }); });
  return { root: state, dir };
}

function run(home, stdin, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], {
      env: { ...process.env, HOME: home, USERPROFILE: home, ...(env || {}) },
    });
    let out = '';
    child.stdout.on('data', (c) => { out += c; });
    child.on('close', () => resolve(out));
    child.stdin.end(stdin);
  });
}

function atISO(offsetMs) {
  return new Date(Date.now() + offsetMs).toISOString();
}

test('clock fired recently: prints the countdown', async (t) => {
  const home = fakeHome(t);
  fs.writeFileSync(path.join(home.dir, 'sess-1.json'),
    JSON.stringify({ at: atISO(0), status: 'ok', detail: null }));
  assert.strictEqual(await run(home.root, JSON.stringify({ session_id: 'sess-1' })),
    'auto-compact in 55m');
});

test('AUTO_COMPACT_IDLE_MIN: the estimate follows the configured margin', async (t) => {
  const home = fakeHome(t);
  fs.writeFileSync(path.join(home.dir, 'sess-1.json'),
    JSON.stringify({ at: atISO(0), status: 'ok', detail: null }));
  assert.strictEqual(await run(home.root, JSON.stringify({ session_id: 'sess-1' }),
    { AUTO_COMPACT_IDLE_MIN: '30' }),
    'auto-compact in 30m');
});

test('clock fired long ago (target in the past): prints nothing', async (t) => {
  const home = fakeHome(t);
  fs.writeFileSync(path.join(home.dir, 'sess-1.json'),
    JSON.stringify({ at: atISO(-3 * 60 * 60 * 1000), status: 'ok', detail: null }));
  assert.strictEqual(await run(home.root, JSON.stringify({ session_id: 'sess-1' })), '');
});

test('no status file for the session: prints nothing', async (t) => {
  const home = fakeHome(t);
  assert.strictEqual(await run(home.root, JSON.stringify({ session_id: 'nope' })), '');
});

test('stdin without a session id (or not JSON): prints nothing', async (t) => {
  const home = fakeHome(t);
  assert.strictEqual(await run(home.root, JSON.stringify({ cwd: '/x' })), '');
  assert.strictEqual(await run(home.root, 'not json'), '');
  assert.strictEqual(await run(home.root, ''), '');
});

test('an epoch-number at field counts the same way', async (t) => {
  const home = fakeHome(t);
  fs.writeFileSync(path.join(home.dir, 'sess-1.json'),
    JSON.stringify({ at: Date.now(), status: 'ok', detail: null }));
  assert.strictEqual(await run(home.root, JSON.stringify({ session_id: 'sess-1' })),
    'auto-compact in 55m');
});

test('the exported helper honors opts without spawning', (t) => {
  const { autoCompactSegment } = require(script);
  const home = fakeHome(t);
  fs.writeFileSync(path.join(home.dir, 'x.json'),
    JSON.stringify({ at: new Date(0).toISOString(), status: 'ok', detail: null }));
  assert.strictEqual(
    autoCompactSegment({ session_id: 'x' }, { env: { AUTO_COMPACT_IDLE_MIN: '10' }, home: home.root, now: 9 * 60000 }),
    'auto-compact in 1m');
});
