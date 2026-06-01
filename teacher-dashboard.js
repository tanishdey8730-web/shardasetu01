(function () {
  let currentSection = "dashboard";
  let quizQCount = 0;

  const titles = {
    dashboard: "Dashboard",
    lessons: "Upload Lessons",
    notes: "Upload Notes",
    quizzes: "Create Quizzes",
    assignments: "Assignments",
    performance: "Student Performance",
    discussions: "Discussion Moderation",
    analytics: "Course Analytics"
  };

  const $ = (id) => document.getElementById(id);

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  }

  function badge(status) {
    return `<span class="td-badge ${esc(status)}">${esc(status)}</span>`;
  }

  async function api(path, options = {}) {
    return window.ShardaAuth.apiFetch(path, options);
  }

  async function apiForm(path, formData) {
    const token = window.ShardaAuth.getToken();
    const res = await fetch(path, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  function switchSection(name) {
    currentSection = name;
    document.querySelectorAll(".td-nav button").forEach((b) => {
      b.classList.toggle("active", b.dataset.section === name);
    });
    document.querySelectorAll(".td-section").forEach((s) => {
      const on = s.dataset.section === name;
      s.hidden = !on;
      s.classList.toggle("active", on);
    });
    $("td-page-title").textContent = titles[name] || "Teacher";
    $("td-sidebar").classList.remove("open");
    $("td-overlay").classList.remove("show");
    loadSection(name);
  }

  async function loadSection(name) {
    try {
      if (name === "dashboard") await loadDashboard();
      else if (name === "lessons") await loadLessons();
      else if (name === "notes") await loadNotes();
      else if (name === "quizzes") await loadQuizzes();
      else if (name === "assignments") await loadAssignments();
      else if (name === "performance") await loadPerformance();
      else if (name === "discussions") await loadDiscussions();
      else if (name === "analytics") await loadAnalytics();
    } catch (err) {
      console.error(err);
    }
  }

  async function loadDashboard() {
    const d = await api("/api/teacher/dashboard");
    const s = d.stats;
    $("td-dash-stats").innerHTML = `
      <div class="td-stat"><strong>${s.lessons}</strong><span>Lessons</span></div>
      <div class="td-stat"><strong>${s.notes}</strong><span>Notes</span></div>
      <div class="td-stat"><strong>${s.quizzes}</strong><span>Quizzes</span></div>
      <div class="td-stat"><strong>${s.assignments}</strong><span>Assignments</span></div>
      <div class="td-stat"><strong>${s.submissions}</strong><span>Submissions</span></div>
      <div class="td-stat"><strong>${s.pendingModeration}</strong><span>Flagged</span></div>`;
  }

  async function loadLessons() {
    const data = await api("/api/teacher/lessons");
    const tbody = $("lessons-table").querySelector("tbody");
    tbody.innerHTML =
      data.lessons
        ?.map(
          (l) => `<tr>
        <td>${esc(l.title)}</td>
        <td>${esc(l.examId)}</td>
        <td>${badge(l.status)}</td>
        <td>${fmtDate(l.createdAt)}</td>
        <td><button type="button" class="td-btn td-btn-danger td-del-lesson" data-id="${esc(l.id)}">Delete</button></td>
      </tr>`
        )
        .join("") || '<tr><td colspan="5" class="td-empty">No lessons yet</td></tr>';

    tbody.querySelectorAll(".td-del-lesson").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Delete this lesson?")) return;
        await api(`/api/teacher/lessons/${btn.dataset.id}`, { method: "DELETE" });
        loadLessons();
      });
    });
  }

  async function loadNotes() {
    const data = await api("/api/teacher/notes");
    const tbody = $("notes-table").querySelector("tbody");
    tbody.innerHTML =
      data.notes
        ?.map(
          (n) => `<tr>
        <td>${esc(n.title)}</td>
        <td>${esc(n.examId)}</td>
        <td>${badge(n.status)}</td>
        <td>${n.fileName ? esc(n.fileName) : "—"}</td>
        <td><button type="button" class="td-btn td-btn-danger td-del-note" data-id="${esc(n.id)}">Delete</button></td>
      </tr>`
        )
        .join("") || '<tr><td colspan="5" class="td-empty">No notes yet</td></tr>';

    tbody.querySelectorAll(".td-del-note").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Delete?")) return;
        await api(`/api/teacher/notes/${btn.dataset.id}`, { method: "DELETE" });
        loadNotes();
      });
    });
  }

  function addQuizQuestionBlock() {
    const i = quizQCount++;
    const div = document.createElement("div");
    div.className = "td-quiz-q";
    div.dataset.idx = i;
    div.innerHTML = `
      <strong>Question ${i + 1}</strong>
      <input class="qq-text" placeholder="Question text" style="width:100%;margin:8px 0" />
      <input class="qq-opt" placeholder="Option A" style="width:48%;margin:2px" />
      <input class="qq-opt" placeholder="Option B" style="width:48%;margin:2px" />
      <input class="qq-opt" placeholder="Option C" style="width:48%;margin:2px" />
      <input class="qq-opt" placeholder="Option D" style="width:48%;margin:2px" />
      <label>Correct (0-3): <input class="qq-correct" type="number" min="0" max="3" value="0" style="width:50px" /></label>`;
    $("quiz-questions").appendChild(div);
  }

  function collectQuizQuestions() {
    return [...$("quiz-questions").querySelectorAll(".td-quiz-q")].map((block) => ({
      question: block.querySelector(".qq-text").value,
      options: [...block.querySelectorAll(".qq-opt")].map((i) => i.value),
      correct: Number(block.querySelector(".qq-correct").value) || 0
    }));
  }

  async function loadQuizzes() {
    const data = await api("/api/teacher/quizzes");
    const tbody = $("quizzes-table").querySelector("tbody");
    tbody.innerHTML =
      data.quizzes
        ?.map(
          (q) => `<tr>
        <td>${esc(q.title)}</td>
        <td>${q.questions?.length || 0} Qs</td>
        <td>${q.publishedToBank ? "Yes" : "No"}</td>
        <td>
          ${
            !q.publishedToBank
              ? `<button type="button" class="td-btn td-btn-primary td-pub-quiz" data-id="${esc(q.id)}">Publish to bank</button>`
              : "Published"
          }
        </td>
      </tr>`
        )
        .join("") || '<tr><td colspan="4" class="td-empty">No quizzes</td></tr>';

    tbody.querySelectorAll(".td-pub-quiz").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const r = await api(`/api/teacher/quizzes/${btn.dataset.id}/publish`, { method: "POST" });
        alert(`Published ${r.addedCount} questions to question bank`);
        loadQuizzes();
      });
    });
  }

  async function loadAssignments() {
    const data = await api("/api/teacher/assignments");
    const tbody = $("assignments-table").querySelector("tbody");
    tbody.innerHTML =
      data.assignments
        ?.map(
          (a) => `<tr>
        <td>${esc(a.title)}</td>
        <td>${fmtDate(a.dueDate)}</td>
        <td>${a.submissionCount || 0}</td>
        <td><button type="button" class="td-btn td-btn-ghost td-view-subs" data-id="${esc(a.id)}" data-title="${esc(a.title)}">View submissions</button></td>
      </tr>`
        )
        .join("") || '<tr><td colspan="4" class="td-empty">No assignments</td></tr>';

    tbody.querySelectorAll(".td-view-subs").forEach((btn) => {
      btn.addEventListener("click", () => loadSubmissions(btn.dataset.id, btn.dataset.title));
    });
  }

  async function loadSubmissions(assignmentId, title) {
    const data = await api(`/api/teacher/assignments/${assignmentId}/submissions`);
    $("submissions-panel").hidden = false;
    $("submissions-title").textContent = `Submissions: ${title}`;
    const tbody = $("submissions-table").querySelector("tbody");
    tbody.innerHTML =
      data.submissions
        ?.map(
          (s) => `<tr>
        <td>${esc(s.studentName)}</td>
        <td>${esc((s.content || "").slice(0, 60))}</td>
        <td>${s.score != null ? s.score : "—"}</td>
        <td>${badge(s.status)}</td>
        <td>
          <button type="button" class="td-btn td-btn-primary td-grade" data-id="${esc(s.id)}">Grade</button>
        </td>
      </tr>`
        )
        .join("") || '<tr><td colspan="5" class="td-empty">No submissions</td></tr>';

    tbody.querySelectorAll(".td-grade").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const score = prompt("Score:");
        if (score === null) return;
        const feedback = prompt("Feedback (optional):") || "";
        await api(`/api/teacher/submissions/${btn.dataset.id}`, {
          method: "PATCH",
          body: JSON.stringify({ score: Number(score), feedback })
        });
        loadSubmissions(assignmentId, title);
      });
    });
  }

  async function loadPerformance() {
    const data = await api("/api/teacher/performance");
    const tbody = $("performance-table").querySelector("tbody");
    tbody.innerHTML =
      data.students
        ?.filter((s) => s.mockAttempts || s.quizAttempts || s.assignmentsSubmitted)
        .map(
          (s) => `<tr>
        <td>${esc(s.name)}<br/><small>${esc(s.email)}</small></td>
        <td>${s.mockAttempts}</td>
        <td>${s.avgMockScore || "—"}</td>
        <td>${s.quizAttempts}</td>
        <td>${s.assignmentsSubmitted}</td>
        <td>${s.avgAssignmentScore ?? "—"}</td>
      </tr>`
        )
        .join("") || '<tr><td colspan="6" class="td-empty">No student activity yet</td></tr>';
  }

  async function loadDiscussions() {
    const flagged = $("disc-flagged").checked ? "1" : "";
    const q = $("disc-q").value;
    const data = await api(`/api/teacher/discussions?q=${encodeURIComponent(q)}&flagged=${flagged}`);
    const el = $("discussions-list");
    el.innerHTML =
      data.discussions
        ?.map(
          (d) => `<div class="td-card" style="margin-bottom:12px;padding:14px">
        <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap">
          <strong>${esc(d.title)}</strong>
          ${d.pinned ? "📌" : ""} ${d.flagged ? "🚩" : ""} ${d.hidden ? "(hidden)" : ""}
        </div>
        <p style="font-size:0.88rem;color:var(--td-muted)">${esc(d.body?.slice(0, 200))}</p>
        <small>${esc(d.authorName)} · ${fmtDate(d.createdAt)} · ${(d.replies || []).length} replies</small>
        <div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:6px">
          <button type="button" class="td-btn td-btn-ghost td-mod" data-id="${esc(d.id)}" data-action="pin">${d.pinned ? "Unpin" : "Pin"}</button>
          <button type="button" class="td-btn td-btn-ghost td-mod" data-id="${esc(d.id)}" data-action="hide">${d.hidden ? "Show" : "Hide"}</button>
          <button type="button" class="td-btn td-btn-ghost td-mod" data-id="${esc(d.id)}" data-action="flag">${d.flagged ? "Unflag" : "Flag"}</button>
          <button type="button" class="td-btn td-btn-danger td-mod" data-id="${esc(d.id)}" data-action="delete">Delete</button>
        </div>
      </div>`
        )
        .join("") || '<p class="td-empty">No discussions</p>';

    el.querySelectorAll(".td-mod").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id;
        const action = btn.dataset.action;
        const body = {};
        if (action === "pin") body.pinned = !btn.textContent.startsWith("Un");
        if (action === "hide") body.hidden = btn.textContent === "Hide";
        if (action === "flag") body.flagged = btn.textContent === "Flag";
        if (action === "delete") {
          if (!confirm("Delete thread?")) return;
          body.delete = true;
        }
        await api(`/api/teacher/discussions/${id}`, { method: "PATCH", body: JSON.stringify(body) });
        loadDiscussions();
      });
    });
  }

  async function loadAnalytics() {
    const data = await api("/api/teacher/analytics");
    const t = data.totals;
    $("td-analytics-stats").innerHTML = `
      <div class="td-stat"><strong>${t.lessonViews}</strong><span>Lesson views</span></div>
      <div class="td-stat"><strong>${t.noteDownloads}</strong><span>Downloads</span></div>
      <div class="td-stat"><strong>${t.assignmentCount}</strong><span>Assignments</span></div>
      <div class="td-stat"><strong>${t.submissionCount}</strong><span>Submissions</span></div>`;

    $("td-analytics-exams").innerHTML =
      (data.byExam || [])
        .map(
          (e) => `<div style="padding:10px 0;border-bottom:1px solid var(--td-border)">
        <strong>${esc(e.examId)}</strong> — ${e.lessons} lessons, ${e.notes} notes, ${e.assignments} assignments
      </div>`
        )
        .join("") || '<p class="td-empty">No data by exam yet</p>';
  }

  function init() {
    const user = window.ShardaAuth?.getUser();
    if (!window.ShardaAuth?.isLoggedIn()) {
      $("td-guest").hidden = false;
      return;
    }
    if (user?.role !== "teacher" && user?.role !== "admin") {
      $("td-guest").hidden = false;
      $("td-guest-msg").textContent = "Teacher or admin role required.";
      return;
    }

    $("td-app").hidden = false;

    document.querySelectorAll(".td-nav button").forEach((btn) => {
      btn.addEventListener("click", () => switchSection(btn.dataset.section));
    });

    document.querySelectorAll("[data-goto]").forEach((btn) => {
      btn.addEventListener("click", () => switchSection(btn.dataset.goto));
    });

    $("td-menu-btn").addEventListener("click", () => {
      $("td-sidebar").classList.toggle("open");
      $("td-overlay").classList.toggle("show");
    });
    $("td-overlay").addEventListener("click", () => {
      $("td-sidebar").classList.remove("open");
      $("td-overlay").classList.remove("show");
    });

    $("td-refresh").addEventListener("click", () => loadSection(currentSection));

    $("lesson-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      if (e.target.submitForApproval?.checked) fd.set("submitForApproval", "true");
      await apiForm("/api/teacher/lessons", fd);
      e.target.reset();
      alert("Lesson uploaded");
      loadLessons();
    });

    $("notes-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      if (e.target.submitForApproval?.checked) fd.set("submitForApproval", "true");
      await apiForm("/api/teacher/notes", fd);
      e.target.reset();
      alert("Notes uploaded");
      loadNotes();
    });

    $("quiz-add-q").addEventListener("click", addQuizQuestionBlock);
    addQuizQuestionBlock();
    addQuizQuestionBlock();

    $("quiz-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      await api("/api/teacher/quizzes", {
        method: "POST",
        body: JSON.stringify({
          title: $("quiz-title").value,
          examId: $("quiz-exam").value,
          chapterId: $("quiz-chapter").value,
          durationMinutes: $("quiz-duration").value,
          questions: collectQuizQuestions()
        })
      });
      alert("Quiz saved");
      loadQuizzes();
    });

    $("assignment-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      await api("/api/teacher/assignments", {
        method: "POST",
        body: JSON.stringify({
          title: $("asg-title").value,
          description: $("asg-desc").value,
          examId: $("asg-exam").value,
          dueDate: $("asg-due").value || null,
          maxScore: $("asg-max").value
        })
      });
      e.target.reset();
      alert("Assignment created");
      loadAssignments();
    });

    $("disc-search").addEventListener("click", loadDiscussions);
    $("disc-new").addEventListener("click", async () => {
      const title = prompt("Thread title:");
      if (!title) return;
      const body = prompt("Message:");
      const examId = prompt("Exam ID (optional):") || "";
      await api("/api/teacher/discussions", {
        method: "POST",
        body: JSON.stringify({ title, body, examId })
      });
      loadDiscussions();
    });

    loadDashboard();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
