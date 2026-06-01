(function () {
  const THEME_KEY = "sharda_setu_mt_theme";
  let catalog = null;
  let activeTest = null;
  let answers = {};
  let marked = new Set();
  let currentIndex = 0;
  let timerInterval = null;
  let testStartedAt = null;

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
    $("mt-theme-btn").textContent = dark ? "☀️ Light" : "🌙 Dark";
  }

  function toggleTheme() {
    const dark = document.documentElement.getAttribute("data-theme") === "dark";
    const next = dark ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem(THEME_KEY, next === "dark" ? "dark" : "light");
    $("mt-theme-btn").textContent = next === "dark" ? "☀️ Light" : "🌙 Dark";
  }

  async function loadCatalog() {
    catalog = await fetch("/api/exam-catalog").then((r) => r.json());
    renderCatalog();
    populateBankForm();
  }

  function renderCatalog() {
    if (!catalog) return;

    $("mt-mock-grid").innerHTML = (catalog.mockTests || [])
      .map(
        (m) => `
      <article class="mt-card">
        <span class="mt-badge mock">Full Mock</span>
        <h3>${escapeHtml(m.title)}</h3>
        <p class="mt-card-meta">${escapeHtml(m.description || "")}<br/>
        ${m.questionCount} Q · ${m.durationMinutes} min · +${m.marksPerQuestion} / -${m.negativeMarks}</p>
        <button type="button" class="mt-btn" data-start-mock="${escapeHtml(m.id)}">Start Test</button>
      </article>`
      )
      .join("");

    $("mt-chapter-grid").innerHTML = (catalog.chapterTests || [])
      .map(
        (c) => `
      <article class="mt-card">
        <span class="mt-badge chapter">Chapter</span>
        <h3>${escapeHtml(c.title)}</h3>
        <p class="mt-card-meta">${escapeHtml(c.examName)} · ${c.availableQuestions} Q available<br/>
        ${c.questionCount} Q · ${c.durationMinutes} min · -${c.negativeMarks} negative</p>
        <button type="button" class="mt-btn" data-start-chapter="${escapeHtml(c.chapterId)}" data-exam="${escapeHtml(c.examId)}">Start Chapter Test</button>
      </article>`
      )
      .join("");

    $("mt-pyq-grid").innerHTML = (catalog.pyqTests || [])
      .map(
        (p) => `
      <article class="mt-card">
        <span class="mt-badge pyq">PYQ</span>
        <h3>${escapeHtml(p.title)}</h3>
        <p class="mt-card-meta">${p.questionCount} questions · ${p.durationMinutes} minutes</p>
        <button type="button" class="mt-btn" data-start-pyq="${p.pyqYear}">Start PYQ Test</button>
      </article>`
      )
      .join("");

    document.querySelectorAll("[data-start-mock]").forEach((btn) => {
      btn.addEventListener("click", () =>
        startTest({ templateId: btn.dataset.startMock })
      );
    });
    document.querySelectorAll("[data-start-chapter]").forEach((btn) => {
      btn.addEventListener("click", () =>
        startTest({
          type: "chapter",
          chapterId: btn.dataset.startChapter,
          examId: btn.dataset.exam
        })
      );
    });
    document.querySelectorAll("[data-start-pyq]").forEach((btn) => {
      btn.addEventListener("click", () =>
        startTest({ type: "pyq", pyqYear: Number(btn.dataset.startPyq), examId: "ssc-cgl" })
      );
    });
  }

  async function startTest(payload) {
    if (!window.ShardaAuth?.isLoggedIn()) {
      alert("Please sign in to start a test.");
      window.location.href = "login.html";
      return;
    }
    try {
      const data = await window.ShardaAuth.apiFetch("/api/tests", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      openExam(data.test);
    } catch (err) {
      alert(err.message);
    }
  }

  function openExam(test) {
    activeTest = test;
    answers = {};
    marked = new Set();
    currentIndex = 0;
    testStartedAt = Date.now();

    $("main-header").style.display = "none";
    $("mt-hub").style.display = "none";
    $("mt-exam").classList.add("active");
    $("mt-exam-title").textContent = test.title;
    $("mt-marking-info").textContent = test.negativeMarkingEnabled
      ? `Negative marking: −${test.negativeMarks} for each wrong answer. Unattempted = 0.`
      : "No negative marking on this test.";

    buildPalette();
    renderQuestion();
    startTimer(new Date(test.endsAt));
  }

  function buildPalette() {
    const pal = $("mt-palette");
    pal.innerHTML = activeTest.questions
      .map(
        (_, i) =>
          `<button type="button" class="mt-palette-btn" data-idx="${i}">${i + 1}</button>`
      )
      .join("");
    pal.querySelectorAll(".mt-palette-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        currentIndex = Number(btn.dataset.idx);
        renderQuestion();
      });
    });
  }

  function updatePalette() {
    $("mt-palette").querySelectorAll(".mt-palette-btn").forEach((btn, i) => {
      btn.classList.remove("answered", "marked", "current");
      const q = activeTest.questions[i];
      if (answers[q.questionId] !== undefined && answers[q.questionId] !== -1) {
        btn.classList.add("answered");
      }
      if (marked.has(q.questionId)) btn.classList.add("marked");
      if (i === currentIndex) btn.classList.add("current");
    });
  }

  function renderQuestion() {
    const q = activeTest.questions[currentIndex];
    $("mt-q-num").textContent = `Question ${currentIndex + 1} of ${activeTest.questions.length}`;
    $("mt-q-text").textContent = q.question;

    const keys = ["A", "B", "C", "D"];
    $("mt-options").innerHTML = q.options
      .map(
        (opt, i) => `
      <div class="mt-option${answers[q.questionId] === i ? " selected" : ""}" data-opt="${i}" role="button" tabindex="0">
        <span class="mt-option-key">${keys[i] || i + 1}</span>
        <span>${escapeHtml(opt)}</span>
      </div>`
      )
      .join("");

    $("mt-options").querySelectorAll(".mt-option").forEach((el) => {
      el.addEventListener("click", () => selectOption(Number(el.dataset.opt)));
    });

    $("mt-prev").disabled = currentIndex === 0;
    $("mt-next").textContent =
      currentIndex === activeTest.questions.length - 1 ? "Save & Finish" : "Save & Next →";
    updatePalette();
  }

  function selectOption(i) {
    const q = activeTest.questions[currentIndex];
    answers[q.questionId] = i;
    renderQuestion();
  }

  function startTimer(endsAt) {
    clearInterval(timerInterval);
    const tick = () => {
      const left = Math.max(0, endsAt - Date.now());
      const h = Math.floor(left / 3600000);
      const m = Math.floor((left % 3600000) / 60000);
      const s = Math.floor((left % 60000) / 1000);
      const el = $("mt-timer");
      el.textContent = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
      el.classList.toggle("danger", left < 300000);
      if (left <= 0) {
        clearInterval(timerInterval);
        submitExam(true);
      }
    };
    tick();
    timerInterval = setInterval(tick, 1000);
  }

  async function submitExam(auto) {
    if (!auto && !confirm("Submit test? You cannot change answers after submission.")) return;

    clearInterval(timerInterval);
    const answerList = activeTest.questions.map((q) => ({
      questionId: q.questionId,
      chosen: answers[q.questionId] !== undefined ? answers[q.questionId] : -1
    }));
    const timeTaken = Math.round((Date.now() - testStartedAt) / 1000);

    try {
      const data = await window.ShardaAuth.apiFetch("/api/submit-test", {
        method: "POST",
        body: JSON.stringify({
          testId: activeTest.testId,
          answers: answerList,
          timeTakenSeconds: timeTaken
        })
      });
      closeExam();
      showResult(data.result);
      loadResults();
    } catch (err) {
      alert(err.message);
    }
  }

  function closeExam() {
    $("mt-exam").classList.remove("active");
    $("main-header").style.display = "";
    $("mt-hub").style.display = "";
  }

  function showResult(r) {
    $("mt-result-view").style.display = "flex";
    $("mt-result-content").innerHTML = `
      <div class="mt-scorecard">
        <div class="mt-score-ring">${r.percentScore}%</div>
        <h2 style="text-align:center;margin:0 0 8px">${escapeHtml(r.title)}</h2>
        <p style="text-align:center;color:var(--mt-muted);margin:0">Score: ${r.score} / ${r.maxScore} · Accuracy: ${r.accuracy}%</p>
        <div class="mt-stats-row" style="margin-top:20px">
          <div class="mt-stat"><strong>${r.correct}</strong><span>Correct</span></div>
          <div class="mt-stat"><strong>${r.wrong}</strong><span>Wrong</span></div>
          <div class="mt-stat"><strong>${r.unattempted}</strong><span>Skipped</span></div>
          <div class="mt-stat"><strong>${r.timeTakenSeconds || "—"}s</strong><span>Time taken</span></div>
        </div>
      </div>
      <h3>Question-wise review</h3>
      ${(r.breakdown || [])
        .map(
          (b, i) => `
        <div class="mt-review-item ${b.isCorrect ? "correct" : b.attempted ? "wrong" : ""}">
          <strong>Q${i + 1}.</strong> ${escapeHtml(b.question)}<br/>
          <span style="font-size:0.85rem;color:var(--mt-muted)">
            Your answer: ${b.attempted ? escapeHtml(b.options[b.chosen]) : "Not attempted"} ·
            Correct: ${escapeHtml(b.options[b.correct])} ·
            Marks: ${b.marksAwarded >= 0 ? "+" : ""}${b.marksAwarded}
          </span>
          ${b.explanation ? `<p style="font-size:0.88rem;margin:8px 0 0">${escapeHtml(b.explanation)}</p>` : ""}
        </div>`
        )
        .join("")}`;
  }

  async function loadResults() {
    if (!window.ShardaAuth?.isLoggedIn()) return;
    try {
      const data = await window.ShardaAuth.apiFetch("/api/results");
      const s = data.summary || {};
      $("mt-results-stats").innerHTML = `
        <div class="mt-stat"><strong>${s.totalAttempts || 0}</strong><span>Attempts</span></div>
        <div class="mt-stat"><strong>${s.avgScore || 0}%</strong><span>Avg score</span></div>
        <div class="mt-stat"><strong>${s.bestScore || 0}%</strong><span>Best score</span></div>
        <div class="mt-stat"><strong>${s.avgAccuracy || 0}%</strong><span>Avg accuracy</span></div>`;

      $("mt-results-body").innerHTML = (data.results || []).length
        ? data.results
            .map(
              (r) => `
          <tr>
            <td>${escapeHtml(r.title)}<br/><small>${escapeHtml(r.examId)} · ${escapeHtml(r.type)}</small></td>
            <td><strong>${r.score}</strong>/${r.maxScore} (${r.percentScore}%)</td>
            <td>${r.accuracy}%</td>
            <td>${new Date(r.submittedAt).toLocaleDateString()}</td>
            <td><button type="button" class="mt-btn-outline mt-btn" data-view-result="${escapeHtml(r.id)}">Review</button></td>
          </tr>`
            )
            .join("")
        : `<tr><td colspan="5">No attempts yet. Start a mock test!</td></tr>`;

      document.querySelectorAll("[data-view-result]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const detail = await window.ShardaAuth.apiFetch(
            `/api/results/${btn.dataset.viewResult}`
          );
          showResult(detail.result);
        });
      });
    } catch (_) {}
  }

  async function loadBankList() {
    try {
      const data = await fetch("/api/question-bank?pageSize=15").then((r) => r.json());
      $("mt-bank-list").innerHTML = `
        <p class="mt-card-meta">${data.total} questions in bank (showing ${data.questions.length})</p>
        <table class="mt-result-table">
          <thead><tr><th>ID</th><th>Exam</th><th>Chapter</th><th>Question</th></tr></thead>
          <tbody>
            ${data.questions
              .map(
                (q) => `<tr>
              <td><small>${escapeHtml(q.id)}</small></td>
              <td>${escapeHtml(q.examId)}</td>
              <td>${escapeHtml(q.chapterName)}</td>
              <td>${escapeHtml(q.question.slice(0, 80))}…</td>
            </tr>`
              )
              .join("")}
          </tbody>
        </table>`;
    } catch (err) {
      $("mt-bank-list").textContent = err.message;
    }
  }

  function populateBankForm() {
    if (!catalog) return;
    const sel = $("mt-q-exam");
    sel.innerHTML = (catalog.exams || [])
      .map((e) => `<option value="${escapeHtml(e.id)}">${escapeHtml(e.name)}</option>`)
      .join("");
  }

  function bindTabs() {
    document.querySelectorAll(".mt-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        document.querySelectorAll(".mt-tab").forEach((t) => t.classList.remove("active"));
        document.querySelectorAll(".mt-panel").forEach((p) => p.classList.remove("active"));
        tab.classList.add("active");
        $("mt-panel-" + tab.dataset.panel).classList.add("active");
        if (tab.dataset.panel === "results") loadResults();
        if (tab.dataset.panel === "bank") loadBankList();
      });
    });
  }

  function initApp() {
    if (window.ShardaAuth?.isLoggedIn()) {
      $("mt-guest").hidden = true;
      $("mt-app").hidden = false;
      $("mt-add-question-form").hidden = false;
      loadCatalog();
      loadResults();
    } else {
      $("mt-guest").hidden = false;
      $("mt-app").hidden = true;
      fetch("/api/exam-catalog")
        .then((r) => r.json())
        .then((c) => {
          catalog = c;
          renderCatalog();
          $("mt-guest").hidden = false;
          $("mt-app").hidden = false;
          $("mt-panel-results").classList.remove("active");
          $("mt-panel-catalog").classList.add("active");
        })
        .catch(() => {});
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    initTheme();
    bindTabs();

    $("mt-theme-btn").addEventListener("click", toggleTheme);
    $("mt-next").addEventListener("click", () => {
      if (currentIndex < activeTest.questions.length - 1) {
        currentIndex += 1;
        renderQuestion();
      } else submitExam(false);
    });
    $("mt-prev").addEventListener("click", () => {
      if (currentIndex > 0) {
        currentIndex -= 1;
        renderQuestion();
      }
    });
    $("mt-mark-review").addEventListener("click", () => {
      marked.add(activeTest.questions[currentIndex].questionId);
      updatePalette();
    });
    $("mt-submit-exam").addEventListener("click", () => submitExam(false));
    $("mt-close-result").addEventListener("click", () => {
      $("mt-result-view").style.display = "none";
    });

    $("mt-q-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!window.ShardaAuth?.isLoggedIn()) return alert("Sign in to add questions");
      const options = $("mt-q-options")
        .value.split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      try {
        await window.ShardaAuth.apiFetch("/api/question-bank", {
          method: "POST",
          body: JSON.stringify({
            examId: $("mt-q-exam").value,
            chapterId: $("mt-q-chapter").value.trim(),
            question: $("mt-q-text").value.trim(),
            options,
            correct: Number($("mt-q-correct").value),
            marks: Number($("mt-q-marks").value),
            negativeMarks: Number($("mt-q-neg").value),
            explanation: $("mt-q-exp").value.trim()
          })
        });
        alert("Question added.");
        $("mt-q-form").reset();
        loadBankList();
      } catch (err) {
        alert(err.message);
      }
    });

    setTimeout(initApp, 80);
  });
})();
