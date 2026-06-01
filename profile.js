const IT_EXAM_GOALS = new Set([
  "dsa", "python", "fullstack", "aptitude", "hr-interview",
  "tcs-nqt", "infosys", "wipro-nth", "accenture", "java-placements"
]);

const EXAM_LABELS = {
  "ssc-cgl": "SSC CGL", "ssc-chsl": "SSC CHSL", "ssc-mts": "SSC MTS", "ssc-gd": "SSC GD",
  cds: "CDS", afcat: "AFCAT", nda: "NDA", capf: "CAPF AC", "rrb-ntpc": "RRB NTPC",
  dsa: "DSA", python: "Python", fullstack: "Full Stack", aptitude: "Aptitude",
  "hr-interview": "HR Interview", "tcs-nqt": "TCS NQT"
};

let profileData = null;
let scoreChart = null;

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}

function fillProfileForm(user) {
  document.getElementById("profile-avatar-lg").src = user.avatar;
  document.getElementById("profile-display-name").textContent = user.name;
  document.getElementById("profile-display-email").textContent = user.email;
  document.getElementById("profile-display-role").textContent =
    user.role === "teacher" ? "Teacher" : user.role === "admin" ? "Admin" : "Student";

  document.getElementById("pf-name").value = user.name || "";
  document.getElementById("pf-email").value = user.email || "";
  document.getElementById("pf-role").value = user.role === "teacher" ? "teacher" : "student";
  document.getElementById("pf-exam").value = user.examGoal || "";
  document.getElementById("pf-city").value = user.city || "";
  document.getElementById("pf-phone").value = user.phone || "";
  document.getElementById("pf-bio").value = user.bio || "";

  const levelEl = document.getElementById("profile-level-badge");
  const level = profileData?.gamification?.level;
  if (level) {
    levelEl.hidden = false;
    levelEl.textContent = `${level.icon || "⭐"} Level ${level.level} · ${level.title}`;
  } else {
    levelEl.hidden = true;
  }
}

function renderStats(stats) {
  const row = document.getElementById("pf-stats-row");
  if (!stats) {
    row.innerHTML = "";
    return;
  }
  row.innerHTML = `
    <div class="pf-stat"><span class="pf-stat-val">${stats.testAttempts || 0}</span><span class="pf-stat-lbl">Tests</span></div>
    <div class="pf-stat"><span class="pf-stat-val">${stats.quizCount || 0}</span><span class="pf-stat-lbl">Quizzes</span></div>
    <div class="pf-stat"><span class="pf-stat-val">${stats.certificatesCount || 0}</span><span class="pf-stat-lbl">Certificates</span></div>
    <div class="pf-stat"><span class="pf-stat-val">${stats.savedCoursesCount || 0}</span><span class="pf-stat-lbl">Saved</span></div>
    <div class="pf-stat"><span class="pf-stat-val">${stats.xp || 0}</span><span class="pf-stat-lbl">XP</span></div>`;
}

function renderTestList(containerId, items, emptyMsg) {
  const el = document.getElementById(containerId);
  if (!items?.length) {
    el.innerHTML = `<p class="pf-empty">${emptyMsg}</p>`;
    return;
  }
  el.innerHTML = items
    .map(
      (t) => `
    <div class="pf-list-item">
      <div>
        <strong>${escapeHtml(t.title)}</strong>
        <span class="pf-list-meta">${formatDate(t.submittedAt || t.at)} · ${t.examName || t.subject || t.type || ""}</span>
      </div>
      <span class="pf-score-pill ${t.percentScore >= 70 || t.percent >= 70 ? "good" : ""}">${t.percentScore ?? t.percent}%</span>
    </div>`
    )
    .join("");
}

function renderOverview() {
  const tests = profileData?.testHistory?.mockTests?.slice(0, 4) || [];
  renderTestList("pf-overview-tests", tests, "No mock tests yet. <a href='mock-tests.html'>Take a mock test</a>.");

  const ach = (profileData?.achievements || []).filter((a) => a.unlocked).slice(0, 6);
  const achEl = document.getElementById("pf-overview-achievements");
  if (!ach.length) {
    achEl.innerHTML = `<p class="pf-empty">Complete quizzes and mocks to unlock achievements.</p>`;
  } else {
    achEl.innerHTML = ach
      .map(
        (a) => `
      <div class="pf-ach-card unlocked">
        <span class="pf-ach-icon">${a.icon || "🏅"}</span>
        <strong>${escapeHtml(a.name)}</strong>
      </div>`
      )
      .join("");
  }
}

function renderTests() {
  const s = profileData?.testHistory?.summary;
  document.getElementById("pf-test-summary").textContent = s
    ? `${s.totalAttempts} attempts · Avg ${s.avgScore}% · Best ${s.bestScore}%`
    : "No test data yet.";

  renderTestList(
    "pf-mock-tests",
    profileData?.testHistory?.mockTests,
    "No mock tests yet. <a href='mock-tests.html'>Start a test</a>."
  );
  renderTestList(
    "pf-quiz-tests",
    profileData?.testHistory?.quizzes,
    "No quizzes yet. <a href='learn-game.html'>Play a quiz</a>."
  );
}

