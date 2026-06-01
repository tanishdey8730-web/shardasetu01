(function () {
  const THEME_KEY = "sharda_setu_vs_theme";
  let currentSummaryId = null;

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
    $("vs-theme-btn").textContent = dark ? "☀️ Light" : "🌙 Dark";
  }

  function toggleTheme() {
    const dark = document.documentElement.getAttribute("data-theme") === "dark";
    const next = dark ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem(THEME_KEY, next === "dark" ? "dark" : "light");
    $("vs-theme-btn").textContent = next === "dark" ? "☀️ Light" : "🌙 Dark";
  }

  async function checkAiStatus() {
    try {
      const s = await fetch("/api/summaries/status").then((r) => r.json());
      const el = $("vs-ai-status");
      if (!s.configured) {
        el.hidden = false;
        el.textContent =
          "Add OPENAI_API_KEY or GEMINI_API_KEY to .env to enable AI summarization.";
      } else {
        el.hidden = true;
      }
    } catch (_) {}
  }

  function showLoading(on) {
    $("vs-empty").hidden = on;
    $("vs-loading").hidden = !on;
    $("vs-result").hidden = on;
    $("vs-summarize-btn").disabled = on;
  }

  function renderMarkdown(md) {
    if (typeof marked !== "undefined") return marked.parse(md || "", { breaks: true });
    return escapeHtml(md).replace(/\n/g, "<br/>");
  }

  function bindTabs() {
    const tabs = $("vs-result").querySelectorAll(".vs-tab");
    const panels = $("vs-result").querySelectorAll(".vs-tab-panel");
    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        const name = tab.dataset.tab;
        tabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
        panels.forEach((p) => p.classList.toggle("active", p.dataset.panel === name));
      });
    });
  }

  function bindPracticeQuestions() {
    $("vs-result").querySelectorAll(".vs-question").forEach((block) => {
      const correct = Number(block.dataset.correct);
      const explanation = block.querySelector(".vs-explanation");
      const revealBtn = block.querySelector(".vs-reveal-btn");

      block.querySelectorAll(".vs-options button").forEach((btn, idx) => {
        btn.addEventListener("click", () => {
          block.querySelectorAll(".vs-options button").forEach((b) => {
            b.disabled = true;
            b.classList.remove("correct", "wrong");
          });
          if (idx === correct) btn.classList.add("correct");
          else {
            btn.classList.add("wrong");
            block.querySelectorAll(".vs-options button")[correct]?.classList.add("correct");
          }
          if (explanation) explanation.classList.add("show");
          if (revealBtn) revealBtn.hidden = true;
        });
      });

      revealBtn?.addEventListener("click", () => {
        block.querySelectorAll(".vs-options button").forEach((b, i) => {
          b.disabled = true;
          if (i === correct) b.classList.add("correct");
        });
        if (explanation) explanation.classList.add("show");
        revealBtn.hidden = true;
      });
    });
  }

  function renderSummary(s) {
    currentSummaryId = s.id;
    $("vs-empty").hidden = true;
    $("vs-result").hidden = false;

    const thumb = s.videoId
      ? `<img class="vs-thumb" src="https://img.youtube.com/vi/${escapeHtml(s.videoId)}/mqdefault.jpg" alt="" loading="lazy" />`
      : "";

    const transcriptBadge = s.hasTranscript
      ? ""
      : '<span class="vs-badge">No captions — AI used title/metadata</span>';

    const keyPoints = (s.keyPoints || [])
      .map((p) => `<li>${escapeHtml(p)}</li>`)
      .join("");

    const concepts = (s.concepts || [])
      .map(
        (c) => `
      <div class="vs-concept-card">
        <strong>${escapeHtml(c.name)}</strong>
        <span>${escapeHtml(c.explanation)}</span>
      </div>`
      )
      .join("");

    const formulas = (s.formulas || [])
      .map(
        (f) => `
      <div class="vs-formula">
        <strong>${escapeHtml(f.name)}</strong><br/>
        ${escapeHtml(f.expression)}
        ${f.usage ? `<br/><em style="color:var(--vs-muted);font-family:inherit">${escapeHtml(f.usage)}</em>` : ""}
      </div>`
      )
      .join("");

    const questions = (s.practiceQuestions || [])
      .map((q, i) => {
        const opts = (q.options || [])
          .map(
            (opt, j) =>
              `<li><button type="button" data-idx="${j}">${String.fromCharCode(65 + j)}. ${escapeHtml(opt)}</button></li>`
          )
          .join("");
        return `
        <div class="vs-question" data-correct="${Number(q.correct) || 0}">
          <h4>Q${i + 1}. ${escapeHtml(q.question)}</h4>
          <ul class="vs-options">${opts}</ul>
          <p class="vs-explanation"><strong>Explanation:</strong> ${escapeHtml(q.explanation || "")}</p>
          <button type="button" class="vs-btn-outline vs-btn vs-reveal-btn">Show answer</button>
        </div>`;
      })
      .join("");

    const timestamps = (s.timestamps || [])
      .map(
        (t) =>
          `<span class="vs-ts-chip">~${t.approxMinute ?? "?"} min · ${escapeHtml(t.label)}</span>`
      )
      .join("");

    $("vs-result").innerHTML = `
      <div class="vs-result-head">
        <div>
          <h2>${escapeHtml(s.title)}${transcriptBadge}</h2>
          <p class="vs-meta">${escapeHtml(s.channel || "YouTube")} · <a href="${escapeHtml(s.youtubeUrl)}" target="_blank" rel="noopener">Watch video</a></p>
          ${thumb}
          ${timestamps ? `<div class="vs-timestamps">${timestamps}</div>` : ""}
        </div>
        <div class="vs-export-row">
          <button type="button" class="vs-btn-outline vs-btn" id="vs-export-pdf">Export PDF</button>
          <a class="vs-btn-outline vs-btn" href="${escapeHtml(s.youtubeUrl)}" target="_blank" rel="noopener">Open on YouTube</a>
        </div>
      </div>

      <div class="vs-tabs">
        <button type="button" class="vs-tab active" data-tab="summary">Summary</button>
        <button type="button" class="vs-tab" data-tab="concepts">Concepts</button>
        <button type="button" class="vs-tab" data-tab="formulas">Formulas</button>
        <button type="button" class="vs-tab" data-tab="practice">Practice</button>
        <button type="button" class="vs-tab" data-tab="revision">Revision</button>
      </div>

      <div class="vs-tab-panel active" data-panel="summary">
        <div class="vs-summary-text">${escapeHtml(s.summary || "")}</div>
        ${keyPoints ? `<h3 style="margin-top:20px;font-size:1rem">Key points</h3><ul class="vs-key-list">${keyPoints}</ul>` : ""}
      </div>

      <div class="vs-tab-panel" data-panel="concepts">
        ${concepts || "<p class='vs-hint'>No concepts extracted.</p>"}
      </div>

      <div class="vs-tab-panel" data-panel="formulas">
        ${formulas || "<p class='vs-hint'>No formulas found in this lesson.</p>"}
      </div>

      <div class="vs-tab-panel" data-panel="practice">
        ${questions || "<p class='vs-hint'>No practice questions generated.</p>"}
      </div>

      <div class="vs-tab-panel" data-panel="revision">
        <div class="vs-markdown">${renderMarkdown(s.revisionNotes)}</div>
      </div>`;

    $("vs-export-pdf").addEventListener("click", downloadPdf);
    bindTabs();
    bindPracticeQuestions();
  }

  async function downloadPdf() {
    if (!currentSummaryId || !window.ShardaAuth?.getToken()) return;
    const token = window.ShardaAuth.getToken();
    try {
      const res = await fetch(`/api/summaries/${currentSummaryId}/export/pdf`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Export failed");
      }
      const blob = await res.blob();
      const disp = res.headers.get("Content-Disposition") || "";
      const match = disp.match(/filename="?([^"]+)"?/);
      const filename = match ? match[1] : "video-summary.pdf";
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
      const data = await window.ShardaAuth.apiFetch("/api/summaries");
      const list = data.summaries || [];
      if (!list.length) {
        $("vs-history").hidden = true;
        return;
      }
      $("vs-history").hidden = false;
      $("vs-history-list").innerHTML = list
        .map(
          (n) => `
        <button type="button" class="vs-history-item" data-id="${escapeHtml(n.id)}">
          ${escapeHtml(n.title)}<br/>
          <small style="color:var(--vs-muted)">${new Date(n.createdAt).toLocaleDateString()}</small>
        </button>`
        )
        .join("");

      $("vs-history-list").querySelectorAll(".vs-history-item").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const detail = await window.ShardaAuth.apiFetch(`/api/summaries/${btn.dataset.id}`);
          renderSummary(detail.summary);
        });
      });
    } catch (_) {}
  }

  async function summarizeVideo(e) {
    e.preventDefault();
    if (!window.ShardaAuth?.isLoggedIn()) {
      window.location.href = "login.html";
      return;
    }

    const youtubeUrl = $("vs-youtube-url").value.trim();
    if (!youtubeUrl) {
      alert("Enter a YouTube URL");
      return;
    }

    showLoading(true);

    try {
      const data = await window.ShardaAuth.apiFetch("/api/summarize-video", {
        method: "POST",
        body: JSON.stringify({
          youtubeUrl,
          examFocus: $("vs-exam-focus").value
        })
      });
      renderSummary(data.summary);
      loadHistory();
    } catch (err) {
      alert(err.message);
      $("vs-empty").hidden = false;
    } finally {
      showLoading(false);
    }
  }

  function initAuth() {
    if (window.ShardaAuth?.isLoggedIn()) {
      $("vs-guest").hidden = true;
      $("vs-app").hidden = false;
      loadHistory();
    } else {
      $("vs-guest").hidden = false;
      $("vs-app").hidden = true;
    }
    if (window.ShardaAuth?.renderAuthSlot) window.ShardaAuth.renderAuthSlot();
  }

  document.addEventListener("DOMContentLoaded", () => {
    initTheme();
    checkAiStatus();
    initAuth();
    $("vs-theme-btn").addEventListener("click", toggleTheme);
    $("vs-form").addEventListener("submit", summarizeVideo);

    const params = new URLSearchParams(location.search);
    const v = params.get("v") || params.get("url");
    if (v) {
      $("vs-youtube-url").value = v.includes("youtube") ? v : `https://www.youtube.com/watch?v=${v}`;
    }
  });
})();
