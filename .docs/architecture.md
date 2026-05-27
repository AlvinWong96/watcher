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

## Tabs
| Tab ID | Content |
|---|---|
| `world-news` | BBC World + Sky News RSS, AI summaries |
| `malaysia-news` | Malay Mail + FMT RSS, AI summaries |
| `world-economy` | BBC Business + MarketWatch RSS, AI summaries |
| `malaysia-economy` | The Star Business + The Edge Markets RSS, AI summaries |
| Stocks (world-economy panel) | Yahoo Finance charts + ML predictions |
| Chat | `/watcher/chat.html` — multi-turn Ollama chat |

## News Pipeline
```
Browser → EventSource → news.php → [cache?] → RSS feeds → page scraping → Ollama → SSE articles → Browser
```

## CSS Variables
All colours use CSS custom properties defined in `css/style.css` `:root`:
- `--bg` `--bg2` `--bg3` `--bg4` — background shades
- `--border` `--border2` — borders
- `--text` `--text2` `--text3` — text shades
- `--accent: #3b82f6` — blue highlight
- `--radius: 10px`

## Key Files
| File | Purpose |
|---|---|
| `index.html` | 4-tab shell, auto-refresh button |
| `chat.html` | Standalone Ollama chat UI |
| `api/news.php` | SSE news stream — see `.docs/news-php.md` |
| `api/chat.php` | POST proxy to Ollama `/v1/chat/completions` |
| `api/stocks.php` | Yahoo Finance proxy + predictor calls |
| `js/app.js` | Tab switching, lazy load, auto-refresh (5 min) |
| `js/news.js` | EventSource consumer, card render, pagination — see `.docs/news-js.md` |
| `js/stocks.js` | Chart.js stock charts + ML predictions |
| `css/style.css` | Dark theme stylesheet |

## Known Quirks
- `isEnglish()` filter is present in `news.php` but **disabled** — it was rejecting valid English articles from Malaysian outlets.
- Auto-refresh interval: 5 minutes. Managed in `app.js` `initAutoRefreshBtn()`.
- `loaded` Set in `app.js` prevents duplicate tab loads; cleared on auto-refresh.
