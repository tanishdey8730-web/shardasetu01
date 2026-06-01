(function () {
  const $ = (id) => document.getElementById(id);
  let trendChart = null;

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function fmtRank(n) {
    return Number(n).toLocaleString("en-IN");
  }

  function renderKpis(data) {
    const p = data.performance || {};
    const r = data.rank || {};
    const s = data.selection || {};
    $("rp-kpis").innerHTML = `
      <div class="rp-kpi"><strong>${data.predictedScore ?? 0}%</strong><span>Predicted score</span></div>
      <div class="rp-kpi"><strong>${r.percentile ?? 0}</strong><span>Percentile</span></div>
      <div class="rp-kpi"><strong>${s.selectionProbability ?? 0}%</strong><span>Selection chance</span></div>
      <div class="rp-kpi"><strong>${p.mockCount ?? 0}</strong><span>Mocks analyzed</span></div>
      <div class="rp-kpi"><strong>${p.trend || "—"}</strong><span>Trend</span></div>`;
  }

  function renderRank(data) {
    const r = data.rank || {};
    $("rp-rank-main").textContent = r.predicted ? `#${fmtRank(r.predicted)}` : "—";
    if (r.range) {
      $("rp-rank-range").textContent = `Range: #${fmtRank(r.range.best)} – #${fmtRank(r.range.worst)} (est.)`;
    }
    $("rp-percentile").textContent = r.percentile
      ? `${r.percentile}th percentile · ~${fmtRank(r.estimatedCandidates)} candidates`
      : "";
    $("rp-confidence").textContent = r.confidence
      ? `Model confidence: ${r.confidence}%`
      : "";
  }

  function renderSelection(sel) {
    $("rp-qual-val").textContent = `${sel.qualifyingProbability ?? 0}%`;
    $("rp-sel-val").textContent = `${sel.selectionProbability ?? 0}%`;
    $("rp-qual-fill").style.width = `${sel.qualifyingProbability ?? 0}%`;
    $("rp-sel-fill").style.width = `${sel.selectionProbability ?? 0}%`;
    $("rp-sel-label").textContent = sel.selectionLabel || "Selection";
    const badge = $("rp-sel-status");
    badge.textContent = (sel.status || "—").replace(/_/g, " ");
    badge.className = "rp-status-badge " + (sel.status || "");
  }

  function renderPerf(p) {
    $("rp-perf-list").innerHTML = `
      <li><span>Mock average</span><strong>${p.mockAvg ?? 0}%</strong></li>
      <li><span>Recent average</span><strong>${p.recentAvg ?? 0}%</strong></li>
      <li><span>Best score</span><strong>${p.bestScore ?? 0}%</strong></li>
      <li><span>Consistency</span><strong>${p.consistency ?? 0}/100</strong></li>
      <li><span>Trend</span><strong>${p.trendDelta >= 0 ? "+" : ""}${p.trendDelta ?? 0} pts</strong></li>`;
  }

  function renderSuggestions(list) {
    const el = $("rp-suggestions");
    if (!list?.length) {
      el.innerHTML = "<p style='color:var(--rp-muted)'>No suggestions yet.</p>";
      return;
    }
    el.innerHTML = list
      .map(
        (s) => `
      <article class="rp-sug">
        <h4>#${s.rank} ${escapeHtml(s.title)}</h4>
        <p>${escapeHtml(s.detail)}</p>
        ${s.action ? `<a href="${escapeHtml(s.action)}">Take action →</a>` : ""}
      </article>`
      )
      .join("");
  }

  function renderTests(tests) {
    const tbody = $("rp-tests-table")?.querySelector("tbody");
    if (!tbody) return;
    if (!tests?.length) {
      tbody.innerHTML =
        '<tr><td colspan="4" style="color:var(--rp-muted)">No tests yet — take a mock to start.</td></tr>';
      return;
    }
    tbody.innerHTML = [...tests]
      .reverse()
      .map(
        (t) => `
      <tr>
        <td>${escapeHtml(t.title || "Test")}</td>
        <td>${escapeHtml(t.type || "—")}</td>
        <td><strong>${t.percentScore}%</strong></td>
        <td>${new Date(t.submittedAt).toLocaleDateString("en-IN")}</td>
      </tr>`
      )
      .join("");
  }

  function renderTrendChart(future, historical) {
    if (trendChart) {
      trendChart.destroy();
      trendChart = null;
    }
    if (typeof Chart === "undefined") return;

    const hist = historical || [];
    const proj = future?.projectedScores || [];
    const labels = [...hist.map((h) => h.label), ...proj.map((p) => p.label)];
    const histData = [...hist.map((h) => h.score), ...Array(proj.length).fill(null)];
    const projData = [...Array(hist.length).fill(null), ...proj.map((p) => p.projectedScore)];

    const dark = document.documentElement.getAttribute("data-theme") === "dark";
    const text = dark ? "#94a3b8" : "#64748b";
    const grid = dark ? "rgba(148,163,184,0.15)" : "rgba(100,116,139,0.2)";

    trendChart = new Chart($("rp-chart-trend"), {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Actual scores",
            data: histData,
            borderColor: "#0d9488",
            backgroundColor: "rgba(13,148,136,0.12)",
            fill: true,
            tension: 0.35,
            spanGaps: false
          },
          {
            label: "Projected",
            data: projData,
            borderColor: "#b45309",
            borderDash: [6, 4],
            tension: 0.35,
            pointStyle: "rectRot"
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { min: 0, max: 100, ticks: { color: text }, grid: { color: grid } },
          x: { ticks: { color: text, maxRotation: 45 }, grid: { color: grid } }
        },
        plugins: { legend: { labels: { color: text } } }
      }
    });
  }

  function renderDashboard(data) {
    $("rp-disclaimer").textContent = data.disclaimer || "";
    $("rp-disclaimer").hidden = !data.disclaimer;
    renderKpis(data);
    renderRank(data);
    renderSelection(data.selection || {});
    renderPerf(data.performance || {});
    $("rp-trend-summary").textContent = data.futureTrends?.summary || "";
    renderTrendChart(data.futureTrends, data.futureTrends?.historical);
    renderSuggestions(data.suggestions);
    renderTests(data.performance?.tests);
  }

  async function load() {
    if (!window.ShardaAuth?.isLoggedIn?.()) {
      $("rp-guest").hidden = false;
      $("rp-loading").hidden = true;
      $("rp-dashboard").hidden = true;
      return;
    }

    $("rp-guest").hidden = true;
    $("rp-loading").hidden = false;
    $("rp-dashboard").hidden = true;

    try {
      const examId = $("rp-exam-filter").value;
      const data = await window.ShardaAuth.apiFetch(
        `/api/rank-prediction?examId=${encodeURIComponent(examId)}`
      );
      renderDashboard(data);
      $("rp-loading").hidden = true;
      $("rp-dashboard").hidden = false;
    } catch (err) {
      $("rp-loading").textContent = err.message || "Failed to load prediction";
    }
  }

  $("rp-exam-filter")?.addEventListener("change", load);
  $("rp-refresh")?.addEventListener("click", load);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", load);
  } else {
    load();
  }
})();
