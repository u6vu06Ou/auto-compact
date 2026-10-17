#!/usr/bin/env node
'use strict';

// Standalone, minimal status line segment for the auto-compact plugin.
//
// Claude Code runs one shell command per status line (see
// https://code.claude.com/docs/en/statusline): it pipes a JSON object to the
// command's stdin and displays whatever the command prints. The plugin itself
// draws nothing; it writes the time and result of each attempt to
// ~/.claude/state/auto-compact/<sessionId>.json. This script reads that file
// for the current session (the `session_id` field of the stdin JSON) and
// prints one segment, for example:
//
//   auto-compact in 37m
//
// No status file (the clock has not fired in this session yet, or the id is
// missing) - prints an empty string. Node standard library only; the home
// directory is resolved at run time, so nothing here is machine-specific.
// (A second `opts` argument exists for tests: { env, home, now }.)

const fs = require('fs');
const path = require('path');
const os = require('os');

// The idle margin the plugin compacts after, in minutes. The env var is the
// one the plugin itself reads (AUTO_COMPACT_IDLE_MIN); keeping the same value
// here is what makes the estimate line up.
function idleMinutes(env) {
  const n = Number(env.AUTO_COMPACT_IDLE_MIN);
  return n > 0 ? n : 55;
}

// Estimate the minutes left until the next auto-compact. The file's `at` field
// is when the clock last fired, so the next run could be as late as `at` plus
// the idle margin. That makes the number an estimate, not a verified countdown:
// a fresh main-loop request re-arms the clock without rewriting the file, and
// a compact that skips or fails shows the same countdown either way.
function autoCompactSegment(data, opts) {
  const o = opts || {};
  const env = o.env || process.env;
  const home = o.home || os.homedir();
  const now = typeof o.now === 'number' ? o.now : Date.now();
  const id = data && data.session_id;
  if (!id) return '';
  let rec;
  try {
    rec = JSON.parse(fs.readFileSync(
      path.join(home, '.claude', 'state', 'auto-compact', String(id) + '.json'),
      'utf8'));
  } catch (e) {
    return ''; // no status file (or unreadable) - nothing to show
  }
  const at = typeof rec.at === 'number' ? rec.at : Date.parse(rec.at);
  if (typeof at !== 'number' || !Number.isFinite(at)) return '';
  const remainingMin = Math.ceil((at + idleMinutes(env) * 60 * 1000 - now) / (60 * 1000));
  return remainingMin > 0 ? 'auto-compact in ' + remainingMin + 'm' : '';
}

if (require.main === module) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    let data = null;
    try { data = JSON.parse(input); } catch (e) {}
    try { process.stdout.write(autoCompactSegment(data)); } catch (e) {}
  });
} else {
  module.exports = { autoCompactSegment, idleMinutes };
}
