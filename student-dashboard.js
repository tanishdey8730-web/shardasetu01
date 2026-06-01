(function () {
  const THEME_KEY = "sharda_setu_sd_theme";
  const charts = {};
  let dashboardData = null;

  const $ = (id) => document.getElementById(id);

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function initTheme() {
    const dark = localStorage.getItem(THEME_KEY) === "dark";
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    $("sd-theme-btn").textContent = dark ? "☀️" : "🌙";
  }

  function toggleTheme() {
    const dark = document.documentElement.getAttribute("data-theme") === "dark";
    const next = dark ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem(THEME_KEY, next === "dark" ? "dark" : "light");
    $("sd-theme-btn").textContent = next === "dark" ? "☀️" : "🌙";
    if (dashboardData) renderCharts(dashboardData.charts);
  }

  function chartTheme() {
    const dark = document.documentElement.getAttribute("data-theme") === "dark";
    return {
      text: dark ? "#94a3b8" : "#64748b",
      grid: dark ? "rgba(148,163,184,0.12)" : "rgba(100,116,139,0.15)"
    };
  }

  function destroyCharts() {
    Object.values(charts).forEach((c) => c?.destroy());
    Object.keys(charts).forEach((k) => delete charts[k]);
  }

  function renderKpis(d) {
    $("sd-kpis").innerHTML = `
      <div class="sd-kpi streak">
        <div class="sd-kpi-icon">🔥</div>
        <strong>${d.streak?.current ?? 0}</strong>
        <span>Day streak</span>
      </div>
      <div class="sd-kpi">
        <div class="sd-kpi-icon">⏱️</div>
        <strong>${d.hoursStudied?.totalHours ?? 0}h</strong>
        <span>Studied (30 days)</span>
      </div>
      <div class="sd-kpi">
        <div class="sd-kpi-icon">📚</div>
        <strong>${d.coursesCompleted?.count ?? 0}</strong>
        <span>Modules completed</span>
      </div>
      <div class="sd-kpi readiness">
        <div class="sd-kpi-icon">🎯</div>
        <strong>${d.readiness?.score ?? 0}</strong>
        <span>Readiness score</span>
      </div>
      <div class="sd-kpi">
        <div class="sd-kpi-icon">📅</div>
        <strong>${d.hoursStudied?.thisWeekHours ?? 0}h</strong>
        <span>This week</span>
      </div>
      <div class="sd-kpi">
        <div class="sd-kpi-icon">✅</div>
        <strong>${d.coursesCompleted?.mockTestsPassed ?? 0}</strong>
        <span>Mocks passed (60%+)</span>
      </div>`;
  }

  function renderWelcome(d) {
    const name = d.user?.name?.split(" ")[0] || "Student";
    $("sd-greeting").textContent = `Welcome back, ${name}`;
    $("sd-subtitle").textContent = d.user?.examGoal
      ? `Preparing for ${d.user.examGoal}`
      : "Track your competitive exam journey";
    if (d.user?.avatar) $("sd-avatar").src = d.user.avatar;

    $("sd-readiness-val").textContent = d.readiness?.score ?? 0;
    $("sd-readiness-label").textContent = d.readiness?.label || "—";
    $("sd-prob-val").textContent = `${d.readiness?.successProbability ?? 0}%`;
  }

  function renderCharts(ch) {
    if (!ch || typeof Chart === "undefined") return;
    destroyCharts();
    const t = chartTheme();
    const scale = {
      ticks: { color: t.text, font: { size: 11 } },
      grid: { color: t.grid }
    };

    if (ch.weeklyStudy) {
      charts.weekly = new Chart($("chart-weekly"), {
        type: "bar",
        data: {
          labels: ch.weeklyStudy.labels,
          datasets: [
            {
              label: "Hours",
              data: ch.weeklyStudy.data,
              backgroundColor: "rgba(37, 99, 235, 0.75)",
              borderRadius: 8
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { x: scale, y: { ...scale, beginAtZero: true } }
        }
      });
    }

    if (ch.scoreProgress?.labels?.length) {
      charts.scores = new Chart($("chart-scores"), {
        type: "line",
        data: {
          labels: ch.scoreProgress.labels,
          datasets: [
            {
              label: "Score %",
              data: ch.scoreProgress.scores,
              borderColor: "#2563eb",
              backgroundColor: "rgba(37,99,235,0.1)",
              fill: true,
              tension: 0.35
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { labels: { color: t.text } } },
          scales: { x: scale, y: { ...scale, min: 0, max: 100 } }
        }
      });
    }

    const rp = ch.roadmapProgress?.percent ?? 0;
    charts.roadmap = new Chart($("chart-roadmap"), {
      type: "doughnut",
      data: {
        labels: ["Done", "Remaining"],
        datasets: [
          {
            data: [rp, Math.max(0, 100 - rp)],
            backgroundColor: ["#16a34a", "rgba(148,163,184,0.25)"],
            borderWidth: 0
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "70%",
        plugins: {
          legend: { position: "bottom", labels: { color: t.text, boxWidth: 12 } }
        }
      }
    });
  }

  function renderActivity(items) {
    const el = $("sd-activity");
    if (!items?.length) {
      el.innerHTML = "<li style='color:var(--sd-muted)'>No activity yet. Take a mock test or quiz!</li>";
      return;
    }
    el.innerHTML = items
      .map(
        (a) => `
      <li>
        <span class="sd-act-icon">${a.icon}</span>
        <div class="sd-act-body">
          <strong>${escapeHtml(a.title)}</strong>
          <span>${escapeHtml(a.meta)}</span>
        </div>
        <span class="sd-act-time">${escapeHtml(a.relative)}</span>
      </li>`
      )
      .join("");
  }

  function renderGoals(goals) {
    $("sd-goals").innerHTML = (goals || [])
      .map(
        (g) => `
      <li class="sd-goal${g.completed ? " done" : ""}">
        <input type="checkbox" data-goal-id="${escapeHtml(g.id)}" ${g.completed ? "checked" : ""} ${g.system ? "disabled" : ""} />
        <div>
          <span>${escapeHtml(g.title)}</span>
          ${g.detail ? `<div class="sd-goal-due">${escapeHtml(g.detail)}</div>` : ""}
          ${g.dueDate ? `<div class="sd-goal-due">Due ${escapeHtml(g.dueDate)}</div>` : ""}
        </div>
      </li>`
      )
      .join("");

    $("sd-goals").querySelectorAll("input[type=checkbox]").forEach((cb) => {
      if (cb.disabled) return;
      cb.addEventListener("change", async () => {
        try {
          await window.ShardaAuth.apiFetch(`/api/dashboard/goals/${cb.dataset.goalId}`, {
            method: "PATCH",
            body: JSON.stringify({ completed: cb.checked })
          });
          load();
        } catch (err) {
          alert(err.message);
          cb.checked = !cb.checked;
        }
      });
    });
  }

  function renderRecs(recs) {
    $("sd-recs").innerHTML = (recs || []).length
      ? recs
          .slice(0, 4)
          .map(
            (r) => `
        <div class="sd-rec">
          <strong>${escapeHtml(r.title)}</strong>
          <p style="margin:4px 0;color:var(--sd-muted)">${escapeHtml(r.detail)}</p>
          ${r.action ? `<a href="${escapeHtml(r.action.replace(/^\//, ""))}">Go →</a>` : ""}
        </div>`
          )
          .join("")
      : "<p style='color:var(--sd-muted);font-size:0.88rem'>Complete a mock test for personalized tips.</p>";
  }

  function renderQuick(links) {
    $("sd-quick").innerHTML = (links || [])
      .map(
        (l) => `
      <a href="${escapeHtml(l.href)}">
        <span>${l.icon}</span>
        <span>${escapeHtml(l.label)}</span>
      </a>`
      )
      .join("");
  }

  function showToasts(notifications) {
    const container = $("sd-reward-toasts");
    if (!container) return;
    const unread = (notifications || []).filter((n) => !n.read).slice(0, 4);
    unread.forEach((n, i) => {
      setTimeout(() => {
        const el = document.createElement("div");
        el.className = "sd-toast";
        el.textContent = n.message;
        container.appendChild(el);
        setTimeout(() => el.remove(), 5000);
      }, i * 400);
    });
    if (unread.length) {
      window.ShardaAuth?.apiFetch("/api/gamification/notifications/read", {
        method: "POST"
      }).catch(() => {});
    }
  }

  function renderGamification(g) {
    if (!g) {
      $("sd-gamification").hidden = true;
      return;
    }
    $("sd-gamification").hidden = false;

    const lvl = g.level;
    $("sd-level-card").innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <span style="opacity:0.9;font-size:0.85rem">Level ${lvl.level}</span>
          <strong style="display:block;font-size:1.5rem">${lvl.icon} ${escapeHtml(lvl.title)}</strong>
        </div>
        <div style="text-align:right">
          <strong>${g.xp}</strong> XP
          <div style="font-size:0.8rem;opacity:0.85">${g.xpThisWeek} this week</div>
        </div>
      </div>
      <div class="sd-xp-bar"><div class="sd-xp-fill" style="width:${lvl.progressPercent}%"></div></div>
      <p style="margin:8px 0 0;font-size:0.8rem;opacity:0.9">${lvl.xpToNext > 0 ? `${lvl.xpToNext} XP to ${lvl.nextTitle}` : "Max level reached!"}</p>`;

    $("sd-rank-card").innerHTML = `
      <div style="font-size:0.8rem;color:var(--sd-muted)">Your rank</div>
      <strong>#${g.rank || "—"}</strong>
      <div style="font-size:0.8rem;color:var(--sd-muted);margin-top:4px">Leaderboard</div>`;

    const challenges = [...(g.dailyChallenges || []), ...(g.weeklyChallenges || [])];
    $("sd-challenges").innerHTML = challenges.length
      ? challenges
          .map(
            (c) => `
        <div class="sd-challenge${c.completed ? " done" : ""}">
          <div class="sd-challenge-head">
            <strong>${escapeHtml(c.title)}</strong>
            <span class="sd-badge-period">${c.period === "weekly" ? "Weekly" : "Daily"} · ${c.xp || 100} XP</span>
          </div>
          <p style="margin:0 0 8px;font-size:0.82rem;color:var(--sd-muted)">${escapeHtml(c.description)}</p>
          <div class="sd-challenge-bar"><span style="width:${c.progressPercent}%"></span></div>
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span style="font-size:0.78rem">${c.current}/${c.target}</span>
            <button type="button" class="sd-claim-btn" data-claim="${escapeHtml(c.id)}" data-period="${c.period}" ${!c.completed || c.claimed ? "disabled" : ""}>${c.claimed ? "Claimed" : c.completed ? "Claim reward" : "In progress"}</button>
          </div>
        </div>`
          )
          .join("")
      : "<p style='color:var(--sd-muted)'>No challenges today.</p>";

    $("sd-challenges").querySelectorAll("[data-claim]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          const res = await window.ShardaAuth.apiFetch("/api/gamification/challenges/claim", {
            method: "POST",
            body: JSON.stringify({
              challengeId: btn.dataset.claim,
              period: btn.dataset.period
            })
          });
          alert(`+${res.xpGained || 0} XP claimed!`);
          load();
        } catch (err) {
          alert(err.message);
        }
      });
    });

    $("sd-badges").innerHTML = (g.allBadges || [])
      .map(
        (b) => `
      <div class="sd-badge${b.earned ? " earned" : ""}" title="${escapeHtml(b.description)}">
        <span>${b.icon}</span>
        ${escapeHtml(b.name)}
      </div>`
      )
      .join("");

    let lbPeriod = "alltime";
    function renderLb(board) {
      $("sd-leaderboard").innerHTML = (board || [])
        .map(
          (e) => `
        <div class="sd-lb-row${e.isYou ? " you" : ""}${e.rank <= 3 ? ` top-${e.rank}` : ""}">
          <span class="sd-lb-rank">#${e.rank}</span>
          <span>${escapeHtml(e.displayName)} ${e.levelIcon}</span>
          <span>Lv ${e.level}</span>
          <span><strong>${e.xp}</strong> XP</span>
        </div>`
        )
        .join("");
    }
    renderLb(g.leaderboard);
    document.querySelectorAll(".sd-lb-tabs button").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".sd-lb-tabs button").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        lbPeriod = btn.dataset.lb;
        renderLb(lbPeriod === "weekly" ? g.weeklyLeaderboard : g.leaderboard);
      });
    });

    $("sd-achievements").innerHTML = (g.achievements || [])
      .map(
        (a) => `
      <div class="sd-ach-item${a.unlocked ? " unlocked" : ""}">
        <span style="font-size:1.4rem">${a.icon}</span>
        <div>
          <strong>${escapeHtml(a.name)}</strong>
          <p style="margin:2px 0 0;color:var(--sd-muted)">${escapeHtml(a.description)} — ${Math.min(a.progress, a.target)}/${a.target}</p>
        </div>
      </div>`
      )
      .join("");

    $("sd-notifications").innerHTML = (g.notifications || []).length
      ? g.notifications
          .map(
            (n) => `
        <li class="${n.read ? "" : "unread"}">${escapeHtml(n.message)}<br/><small style="color:var(--sd-muted)">${new Date(n.at).toLocaleString()}</small></li>`
          )
          .join("")
      : "<li style='color:var(--sd-muted)'>Complete activities to earn rewards!</li>";

    showToasts(g.notifications);
  }

  function renderAll(d) {
    dashboardData = d;
    renderWelcome(d);
    renderKpis(d);
    if (d.gamification) {
      const g = d.gamification;
      const extraKpi = document.createElement("div");
      extraKpi.className = "sd-kpi";
      extraKpi.innerHTML = `<div class="sd-kpi-icon">${g.level?.icon || "⭐"}</div><strong>Lv ${g.level?.level || 1}</strong><span>${g.xp || 0} XP</span>`;
      $("sd-kpis").appendChild(extraKpi);
    }
    renderGamification(d.gamification);
    renderCharts(d.charts);
    renderActivity(d.recentActivity);
    renderGoals(d.upcomingGoals);
    renderRecs(d.recommendations);
    renderQuick(d.quickLinks);
  }

  async function load() {
    if (!window.ShardaAuth?.isLoggedIn()) {
      $("sd-guest").hidden = false;
      $("sd-loading").hidden = true;
      $("sd-app").hidden = true;
      return;
    }

    $("sd-guest").hidden = true;
    $("sd-loading").hidden = false;
    $("sd-app").hidden = true;

    try {
      const data = await window.ShardaAuth.apiFetch("/api/dashboard");
      $("sd-loading").hidden = true;
      $("sd-app").hidden = false;
      renderAll(data);
    } catch (err) {
      $("sd-loading").textContent = err.message;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    initTheme();
    $("sd-theme-btn").addEventListener("click", toggleTheme);

    $("sd-add-goal-btn").addEventListener("click", async () => {
      const title = $("sd-new-goal").value.trim();
      const dueDate = $("sd-new-goal-date").value || null;
      if (!title) return;
      try {
        await window.ShardaAuth.apiFetch("/api/dashboard/goals", {
          method: "POST",
          body: JSON.stringify({ title, dueDate })
        });
        $("sd-new-goal").value = "";
        $("sd-new-goal-date").value = "";
        load();
      } catch (err) {
        alert(err.message);
      }
    });

    setTimeout(load, 100);
  });
})();
