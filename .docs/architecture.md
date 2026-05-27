# Architecture Overview

## Stack
| Layer | Tech | Container |
|---|---|---|
| Web app | PHP 8.2 + Apache | `watcher-app` |
| ML predictor | Python 3.11 + Flask | `watcher-predictor` |
| Local LLM | Ollama 0.24.0 (latest) | `watcher-ollama` |
| Model init | Ollama one-shot | `watcher-ollama-init` |

## URL
`http://localhost:8080/watcher/`

## Navigation
Left sidebar with 5 items + Chat link at the bottom. Default landing is the Home panel.

| Nav ID | Content |
|---|---|
| `home` | Welcome page with 4 quick-access cards |
| `world-news` | BBC World + Sky News RSS, AI summaries |
| `malaysia-news` | Malay Mail + FMT RSS, AI summaries |
| `world-economy` | BBC Business + MarketWatch RSS, AI summaries + stock charts |
| `malaysia-economy` | The Star Business + The Edge Markets RSS, AI summaries + stock charts |
| Chat | `/watcher/chat.html` — multi-turn Ollama chat (sidebar footer link) |

## News Pipeline
```
Browser → EventSource → news.php → [cache?] → RSS feeds → page scraping → Ollama → SSE articles → Browser
```

## CSS Variables
All colours use CSS custom properties defined in `css/style.css` `:root`:
- `--bg` `--bg2` `--bg3` `--bg4` — background shades
- `--border` `--border2` — borders
- `--text` `--text2` `--text3` — text shades
- `--accent: #38bdf8` — sky-blue highlight
- `--radius: 10px`

## Key Files
| File | Purpose |
|---|---|
| `index.html` | Sidebar shell: Home panel + 4 content panels, auto-refresh button |
| `chat.html` | Standalone Ollama chat UI |
| `api/news.php` | SSE news stream — see `.docs/news-php.md` |
| `api/chat.php` | POST proxy to Ollama `/v1/chat/completions` |
| `api/stocks.php` | Yahoo Finance proxy + predictor calls |
| `js/app.js` | Sidebar navigation (`activateTab()`), lazy load, auto-refresh (5 min) |
| `js/news.js` | EventSource consumer, card render, pagination, stop-AI button — see `.docs/news-js.md` |
| `js/stocks.js` | Chart.js stock charts + ML predictions |
| `css/style.css` | Dark theme stylesheet |

## Known Quirks
- `isEnglish()` filter is present in `news.php` but **disabled** — it was rejecting valid English articles from Malaysian outlets.
- Auto-refresh interval: 5 minutes. Managed in `app.js` `initAutoRefreshBtn()`.
- `loaded` Set in `app.js` prevents duplicate tab loads; cleared on auto-refresh.
