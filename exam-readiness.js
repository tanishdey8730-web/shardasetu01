(function () {
  const $ = (id) => document.getElementById(id);
  let historyChart = null;

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function setRing(score) {
    const circumference = 2 * Math.PI * 52;
    const offset = circumference - (score / 100) * circumference;
    const fill = $("er-ring-fill");
    if (fill) {
      fill.style.strokeDasharray = String(circumference);
      fill.style.strokeDashoffset = String(offset);
    }
  }

  function renderComponents(progress) {
    const items = progress?.components || [];
    $("er-components").innerHTML = items
      .map(
        (c) => `
      <div class="er-progress-row">
        <span>${escapeHtml(c.label)}</span>
        <strong>${c.percent}%</strong>
        <div class="er-progress-track">
          <div class="er-progress-fill ${c.status}" style="width:${c.percent}%"></div>
        </div>
      </div>`
      )
      .join("");
  }

  function renderSubjects(subjects) {
    const el = $("er-subjects");
    if (!subjects?.length) {
      el.innerHTML = '<p style="color:var(--er-muted);font-size:0.88rem">No subject data yet — complete tests with chapter breakdowns.</p>';
      return;
    }
    el.innerHTML = subjects
      .map(
        (s) => `
      <div class="er-subject-row">
        <header>
          <span>${escapeHtml(s.subject)}</span>
          <span><strong>${s.score}</strong>/100 · ${s.accuracy}% acc</span>
        </header>
        <div class="er-progress-track">
          <div class="er-progress-fill ${s.level === "strong" || s.level === "good" ? "good" : s.level === "developing" ? "fair" : "low"}" style="width:${s.progressPercent}%"></div>
        </div>
      </div>`
      )
      .join("");
  }

  function renderWeaknesses(list) {
    const el = $("er-weaknesses");
    if (!list?.length) {
      el.innerHTML = '<p style="color:var(--er-muted)">No critical weaknesses detected. Keep practicing!</p>';
      return;
    }
    el.innerHTML = list
      .map(
        (w) => `
      <article class="er-weak-item ${w.severity}">
        <h4>${escapeHtml(w.topicName || w.subject)}</h4>
        <p>${escapeHtml(w.summary)}</p>
        <div class="er-weak-meta">
          <span>${w.accuracy}% accuracy</span>
          <span class="${w.severity}">${w.severity}</span>
          <span>+${w.impactOnReadiness} pts potential</span>
        </div>
      </article>`
      )
      .join("");
  }

  function renderRecs(recs) {
    $("er-recs").innerHTML = (recs || [])
      .map(
        (r) => `
      <article class="er-rec">
        <h4>#${r.rank} ${escapeHtml(r.title)}</h4>
        <p>${escapeHtml(r.detail)}</p>
        <footer>
          <span>Impact: ${escapeHtml(r.impact)}</span>
          ${r.estimatedGain ? `<span>~+${r.estimatedGain} readiness</span>` : ""}
          ${r.action ? `<a href="${escapeHtml(r.action)}">Take action →</a>` : ""}
        </footer>
      </article>`
      )
      .join("");
  }

  function renderSummary(data) {
    const s = data.summary || {};
    const strongest = s.strongestSubject;
    $("er-summary").innerHTML = `
      <li><span>Mock tests taken</span><strong>${s.totalTests ?? 0}</strong></li>
      <li><span>Weak topics</span><strong>${s.weakTopics ?? 0}</strong></li>
      <li><span>Subjects needing work</span><strong>${s.weakSubjects ?? 0}</strong></li>
      <li><span>Projected gain (top 3 actions)</span><strong>+${s.projectedGain ?? 0} pts</strong></li>
      ${
        strongest
          ? `<li><span>Strongest subject</span><strong>${escapeHtml(strongest.subject)} (${strongest.accuracy}%)</strong></li>`
          : ""
      }`;
  }

  function renderStrengths(list) {
    const el = $("er-strengths");
    if (!list?.length) {
      el.innerHTML = "<li>No strong topics yet</li>";
      return;
    }
    el.innerHTML = list
      .map((t) => `<li>${escapeHtml(t.topicName)} — ${t.accuracy}%</li>`)
      .join("");
  }

  function renderHistory(history) {
    if (historyChart) {
      historyChart.destroy();
      historyChart = null;
    }
    if (!history?.length || typeof Chart === "undefined") return;

    const dark = document.documentElement.getAttribute("data-theme") === "dark";
    const text = dark ? "#94a3b8" : "#64748b";
    const grid = dark ? "rgba(148,163,184,0.15)" : "rgba(100,116,139,0.2)";

    historyChart = new Chart($("er-chart-history"), {
      type: "line",
      data: {
        labels: history.map((h) => h.label),
        datasets: [
          {
            label: "Readiness score",
            data: history.map((h) => h.readinessScore),
            borderColor: "#4f46e5",
            backgroundColor: "rgba(79,70,229,0.12)",
            fill: true,
            tension: 0.35
          },
          {
            label: "Success probability",
            data: history.map((h) => h.successProbability),
            borderColor: "#7c3aed",
            borderDash: [4, 4],
            tension: 0.35
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
    const r = data.readiness || {};
    $("er-score-num").textContent = r.score ?? 0;
    $("er-level-badge").textContent = r.label || "—";
    $("er-prob").textContent = `${r.successProbability ?? 0}%`;
    $("er-prob-fill").style.width = `${r.successProbability ?? 0}%`;
    setRing(r.score ?? 0);

    const deltaEl = $("er-delta");
    if (data.historyDelta != null) {
      deltaEl.hidden = false;
      const d = data.historyDelta;
      deltaEl.textContent = d >= 0 ? `↑ ${d} pts vs last week` : `↓ ${Math.abs(d)} pts vs last week`;
      deltaEl.className = "er-delta " + (d >= 0 ? "up" : "down");
    } else {
      deltaEl.hidden = true;
    }

    renderComponents(data.progress);
    renderSubjects(data.subjectScores);
    renderWeaknesses(data.weaknesses);
    renderRecs(data.recommendations);
    renderSummary(data);
    renderStrengths(data.strengths);
    renderHistory(data.history);
  }

  async function load() {
    if (!window.ShardaAuth?.isLoggedIn?.()) {
      $("er-guest").hidden = false;
      $("er-loading").hidden = true;
      $("er-dashboard").hidden = true;
      return;
    }

    $("er-guest").hidden = true;
    $("er-loading").hidden = false;
    $("er-dashboard").hidden = true;

    try {
      const examId = $("er-exam-filter").value;
      const q = examId ? `?examId=${encodeURIComponent(examId)}` : "";
      const data = await window.ShardaAuth.apiFetch(`/api/exam-readiness${q}`);
      window._lastReadiness = data;
      renderDashboard(data);
      $("er-loading").hidden = true;
      $("er-dashboard").hidden = false;
    } catch (err) {
      $("er-loading").textContent = err.message || "Failed to load readiness";
    }
  }

  $("er-exam-filter")?.addEventListener("change", load);
  $("er-refresh")?.addEventListener("click", load);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", load);
  } else {
    load();
  }
})();
