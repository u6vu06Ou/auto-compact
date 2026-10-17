#!/usr/bin/env node
'use strict'
// Renders the "compacted HH:MM" segment for a Claude Code status line.
//
// Claude Code pipes the session's JSON to one command's stdin and displays
// what it prints. Configure it in ~/.claude/settings.json:
//
//   "statusLine": { "type": "command", "command": "<path to this file>" }
//
// (On Windows point `command` at the file with forward slashes - an unquoted
// backslash is read as an escape.)
//
// The plugin records the result of every auto-compact in
// ~/.claude/state/auto-compact/<sessionId>.json. This segment shows the most
// recent completed one as local time, and prints nothing while there is none
// (a skipped or failed attempt is not an auto-compact), so the rest of the
// line is left alone.
//
// Standard library only - no dependency to install.

const fs = require('fs')
const path = require('path')
const os = require('os')

function homeDir(env) {
  return env.USERPROFILE || env.HOME || os.homedir()
}

function compactedAt(record) {
  if (!record || record.status !== 'ok' || record.at == null) return null
  const ms = typeof record.at === 'number' ? record.at : Date.parse(String(record.at))
  return Number.isFinite(ms) ? ms : null
}

// The line to show for one session, or '' when there is none to show.
function statusLine(home, id) {
  let text
  try {
    text = fs.readFileSync(path.join(home, '.claude', 'state', 'auto-compact', String(id) + '.json'), 'utf8')
  } catch {
    return '' // not compacted yet, or the file is unreadable
  }
  let record
  try {
    record = JSON.parse(text)
  } catch {
    return ''
  }
  const ms = compactedAt(record)
  if (ms == null) return ''
  const at = new Date(ms)
  const hh = String(at.getHours()).padStart(2, '0')
  const mm = String(at.getMinutes()).padStart(2, '0')
  return `compacted ${hh}:${mm}`
}

function main() {
  let raw = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', chunk => { raw += chunk })
  process.stdin.on('end', () => {
    let line = ''
    try {
      const id = JSON.parse(raw).session_id
      if (id != null) line = statusLine(homeDir(process.env), String(id))
    } catch {
      line = ''
    }
    process.stdout.write(line ? line + '\n' : '')
  })
}

if (require.main === module) {
  main()
} else {
  module.exports = { statusLine, compactedAt, homeDir }
}
