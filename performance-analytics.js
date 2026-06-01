(function () {
  const THEME_KEY = "sharda_setu_pa_theme";
  const charts = {};

  const $ = (id) => document.getElementById(id);

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function chartColors() {
    const dark = document.documentElement.getAttribute("data-theme") === "dark";
    return {
      text: dark ? "#94a3b8" : "#64748b",
      grid: dark ? "rgba(148,163,184,0.15)" : "rgba(100,116,139,0.2)"
    };
  }

  function destroyCharts() {
    Object.values(charts).forEach((c) => c?.destroy());
    Object.keys(charts).forEach((k) => delete charts[k]);
  }

  function initTheme() {
    const dark = localStorage.getItem(THEME_KEY) === "dark";
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    $("pa-theme-btn").textContent = dark ? "☀️" : "🌙";
  }

  function toggleTheme() {
    const dark = document.documentElement.getAttribute("data-theme") === "dark";
    const next = dark ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem(THEME_KEY, next === "dark" ? "dark" : "light");
    $("pa-theme-btn").textContent = next === "dark" ? "☀️" : "🌙";
    if (window._lastAnalytics) renderDashboard(window._lastAnalytics);
  }

  async function fetchAnalytics(examId) {
    const q = examId ? `?examId=${encodeURIComponent(examId)}` : "";
    return window.ShardaAuth.apiFetch(`/api/analytics${q}`);
  }

  function renderKpis(data) {
    const s = data.summary || {};
    const r = data.readiness || {};
    $("pa-kpis").innerHTML = `
      <div class="pa-kpi highlight"><strong>${r.readinessScore ?? 0}</strong><span>Readiness score</span></div>
      <div class="pa-kpi prob"><strong>${r.successProbability ?? 0}%</strong><span>Success probability</span></div>
      <div class="pa-kpi"><strong>${s.avgScore ?? 0}%</strong><span>Avg score</span></div>
      <div class="pa-kpi"><strong>${s.avgAccuracy ?? 0}%</strong><span>Avg accuracy</span></div>
      <div class="pa-kpi"><strong>${s.totalTests ?? 0}</strong><span>Mock tests</span></div>
      <div class="pa-kpi"><strong>${s.weakTopicCount ?? 0}</strong><span>Weak topics</span></div>`;

    $("pa-readiness-val").textContent = r.readinessScore ?? 0;
    $("pa-level-badge").textContent = r.label || "—";
    $("pa-prob-val").textContent = `${r.successProbability ?? 0}%`;
    $("pa-prob-fill").style.width = `${r.successProbability ?? 0}%`;
  }

  function renderTopicList(elId, topics, tagClass, tagLabel) {
    const el = $(elId);
    if (!topics.length) {
      el.innerHTML = `<li style="color:var(--pa-muted)">No ${tagLabel.toLowerCase()} topics identified yet — attempt more tests.</li>`;
      return;
    }
    el.innerHTML = topics
      .map(
        (t) => `
      <li>
        <span>${escapeHtml(t.topicName)}</span>
        <span class="pa-tag ${tagClass}">${t.accuracy}%</span>
      </li>`
      )
      .join("");
  }

  function renderRecs(recs) {
    $("pa-recs").innerHTML = (recs || [])
      .map(
        (rec) => `
      <article class="pa-rec ${rec.priority}">
        <h4>${escapeHtml(rec.title)}</h4>
        <p>${escapeHtml(rec.detail)}</p>
        ${rec.action ? `<a href="${escapeHtml(rec.action.replace(/^\//, ""))}">Take action →</a>` : ""}
      </article>`
      )
      .join("");
  }

  function renderCharts(ch) {
    if (!ch || typeof Chart === "undefined") return;
    const c = chartColors();

    destroyCharts();

    const defaultScale = {
      ticks: { color: c.text, font: { size: 11 } },
      grid: { color: c.grid }
    };

    if (ch.scoreTrend?.labels?.length) {
      charts.trend = new Chart($("chart-trend"), {
        type: "line",
        data: {
          labels: ch.scoreTrend.labels,
          datasets: ch.scoreTrend.datasets.map((ds, i) => ({
            label: ds.label,
            data: ds.data,
            borderColor: i === 0 ? "#1565c0" : "#2e7d32",
            backgroundColor: i === 0 ? "rgba(21,101,192,0.1)" : "transparent",
            fill: i === 0,
            tension: 0.35,
            pointRadius: 4
          }))
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { labels: { color: c.text } } },
          scales: { x: defaultScale, y: { ...defaultScale, min: 0, max: 100 } }
        }
      });
    }

    if (ch.topicAccuracy?.labels?.length) {
      charts.topics = new Chart($("chart-topics"), {
        type: "bar",
        data: {
          labels: ch.topicAccuracy.labels,
          datasets: [
            {
              label: "Accuracy %",
              data: ch.topicAccuracy.data,
              backgroundColor: ch.topicAccuracy.colors
            }
          ]
        },
        options: {
          indexAxis: "y",
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { ...defaultScale, min: 0, max: 100 },
            y: defaultScale
          }
        }
      });
    }

    const ans = ch.answerDistribution;
    if (ans?.data?.some((v) => v > 0)) {
      charts.answers = new Chart($("chart-answers"), {
        type: "doughnut",
        data: {
          labels: ans.labels,
          datasets: [{ data: ans.data, backgroundColor: ans.colors }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: "bottom", labels: { color: c.text, boxWidth: 12 } } }
        }
      });
    }

    const mix = ch.attemptMix;
    if (mix?.data?.some((v) => v > 0)) {
      charts.mix = new Chart($("chart-mix"), {
        type: "pie",
        data: {
          labels: mix.labels,
          datasets: [
            {
              data: mix.data,
              backgroundColor: ["#1565c0", "#1a237e", "#ef6c00"]
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: "bottom", labels: { color: c.text, boxWidth: 12 } } }
        }
      });
    }

    const comp = ch.componentBreakdown;
    if (comp?.data?.length) {
      charts.components = new Chart($("chart-components"), {
        type: "radar",
        data: {
          labels: comp.labels,
          datasets: [
            {
              label: "Score",
              data: comp.data,
              backgroundColor: "rgba(21,101,192,0.2)",
              borderColor: "#1565c0",
              pointBackgroundColor: "#1565c0"
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            r: {
              min: 0,
              max: 100,
              ticks: { color: c.text, backdropColor: "transparent" },
              grid: { color: c.grid },
              pointLabels: { color: c.text, font: { size: 10 } }
            }
          },
          plugins: { legend: { display: false } }
        }
      });
    }
  }

  function renderDashboard(data) {
    window._lastAnalytics = data;

    $("pa-loading").hidden = true;

    if (!data.summary?.totalTests && !data.summary?.totalQuizGames) {
      $("pa-dashboard").hidden = true;
      $("pa-empty-state").hidden = false;
      return;
    }

    $("pa-empty-state").hidden = true;
    $("pa-dashboard").hidden = false;

    const ai = $("pa-ai-insights");
    if (data.aiInsights) {
      ai.hidden = false;
      ai.innerHTML = `<strong>AI coach insights</strong><br/>${escapeHtml(data.aiInsights).replace(/\n/g, "<br/>")}`;
    } else {
      ai.hidden = true;
    }

    renderKpis(data);
    renderTopicList("pa-weak-list", data.weakTopics || [], "weak", "Weak");
    renderTopicList("pa-strong-list", data.strongTopics || [], "strong", "Strong");
    renderRecs(data.recommendations);
    renderCharts(data.charts);
  }

  async function load() {
    if (!window.ShardaAuth?.isLoggedIn()) {
      $("pa-guest").hidden = false;
      $("pa-loading").hidden = true;
      $("pa-dashboard").hidden = true;
      return;
    }

    $("pa-guest").hidden = true;
    $("pa-loading").hidden = false;
    $("pa-dashboard").hidden = true;
    $("pa-empty-state").hidden = true;

    try {
      const examId = $("pa-exam-filter").value;
      const data = await fetchAnalytics(examId);
      renderDashboard(data);
    } catch (err) {
      $("pa-loading").textContent = err.message;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    initTheme();
    $("pa-theme-btn").addEventListener("click", toggleTheme);
    $("pa-refresh-btn").addEventListener("click", load);
    $("pa-exam-filter").addEventListener("change", load);
    setTimeout(load, 100);
  });
})();
