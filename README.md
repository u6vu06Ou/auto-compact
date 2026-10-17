# auto-compact

A Claude Code plugin that compacts an idle conversation shortly before the prompt cache expires, so the next summarization request reads the cheap warm cache instead of reprocessing the full history.

## Why

A long conversation builds up a prompt cache, and any request that hits the cache re-reads history at cache rates instead of re-tokenizing everything. Anthropic's API offers two cache lifetimes: a five-minute TTL, and a one-hour TTL that keeps the cache warm through longer breaks but charges a higher rate for cache writes (see [prompt caching](https://code.claude.com/docs/en/prompt-caching)). On the one-hour lifetime - a Claude subscription within plan usage, or an explicit `promptCacheTtl` of one hour - a break longer than an hour lets the cache expire, and the next compaction-style summarization request then reprocesses the whole history as one large cold request. Auto-compacting a little ahead of that hour keeps the summarization on the warm cache instead.

## Install

At a Claude Code prompt:

```
/plugin install auto-compact --marketplace u6vu06Ou/auto-compact
```

(Answer `y` to add the marketplace, then pick the user scope.)

## What it does

- **Restarts a timer at every main-loop API request**: typed input, a subagent report waking the main agent, a scheduled wake-up - all count, because the cache is renewed by requests, not by typing. A subagent's own requests don't count: those renew the subagent's own cache.
- **When the timer fires** after the configured idle time (55 minutes by default), it shows a toast announcing the compaction, runs the harness's conversation compaction (the same mechanism as `/compact`), then a second toast with the result.
- **Refusals are toasted too**: compaction is refused while a turn already runs; that failure is reported, not quietly swallowed.
- **Status feed**: after every attempt it writes the time and result to `~/.claude/state/auto-compact/<sessionId>.json` - one file per session, so several windows can coexist.
- **Interactive only**: headless or scheduled runs are left alone.
- **Custom endpoints**: compacting a conversation that runs on another provider buys nothing, so a custom endpoint only arms when the current model name looks like a Claude model (regex configurable).
- **Fail-soft**: a status write that fails never affects the compact.

