# Watcher

A self-hosted news & stocks dashboard with local AI summaries powered by Ollama.

## Features
- **4 news tabs** — World News, Malaysia News, World Economy, Malaysia Economy
- **AI summaries** — each article summarized in 5 sentences by a local LLM (no cloud required)
- **Progressive loading** — articles appear one by one as AI finishes each, via Server-Sent Events
- **Pagination** — 5 articles per page, up to 5 pages (25 articles total)
- **Stock charts** — Chart.js powered charts with Yahoo Finance data
- **ML stock predictions** — ARIMA + Random Forest + Gradient Boost ensemble
- **Ollama chat UI** — multi-turn chat with the local LLM at `/watcher/chat.html`
- **Auto-refresh** — toggle button refreshes news every 5 minutes

## Tech Stack
PHP 8.2 · Apache · Vanilla JS · Chart.js 4.4.3 · Ollama (llama3.2:3b)

## Part of the Watcher Stack
This repo is the web application only. Run it via the Docker orchestration repo:

→ **[watcher-infra](https://github.com/AlvinWong96/watcher-infra)** for full setup instructions.

## Related Repos
- [watcher-infra](https://github.com/AlvinWong96/watcher-infra) — Docker Compose orchestration
- [watcher-predictor](https://github.com/AlvinWong96/watcher-predictor) — Python ML microservice
