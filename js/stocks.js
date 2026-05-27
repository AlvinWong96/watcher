/**
 * stocks.js — Stock Dashboard, Chart Rendering & Price Prediction
 *
 * Fetches data from api/stocks.php (Yahoo Finance + linear regression).
 * Renders a Chart.js price chart with:
 *   - Historical close prices
 *   - SMA 7 & SMA 20 overlays
 *   - 7-day predicted price line (dashed)
 *   - 95% confidence band (shaded area)
 * Also renders a prediction table and key stats.
 */

const WatcherStocks = (() => {
  'use strict';

  // ── Stock symbol lists ────────────────────────────────────────────────────
  const STOCK_LISTS = {
    'world-economy': [
      { symbol: '^GSPC',  label: 'S&P 500' },
      { symbol: '^IXIC',  label: 'NASDAQ Composite' },
      { symbol: '^DJI',   label: 'Dow Jones' },
      { symbol: 'AAPL',   label: 'Apple (AAPL)' },
      { symbol: 'MSFT',   label: 'Microsoft (MSFT)' },
      { symbol: 'NVDA',   label: 'NVIDIA (NVDA)' },
      { symbol: 'TSLA',   label: 'Tesla (TSLA)' },
      { symbol: 'GOOGL',  label: 'Alphabet (GOOGL)' },
      { symbol: 'AMZN',   label: 'Amazon (AMZN)' },
      { symbol: 'META',   label: 'Meta (META)' },
    ],
    'malaysia-economy': [
      { symbol: '^KLSE',   label: 'FTSE Bursa KLCI' },
      { symbol: '1155.KL', label: 'Maybank (1155)' },
      { symbol: '1023.KL', label: 'CIMB Group (1023)' },
      { symbol: '5347.KL', label: 'Tenaga Nasional (5347)' },
      { symbol: '4863.KL', label: 'Telekom Malaysia (4863)' },
      { symbol: '5183.KL', label: 'Public Bank (5183)' },
      { symbol: '1082.KL', label: 'Hong Leong Bank (1082)' },
      { symbol: '3816.KL', label: 'MISC Berhad (3816)' },
      { symbol: '2445.KL', label: 'PETRONAS Gas (2445)' },
    ],
  };

  // Active Chart.js instances keyed by tabId
  const charts = {};

  // Per-tab state
  const state = {
    'world-economy':    { symbol: '^GSPC',  range: '1mo' },
    'malaysia-economy': { symbol: '^KLSE',  range: '1mo' },
  };

  // ── Helpers ───────────────────────────────────────────────────────────────
  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmtNum(n, decimals = 2) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return Number(n).toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }

  function fmtVol(n) {
    if (!n) return '—';
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return String(n);
  }

  function pct(n) {
    if (n === null || isNaN(n)) return '—';
    const sign = n >= 0 ? '+' : '';
    return sign + fmtNum(n) + '%';
  }

  function signClass(n) { return n >= 0 ? 'up' : 'down'; }

  // ── Namespace prefix helpers ───────────────────────────────────────────────
  function prefix(tabId) {
    return tabId === 'world-economy' ? 'world' : 'malaysia';
  }

  // ── Populate stock selector ────────────────────────────────────────────────
  function populateSelect(tabId) {
    const p   = prefix(tabId);
    const sel = document.getElementById(`${p}-stock-select`);
    if (!sel) return;

    sel.innerHTML = STOCK_LISTS[tabId]
      .map(s => `<option value="${escHtml(s.symbol)}">${escHtml(s.label)}</option>`)
      .join('');

    sel.value = state[tabId].symbol;

    sel.addEventListener('change', () => {
      state[tabId].symbol = sel.value;
      loadChart(tabId);
    });
  }

  // ── Range buttons ─────────────────────────────────────────────────────────
  function initRangeBtns(tabId) {
    const p = prefix(tabId);
    document.getElementById(`${p}-range-group`)
      ?.querySelectorAll('.range-btn')
      .forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll(`#${p}-range-group .range-btn`)
            .forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          state[tabId].range = btn.dataset.range;
          loadChart(tabId);
        });
      });
  }

  // ── Show / hide chart overlay ──────────────────────────────────────────────
  function setOverlay(tabId, show) {
    const p  = prefix(tabId);
    const el = document.getElementById(`${p}-chart-overlay`);
    if (el) el.classList.toggle('hidden', !show);
  }

  // ── Render stats row ───────────────────────────────────────────────────────
  function renderStats(tabId, data) {
    const p   = prefix(tabId);
    const el  = document.getElementById(`${p}-stock-stats`);
    if (!el) return;

    const chgClass = signClass(data.changePct);
    const rsiBadge = rsiClass(data.rsi);

    el.innerHTML = `
      <div class="stat-card">
        <div class="stat-label">Price</div>
        <div class="stat-value">${escHtml(data.currency)} ${fmtNum(data.currentPrice, 4)}</div>
        <div class="stat-sub">${escHtml(data.name || data.symbol)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Change</div>
        <div class="stat-value ${chgClass}">${pct(data.changePct)}</div>
        <div class="stat-sub">${data.change >= 0 ? '+' : ''}${fmtNum(data.change, 4)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Volume</div>
        <div class="stat-value">${fmtVol(data.volume)}</div>
        <div class="stat-sub">Daily volume</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">RSI (14)</div>
        <div class="stat-value">${data.rsi !== null ? fmtNum(data.rsi, 1) : '—'}</div>
        <div><span class="rsi-badge ${rsiBadge}">${escHtml(data.trendSignal)}</span></div>
      </div>`;
  }

  function rsiClass(rsi) {
    if (rsi === null) return 'neutral';
    if (rsi >= 70)    return 'overbought';
    if (rsi <= 30)    return 'oversold';
    return 'neutral';
  }

  // ── Build Chart.js dataset array ──────────────────────────────────────────
  function buildDatasets(data) {
    const hist  = data.history;
    const preds = data.predictions;
    const n     = hist.length;

    // All dates (historical + prediction)
    const allDates = [
      ...hist.map(h => h.date),
      ...preds.map(p => p.date),
    ];

    // Historical close prices padded with nulls for prediction range
    const closePrices = [
      ...hist.map(h => h.close),
      ...Array(preds.length).fill(null),
    ];

    // SMA lines (already n-length, pad with nulls)
    const sma7  = [...data.sma7,  ...Array(preds.length).fill(null)];
    const sma20 = [...data.sma20, ...Array(preds.length).fill(null)];

    // Prediction line: null for all historical except last point (for continuity)
    const lastClose = hist[n - 1].close;
    const predLine  = [
      ...Array(n - 1).fill(null),
      lastClose,
      ...preds.map(p => p.price),
    ];

    // Confidence bands
    const upperBand = [
      ...Array(n - 1).fill(null),
      lastClose,
      ...preds.map(p => p.upper),
    ];
    const lowerBand = [
      ...Array(n - 1).fill(null),
      lastClose,
      ...preds.map(p => p.lower),
    ];

    return {
      labels: allDates,
      datasets: [
        // 0: Price history (area)
        {
          label: 'Close Price',
          data: closePrices,
          borderColor: '#38bdf8',
          backgroundColor: 'rgba(56,189,248,0.08)',
          borderWidth: 2,
          pointRadius: 0,
          fill: true,
          tension: 0.3,
          order: 3,
        },
        // 1: SMA 7
        {
          label: 'SMA 7',
          data: sma7,
          borderColor: '#eab308',
          backgroundColor: 'transparent',
          borderWidth: 1.5,
          borderDash: [4, 3],
          pointRadius: 0,
          fill: false,
          tension: 0.3,
          order: 2,
        },
        // 2: SMA 20
        {
          label: 'SMA 20',
          data: sma20,
          borderColor: '#22c55e',
          backgroundColor: 'transparent',
          borderWidth: 1.5,
          borderDash: [4, 3],
          pointRadius: 0,
          fill: false,
          tension: 0.3,
          order: 2,
        },
        // 3: Upper confidence band (fills to dataset index 4)
        {
          label: 'Upper 95%',
          data: upperBand,
          borderColor: 'rgba(249,115,22,0.25)',
          backgroundColor: 'rgba(249,115,22,0.08)',
          borderWidth: 1,
          pointRadius: 0,
          fill: '+1',   // fill to dataset at index+1 (lowerBand)
          tension: 0.3,
          order: 1,
        },
        // 4: Lower confidence band
        {
          label: 'Lower 95%',
          data: lowerBand,
          borderColor: 'rgba(249,115,22,0.25)',
          backgroundColor: 'rgba(249,115,22,0.08)',
          borderWidth: 1,
          pointRadius: 0,
          fill: false,
          tension: 0.3,
          order: 1,
        },
        // 5: Predicted price
        {
          label: 'Predicted',
          data: predLine,
          borderColor: '#f97316',
          backgroundColor: 'transparent',
          borderWidth: 2,
          borderDash: [6, 4],
          pointRadius: (ctx) => {
            // Only show dot at the prediction start (index n-1) and end
            const i = ctx.dataIndex;
            return (i === n - 1 || i === allDates.length - 1) ? 4 : 0;
          },
          pointBackgroundColor: '#f97316',
          fill: false,
          tension: 0.3,
          order: 0,
        },
      ],
    };
  }

  // ── Render Chart.js chart ─────────────────────────────────────────────────
  function renderChart(tabId, data) {
    const p      = prefix(tabId);
    const canvas = document.getElementById(`${p}-stock-chart`);
    if (!canvas) return;

    // Destroy previous chart instance
    if (charts[tabId]) {
      charts[tabId].destroy();
      charts[tabId] = null;
    }

    const { labels, datasets } = buildDatasets(data);

    charts[tabId] = new Chart(canvas, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1e293b',
            borderColor: '#334155',
            borderWidth: 1,
            titleColor: '#94a3b8',
            bodyColor: '#e2e8f0',
            padding: 10,
            callbacks: {
              label(ctx) {
                const v = ctx.raw;
                if (v === null) return null;
                const label = ctx.dataset.label || '';
                return ` ${label}: ${data.currency} ${fmtNum(v, 4)}`;
              },
            },
          },
        },
        scales: {
          x: {
            grid: { color: 'rgba(255,255,255,0.04)' },
            ticks: {
              color: '#64748b',
              maxTicksLimit: 8,
              maxRotation: 0,
              autoSkip: true,
            },
          },
          y: {
            grid: { color: 'rgba(255,255,255,0.04)' },
            ticks: {
              color: '#64748b',
              callback: v => fmtNum(v, 2),
            },
          },
        },
      },
    });

    // Custom legend
    renderLegend(tabId);
  }

  // ── Legend ────────────────────────────────────────────────────────────────
  function renderLegend(tabId) {
    const p  = prefix(tabId);
    const el = document.getElementById(`${p}-chart-legend`);
    if (!el) return;

    el.innerHTML = `
      <div class="legend-item">
        <div class="legend-dot" style="background:#38bdf8;height:3px;width:14px;"></div>
        <span>Close Price</span>
      </div>
      <div class="legend-item">
        <div class="legend-dot dashed" style="color:#eab308;height:2px;width:14px;background:repeating-linear-gradient(to right,#eab308 0,#eab308 4px,transparent 4px,transparent 8px);"></div>
        <span>SMA 7</span>
      </div>
      <div class="legend-item">
        <div class="legend-dot dashed" style="color:#22c55e;height:2px;width:14px;background:repeating-linear-gradient(to right,#22c55e 0,#22c55e 4px,transparent 4px,transparent 8px);"></div>
        <span>SMA 20</span>
      </div>
      <div class="legend-item">
        <div class="legend-dot dashed" style="color:#f97316;height:2px;width:14px;background:repeating-linear-gradient(to right,#f97316 0,#f97316 6px,transparent 6px,transparent 10px);"></div>
        <span>Predicted</span>
      </div>
      <div class="legend-item">
        <div class="legend-dot" style="background:rgba(249,115,22,0.3);height:10px;width:14px;border-radius:2px;"></div>
        <span>95% Confidence</span>
      </div>`;
  }

  // ── Prediction table ──────────────────────────────────────────────────────
  function renderPredictionTable(tabId, data) {
    const p   = prefix(tabId);
    const el  = document.getElementById(`${p}-prediction-table`);
    if (!el) return;

    const cur  = data.currentPrice;
    const cur2 = data.currency;
    const method = data.predMethod || 'Linear Regression';
    const meta   = data.predMeta  || {};

    // Update the badge text in the section title
    const badge = document.querySelector(`#panel-${tabId} .prediction-badge`);
    if (badge) badge.textContent = method;

    const rows = data.predictions.map(pred => {
      const diff    = pred.price - cur;
      const diffPct = pred.change ?? ((diff / cur) * 100);
      const cls     = diff >= 0 ? 'up' : 'down';
      const sign    = diff >= 0 ? '▲' : '▼';

      return `
        <tr>
          <td>${escHtml(pred.date)}</td>
          <td class="pred-price">${escHtml(cur2)} ${fmtNum(pred.price, 4)}</td>
          <td class="pred-change ${cls}">${sign} ${fmtNum(Math.abs(diffPct), 2)}%</td>
          <td class="pred-upper">↑ ${fmtNum(pred.upper, 4)}</td>
          <td class="pred-lower">↓ ${fmtNum(pred.lower, 4)}</td>
        </tr>`;
    }).join('');

    // Build meta info line
    let metaHtml = '';
    if (meta.r2 !== undefined) {
      metaHtml += `R² = ${fmtNum(meta.r2, 4)} &nbsp;|&nbsp; σ = ${fmtNum(meta.stdDev, 4)}`;
    }
    if (meta.weights) {
      const w = meta.weights;
      metaHtml += `Model weights — RF: ${fmtNum(w.rf*100,1)}% &nbsp; GB: ${fmtNum(w.gb*100,1)}% &nbsp; LR: ${fmtNum(w.lr*100,1)}%`;
    }
    if (meta.top_features) {
      const top3 = Object.entries(meta.top_features).slice(0, 3)
        .map(([k, v]) => `${k} (${fmtNum(v*100, 1)}%)`).join(', ');
      metaHtml += (metaHtml ? ' &nbsp;|&nbsp; ' : '') + `Top features: ${escHtml(top3)}`;
    }

    el.innerHTML = `
      <table class="prediction-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Predicted Price</th>
            <th>vs Current</th>
            <th>Upper (95%)</th>
            <th>Lower (95%)</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      ${metaHtml ? `<div style="margin-top:10px;font-size:0.75rem;color:var(--text3);">${metaHtml}</div>` : ''}`;
  }

  // ── Fetch and render everything for a given tab ───────────────────────────
  async function loadChart(tabId) {
    const { symbol, range } = state[tabId];
    const p = prefix(tabId);

    setOverlay(tabId, true);

    // Reset stats to skeletons
    const statsEl = document.getElementById(`${p}-stock-stats`);
    if (statsEl) {
      statsEl.innerHTML = Array(4).fill('<div class="stat-skeleton"></div>').join('');
    }

    const predEl = document.getElementById(`${p}-prediction-table`);
    if (predEl) predEl.innerHTML = '';

    try {
      const url = `api/stocks.php?symbol=${encodeURIComponent(symbol)}&range=${encodeURIComponent(range)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });

      if (!res.ok) throw new Error(`Server error ${res.status}`);

      const data = await res.json();

      if (data.error) throw new Error(data.error);

      renderStats(tabId, data);
      renderChart(tabId, data);
      renderPredictionTable(tabId, data);
    } catch (err) {
      if (statsEl) statsEl.innerHTML = '';
      if (predEl)  predEl.innerHTML  = '';

      const chartWrap = document.getElementById(`${p}-stock-chart`)?.closest('.chart-wrap');
      if (chartWrap) {
        chartWrap.innerHTML = `
          <div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text3);font-size:.85rem;flex-direction:column;gap:8px;">
            <span>⚠ ${escHtml(err.message)}</span>
            <button class="retry-btn" onclick="WatcherStocks.reload('${escHtml(tabId)}')">↺ Retry</button>
          </div>`;
      }
    } finally {
      setOverlay(tabId, false);
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /** Initialize a stock dashboard tab (called once on first activation) */
  function init(tabId) {
    populateSelect(tabId);
    initRangeBtns(tabId);
    loadChart(tabId);
  }

  /** Re-fetch with current symbol/range (used by retry button) */
  function reload(tabId) {
    loadChart(tabId);
  }

  return { init, reload };

})();