function renderCertificates() {
  const el = document.getElementById("pf-certificates");
  const certs = profileData?.certificates || [];
  if (!certs.length) {
    el.innerHTML = `<p class="pf-empty">Score 70%+ on a mock test or earn badges to unlock certificates.</p>`;
    return;
  }
  el.innerHTML = certs
    .map(
      (c) => `
    <article class="pf-cert-card" data-cert-id="${escapeHtml(c.id)}">
      <div class="pf-cert-icon">${c.icon || "📜"}</div>
      <h3>${escapeHtml(c.title)}</h3>
      <p>${escapeHtml(c.subtitle)}</p>
      <footer>${formatDate(c.issuedAt)}${c.score != null ? ` · ${c.score}%` : ""}</footer>
      <button type="button" class="btn btn-ghost pf-cert-print">Print</button>
    </article>`
    )
    .join("");

  el.querySelectorAll(".pf-cert-print").forEach((btn) => {
    btn.addEventListener("click", () => {
      const card = btn.closest(".pf-cert-card");
      const w = window.open("", "_blank");
      w.document.write(`<html><head><title>Certificate</title></head><body style="font-family:Inter,sans-serif;padding:40px;text-align:center">${card.innerHTML}</body></html>`);
      w.document.close();
      w.print();
    });
  });
}

function renderSavedCourses() {
  const el = document.getElementById("pf-saved-courses");
  const courses = profileData?.savedCourses || [];
  if (!courses.length) {
    el.innerHTML = `<p class="pf-empty">Save tracks from Online Education using the form above.</p>`;
    return;
  }
  el.innerHTML = courses
    .map(
      (c) => `
    <div class="pf-course-card">
      <h3>${escapeHtml(c.title)}</h3>
      <p>${escapeHtml(c.examId || c.type || "Course")} · ${formatDate(c.savedAt)}</p>
      ${c.url ? `<a href="${escapeHtml(c.url)}" target="_blank" rel="noopener">Open course →</a>` : ""}
      <button type="button" class="pf-remove-course" data-id="${escapeHtml(c.courseId)}">Remove</button>
    </div>`
    )
    .join("");

  el.querySelectorAll(".pf-remove-course").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await window.ShardaAuth.apiFetch(`/api/profile/saved-courses/${btn.dataset.id}`, {
          method: "DELETE"
        });
        await loadStudentProfile();
        switchTab("courses");
      } catch (ex) {
        alert(ex.message);
      }
    });
  });
}

function renderAchievements() {
  const el = document.getElementById("pf-achievements");
  const list = profileData?.achievements || [];
  if (!list.length) {
    el.innerHTML = `<p class="pf-empty">No achievements yet.</p>`;
    return;
  }
  el.innerHTML = list
    .map((a) => {
      const pct = a.target ? Math.min(100, Math.round(((a.progress || 0) / a.target) * 100)) : 100;
      return `
    <div class="pf-ach-card ${a.unlocked ? "unlocked" : "locked"}">
      <span class="pf-ach-icon">${a.icon || "🏅"}</span>
      <strong>${escapeHtml(a.name)}</strong>
      <p>${escapeHtml(a.description || "")}</p>
      ${a.target ? `<div class="pf-progress-bar"><span style="width:${a.unlocked ? 100 : pct}%"></span></div><small>${a.progress || 0} / ${a.target}</small>` : ""}
    </div>`;
    })
    .join("");
}

function renderProgressReport() {
  const report = profileData?.progressReport;
  if (!report) {
    document.getElementById("pf-report-stats").innerHTML =
      "<p class='pf-empty'>Complete mock tests to generate your progress report.</p>";
    return;
  }

  document.getElementById("pf-report-date").textContent = `Generated ${formatDate(report.generatedAt)}`;

  const r = report.readiness;
  document.getElementById("pf-report-stats").innerHTML = `
    <div class="pf-stat"><span class="pf-stat-val">${report.streak?.current || 0}</span><span class="pf-stat-lbl">Day streak</span></div>
    <div class="pf-stat"><span class="pf-stat-val">${report.hoursStudied?.totalHours ?? 0}</span><span class="pf-stat-lbl">Hours studied</span></div>
    <div class="pf-stat"><span class="pf-stat-val">${report.coursesCompleted?.count ?? 0}</span><span class="pf-stat-lbl">Modules done</span></div>
    <div class="pf-stat"><span class="pf-stat-val">${r?.score ?? "—"}</span><span class="pf-stat-lbl">Readiness</span></div>`;

  const weak = document.getElementById("pf-weak-topics");
  const strong = document.getElementById("pf-strong-topics");
  const rec = document.getElementById("pf-recommendations");

  weak.innerHTML = (r?.weakTopics || [])
    .map((t) => `<li>${escapeHtml(t.topicName || t.topic || t.name || t)} — ${t.accuracy != null ? t.accuracy + "%" : t.score != null ? t.score + "%" : ""}</li>`)
    .join("") || "<li>No weak topics identified yet.</li>";

  strong.innerHTML = (r?.strongTopics || [])
    .map((t) => `<li>${escapeHtml(t.topicName || t.topic || t.name || t)}</li>`)
    .join("") || "<li>Keep practicing to identify strengths.</li>";

  rec.innerHTML = (r?.recommendations || [])
    .map((t) => `<li>${escapeHtml(typeof t === "string" ? t : t.text || t.title || "")}</li>`)
    .join("") || "<li>Take a mock test for personalized tips.</li>";

  if (scoreChart) scoreChart.destroy();
  const chartEl = document.getElementById("pf-score-chart");
  const ch = report.scoreChart;
  if (chartEl && ch?.labels?.length && typeof Chart !== "undefined") {
    scoreChart = new Chart(chartEl, {
      type: "line",
      data: {
        labels: ch.labels,
        datasets: [
          {
            label: "Mock score %",
            data: ch.scores,
            borderColor: "#0b63d6",
            backgroundColor: "rgba(11,99,214,0.1)",
            fill: true,
            tension: 0.3
          }
        ]
      },
      options: {
        responsive: true,
        scales: { y: { min: 0, max: 100 } },
        plugins: { legend: { display: false } }
      }
    });
  }
}

