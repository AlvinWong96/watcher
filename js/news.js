/**
 * news.js — News Fetching & Rendering
 * Fetches articles via api/news.php and renders them as cards.
 */

const WatcherNews = (() => {
  'use strict';

  // Map tab ID → list container ID
  const CONTAINERS = {
    'world-news':       'world-news-list',
    'malaysia-news':    'malaysia-news-list',
    'world-economy':    'world-economy-list',
    'malaysia-economy': 'malaysia-economy-list',
  };

  // ── Helpers ──────────────────────────────────────────────────────────────
  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function safeUrl(url) {
    return /^https?:\/\//i.test(url) ? url.replace(/"/g, '%22') : '#';
  }

  function formatDate(str) {
    if (!str) return '';
    try {
      const d = new Date(str);
      if (isNaN(d.getTime())) return str;
      const diff = Math.floor((Date.now() - d.getTime()) / 60000); // minutes ago
      if (diff < 1)   return 'Just now';
      if (diff < 60)  return `${diff}m ago`;
      if (diff < 1440) return `${Math.floor(diff / 60)}h ago`;
      return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    } catch {
      return str;
    }
  }

  // ── Render helpers ────────────────────────────────────────────────────────
  function renderLoading(container) {
    container.innerHTML = `
      <div class="loading-state">
        <div class="spinner"></div>
        <span>Loading articles…</span>
        <button class="stop-ai-btn" style="display:none" title="Stop AI processing">⏹ Stop AI</button>
      </div>`;
  }

  function renderError(container, message, retryTab) {
    container.insertAdjacentHTML('beforeend', `
      <div class="error-card">
        <strong>Could not load news</strong>
        ${escHtml(message)}
        <br>
        <button class="retry-btn" onclick="WatcherNews.load('${escHtml(retryTab)}')">
          ↺ Retry
        </button>
      </div>`);
  }

  function renderCards(container, articles, aiAttempted) {
    if (!articles.length) {
      container.insertAdjacentHTML('beforeend', `
        <div class="error-card" style="border-color:var(--border);">
          <strong>No articles found</strong>
          The feed returned no articles. Please try again later.
        </div>`);
      return;
    }

    const html = articles.map(a => {
      // Split on double newlines (paragraph breaks from article extraction)
      const paragraphs = a.desc
        ? a.desc.split(/\n\n+/).map(p => p.trim()).filter(Boolean)
        : [];
      const bodyHtml = paragraphs.length > 1
        ? paragraphs.map(p => `<p>${escHtml(p)}</p>`).join('')
        : (paragraphs[0] ? `<p>${escHtml(paragraphs[0])}</p>` : '');

      const aiTag = a.ai_summary
        ? `<span class="ai-badge">✦ AI Summary</span>`
        : (aiAttempted ? `<span class="ai-failed-badge">✦ AI unavailable</span>` : '');

      return `
      <a href="${safeUrl(a.link)}" target="_blank" rel="noopener noreferrer" class="news-card-link">
        <article class="news-card">
          <div class="card-meta">
            <span class="card-source">${escHtml(a.source)}</span>
            ${a.date ? `<span class="card-date">${escHtml(formatDate(a.date))}</span>` : ''}
            ${aiTag}
          </div>
          <h3>${escHtml(a.title)}</h3>
          <div class="card-body">${bodyHtml}</div>
        </article>
      </a>`;
    }).join('');

    container.insertAdjacentHTML('beforeend', html);
  }

  // ── Public: load a tab's news via SSE (articles appear as each is summarized) ─
  // Track open EventSource connections so we can cancel on re-load
  const activeSources = {};
  const PAGE_SIZE = 5; // articles shown per page

  function updateLoadingStatus(container, message) {
    const el = container.querySelector('.loading-state span');
    if (el) el.textContent = message;
  }

  function buildCardHtml(article, aiAttempted) {
    const paragraphs = article.desc
      ? article.desc.split(/\n\n+/).map(p => p.trim()).filter(Boolean)
      : [];
    const bodyHtml = paragraphs.length > 1
      ? paragraphs.map(p => `<p>${escHtml(p)}</p>`).join('')
      : (paragraphs[0] ? `<p>${escHtml(paragraphs[0])}</p>` : '');
    const aiTag = article.ai_summary
      ? `<span class="ai-badge">✦ AI Summary</span>`
      : (aiAttempted ? `<span class="ai-failed-badge">✦ AI unavailable</span>` : '');
    return `
      <a href="${safeUrl(article.link)}" target="_blank" rel="noopener noreferrer" class="news-card-link">
        <article class="news-card">
          <div class="card-meta">
            <span class="card-source">${escHtml(article.source)}</span>
            ${article.date ? `<span class="card-date">${escHtml(formatDate(article.date))}</span>` : ''}
            ${aiTag}
          </div>
          <h3>${escHtml(article.title)}</h3>
          <div class="card-body">${bodyHtml}</div>
        </article>
      </a>`;
  }

  function appendCard(container, article, aiAttempted) {
    container.insertAdjacentHTML('beforeend', buildCardHtml(article, aiAttempted));
  }

  function load(tabId) {
    const containerId = CONTAINERS[tabId];
    if (!containerId) return;
    const container = document.getElementById(containerId);
    if (!container) return;

    // Close any existing stream for this tab before starting a new one
    if (activeSources[tabId]) {
      activeSources[tabId].close();
      delete activeSources[tabId];
    }

    renderLoading(container);
    const articleBuffer = []; // all received articles (may span multiple pages)
    let aiAttempted  = false;
    let currentPage  = 0;
    let streamDone   = false;

    function renderPagination() {
      container.querySelector('.pagination-bar')?.remove();
      const totalPages = Math.ceil(articleBuffer.length / PAGE_SIZE);
      if (totalPages <= 1) return;
      const bar = document.createElement('div');
      bar.className = 'pagination-bar';
      bar.innerHTML = `
        <button class="page-btn prev-btn"${currentPage === 0 ? ' disabled' : ''}>← Prev</button>
        <span class="page-info">Page ${currentPage + 1} / ${totalPages}</span>
        <button class="page-btn next-btn"${currentPage >= totalPages - 1 ? ' disabled' : ''}>Next →</button>`;
      bar.querySelector('.prev-btn').addEventListener('click', () => {
        currentPage--;
        renderCurrentPage();
        container.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      bar.querySelector('.next-btn').addEventListener('click', () => {
        currentPage++;
        renderCurrentPage();
        container.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      container.appendChild(bar);
    }

    function renderCurrentPage() {
      // Remove cards and pagination but preserve spinner if still streaming
      container.querySelectorAll('.news-card-link, .pagination-bar').forEach(el => el.remove());
      const start = currentPage * PAGE_SIZE;
      const slice = articleBuffer.slice(start, start + PAGE_SIZE);
      const spinnerEl = container.querySelector('.loading-state');
      slice.forEach(a => {
        const html = buildCardHtml(a, aiAttempted);
        if (spinnerEl) spinnerEl.insertAdjacentHTML('beforebegin', html);
        else container.insertAdjacentHTML('beforeend', html);
      });
      renderPagination();
    }

    const source = new EventSource(`api/news.php?tab=${encodeURIComponent(tabId)}`);
    activeSources[tabId] = source;

    // Wire stop button — closes the SSE stream; PHP continues in background to fill cache
    container.querySelector('.stop-ai-btn')?.addEventListener('click', () => {
      source.close();
      delete activeSources[tabId];
      container.querySelector('.loading-state')?.remove();
      if (articleBuffer.length === 0) {
        container.innerHTML = '';
        renderError(container, 'AI processing stopped before any articles arrived.', tabId);
      } else {
        renderCurrentPage();
        container.insertAdjacentHTML('beforeend',
          `<div class="stop-notice">⏹ AI stopped · ${articleBuffer.length} article${articleBuffer.length !== 1 ? 's' : ''} loaded</div>`);
      }
    });

    source.addEventListener('meta', e => {
      const d = JSON.parse(e.data);
      aiAttempted = d.ai_attempted === true;
      if (aiAttempted) {
        const stopBtn = container.querySelector('.stop-ai-btn');
        if (stopBtn) stopBtn.style.display = '';
      }
    });

    source.addEventListener('status', e => {
      updateLoadingStatus(container, JSON.parse(e.data).message);
    });

    source.addEventListener('article', e => {
      const article = JSON.parse(e.data);
      articleBuffer.push(article);
      // Render immediately only if it belongs to the current page view
      if (articleBuffer.length > currentPage * PAGE_SIZE &&
          articleBuffer.length <= (currentPage + 1) * PAGE_SIZE) {
        const spinnerEl = container.querySelector('.loading-state');
        const html = buildCardHtml(article, aiAttempted);
        if (spinnerEl) spinnerEl.insertAdjacentHTML('beforebegin', html);
        else container.insertAdjacentHTML('beforeend', html);
      }
    });

    source.addEventListener('done', e => {
      source.close();
      delete activeSources[tabId];
      streamDone = true;
      // Remove spinner now that all articles have arrived
      container.querySelector('.loading-state')?.remove();
      if (articleBuffer.length === 0) {
        renderError(container, 'No articles found', tabId);
        return;
      }
      renderPagination();
      const d = JSON.parse(e.data);
      if (d.errors && d.errors.length) {
        container.insertAdjacentHTML('beforeend', `
          <div class="error-card" style="font-size:.75rem;padding:10px 14px;grid-column:1/-1;">
            ⚠ Some feeds failed: ${escHtml(d.errors.join('; '))}
          </div>`);
      }
    });

    // SSE transport error (network failure, 5xx, etc.)
    source.addEventListener('error', () => {
      source.close();
      delete activeSources[tabId];
      container.querySelector('.loading-state')?.remove();
      if (articleBuffer.length === 0) {
        container.innerHTML = '';
        renderError(container, 'Stream connection failed. Please retry.', tabId);
      }
    });
  }

  return { load };

})();
