const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const BANK_FILE = path.join(__dirname, "data", "question-bank.json");
const SESSIONS_FILE = path.join(__dirname, "data", "test-sessions.json");
const RESULTS_FILE = path.join(__dirname, "data", "test-results.json");

const GRACE_SECONDS = 90;
const MAX_QUESTIONS_MOCK = 100;
const MAX_QUESTIONS_CHAPTER = 30;

function newId() {
  return crypto.randomBytes(12).toString("hex");
}

function loadBank() {
  if (!fs.existsSync(BANK_FILE)) {
    throw new Error("Question bank missing. Run: node backend/build-question-bank.js");
  }
  return JSON.parse(fs.readFileSync(BANK_FILE, "utf8"));
}

function loadSessions() {
  if (!fs.existsSync(SESSIONS_FILE)) {
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify({ sessions: [] }, null, 2));
  }
  return JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf8"));
}

function saveSessions(store) {
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(store, null, 2));
}

function loadResults() {
  if (!fs.existsSync(RESULTS_FILE)) {
    fs.writeFileSync(RESULTS_FILE, JSON.stringify({ results: [] }, null, 2));
  }
  return JSON.parse(fs.readFileSync(RESULTS_FILE, "utf8"));
}

function saveResults(store) {
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(store, null, 2));
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function examMatches(questionExamId, targetExamId) {
  if (questionExamId === targetExamId) return true;
  if (targetExamId === "ssc-cgl" && questionExamId === "ssc") return true;
  if (targetExamId.startsWith("ssc") && questionExamId === "ssc") return true;
  return false;
}

function filterQuestions(bank, { examId, type, chapterId, pyqYear, limit }) {
  let pool = bank.questions.filter((q) => examMatches(q.examId, examId));

  if (type === "pyq") {
    pool = pool.filter((q) => q.types.includes("pyq"));
    if (pyqYear) pool = pool.filter((q) => q.pyqYear === Number(pyqYear));
  } else if (type === "chapter") {
    pool = pool.filter((q) => q.types.includes("chapter"));
    if (chapterId) {
      const byChapter = pool.filter((q) => q.chapterId === chapterId);
      if (byChapter.length >= 5) {
        pool = byChapter;
      } else {
        const ch = bank.chapters.find((c) => c.id === chapterId);
        const subjectPool = ch
          ? pool.filter((q) => q.subjectId === ch.subjectId)
          : pool;
        pool = [...byChapter, ...subjectPool.filter((q) => !byChapter.includes(q))];
      }
    }
  } else if (type === "mock") {
    pool = pool.filter((q) => q.types.includes("mock") || q.types.includes("chapter"));
  }

  pool = shuffle(pool);
  const cap = limit || pool.length;
  return pool.slice(0, Math.min(cap, pool.length));
}

function publicQuestion(q, index) {
  return {
    questionId: q.id,
    index: index + 1,
    question: q.question,
    options: q.options,
    marks: q.marks,
    negativeMarks: q.negativeMarks,
    chapterId: q.chapterId,
    chapterName: q.chapterName,
    subjectId: q.subjectId,
    pyqYear: q.pyqYear,
    pyqPaper: q.pyqPaper
  };
}

function getCatalog() {
  const bank = loadBank();
  const chapterTests = bank.chapters.map((ch) => {
    const byChapter = bank.questions.filter(
      (q) => q.chapterId === ch.id && examMatches(q.examId, ch.examId)
    );
    const bySubject = bank.questions.filter(
      (q) => q.subjectId === ch.subjectId && examMatches(q.examId, ch.examId)
    );
    const count = Math.max(byChapter.length, bySubject.length);
    const exam = bank.exams.find((e) => e.id === ch.examId);
    return {
      id: `chapter-${ch.id}`,
      type: "chapter",
      title: `${ch.name} — Chapter Test`,
      examId: ch.examId,
      examName: exam?.name || ch.examId,
      chapterId: ch.id,
      chapterName: ch.name,
      questionCount: Math.min(15, count),
      durationMinutes: 20,
      negativeMarks: exam?.negativeMarks ?? 0.5,
      marksPerQuestion: exam?.marksPerQuestion ?? 2,
      availableQuestions: count
    };
  });

  const pyqYears = [
    ...new Set(
      bank.questions.filter((q) => q.pyqYear).map((q) => q.pyqYear)
    )
  ].sort((a, b) => b - a);

  const pyqTests = pyqYears.map((year) => ({
    id: `pyq-${year}`,
    type: "pyq",
    title: `Previous Year Questions — ${year}`,
    pyqYear: year,
    questionCount: 15,
    durationMinutes: 25,
    examIds: bank.exams.map((e) => e.id)
  }));

  return {
    exams: bank.exams,
    chapters: bank.chapters,
    chapterTests: chapterTests.filter((t) => t.availableQuestions >= 5),
    mockTests: bank.mockTemplates,
    pyqTests,
    totalQuestions: bank.questions.length
  };
}

