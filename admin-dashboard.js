(function () {
  const THEME_KEY = "sharda_setu_adm_theme";
  let activityChart = null;
  let lastReport = null;
  let currentSection = "dashboard";

  const titles = {
    dashboard: "Dashboard",
    users: "User Management",
    courses: "Course Management",
    videos: "Video Management",
    notes: "Notes Management",
    approvals: "Content Approval",
    analytics: "Analytics",
    reports: "Reports"
  };

  function $(id) {
    return document.getElementById(id);
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric"
    });
  }

  async function api(path, options = {}) {
    return window.ShardaAuth.apiFetch(path, options);
  }

  function badge(status) {
    return `<span class="adm-badge ${esc(status)}">${esc(status)}</span>`;
  }

  function switchSection(name) {
    currentSection = name;
    document.querySelectorAll(".adm-nav button").forEach((b) => {
      b.classList.toggle("active", b.dataset.section === name);
    });
    document.querySelectorAll(".adm-section").forEach((s) => {
      const on = s.dataset.section === name;
      s.hidden = !on;
      s.classList.toggle("active", on);
    });
    $("adm-page-title").textContent = titles[name] || "Admin";
    $("adm-sidebar").classList.remove("open");
    $("adm-overlay").classList.remove("show");
    loadSection(name);
  }

  async function loadSection(name) {
    try {
      if (name === "dashboard") await loadDashboard();
      else if (name === "users") await loadUsers();
      else if (name === "courses") await loadCourses();
      else if (name === "videos") await loadVideos();
      else if (name === "notes") await loadNotes();
      else if (name === "approvals") await loadApprovals();
      else if (name === "analytics") await loadAnalytics();
    } catch (err) {
      console.error(err);
    }
  }

  async function loadDashboard() {
    const data = await api("/api/admin/dashboard");
    const s = data.stats;
    $("adm-dash-stats").innerHTML = `
      <div class="adm-stat"><strong>${s.users}</strong><span>Users</span></div>
      <div class="adm-stat"><strong>${s.activeUsers}</strong><span>Active</span></div>
      <div class="adm-stat"><strong>${s.pendingApprovals}</strong><span>Pending</span></div>
      <div class="adm-stat"><strong>${s.mockTests}</strong><span>Mock tests</span></div>
      <div class="adm-stat"><strong>${s.notes}</strong><span>Notes</span></div>
      <div class="adm-stat"><strong>${s.videos}</strong><span>Videos</span></div>`;

    const pending = data.pendingPreview || [];
    $("adm-dash-pending").innerHTML = pending.length
      ? `<table class="adm-table"><tbody>${pending
          .map(
            (p) =>
              `<tr><td>${esc(p.title)}</td><td>${badge(p.type)}</td><td>${badge(p.status)}</td><td><button type="button" class="adm-btn adm-btn-ghost" data-goto-approval="${esc(p.id)}">Review</button></td></tr>`
          )
          .join("")}</tbody></table>`
      : '<p class="adm-empty">No pending approvals.</p>';

    $("adm-dash-pending").querySelectorAll("[data-goto-approval]").forEach((btn) => {
      btn.addEventListener("click", () => switchSection("approvals"));
    });

    if (activityChart) activityChart.destroy();
    const ch = data.charts?.activityLast7Days;
    if (ch?.length && typeof Chart !== "undefined") {
      activityChart = new Chart($("adm-activity-chart"), {
        type: "bar",
        data: {
          labels: ch.map((d) => d.date.slice(5)),
          datasets: [
            { label: "Tests", data: ch.map((d) => d.tests), backgroundColor: "#4f46e5" },
            { label: "Signups", data: ch.map((d) => d.signups), backgroundColor: "#059669" }
          ]
        },
        options: { responsive: true, scales: { y: { beginAtZero: true } } }
      });
    }
  }

  async function loadUsers() {
    const q = $("users-q").value;
    const role = $("users-role").value;
    const data = await api(`/api/admin/users?q=${encodeURIComponent(q)}&role=${role}&pageSize=50`);
    const tbody = $("users-table").querySelector("tbody");
    tbody.innerHTML =
      data.users
        ?.map(
          (u) => `
      <tr>
        <td>${esc(u.name)}</td>
        <td>${esc(u.email)}</td>
        <td>${badge(u.role)}</td>
        <td>${u.disabled ? badge("hidden") : badge("published")}</td>
        <td>${fmtDate(u.createdAt)}</td>
        <td>
          <select data-user-role="${esc(u.id)}" class="adm-inline-role">
            <option value="student" ${u.role === "student" ? "selected" : ""}>Student</option>
            <option value="teacher" ${u.role === "teacher" ? "selected" : ""}>Teacher</option>
            <option value="admin" ${u.role === "admin" ? "selected" : ""}>Admin</option>
          </select>
          <button type="button" class="adm-btn adm-btn-ghost" data-toggle-user="${esc(u.id)}" data-disabled="${u.disabled}">
            ${u.disabled ? "Enable" : "Disable"}
          </button>
        </td>
      </tr>`
        )
        .join("") || '<tr><td colspan="6" class="adm-empty">No users found</td></tr>';

    tbody.querySelectorAll(".adm-inline-role").forEach((sel) => {
      sel.addEventListener("change", async () => {
        await api(`/api/admin/users/${sel.dataset.userRole}`, {
          method: "PATCH",
          body: JSON.stringify({ role: sel.value })
        });
      });
    });

    tbody.querySelectorAll("[data-toggle-user]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const disabled = btn.dataset.disabled !== "true";
        await api(`/api/admin/users/${btn.dataset.toggleUser}`, {
          method: "PATCH",
          body: JSON.stringify({ disabled })
        });
        loadUsers();
      });
    });
  }

  async function loadCourses() {
    const q = $("courses-q").value;
    const source = $("courses-source").value;
    const data = await api(
      `/api/admin/courses?q=${encodeURIComponent(q)}&source=${encodeURIComponent(source)}`
    );
    const tbody = $("courses-table").querySelector("tbody");
    tbody.innerHTML =
      data.courses
        ?.map(
          (c) => `
      <tr>
        <td>${esc(c.name)}</td>
        <td><code>${esc(c.id)}</code></td>
        <td>${esc(c.source)}</td>
        <td>${badge(c.status)}</td>
        <td>
          ${
            c.source !== "pending"
              ? `<button type="button" class="adm-btn adm-btn-ghost" data-hide-course="${esc(c.id)}" data-hidden="${c.status === "hidden"}">${c.status === "hidden" ? "Show" : "Hide"}</button>`
              : "—"
          }
        </td>
      </tr>`
        )
        .join("") || '<tr><td colspan="5" class="adm-empty">No courses</td></tr>';

    tbody.querySelectorAll("[data-hide-course]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const hidden = btn.dataset.hidden !== "true";
        await api(`/api/admin/courses/${encodeURIComponent(btn.dataset.hideCourse)}/visibility`, {
          method: "PATCH",
          body: JSON.stringify({ hidden })
        });
        loadCourses();
      });
    });
  }

  async function loadVideos() {
    const q = $("videos-q").value;
    const examId = $("videos-exam").value;
    const status = $("videos-status").value;
    const data = await api(
      `/api/admin/videos?q=${encodeURIComponent(q)}&examId=${encodeURIComponent(examId)}&status=${status}`
    );
    const tbody = $("videos-table").querySelector("tbody");
    const list = (data.videos || []).slice(0, 80);
    tbody.innerHTML =
      list
        .map(
          (v) => `
      <tr>
        <td>${esc(v.title)}</td>
        <td>${esc(v.examName || v.examId)}</td>
        <td>${esc(v.subjectId)}</td>
        <td>${esc(v.type)}</td>
        <td>${badge(v.status)}</td>
        <td>
          ${
            v.source !== "pending" && v.type === "video"
              ? `<button type="button" class="adm-btn adm-btn-ghost" data-hide-video="${esc(v.id)}">Hide</button>`
              : "—"
          }
        </td>
      </tr>`
        )
        .join("") || '<tr><td colspan="6" class="adm-empty">No videos</td></tr>';

    tbody.querySelectorAll("[data-hide-video]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Hide this video from admin catalog?")) return;
        await api("/api/admin/videos/visibility", {
          method: "PATCH",
          body: JSON.stringify({ id: btn.dataset.hideVideo, hidden: true })
        });
        loadVideos();
      });
    });
  }

  async function loadNotes() {
    const q = $("notes-q").value;
    const kind = $("notes-kind").value;
    const data = await api(`/api/admin/notes?q=${encodeURIComponent(q)}&kind=${kind}`);
    const tbody = $("notes-table").querySelector("tbody");
    tbody.innerHTML =
      data.notes
        ?.map(
          (n) => `
      <tr>
        <td>${esc(n.title)}</td>
        <td>${esc(n.kind)}</td>
        <td><code>${esc(n.userId?.slice(0, 8))}…</code></td>
        <td>${fmtDate(n.createdAt)}</td>
        <td>${badge(n.status)}</td>
        <td>
          <button type="button" class="adm-btn adm-btn-ghost" data-hide-note="${esc(n.id)}" data-kind="${esc(n.kind)}" data-hidden="${n.status === "hidden"}">${n.status === "hidden" ? "Show" : "Hide"}</button>
          <button type="button" class="adm-btn adm-btn-danger" data-del-note="${esc(n.id)}" data-kind="${esc(n.kind)}">Delete</button>
        </td>
      </tr>`
        )
        .join("") || '<tr><td colspan="6" class="adm-empty">No notes</td></tr>';

    tbody.querySelectorAll("[data-hide-note]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const hidden = btn.dataset.hidden !== "true";
        await api(`/api/admin/notes/${btn.dataset.hideNote}/visibility`, {
          method: "PATCH",
          body: JSON.stringify({ hidden })
        });
        loadNotes();
      });
    });

    tbody.querySelectorAll("[data-del-note]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Permanently delete this note?")) return;
        await api(`/api/admin/notes/${btn.dataset.delNote}?kind=${btn.dataset.kind}`, {
          method: "DELETE"
        });
        loadNotes();
      });
    });
  }

  async function loadApprovals() {
    const status = $("approvals-status").value;
    const type = $("approvals-type").value;
    const q = $("approvals-q").value;
    const data = await api(
      `/api/admin/approvals?status=${status}&type=${type}&q=${encodeURIComponent(q)}`
    );
    const tbody = $("approvals-table").querySelector("tbody");
    tbody.innerHTML =
      data.approvals
        ?.map(
          (p) => `
      <tr>
        <td>${esc(p.title)}</td>
        <td>${badge(p.type)}</td>
        <td>${fmtDate(p.submittedAt)}</td>
        <td>${badge(p.status)}</td>
        <td>
          ${
            p.status === "pending"
              ? `<button type="button" class="adm-btn adm-btn-success" data-approve="${esc(p.id)}">Approve</button>
                 <button type="button" class="adm-btn adm-btn-danger" data-reject="${esc(p.id)}">Reject</button>`
              : "—"
          }
        </td>
      </tr>`
        )
        .join("") || '<tr><td colspan="5" class="adm-empty">No items</td></tr>';

    tbody.querySelectorAll("[data-approve]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await api(`/api/admin/approvals/${btn.dataset.approve}/approve`, {
          method: "POST",
          body: JSON.stringify({})
        });
        loadApprovals();
        loadDashboard();
      });
    });

    tbody.querySelectorAll("[data-reject]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const note = prompt("Rejection reason (optional):") || "";
        await api(`/api/admin/approvals/${btn.dataset.reject}/reject`, {
          method: "POST",
          body: JSON.stringify({ note })
        });
        loadApprovals();
      });
    });
  }

  async function loadAnalytics() {
    const data = await api("/api/admin/analytics");
    $("adm-analytics-stats").innerHTML = `
      <div class="adm-stat"><strong>${data.userGrowth}</strong><span>Total users</span></div>
      <div class="adm-stat"><strong>${data.verifiedUsers}</strong><span>Verified</span></div>
      <div class="adm-stat"><strong>${data.avgMockScore}%</strong><span>Avg mock score</span></div>
      <div class="adm-stat"><strong>${data.notesGenerated}</strong><span>Notes generated</span></div>`;

    $("adm-tests-by-exam").innerHTML =
      (data.testsByExam || [])
        .map(
          (e) =>
            `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--adm-border)"><span>${esc(e.examId)}</span><strong>${e.count}</strong></div>`
        )
        .join("") || '<p class="adm-empty">No test data yet.</p>';
  }

  async function loadReport() {
    const type = $("report-type").value;
    lastReport = await api(`/api/admin/reports?type=${type}`);
    $("report-output").textContent = JSON.stringify(lastReport, null, 2);
  }

  function openModal(title, fields, onSubmit) {
    $("modal-title").textContent = title;
    $("modal-form").innerHTML = fields
      .map(
        (f) => `
      <label for="mf-${f.id}">${esc(f.label)}</label>
      ${
        f.type === "select"
          ? `<select id="mf-${f.id}" name="${f.id}">${(f.options || [])
              .map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`)
              .join("")}</select>`
          : `<input id="mf-${f.id}" name="${f.id}" type="${f.type || "text"}" ${f.required ? "required" : ""} placeholder="${esc(f.placeholder || "")}" />`
      }`
      )
      .join("");

    $("adm-modal").hidden = false;
    $("modal-form").onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = {};
      fields.forEach((f) => {
        body[f.id] = fd.get(f.id);
      });
      await onSubmit(body);
      $("adm-modal").hidden = true;
    };
  }

  function initTheme() {
    const dark = localStorage.getItem(THEME_KEY) === "dark";
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    $("adm-theme-btn").textContent = dark ? "☀️" : "🌙";
  }

  function init() {
    if (!window.ShardaAuth?.isLoggedIn()) {
      $("adm-guest").hidden = false;
      return;
    }
    const user = window.ShardaAuth.getUser();
    if (user?.role !== "admin") {
      $("adm-guest").hidden = false;
      $("adm-guest-msg").textContent = "Your account does not have admin privileges.";
      return;
    }

    $("adm-app").hidden = false;
    initTheme();

    document.querySelectorAll(".adm-nav button").forEach((btn) => {
      btn.addEventListener("click", () => switchSection(btn.dataset.section));
    });

    $("adm-menu-btn").addEventListener("click", () => {
      $("adm-sidebar").classList.toggle("open");
      $("adm-overlay").classList.toggle("show");
    });
    $("adm-overlay").addEventListener("click", () => {
      $("adm-sidebar").classList.remove("open");
      $("adm-overlay").classList.remove("show");
    });

    $("adm-theme-btn").addEventListener("click", () => {
      const dark = document.documentElement.getAttribute("data-theme") === "dark";
      const next = dark ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem(THEME_KEY, next === "dark" ? "dark" : "light");
      $("adm-theme-btn").textContent = next === "dark" ? "☀️" : "🌙";
    });

    $("adm-refresh-btn").addEventListener("click", () => loadSection(currentSection));

    $("users-search").addEventListener("click", loadUsers);
    $("courses-search").addEventListener("click", loadCourses);
    $("videos-search").addEventListener("click", loadVideos);
    $("notes-search").addEventListener("click", loadNotes);
    $("approvals-search").addEventListener("click", loadApprovals);

    $("courses-add").addEventListener("click", () => {
      openModal(
        "Add course",
        [
          { id: "name", label: "Course name", required: true },
          { id: "id", label: "Course ID (optional)" },
          { id: "description", label: "Description" }
        ],
        async (body) => {
          await api("/api/admin/courses", { method: "POST", body: JSON.stringify(body) });
          loadCourses();
        }
      );
    });

    $("videos-add").addEventListener("click", () => {
      openModal(
        "Add video",
        [
          { id: "title", label: "Title", required: true },
          { id: "videoId", label: "YouTube video ID", required: true },
          { id: "examId", label: "Exam ID", placeholder: "ssc-cgl" },
          {
            id: "subjectId",
            label: "Subject",
            type: "select",
            options: [
              { value: "maths", label: "Maths" },
              { value: "physics", label: "Physics" },
              { value: "chemistry", label: "Chemistry" }
            ]
          },
          { id: "duration", label: "Duration" }
        ],
        async (body) => {
          await api("/api/admin/videos", { method: "POST", body: JSON.stringify(body) });
          loadVideos();
        }
      );
    });

    $("modal-cancel").addEventListener("click", () => {
      $("adm-modal").hidden = true;
    });

    $("report-load").addEventListener("click", loadReport);
    $("report-print").addEventListener("click", () => window.print());
    $("report-download").addEventListener("click", () => {
      if (!lastReport) return;
      const blob = new Blob([JSON.stringify(lastReport, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `sharda-setu-report-${Date.now()}.json`;
      a.click();
    });

    loadDashboard();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
