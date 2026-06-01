(function () {
  const THEME_KEY = "sharda_setu_qg_theme";
  let currentSet = null;
  let showKey = false;
  let showExp = false;

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
    $("qg-theme-btn").textContent = dark ? "☀️ Light" : "🌙 Dark";
  }

  function toggleTheme() {
    const dark = document.documentElement.getAttribute("data-theme") === "dark";
    const next = dark ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem(THEME_KEY, next === "dark" ? "dark" : "light");
    $("qg-theme-btn").textContent = next === "dark" ? "☀️ Light" : "🌙 Dark";
  }

  function getFormValue(name) {
    const el = document.querySelector(`input[name="${name}"]:checked`);
    return el ? el.value : "";
  }

  async function checkAiStatus() {
    try {
      const s = await fetch("/api/question-generator/status").then((r) => r.json());
      const el = $("qg-ai-status");
      if (!s.configured) {
        el.hidden = false;
        el.textContent =
          "Add OPENAI_API_KEY or GEMINI_API_KEY to .env to enable AI generation.";
      } else {
        el.hidden = true;
      }
    } catch (_) {}
  }

  function typeLabel(t) {
    if (t === "subjective") return "Subjective";
    if (t === "pyq") return "PYQ style";
    return "MCQ";
  }

  function diffLabel(d) {
    return d.charAt(0).toUpperCase() + d.slice(1);
  }

  function renderAnswerKey() {
    const el = $("qg-answer-key");
    if (!showKey || !currentSet?.answerKey?.length) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    const items = currentSet.answerKey
      .map((k) => {
        if (k.type === "subjective") {
          const kw = (k.keywords || []).join(", ");
          return `<li><strong>Q${k.number}:</strong> ${escapeHtml(k.answer || "")}${kw ? ` <em>(Keywords: ${escapeHtml(kw)})</em>` : ""}</li>`;
        }
        return `<li><strong>Q${k.number}:</strong> ${escapeHtml(k.answer)}</li>`;
      })
      .join("");
    el.innerHTML = `<h3>Answer key</h3><ol>${items}</ol>`;
  }

  function renderQuestions() {
    const container = $("qg-questions");
    if (!currentSet?.questions?.length) {
      container.innerHTML = "";
      return;
    }

    container.innerHTML = currentSet.questions
      .map((q) => {
        const tags = [
          `<span class="qg-tag">${escapeHtml(q.difficulty)}</span>`,
          q.type === "pyq" && q.pyqYear
            ? `<span class="qg-tag pyq">PYQ ${escapeHtml(String(q.pyqYear))}${q.pyqExam ? " · " + escapeHtml(q.pyqExam) : ""}</span>`
            : `<span class="qg-tag">${escapeHtml(typeLabel(q.type))}</span>`
        ].join("");

        let body = "";
        if (q.type === "subjective") {
          body = `<p>${escapeHtml(q.question)}</p>`;
          if (showKey) {
            body += `<div class="qg-model-answer"><strong>Model answer:</strong><br/>${escapeHtml(q.modelAnswer || "")}</div>`;
            if (q.keywords?.length) {
              body += `<p class="qg-keywords"><strong>Keywords:</strong> ${escapeHtml(q.keywords.join(", "))}</p>`;
            }
          }
        } else {
          const opts = (q.options || [])
            .map((opt, j) => {
              const hl = showKey && j === q.correct ? " correct-highlight" : "";
              const mark = showKey && j === q.correct ? " ✓" : "";
              return `<li class="${hl}">${String.fromCharCode(65 + j)}. ${escapeHtml(opt)}${mark}</li>`;
            })
            .join("");
          body = `<p>${escapeHtml(q.question)}</p><ul class="qg-options">${opts}</ul>`;
        }

        const exp =
          showExp && q.explanation
            ? `<div class="qg-explanation"><strong>Explanation:</strong> ${escapeHtml(q.explanation)}</div>`
            : "";

        return `
        <article class="qg-card">
          <div class="qg-card-head">
            <h3>Q${q.number}. ${escapeHtml(q.topic || currentSet.topic)}</h3>
            ${tags}
            <span class="qg-tag">${q.marks || 1} mark${q.marks > 1 ? "s" : ""}</span>
          </div>
          ${body}
          ${exp}
        </article>`;
      })
      .join("");

    renderAnswerKey();
  }

  function renderSet(set) {
    currentSet = set;
    showKey = false;
    showExp = false;
    $("qg-empty").hidden = true;
    $("qg-loading").hidden = true;
    $("qg-output-head").hidden = false;
    $("qg-toggle-key").classList.remove("active");
    $("qg-toggle-exp").classList.remove("active");
    $("qg-toggle-key").textContent = "Show answer key";
    $("qg-toggle-exp").textContent = "Show explanations";

    $("qg-result-title").textContent = set.topic;
    $("qg-result-meta").textContent = `${typeLabel(set.questionType)} · ${diffLabel(set.difficulty)} · ${set.count} questions · ${set.examId || "general"}`;

    renderQuestions();
  }

  function showLoading(on) {
    $("qg-empty").hidden = on;
    $("qg-loading").hidden = !on;
    if (on) {
      $("qg-output-head").hidden = true;
      $("qg-questions").innerHTML = "";
      $("qg-answer-key").hidden = true;
    }
    $("qg-generate-btn").disabled = on;
  }

  async function loadHistory() {
    if (!window.ShardaAuth?.isLoggedIn()) return;
    try {
      const data = await window.ShardaAuth.apiFetch("/api/question-generator");
      const list = data.sets || [];
      if (!list.length) {
        $("qg-history").hidden = true;
        return;
      }
      $("qg-history").hidden = false;
      $("qg-history-list").innerHTML = list
        .map(
          (s) => `
        <button type="button" class="qg-history-item" data-id="${escapeHtml(s.id)}">
          ${escapeHtml(s.topic)}<br/>
          <small style="color:var(--qg-muted)">${typeLabel(s.questionType)} · ${diffLabel(s.difficulty)} · ${new Date(s.createdAt).toLocaleDateString()}</small>
        </button>`
        )
        .join("");

      $("qg-history-list").querySelectorAll(".qg-history-item").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const detail = await window.ShardaAuth.apiFetch(`/api/question-generator/${btn.dataset.id}`);
          renderSet(detail.set);
        });
      });
    } catch (_) {}
  }

  async function generateQuestions(e) {
    e.preventDefault();
    if (!window.ShardaAuth?.isLoggedIn()) {
      window.location.href = "login.html";
      return;
    }

    const topic = $("qg-topic").value.trim();
    if (!topic) {
      alert("Enter a topic");
      return;
    }

    showLoading(true);

    try {
      const data = await window.ShardaAuth.apiFetch("/api/question-generator", {
        method: "POST",
        body: JSON.stringify({
          topic,
          examId: $("qg-exam").value,
          subject: $("qg-subject").value,
          questionType: getFormValue("qg-type"),
          difficulty: getFormValue("qg-diff"),
          count: Number($("qg-count").value) || 5
        })
      });
      renderSet(data.set);
      loadHistory();
    } catch (err) {
      alert(err.message);
      $("qg-empty").hidden = false;
    } finally {
      showLoading(false);
    }
  }

  function initAuth() {
    if (window.ShardaAuth?.isLoggedIn()) {
      $("qg-guest").hidden = true;
      $("qg-app").hidden = false;
      loadHistory();
    } else {
      $("qg-guest").hidden = false;
      $("qg-app").hidden = true;
    }
    if (window.ShardaAuth?.renderAuthSlot) window.ShardaAuth.renderAuthSlot();
  }

  document.addEventListener("DOMContentLoaded", () => {
    initTheme();
    checkAiStatus();
    initAuth();
    $("qg-theme-btn").addEventListener("click", toggleTheme);
    $("qg-form").addEventListener("submit", generateQuestions);

    $("qg-toggle-key").addEventListener("click", () => {
      showKey = !showKey;
      $("qg-toggle-key").classList.toggle("active", showKey);
      $("qg-toggle-key").textContent = showKey ? "Hide answer key" : "Show answer key";
      renderQuestions();
    });

    $("qg-toggle-exp").addEventListener("click", () => {
      showExp = !showExp;
      $("qg-toggle-exp").classList.toggle("active", showExp);
      $("qg-toggle-exp").textContent = showExp ? "Hide explanations" : "Show explanations";
      renderQuestions();
    });

    const params = new URLSearchParams(location.search);
    if (params.get("topic")) $("qg-topic").value = params.get("topic");
  });
})();