function listQuestionBank(filters = {}) {
  const bank = loadBank();
  let pool = bank.questions;
  if (filters.examId) pool = pool.filter((q) => examMatches(q.examId, filters.examId));
  if (filters.chapterId) pool = pool.filter((q) => q.chapterId === filters.chapterId);
  if (filters.type === "pyq") pool = pool.filter((q) => q.types.includes("pyq"));
  if (filters.pyqYear) pool = pool.filter((q) => q.pyqYear === Number(filters.pyqYear));

  const page = Math.max(1, Number(filters.page) || 1);
  const pageSize = Math.min(50, Math.max(10, Number(filters.pageSize) || 20));
  const start = (page - 1) * pageSize;

  return {
    total: pool.length,
    page,
    pageSize,
    questions: pool.slice(start, start + pageSize).map((q) => ({
      id: q.id,
      examId: q.examId,
      chapterId: q.chapterId,
      chapterName: q.chapterName,
      types: q.types,
      pyqYear: q.pyqYear,
      question: q.question,
      options: q.options,
      marks: q.marks,
      negativeMarks: q.negativeMarks
    }))
  };
}

function addQuestion(payload) {
  const bank = loadBank();
  const required = ["examId", "chapterId", "question", "options", "correct"];
  for (const k of required) {
    if (payload[k] === undefined) return { error: `${k} is required`, status: 400 };
  }
  if (!Array.isArray(payload.options) || payload.options.length < 2) {
    return { error: "options must have at least 2 items", status: 400 };
  }

  const ch = bank.chapters.find((c) => c.id === payload.chapterId);
  const exam = bank.exams.find((e) => e.id === payload.examId) || bank.exams[0];

  const q = {
    id: payload.id || `qb-custom-${newId()}`,
    examId: payload.examId,
    subjectId: ch?.subjectId || payload.subjectId || "general",
    chapterId: payload.chapterId,
    chapterName: ch?.name || payload.chapterName || "General",
    types: payload.types || ["chapter", "mock"],
    pyqYear: payload.pyqYear || null,
    pyqPaper: payload.pyqPaper || null,
    question: String(payload.question).trim(),
    options: payload.options.map(String),
    correct: Number(payload.correct),
    marks: Number(payload.marks) || exam.marksPerQuestion,
    negativeMarks: Number(payload.negativeMarks ?? exam.negativeMarks),
    explanation: payload.explanation || ""
  };

  bank.questions.push(q);
  fs.writeFileSync(BANK_FILE, JSON.stringify(bank, null, 2));
  return { question: q, status: 201 };
}

