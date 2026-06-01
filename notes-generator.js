(function () {
  const THEME_KEY = "sharda_setu_ng_theme";
  let currentSource = "youtube";
  let currentNoteId = null;
  let pdfFile = null;

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
    $("ng-theme-btn").textContent = dark ? "☀️ Light" : "🌙 Dark";
  }

  function toggleTheme() {
    const dark = document.documentElement.getAttribute("data-theme") === "dark";
    const next = dark ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem(THEME_KEY, next === "dark" ? "dark" : "light");
    $("ng-theme-btn").textContent = next === "dark" ? "☀️ Light" : "🌙 Dark";
  }

  async function checkAiStatus() {
    try {
      const s = await fetch("/api/notes/status").then((r) => r.json());
      const el = $("ng-ai-status");
      if (!s.configured) {
        el.hidden = false;
        el.textContent =
          "Add OPENAI_API_KEY or GEMINI_API_KEY to .env to enable AI generation.";
      } else {
        el.hidden = true;
      }
    } catch (_) {}
  }

  function setSource(src) {
    currentSource = src;
    document.querySelectorAll(".ng-tab").forEach((t) => {
      t.classList.toggle("active", t.dataset.source === src);
    });
    $("ng-youtube-fields").hidden = src !== "youtube";
    $("ng-pdf-fields").hidden = src !== "pdf";
  }

  function showLoading(on) {
    $("ng-empty").hidden = on;
    $("ng-loading").hidden = !on;
    $("ng-result").hidden = on;
    $("ng-generate-btn").disabled = on;
  }

  function renderMarkdown(md) {
    if (typeof marked !== "undefined") return marked.parse(md || "", { breaks: true });
    return escapeHtml(md).replace(/\n/g, "<br/>");
  }

  function renderNote(note) {
    currentNoteId = note.id;
    $("ng-empty").hidden = true;
    $("ng-result").hidden = false;

    const concepts = (note.concepts || [])
      .map(
        (c) => `
      <div class="ng-concept-card">
        <strong>${escapeHtml(c.name)}</strong>
        <span>${escapeHtml(c.explanation)}</span>
      </div>`
      )
      .join("");

    const formulas = (note.formulas || [])
      .map(
        (f) => `
      <div class="ng-formula">
        <strong>${escapeHtml(f.name)}</strong><br/>
        ${escapeHtml(f.expression)}
        ${f.usage ? `<br/><em style="color:var(--ng-muted)">${escapeHtml(f.usage)}</em>` : ""}
      </div>`
      )
      .join("");

    $("ng-result").innerHTML = `
      <div class="ng-output-head">
        <div>
          <h2>${escapeHtml(note.title)}</h2>
          <p style="margin:6px 0 0;color:var(--ng-muted);font-size:0.88rem">${escapeHtml(note.summary || "")}</p>
        </div>
        <div class="ng-export-row">
          <button type="button" class="ng-btn-outline ng-btn" data-export="pdf">Export PDF</button>
          <button type="button" class="ng-btn-outline ng-btn" data-export="docx">Export DOCX</button>
        </div>
      </div>

      <div class="ng-section">
        <h3>Key concepts</h3>
        ${concepts || "<p style='color:var(--ng-muted)'>No concepts extracted.</p>"}
      </div>

      <div class="ng-section">
        <h3>Formulas</h3>
        ${formulas || "<p style='color:var(--ng-muted)'>No formulas found.</p>"}
      </div>

      <div class="ng-section">
        <h3>Revision notes</h3>
        <div class="ng-markdown">${renderMarkdown(note.revisionNotes)}</div>
      </div>

      <div class="ng-section">
        <h3>Full notes</h3>
        <div class="ng-markdown">${renderMarkdown(note.fullNotesMarkdown)}</div>
      </div>`;

    $("ng-result").querySelectorAll("[data-export]").forEach((btn) => {
      btn.addEventListener("click", () => downloadExport(btn.dataset.export));
    });
  }

  async function downloadExport(format) {
    if (!currentNoteId || !window.ShardaAuth?.getToken()) return;
    const token = window.ShardaAuth.getToken();
    try {
      const res = await fetch(`/api/notes/${currentNoteId}/export/${format}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Export failed");
      }
      const blob = await res.blob();
      const disp = res.headers.get("Content-Disposition") || "";
      const match = disp.match(/filename="?([^"]+)"?/);
      const filename = match ? match[1] : `notes.${format}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err.message);
    }
  }

  async function loadHistory() {
    if (!window.ShardaAuth?.isLoggedIn()) return;
    try {
      const data = await window.ShardaAuth.apiFetch("/api/notes");
      const list = data.notes || [];
      if (!list.length) {
        $("ng-history").hidden = true;
        return;
      }
      $("ng-history").hidden = false;
      $("ng-history-list").innerHTML = list
        .map(
          (n) => `
        <button type="button" class="ng-history-item" data-id="${escapeHtml(n.id)}">
          ${escapeHtml(n.title)}<br/>
          <small style="color:var(--ng-muted)">${n.sourceType} · ${new Date(n.createdAt).toLocaleDateString()}</small>
        </button>`
        )
        .join("");

      $("ng-history-list").querySelectorAll(".ng-history-item").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const detail = await window.ShardaAuth.apiFetch(`/api/notes/${btn.dataset.id}`);
          renderNote(detail.note);
        });
      });
    } catch (_) {}
  }

  async function generateNotes(e) {
    e.preventDefault();
    if (!window.ShardaAuth?.isLoggedIn()) {
      window.location.href = "login.html";
      return;
    }

    showLoading(true);

    try {
      let data;
      const examFocus = $("ng-exam-focus").value;
      const noteType = $("ng-note-type").value;

      if (currentSource === "youtube") {
        const youtubeUrl = $("ng-youtube-url").value.trim();
        if (!youtubeUrl) throw new Error("Enter a YouTube URL");
        data = await window.ShardaAuth.apiFetch("/api/generate-notes", {
          method: "POST",
          body: JSON.stringify({
            sourceType: "youtube",
            youtubeUrl,
            examFocus,
            noteType
          })
        });
      } else {
        if (!pdfFile) throw new Error("Select a PDF file");
        const fd = new FormData();
        fd.append("pdf", pdfFile);
        fd.append("sourceType", "pdf");
        fd.append("examFocus", examFocus);
        fd.append("noteType", noteType);

        const token = window.ShardaAuth.getToken();
        const res = await fetch("/api/generate-notes", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: fd
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || "Generation failed");
        data = json;
      }

      renderNote(data.note);
      loadHistory();
    } catch (err) {
      alert(err.message);
      $("ng-empty").hidden = false;
    } finally {
      showLoading(false);
    }
  }

  function initUpload() {
    const zone = $("ng-drop-zone");
    const input = $("ng-pdf-file");

    zone.addEventListener("click", () => input.click());
    input.addEventListener("change", () => {
      pdfFile = input.files[0] || null;
      $("ng-file-name").textContent = pdfFile ? pdfFile.name : "";
    });
    zone.addEventListener("dragover", (e) => {
      e.preventDefault();
      zone.classList.add("dragover");
    });
    zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));
    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      zone.classList.remove("dragover");
      const f = e.dataTransfer.files[0];
      if (f && f.type === "application/pdf") {
        pdfFile = f;
        $("ng-file-name").textContent = f.name;
      }
    });
  }

  function initFromQuery() {
    const params = new URLSearchParams(location.search);
    const v = params.get("v") || params.get("youtube");
    if (v) {
      $("ng-youtube-url").value = v.includes("http") ? v : `https://www.youtube.com/watch?v=${v}`;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    initTheme();
    initUpload();
    initFromQuery();
    checkAiStatus();

    $("ng-theme-btn").addEventListener("click", toggleTheme);
    $("ng-form").addEventListener("submit", generateNotes);

    document.querySelectorAll(".ng-tab").forEach((tab) => {
      tab.addEventListener("click", () => setSource(tab.dataset.source));
    });

    if (window.ShardaAuth?.isLoggedIn()) {
      $("ng-guest").hidden = true;
      $("ng-app").hidden = false;
      loadHistory();
    } else {
      $("ng-guest").hidden = false;
      $("ng-app").hidden = true;
    }
  });
})();
