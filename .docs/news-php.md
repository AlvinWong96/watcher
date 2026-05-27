# news.php — Architecture & Behaviour

## Output Format
**Not a JSON endpoint.** Outputs `text/event-stream` (Server-Sent Events).  
JavaScript must use `EventSource`, not `fetch`.

## SSE Event Sequence
```
event: status   {"message":"Fetching news feeds…"}
event: status   {"message":"Loading article content…"}
event: meta     {"ai_attempted":true,"total":25}
event: status   {"message":"AI summary 0/25…"}
event: article  {title, link, desc, date, source, ai_summary?}
event: status   {"message":"AI summary 1/25…"}
event: article  {...}
... (one article event per completed summary)
event: done     {count, ai_attempted, errors[], fetched, cached}
```

## Cache
- Location: `/tmp/watcher_cache/news_{md5(tab)}.json`
- TTL: 180 seconds
- On cache HIT: streams all articles instantly then `done`
- Cache is written at end of stream (even if client disconnects, due to `ignore_user_abort(true)`)

## Key Settings
| Setting | Value | Where to change |
|---|---|---|
| Total articles fetched | 25 | `array_slice($allArticles, 0, 25)` |
| AI timeout per article | 90s | `summarizeOne(..., 90)` call |
| Summary length | 5 sentences | prompt string in `summarizeOne()` |
| max_tokens | 350 | payload in `summarizeOne()` |
| Cache TTL | 180s | `CACHE_TTL` constant |
| PHP time limit | 300s | `set_time_limit(300)` at top |

## Feed Registry (`FEEDS` constant)
| Tab | Feeds |
|---|---|
| `world-news` | BBC World, Sky News |
| `malaysia-news` | Malay Mail, FMT |
| `world-economy` | BBC Business, MarketWatch |
| `malaysia-economy` | The Star Business, The Edge Markets |

**Note:** `isEnglish()` filter is disabled. All registered feeds are English-language sources.  
Reason: the 80%-ASCII check was incorrectly rejecting English articles from Malaysian outlets that mix Malay words or Unicode characters in descriptions.

## AI Provider Dispatch
```
AI_PROVIDER=ollama  → summarizeOne() per article, streams each result immediately
AI_PROVIDER=groq    → summarizeBatch() (single API call), then streams all at once
AI_PROVIDER=        → no AI, articles stream without summaries
```

## Apache / Buffering
Top of file must:
1. `while (ob_get_level() > 0) ob_end_clean()` — kills PHP output buffer
2. `@ini_set('output_buffering', '0')` — disables PHP buffering
3. `@ini_set('zlib.output_compression', '0')` — disables gzip compression
4. `header('X-Accel-Buffering: no')` — disables nginx proxy buffering
Without all four, SSE events are held until Apache flushes (defeats streaming).
