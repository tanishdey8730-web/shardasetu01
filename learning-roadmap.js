(function () {
  const THEME_KEY = "sharda_setu_lr_theme";
  let roadmap = null;

  const $ = (id) => document.getElementById(id);

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  function initTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    const dark =
      saved === "dark" || (!saved && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    $("lr-theme-btn").textContent = dark ? "☀️" : "🌙";
  }

  function toggleTheme() {
    const dark = document.documentElement.getAttribute("data-theme") === "dark";
    const next = dark ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem(THEME_KEY, next);
    $("lr-theme-btn").textContent = next === "dark" ? "☀️" : "🌙";
  }

  function setMinDate() {
    const input = $("lr-date");
    const min = new Date();
    min.setDate(min.getDate() + 14);
    input.min = min.toISOString().slice(0, 10);
  }

  async function loadExams() {
    try {
      const data = await fetch("/api/roadmap/exams").then((r) => r.json());
      const sel = $("lr-exam");
      (data.exams || []).forEach((e) => {
        const opt = document.createElement("option");
        opt.value = e.id;
        opt.textContent = `${e.icon || ""} ${e.name}`.trim();
        sel.appendChild(opt);
      });
    } catch (_) {
      ["ssc", "ssc-cgl", "nda", "cds", "afcat", "rrb-ntpc"].forEach((id) => {
        const opt = document.createElement("option");
        opt.value = id;
        opt.textContent = id.toUpperCase();
        $("lr-exam").appendChild(opt);
      });
    }
  }

  function showGuest() {
    $("lr-guest").hidden = false;
    $("lr-setup").hidden = true;
    $("lr-dashboard").classList.remove("visible");
  }

  function showSetup() {
    $("lr-guest").hidden = true;
    $("lr-setup").hidden = false;
    $("lr-dashboard").classList.remove("visible");
  }

  function showDashboard() {
    $("lr-guest").hidden = true;
    $("lr-setup").hidden = true;
    $("lr-dashboard").classList.add("visible");
  }

  async function fetchRoadmap(userId) {
    return window.ShardaAuth.apiFetch(`/api/roadmap/${encodeURIComponent(userId)}`);
  }

  async function createRoadmap(payload) {
    return window.ShardaAuth.apiFetch("/api/roadmap", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async function patchTopic(topicId, date, completed) {
    const user = window.ShardaAuth.getUser();
    return window.ShardaAuth.apiFetch(`/api/roadmap/${encodeURIComponent(user.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ topicId, date, completed })
    });
  }

  function renderStats(r) {
    const s = r.stats || {};
    $("lr-stats").innerHTML = `
      <div class="lr-stat-card"><strong>${s.progressPercent ?? 0}%</strong><span>Progress</span></div>
      <div class="lr-stat-card"><strong>${s.completedTasks ?? 0}/${s.totalTasks ?? 0}</strong><span>Topics done</span></div>
      <div class="lr-stat-card"><strong>${s.daysRemaining ?? "—"}</strong><span>Days to exam</span></div>
      <div class="lr-stat-card"><strong>${r.hoursPerDay}h</strong><span>Per day</span></div>`;
  }

  function renderProgress(r) {
    const pct = r.stats?.progressPercent ?? 0;
    $("lr-progress-fill").style.width = `${pct}%`;
    $("lr-progress-label").textContent = `${pct}% complete · ${r.stats?.completedTasks || 0} of ${r.stats?.totalTasks || 0} tasks`;
    $("lr-exam-title").textContent = `${r.examIcon || ""} ${r.examName}`.trim();
    $("lr-exam-meta").textContent = `Exam: ${r.examDate} · Started ${r.startDate}`;
  }

  function renderWeeks(r) {
    const el = $("lr-weeks");
    el.innerHTML = (r.weeks || [])
      .map((w) => {
        const done = w.completedDays ?? 0;
        const pct = w.totalDays ? Math.round((done / w.totalDays) * 100) : 0;
        return `
        <article class="lr-week-card">
          <div class="lr-week-head">
            <h3>Week ${w.weekNumber}</h3>
            <span class="lr-week-meta">${w.startDate} → ${w.endDate} · ${pct}% days done</span>
          </div>
          <p style="margin:0;font-size:0.9rem">${escapeHtml(w.summary)}</p>
          <ul class="lr-week-targets">
            ${(w.targets || []).map((t) => `<li>${escapeHtml(t)}</li>`).join("")}
          </ul>
        </article>`;
      })
      .join("");
  }

  function renderDays(r) {
    const today = todayStr();
    const el = $("lr-days");
    el.innerHTML = (r.dailyPlan || [])
      .map((day) => {
        const isToday = day.date === today;
        const isPast = day.date < today;
        const open = isToday ? " open" : "";
        const rev = day.isRevision
          ? '<span class="lr-revision-badge">Revision</span>'
          : "";
        const tasks = (day.tasks || [])
          .map(
            (t) => `
          <label class="lr-task${t.completed ? " done" : ""}">
            <input type="checkbox" data-topic="${escapeHtml(t.topicId)}" data-date="${escapeHtml(day.date)}" ${t.completed ? "checked" : ""} />
            <div>
              <div class="lr-task-title">${escapeHtml(t.title)}</div>
              <div class="lr-task-meta">${escapeHtml(t.subjectName)} · ${t.hours}h${t.rescheduledFrom ? ` · catch-up from ${t.rescheduledFrom}` : ""}</div>
            </div>
          </label>`
          )
          .join("");
        return `
        <article class="lr-day-card${isPast ? " past" : ""}${isToday ? " today" : ""}${open}" data-day-id="${escapeHtml(day.id)}">
          <div class="lr-day-head" role="button" tabindex="0">
            <h4>${escapeHtml(day.label)} — ${day.date} ${rev}</h4>
            <span class="lr-week-meta">${day.plannedHours}h · ${day.tasks.filter((x) => x.completed).length}/${day.tasks.length} done</span>
          </div>
          <div class="lr-day-body">${tasks || "<p class='lr-task-meta'>Rest day</p>"}</div>
        </article>`;
      })
      .join("");

    el.querySelectorAll(".lr-day-head").forEach((head) => {
      head.addEventListener("click", () => head.parentElement.classList.toggle("open"));
    });

    el.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.addEventListener("change", async () => {
        const topicId = cb.dataset.topic;
        const date = cb.dataset.date;
        cb.disabled = true;
        try {
          const data = await patchTopic(topicId, date, cb.checked);
          roadmap = data.roadmap;
          renderAll(roadmap);
        } catch (err) {
          cb.checked = !cb.checked;
          alert(err.message);
        } finally {
          cb.disabled = false;
        }
      });
    });
  }

  function renderAiTips(r) {
    const box = $("lr-ai-tips");
    if (!r.aiTips) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    box.innerHTML = `<strong>AI coach tips</strong><br/>${escapeHtml(r.aiTips).replace(/\n/g, "<br/>")}`;
  }

  function renderAdjustBanner(meta) {
    const box = $("lr-adjust-banner");
    if (!meta?.scheduleAdjusted) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    box.textContent = `Schedule updated: ${meta.movedTasks || 0} missed task(s) moved to upcoming days. Keep going!`;
  }

  function renderAll(r, meta) {
    roadmap = r;
    renderStats(r);
    renderProgress(r);
    renderWeeks(r);
    renderDays(r);
    renderAiTips(r);
    if (meta) renderAdjustBanner(meta);
    showDashboard();
  }

  async function loadUserRoadmap() {
    const user = window.ShardaAuth.getUser();
    if (!user) {
      showGuest();
      return;
    }
    try {
      const data = await fetchRoadmap(user.id);
      if (data.roadmap) {
        renderAll(data.roadmap, data);
      } else {
        showSetup();
      }
    } catch (err) {
      if (err.message.includes("No roadmap")) showSetup();
      else {
        $("lr-form-error").textContent = err.message;
        $("lr-form-error").hidden = false;
        showSetup();
      }
    }
  }

  async function onGenerate(e, regenerate) {
    e?.preventDefault();
    const errEl = $("lr-form-error");
    errEl.hidden = true;
    const btn = $("lr-generate-btn");
    btn.disabled = true;

    try {
      const payload = {
        examId: $("lr-exam").value,
        examDate: $("lr-date").value,
        hoursPerDay: Number($("lr-hours").value) || 5,
        regenerate: Boolean(regenerate)
      };
      const data = await createRoadmap(payload);
      renderAll(data.roadmap);
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
    } finally {
      btn.disabled = false;
    }
  }

  function bindTabs() {
    document.querySelectorAll(".lr-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        document.querySelectorAll(".lr-tab").forEach((t) => t.classList.remove("active"));
        document.querySelectorAll(".lr-panel").forEach((p) => p.classList.remove("active"));
        tab.classList.add("active");
        $("lr-panel-" + tab.dataset.panel).classList.add("active");
      });
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    initTheme();
    setMinDate();
    loadExams();
    bindTabs();

    $("lr-theme-btn").addEventListener("click", toggleTheme);
    $("lr-form").addEventListener("submit", (e) => onGenerate(e, false));
    $("lr-regenerate-btn").addEventListener("click", async () => {
      if (!roadmap || !confirm("Regenerate your entire plan? All task progress will reset.")) return;
      $("lr-generate-btn").disabled = true;
      try {
        const data = await createRoadmap({
          examId: roadmap.examId,
          examDate: roadmap.examDate,
          hoursPerDay: roadmap.hoursPerDay,
          regenerate: true
        });
        renderAll(data.roadmap);
      } catch (err) {
        alert(err.message);
      } finally {
        $("lr-generate-btn").disabled = false;
      }
    });
    $("lr-edit-setup-btn").addEventListener("click", () => {
      showSetup();
      if (roadmap) {
        $("lr-exam").value = roadmap.examId;
        $("lr-date").value = roadmap.examDate;
        $("lr-hours").value = roadmap.hoursPerDay;
      }
    });

    const tryLoad = () => {
      if (window.ShardaAuth?.isLoggedIn()) loadUserRoadmap();
      else showGuest();
    };
    if (window.ShardaAuth) tryLoad();
    else setTimeout(tryLoad, 100);
  });
})();
