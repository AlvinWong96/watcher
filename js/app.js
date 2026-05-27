/**
 * app.js — Watcher Application Bootstrap
 * Handles tab switching and delegates to news.js / stocks.js modules.
 */

(function () {
  'use strict';

  // Track which tabs have been loaded (avoid redundant fetches)
  const loaded = new Set();

  // ── Tab Switching ──────────────────────────────────────────────────────
  function initTabs() {
    const tabBtns   = document.querySelectorAll('.tab-btn');
    const tabPanels = document.querySelectorAll('.tab-panel');

    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const tabId = btn.dataset.tab;

        tabBtns.forEach(b => {
          b.classList.remove('active');
          b.setAttribute('aria-selected', 'false');
        });
        tabPanels.forEach(p => p.classList.remove('active'));

        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
        document.getElementById(`panel-${tabId}`).classList.add('active');

        // Lazy-load content
        loadTab(tabId);
      });
    });
  }

  // ── Route tab to the correct loader ───────────────────────────────────
  function loadTab(tabId) {
    if (loaded.has(tabId)) return;
    loaded.add(tabId);

    switch (tabId) {
      case 'world-news':
      case 'malaysia-news':
        WatcherNews.load(tabId);
        break;
      case 'world-economy':
      case 'malaysia-economy':
        WatcherStocks.init(tabId);
        WatcherNews.load(tabId);
        break;
    }
  }

  // ── Timestamp in header ────────────────────────────────────────────────
  function setUpdatedTime() {
    const el = document.getElementById('js-last-updated');
    if (!el) return;
    const now = new Date();
    el.textContent = 'Updated ' + now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }

  // ── Auto-refresh ───────────────────────────────────────────────────────
  const AUTO_REFRESH_MS = 5 * 60 * 1000; // 5 minutes
  let   autoRefreshTimer = null;

  function getActiveTabId() {
    const btn = document.querySelector('.tab-btn.active');
    return btn ? btn.dataset.tab : 'world-news';
  }

  function refreshActiveTab() {
    const tabId = getActiveTabId();
    // Remove from cache so loadTab re-fetches
    loaded.delete(tabId);
    // For economy tabs, also reload stocks
    if (tabId === 'world-economy' || tabId === 'malaysia-economy') {
      WatcherStocks.init(tabId);
    }
    WatcherNews.load(tabId);
    loaded.add(tabId);
    setUpdatedTime();
  }

  function startAutoRefresh() {
    if (autoRefreshTimer) return;
    autoRefreshTimer = setInterval(refreshActiveTab, AUTO_REFRESH_MS);
  }

  function stopAutoRefresh() {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }

  function initAutoRefreshBtn() {
    const btn = document.getElementById('js-auto-refresh');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const isOn = btn.getAttribute('aria-pressed') === 'true';
      if (isOn) {
        stopAutoRefresh();
        btn.setAttribute('aria-pressed', 'false');
        btn.title = 'Enable auto-refresh every 5 minutes';
      } else {
        startAutoRefresh();
        btn.setAttribute('aria-pressed', 'true');
        btn.title = 'Auto-refresh ON — click to disable';
      }
    });
  }

  // ── Init ───────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    setUpdatedTime();
    initAutoRefreshBtn();
    // Load the default active tab (World News)
    loadTab('world-news');
  });

})();