function createTest({ userId, examId, type, chapterId, pyqYear, templateId, questionCount, durationMinutes }) {
  if (!userId) return { error: "Sign in required to start a test", status: 401 };
  if (!examId && type !== "pyq") {
    return { error: "examId is required", status: 400 };
  }

  const bank = loadBank();
  const testType = type || "chapter";
  let template = null;
  let count = Number(questionCount) || 15;
  let duration = Number(durationMinutes) || 30;
  let negativeMarks = 0.5;
  let marksPerQuestion = 2;
  let title = "Practice Test";
  let targetExamId = examId;

  if (templateId) {
    template = bank.mockTemplates.find((t) => t.id === templateId);
    if (!template) return { error: "Mock template not found", status: 404 };
    targetExamId = template.examId;
    count = template.questionCount;
    duration = template.durationMinutes;
    negativeMarks = template.negativeMarks;
    marksPerQuestion = template.marksPerQuestion;
    title = template.title;
  } else if (testType === "mock") {
    count = Math.min(MAX_QUESTIONS_MOCK, count || 25);
    duration = duration || 60;
    const exam = bank.exams.find((e) => e.id === examId) || bank.exams[0];
    negativeMarks = exam.negativeMarks;
    marksPerQuestion = exam.marksPerQuestion;
    title = `${exam.name} Mock Test`;
  } else if (testType === "chapter") {
    count = Math.min(MAX_QUESTIONS_CHAPTER, count || 15);
    duration = duration || 20;
    const ch = bank.chapters.find((c) => c.id === chapterId);
    if (!ch) return { error: "chapterId is required for chapter tests", status: 400 };
    const exam = bank.exams.find((e) => e.id === ch.examId);
    negativeMarks = exam?.negativeMarks ?? 0.5;
    marksPerQuestion = exam?.marksPerQuestion ?? 2;
    title = `${ch.name} — Chapter Test`;
    targetExamId = examId || ch.examId;
  } else if (testType === "pyq") {
    count = count || 15;
    duration = duration || 25;
    title = pyqYear ? `PYQ ${pyqYear}` : "Previous Year Questions";
    targetExamId = examId || "ssc-cgl";
  }

  const selected = filterQuestions(bank, {
    examId: targetExamId,
    type: testType,
    chapterId,
    pyqYear,
    limit: count
  });

  if (selected.length < 5) {
    return { error: "Not enough questions in bank for this test. Try another chapter or exam.", status: 400 };
  }

  const startedAt = new Date();
  const endsAt = new Date(startedAt.getTime() + duration * 60 * 1000);

  const session = {
    id: newId(),
    userId,
    examId: targetExamId,
    type: testType,
    chapterId: chapterId || null,
    pyqYear: pyqYear ? Number(pyqYear) : null,
    templateId: templateId || null,
    title,
    durationMinutes: duration,
    marksPerQuestion,
    negativeMarks,
    questionIds: selected.map((q) => q.id),
    startedAt: startedAt.toISOString(),
    endsAt: endsAt.toISOString(),
    submitted: false,
    createdAt: startedAt.toISOString()
  };

  const store = loadSessions();
  store.sessions = store.sessions.filter(
    (s) => !(s.userId === userId && !s.submitted)
  );
  store.sessions.push(session);
  saveSessions(store);

  return {
    test: {
      testId: session.id,
      title: session.title,
      examId: session.examId,
      type: session.type,
      durationMinutes: session.durationMinutes,
      totalQuestions: selected.length,
      marksPerQuestion: session.marksPerQuestion,
      negativeMarks: session.negativeMarks,
      negativeMarkingEnabled: session.negativeMarks > 0,
      startedAt: session.startedAt,
      endsAt: session.endsAt,
      questions: selected.map((q, i) => publicQuestion(q, i))
    },
    status: 201
  };
}

function getSession(testId, userId) {
  const store = loadSessions();
  const session = store.sessions.find((s) => s.id === testId);
  if (!session) return { error: "Test session not found", status: 404 };
  if (session.userId !== userId) return { error: "Access denied", status: 403 };
  if (session.submitted) return { error: "Test already submitted", status: 400 };

  const bank = loadBank();
  const questions = session.questionIds
    .map((id) => bank.questions.find((q) => q.id === id))
    .filter(Boolean);

  return {
    test: {
      testId: session.id,
      title: session.title,
      examId: session.examId,
      type: session.type,
      durationMinutes: session.durationMinutes,
      totalQuestions: questions.length,
      marksPerQuestion: session.marksPerQuestion,
      negativeMarks: session.negativeMarks,
      negativeMarkingEnabled: session.negativeMarks > 0,
      startedAt: session.startedAt,
      endsAt: session.endsAt,
      questions: questions.map((q, i) => publicQuestion(q, i))
    }
  };
}