function switchTab(tabId) {
  document.querySelectorAll(".pf-tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.tab === tabId);
  });
  document.querySelectorAll(".pf-panel").forEach((p) => {
    const on = p.dataset.panel === tabId;
    p.hidden = !on;
    p.classList.toggle("active", on);
  });
  if (tabId === "report") renderProgressReport();
}

async function loadStudentProfile() {
  profileData = await window.ShardaAuth.apiFetch("/api/student-profile");
  fillProfileForm(profileData.user);
  renderStats(profileData.stats);
  renderOverview();
  renderTests();
  renderCertificates();
  renderSavedCourses();
  renderAchievements();
}

async function uploadAvatar(file) {
  const token = window.ShardaAuth.getToken();
  const fd = new FormData();
  fd.append("avatar", file);
  const res = await fetch("/api/profile/avatar", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: fd
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Upload failed");
  return data.user;
}

async function initProfile() {
  const guest = document.getElementById("profile-guest");
  const app = document.getElementById("profile-app");

  if (!window.ShardaAuth?.isLoggedIn()) {
    guest.hidden = false;
    app.hidden = true;
    return;
  }

  guest.hidden = true;
  app.hidden = false;

  try {
    await window.ShardaAuth.fetchProfile();
    await loadStudentProfile();
  } catch (err) {
    console.error(err);
  }

  document.querySelectorAll(".pf-tab").forEach((tab) => {
    tab.addEventListener("click", () => switchTab(tab.dataset.tab));
  });

  const params = new URLSearchParams(location.search);
  if (params.get("tab")) switchTab(params.get("tab"));

  document.getElementById("profile-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = document.getElementById("profile-msg");
    msg.textContent = "Saving…";
    msg.className = "profile-msg";
    try {
      const updated = await window.ShardaAuth.updateProfile({
        name: document.getElementById("pf-name").value,
        role: document.getElementById("pf-role").value,
        examGoal: document.getElementById("pf-exam").value,
        city: document.getElementById("pf-city").value,
        phone: document.getElementById("pf-phone").value,
        bio: document.getElementById("pf-bio").value
      });
      fillProfileForm(updated);
      window.ShardaAuth.renderHeaderAuth(document.getElementById("auth-slot"));
      msg.textContent = "Profile saved successfully!";
      msg.className = "profile-msg ok";
    } catch (err) {
      msg.textContent = err.message || "Could not save profile.";
      msg.className = "profile-msg err";
    }
  });

  document.getElementById("pf-avatar-file").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const user = await uploadAvatar(file);
      fillProfileForm(user);
      window.ShardaAuth.renderHeaderAuth(document.getElementById("auth-slot"));
    } catch (err) {
      alert(err.message);
    }
    e.target.value = "";
  });

  document.getElementById("pf-save-course-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await window.ShardaAuth.apiFetch("/api/profile/saved-courses", {
        method: "POST",
        body: JSON.stringify({
          courseId: document.getElementById("pf-course-id").value.trim(),
          title: document.getElementById("pf-course-title").value.trim(),
          url: document.getElementById("pf-course-url").value.trim(),
          examId: document.getElementById("pf-course-id").value.trim()
        })
      });
      e.target.reset();
      await loadStudentProfile();
      switchTab("courses");
    } catch (err) {
      alert(err.message);
    }
  });

  document.getElementById("pf-print-report").addEventListener("click", () => window.print());

  if (params.get("saveCourse")) {
    try {
      const c = JSON.parse(params.get("saveCourse"));
      await window.ShardaAuth.apiFetch("/api/profile/saved-courses", {
        method: "POST",
        body: JSON.stringify(c)
      });
      await loadStudentProfile();
      switchTab("courses");
    } catch (_) {}
  }
}

document.addEventListener("DOMContentLoaded", initProfile);
