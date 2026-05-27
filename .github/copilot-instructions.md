# Watcher Web App — Copilot Context

## Overview
Single-page PHP/JS news & stocks dashboard served by Apache inside Docker.
URL: `http://localhost:8080/watcher/`

## Tech Stack
- **PHP 8.2** — backend API endpoints (`api/`)
- **Vanilla JS** — no framework, ES modules pattern via IIFE
- **Chart.js 4.4.3** — stock charts (CDN)
- **Yahoo Finance unofficial API** — `https://query1.finance.yahoo.com/v8/finance/chart/{symbol}`
- **Ollama** — local LLM at `http://ollama:11434` via OpenAI-compatible `/v1/chat/completions`

## File Structure
```
watcher/
├── index.html          # Main 4-tab layout
├── chat.html           # Ollama chat UI (multi-turn, markdown, timestamps)
├── api/
│   ├── news.php        # RSS aggregation + AI summarization (SSE streaming)
│   ├── chat.php        # PHP proxy to Ollama for chat
│   └── stocks.php      # Yahoo Finance proxy + predictor calls
├── js/
│   ├── app.js          # Tab switching, lazy loading, auto-refresh (5 min)
│   ├── news.js         # EventSource SSE consumer, card rendering, pagination
│   └── stocks.js       # Chart.js stock charts + ML predictions
└── css/
    └── style.css       # Dark theme, CSS variables
```

## news.php — SSE Streaming Architecture
- **Not a JSON endpoint** — outputs `text/event-stream` (Server-Sent Events)
- **Event types**: `status`, `meta`, `article`, `done`, `error`
- **Pipeline**:
  1. Check file cache (`/tmp/watcher_cache/news_{md5(tab)}.json`, TTL 180s) → stream cached articles instantly
  2. `status`: Fetch RSS feeds (curl, SimpleXML)
  3. `status`: Enrich short articles with full page text (parallel `curl_multi`)
  4. `meta`: Send `ai_attempted` flag to JS
  5. For each article: summarize via Ollama → `article` event immediately (progressive)
  6. Save full result to cache → `done` event
- **Key settings**: `set_time_limit(300)`, `ignore_user_abort(true)` (writes cache even if browser closes)
- **Per-article timeout**: 90s (Ollama CPU takes ~15-25s per article for 5-sentence summary)
- **Article limit**: `array_slice($allArticles, 0, 25)` — change this number for more/fewer total articles
- **AI prompt**: 5 sentences — what happened, who is involved, key details, why it matters
- **max_tokens**: 350

## news.js — EventSource Pattern
- Uses `EventSource` (not `fetch`) for SSE
- `activeSources{}` map — tracks open connections, closes old one on re-load
- `articleBuffer[]` — stores all received articles for pagination
- `PAGE_SIZE = 5` — articles per page (change this for different page size)
- Spinner stays visible until `done` event; articles insert **before** spinner
- Pagination: Next/Prev buttons appear after `done` if `articleBuffer.length > PAGE_SIZE`
- Page navigation renders from buffer (instant, no new network request)

## Tabs
| Tab ID | Feed |
|---|---|
| `world-news` | BBC World, Sky News |
| `malaysia-news` | Malay Mail, FMT |
| `world-economy` | BBC Business, MarketWatch |
| `malaysia-economy` | The Star Business, The Edge Markets |

## AI Provider Logic (news.php)
- `AI_PROVIDER=ollama` → per-article calls to local Ollama, streams progressively
- `AI_PROVIDER=groq` → batch call to Groq cloud API (requires `GROQ_API_KEY`)
- `AI_PROVIDER=` (empty) → no AI, articles stream without summaries

## chat.php
- POST endpoint, proxies to Ollama `/v1/chat/completions`
- Validates model name with regex (security)
- Keeps last 10 turns of conversation history
- Timeout: 300s

## CSS Variables (dark theme)
```css
--bg: #0a0f1e       --bg2: #111827      --bg3: #1e293b      --bg4: #243044
--border: #1e2d45   --border2: #2d3f5a
--text: #e2e8f0     --text2: #94a3b8    --text3: #64748b
--accent: #3b82f6   --radius: 10px
```

## Key Decisions
- **SSE over polling**: articles appear one-by-one as Ollama finishes each — better UX than waiting for all
- **PHP file cache**: 180s TTL avoids re-running the full pipeline on every tab switch
- **`ignore_user_abort(true)`**: ensures cache is written even if user navigates away mid-stream
- **`ob_end_clean()` at top**: SSE requires no output buffering — Apache/mod_php buffers must be cleared
- **`X-Accel-Buffering: no`**: prevents nginx proxy from buffering the SSE stream
