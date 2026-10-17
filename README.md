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

## See when it compacted

`statusline/auto-compact-statusline.js` prints `compacted 14:32` (local time of the last auto-compact) and nothing before the first one. No countdown - just when it last happened. Point your status line at it in `~/.claude/settings.json`:

```json
"statusLine": { "type": "command", "command": "node /path/to/auto-compact/statusline/auto-compact-statusline.js" }
```

Already have a status line script? `require` it and append its output:

```js
const { statusLine, homeDir } = require('/path/to/auto-compact/statusline/auto-compact-statusline.js')
const seg = statusLine(homeDir(process.env), input.session_id) // '' until the first compact
```

## Built-in idle compaction vs this mod

Claude Code 2.1.290+ (October 2026) also compacts idle conversations on its own, but only once a conversation is large (about 200K tokens by default; `CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS` changes that, `"idleCompaction": false` turns it off). This mod also covers shorter conversations. Both can be on; whichever fires first compacts, and the other then has little left to do.

## Tuning

| Env var | Default | Meaning |
|---|---|---|
| `AUTO_COMPACT_IDLE_MIN` | `55` | Idle minutes after the main loop's last API request before compacting |
| `AUTO_COMPACT_PAID_MODELS` | `claude\|opus\|sonnet\|fable\|haiku` | Regex deciding which model names count as Anthropic on a custom endpoint |

Make it yours: the idle time is the env var above. There is no "only compact above N tokens of context" threshold - if you want one, ask your AI to add it; it is a few lines.

## Limits

- Requires a harness build whose compaction hooks can call into (`session.compact()`); on older builds the attempt fails and the failure is toasted.
- The 55-minute margin assumes the one-hour cache lifetime; on the default five-minute lifetime the margin does not apply as a fact, only as a design assumption.
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

| 變數 | 預設 | 意義 |
|---|---|---|
| `AUTO_COMPACT_IDLE_MIN` | `55` | 主對話最後一次 API 後安靜這麼久才壓縮 |
| `AUTO_COMPACT_PAID_MODELS` | `claude\|opus\|sonnet\|fable\|haiku` | 判定自訂端點上哪些模型名算 Anthropic |

看上次什麼時候壓縮：`statusline/auto-compact-statusline.js` 會在狀態列印出 `compacted 14:32`（上次自動壓縮的時間），還沒壓過就什麼都不印。沒有倒數。設定方式見上面英文段。

想自己調：閒置時間用上面的環境變數。「context 超過多大才壓」這個門檻沒有做，想要的話叫你的 AI 加，幾行就好。

跟官方內建的差別：Claude Code 2.1.290 起（2026 年 10 月）自己也會在閒置時壓縮，但只壓很長的對話（預設約 20 萬 token，`CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS` 可改，`"idleCompaction": false` 可關）。這個外掛連短對話也壓。兩個可以同時開，誰先到誰壓。

限制：需要 hooks 能呼叫壓縮的 harness 版本；state 檔寫不進去不影響壓縮。授權 MIT。