The mod itself does not draw a countdown - [Show the countdown](#show-the-countdown) covers the segment this repo ships for that display.

## Show the countdown

The plugin draws nothing by itself; it writes the time and result of each attempt to `~/.claude/state/auto-compact/<sessionId>.json`. A custom status line is what turns that into something visible: Claude Code runs one shell command on every update, pipes JSON session data to its stdin, and displays whatever the command prints - the `session_id` field of that JSON identifies the session (see [status line](https://code.claude.com/docs/en/statusline)).

This repo ships a minimal, independent segment: [`statusline/auto-compact-statusline.js`](statusline/auto-compact-statusline.js). For the current session it reads that status file and prints `auto-compact in 37m` while the clock is running; when there is no status file yet (the clock has not fired in that session), it prints nothing. Node standard library only.

Point `statusLine` at it - adjust the path to wherever you keep the file (a plugin install leaves the file inside the plugin's own directory, so copying it to `~/.claude/statusline/` keeps the command stable):

```
{
  "statusLine": {
    "type": "command",
    "command": "node ~/.claude/statusline/auto-compact-statusline.js"
  }
}
```

On Windows, expand the home directory yourself: `node "C:\Users\<you>\.claude\statusline\auto-compact-statusline.js"`.

The minutes count toward the status file's `at` plus the idle margin (`AUTO_COMPACT_IDLE_MIN`), counted from the last recorded attempt - an estimate, not verified behavior: a fresh main-loop request re-arms the clock without rewriting the file.

**Already have a status line?** Claude Code runs a single command, so the segment folds into your existing script. Paste this helper in next to your other segments and render its return value as one more part of your line:

```
// data = the parsed status line JSON; returns "auto-compact in 37m" or ''
function autoCompactSegment(data, env = process.env) {
  const id = data && data.session_id;
  if (!id) return '';
  let rec;
  try {
    rec = JSON.parse(require('fs').readFileSync(require('path').join(
      require('os').homedir(), '.claude', 'state', 'auto-compact',
      String(id) + '.json'), 'utf8'));
  } catch { return ''; }
  const at = typeof rec.at === 'number' ? rec.at : Date.parse(rec.at);
  if (typeof at !== 'number' || !Number.isFinite(at)) return '';
  const idle = Number(env.AUTO_COMPACT_IDLE_MIN) > 0 ? Number(env.AUTO_COMPACT_IDLE_MIN) : 55;
  const remaining = Math.ceil((at + idle * 60000 - Date.now()) / 60000);
  return remaining > 0 ? `auto-compact in ${remaining}m` : '';
}
// usage: compactStr = autoCompactSegment(data)
```

## Tuning

| Env var | Default | Meaning |
|---|---|---|
| `AUTO_COMPACT_IDLE_MIN` | `55` | Idle minutes after the main loop's last API request before compacting |
| `AUTO_COMPACT_PAID_MODELS` | `claude\|opus\|sonnet\|fable\|haiku` | Regex deciding which model names count as Anthropic on a custom endpoint |

## Limits

- Requires a harness build whose compaction hooks can call into (`session.compact()`); on older builds the attempt fails and the failure is toasted.
- The 55-minute margin assumes the one-hour cache lifetime; on the default five-minute lifetime the margin does not apply as a fact, only as a design assumption.
- Shipping alternative: the harness itself compacts idle conversations natively via the `idleCompaction` setting (v2.1.290+), which may be all you need.
- Multiple test runs were not run against every client; toast behavior depends on your client's UI kit.

## License

MIT - see [LICENSE](LICENSE).

---

## 繁中簡版

# auto-compact

Claude Code 外掛：對話閒置約 55 分鐘、在提示快取過期前自動壓縮對話，讓下一次摘要走便宜的快取，而不是把整份歷史重算一遍。

為什麼是 55：Anthropic 提示快取的存活時間有兩種——5 分鐘和 1 小時，較長的是 1 小時；跑訂閱用量（或明確設一小時 TTL）的對話，安靜超過一小時快取就過期，下一次就要整份重算。提前一點壓縮，摘要就能讀到快取。

安裝（在 Claude Code 對話框輸入）：

```
/plugin install auto-compact --marketplace u6vu06Ou/auto-compact
```

行為：每次主對話打 API 就重新計時（打字、subagent 回報喚醒主 agent、排程喚醒都算；subagent 自己的請求不算）；安靜屆滿（預設 55 分鐘）就跳提示並執行壓縮（跟 `/compact` 同一個機制），再回報結果；正好有一輪在跑被略過時也會說明；每次結果寫進 `~/.claude/state/auto-compact/<sessionId>.json`（一個視窗一個檔，多窗共存）；只壓互動視窗，無頭／排程跑的不動；自訂端點只在模型名像 Claude 時才啟用（正則可調）。

環境變數：

倒數顯示：外掛本身不會畫任何東西，repo 附了最小獨立範例腳本 [`statusline/auto-compact-statusline.js`](statusline/auto-compact-statusline.js)，讓 `settings.json` 的 `statusLine` 指過去就會顯示 `auto-compact in 37m`（細節與「已有自己狀態列」的合併寫法見上方 Show the countdown）。

| 變數 | 預設 | 意義 |
|---|---|---|
| `AUTO_COMPACT_IDLE_MIN` | `55` | 主對話最後一次 API 後安靜這麼久才壓縮 |
| `AUTO_COMPACT_PAID_MODELS` | `claude\|opus\|sonnet\|fable\|haiku` | 判定自訂端點上哪些模型名算 Anthropic |

限制：倒數顯示不內建——repo 附最小範例腳本（`statusline/`），已有自己狀態列的可把 helper 貼進既有腳本合併；需要 hooks 能呼叫壓縮的 harness 版本；state 檔寫不進去不影響壓縮。harness 本身 v2.1.290+ 的內建 `idleCompaction` 設定可以取代這個外掛。授權 MIT。