function evaluateSession(session, answers, bank) {
  const answerMap = new Map();
  for (const a of answers || []) {
    if (a.questionId != null) answerMap.set(a.questionId, a.chosen);
  }

  let correct = 0;
  let wrong = 0;
  let unattempted = 0;
  let score = 0;
  let maxScore = 0;
  const breakdown = [];

  for (const qid of session.questionIds) {
    const q = bank.questions.find((x) => x.id === qid);
    if (!q) continue;
    maxScore += q.marks;
    const chosen = answerMap.has(qid) ? answerMap.get(qid) : null;
    const attempted = chosen !== null && chosen !== undefined && chosen !== -1;

    let isCorrect = false;
    if (attempted) {
      isCorrect = chosen === q.correct;
      if (isCorrect) {
        correct += 1;
        score += q.marks;
      } else {
        wrong += 1;
        score -= session.negativeMarks;
      }
    } else {
      unattempted += 1;
    }

    breakdown.push({
      questionId: q.id,
      question: q.question,
      options: q.options,
      chosen: attempted ? chosen : -1,
      correct: q.correct,
      isCorrect: attempted && isCorrect,
      attempted,
      marksAwarded: attempted ? (isCorrect ? q.marks : -session.negativeMarks) : 0,
      explanation: q.explanation,
      chapterId: q.chapterId,
      chapterName: q.chapterName,
      subjectId: q.subjectId
    });
  }

  score = Math.max(0, Math.round(score * 100) / 100);
  const total = session.questionIds.length;
  const accuracy = total ? Math.round((correct / total) * 1000) / 10 : 0;
  const percentScore = maxScore ? Math.round((score / maxScore) * 1000) / 10 : 0;

  return {
    correct,
    wrong,
    unattempted,
    total,
    score,
    maxScore,
    accuracy,
    percentScore,
    breakdown
  };
}

function submitTest({ testId, userId, answers, timeTakenSeconds }) {
  if (!userId) return { error: "Sign in required", status: 401 };

  const store = loadSessions();
  const session = store.sessions.find((s) => s.id === testId);
  if (!session) return { error: "Test session not found", status: 404 };
  if (session.userId !== userId) return { error: "Access denied", status: 403 };
  if (session.submitted) return { error: "Test already submitted", status: 400 };

  const now = Date.now();
  const endMs = new Date(session.endsAt).getTime() + GRACE_SECONDS * 1000;
  if (now > endMs) {
    return { error: "Time expired. Test auto-closed.", status: 400 };
  }

  const bank = loadBank();
  const evalResult = evaluateSession(session, answers, bank);

  session.submitted = true;
  session.submittedAt = new Date().toISOString();
  saveSessions(store);

  const result = {
    id: newId(),
    testId: session.id,
    userId,
    examId: session.examId,
    type: session.type,
    title: session.title,
    chapterId: session.chapterId,
    pyqYear: session.pyqYear,
    durationMinutes: session.durationMinutes,
    timeTakenSeconds: Number(timeTakenSeconds) || null,
    negativeMarks: session.negativeMarks,
    marksPerQuestion: session.marksPerQuestion,
    ...evalResult,
    submittedAt: session.submittedAt
  };

  const rStore = loadResults();
  rStore.results.unshift(result);
  if (rStore.results.length > 2000) rStore.results = rStore.results.slice(0, 2000);
  saveResults(rStore);

  return { result, status: 200 };
}

function getResults(userId, requesterId, filters = {}) {
  if (userId !== requesterId) {
    return { error: "You can only view your own results", status: 403 };
  }

  const store = loadResults();
  let list = store.results.filter((r) => r.userId === userId);
  if (filters.examId) list = list.filter((r) => r.examId === filters.examId);
  if (filters.type) list = list.filter((r) => r.type === filters.type);

  const summary = {
    totalAttempts: list.length,
    avgScore: list.length
      ? Math.round((list.reduce((s, r) => s + r.percentScore, 0) / list.length) * 10) / 10
      : 0,
    avgAccuracy: list.length
      ? Math.round((list.reduce((s, r) => s + r.accuracy, 0) / list.length) * 10) / 10
      : 0,
    bestScore: list.length ? Math.max(...list.map((r) => r.percentScore)) : 0
  };

  const limit = Math.min(50, Number(filters.limit) || 20);
  return {
    summary,
    results: list.slice(0, limit).map((r) => ({
      id: r.id,
      testId: r.testId,
      title: r.title,
      examId: r.examId,
      type: r.type,
      score: r.score,
      maxScore: r.maxScore,
      percentScore: r.percentScore,
      accuracy: r.accuracy,
      correct: r.correct,
      wrong: r.wrong,
      unattempted: r.unattempted,
      total: r.total,
      submittedAt: r.submittedAt,
      timeTakenSeconds: r.timeTakenSeconds
    }))
  };
}

function getResultDetail(resultId, userId) {
  const store = loadResults();
  const r = store.results.find((x) => x.id === resultId);
  if (!r) return { error: "Result not found", status: 404 };
  if (r.userId !== userId) return { error: "Access denied", status: 403 };
  return { result: r };
}

module.exports = {
  getCatalog,
  listQuestionBank,
  addQuestion,
  createTest,
  getSession,
  submitTest,
  getResults,
  getResultDetail
};
