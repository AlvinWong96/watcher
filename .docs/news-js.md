# news.js — EventSource & Pagination

## Pattern
Uses `EventSource` (not `fetch`). The PHP endpoint streams SSE events; JS renders cards progressively.

## Key Variables (inside `load()` closure)
| Variable | Purpose |
|---|---|
| `activeSources{}` | Map of `tabId → EventSource`. Closed on re-load or tab refresh. |
| `articleBuffer[]` | All received articles for the current tab. Used for pagination. |
| `currentPage` | 0-indexed current page. |
| `aiAttempted` | Set from `meta` event. Controls which badge to show on cards. |

## Constants
| Constant | Value | Effect |
|---|---|---|
| `PAGE_SIZE` | `5` | Articles shown per page. Change here to adjust. |

## Spinner Behaviour
- Spinner stays visible until `done` event fires.
- New article cards insert **before** the spinner (`spinnerEl.insertAdjacentHTML('beforebegin', html)`).
- On `done`: `container.querySelector('.loading-state')?.remove()`.
- The loading state also contains a hidden **⏹ Stop AI** button (see below).

## Stop AI Button
- Rendered inside `.loading-state` as `<button class="stop-ai-btn" style="display:none">`.
- Becomes visible after the `meta` SSE event when `ai_attempted === true`.
- On click:
  1. Closes the `EventSource` (`source.close()`).
  2. Removes the loading spinner.
  3. If `articleBuffer` is non-empty: calls `renderCurrentPage()` and appends a `.stop-notice` bar.
  4. If buffer is empty: calls `renderError()` with a "stopped" message.
- PHP continues running in the background (`ignore_user_abort(true)`) to finish writing the cache — the next load of that tab will be instant and fully summarised.

## Pagination Flow
1. All articles are stored in `articleBuffer` regardless of page.
2. Only articles belonging to `currentPage` are rendered during streaming.
3. After `done`: `renderPagination()` adds Prev/Next buttons if `articleBuffer.length > PAGE_SIZE`.
4. Page navigation calls `renderCurrentPage()` which re-renders from buffer (no network request).

## Re-load / Auto-refresh
Calling `load(tabId)` when a stream is already open:
1. Closes old `EventSource` via `activeSources[tabId].close()`.
2. Clears `activeSources[tabId]`.
3. Starts fresh with new `articleBuffer`, `currentPage=0`.

## Badge Logic
```js
article.ai_summary === true  → purple "✦ AI Summary" badge
aiAttempted && !ai_summary   → grey   "✦ AI unavailable" badge
!aiAttempted                 → no badge
```
`aiAttempted` comes from the `meta` SSE event (`AI_PROVIDER !== ''` in PHP).
