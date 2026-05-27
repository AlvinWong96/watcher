/**
 * app.js — Watcher Application Bootstrap
 * Handles tab switching and delegates to news.js / stocks.js modules.
 */

(function () {
  'use strict';

  // Track which tabs have been loaded (avoid redundant fetches)
  const loaded = new Set();

  // ── Tab Switching ──────────────────────────────────────────────────────
  function activateTab(tabId) {
    const navItems  = document.querySelectorAll('.nav-item[data-tab]');
    const tabPanels = document.querySelectorAll('.tab-panel');

    navItems.forEach(b => {
      b.classList.remove('active');
      b.setAttribute('aria-selected', 'false');
    });
    tabPanels.forEach(p => p.classList.remove('active'));

    const activeBtn = document.querySelector(`.nav-item[data-tab="${tabId}"]`);
    if (activeBtn) {
      activeBtn.classList.add('active');
      activeBtn.setAttribute('aria-selected', 'true');
    }
    const panel = document.getElementById(`panel-${tabId}`);
    if (panel) panel.classList.add('active');

    // Lazy-load content
    loadTab(tabId);
  }

  function initTabs() {
    document.querySelectorAll('.nav-item[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => activateTab(btn.dataset.tab));
    });

    // Home-card shortcut buttons
    document.querySelectorAll('.home-card[data-tab]').forEach(card => {
      card.addEventListener('click', () => activateTab(card.dataset.tab));
    });
  }

  // ── Route tab to the correct loader ───────────────────────────────────
  function loadTab(tabId) {
    if (loaded.has(tabId)) return;
    loaded.add(tabId);

    switch (tabId) {
      case 'home':
        break; // nothing to load
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
    const btn = document.querySelector('.nav-item[data-tab].active');
    return btn ? btn.dataset.tab : 'home';
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
    // Home is the default active tab — no content to load
  });

})();
