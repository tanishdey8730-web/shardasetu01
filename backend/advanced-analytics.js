const fs = require("fs");
const path = require("path");
const analytics = require("./analytics");
const dashboard = require("./dashboard");

const USERS_FILE = path.join(__dirname, "data", "users.json");
const RESULTS_FILE = path.join(__dirname, "data", "test-results.json");
const QUIZ_FILE = path.join(__dirname, "data", "quiz-scores.json");

const SUBJECT_LABELS = {
  maths: "Mathematics",
  math: "Mathematics",
  quant: "Quantitative Aptitude",
  physics: "Physics",
  chemistry: "Chemistry",
  reasoning: "Reasoning",
  gs: "General Studies",
  english: "English",
  general: "General"
};

function toDateStr(d) {
  return new Date(d).toISOString().slice(0, 10);
}

function parseRange(range) {
  const map = { "7d": 7, "30d": 30, "90d": 90, all: 3650 };
  return map[range] || 30;
}

function inRange(isoDate, days) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return new Date(isoDate) >= cutoff;
}

function weekKey(iso) {
  const d = new Date(iso);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function subjectLabel(id) {
  if (!id) return "General";
  const k = String(id).toLowerCase();
  return SUBJECT_LABELS[k] || id.charAt(0).toUpperCase() + id.slice(1);
}

function buildDailyStudyHours(events, days) {
  const map = new Map();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    map.set(toDateStr(d), 0);
  }
  for (const e of events) {
    if (!inRange(e.at, days)) continue;
    const key = toDateStr(e.at);
    if (map.has(key)) {
      map.set(key, Math.round((map.get(key) + (e.minutes || 10) / 60) * 100) / 100);
    }
  }
  return [...map.entries()].map(([date, hours]) => ({
    date,
    label: new Date(date).toLocaleDateString("en-IN", { weekday: "short", day: "numeric" }),
    hours
  }));
}

function buildWeeklyProgress(results, events, days) {
  const weekMap = new Map();

  for (const e of events) {
    if (!inRange(e.at, days)) continue;
    const wk = weekKey(e.at);
    if (!weekMap.has(wk)) {
      weekMap.set(wk, { week: wk, hours: 0, tests: 0, scoreSum: 0, scoreCount: 0 });
    }
    const row = weekMap.get(wk);
    row.hours += (e.minutes || 10) / 60;
  }

  for (const r of results) {
    if (!inRange(r.submittedAt, days)) continue;
    const wk = weekKey(r.submittedAt);
    if (!weekMap.has(wk)) {
      weekMap.set(wk, { week: wk, hours: 0, tests: 0, scoreSum: 0, scoreCount: 0 });
    }
    const row = weekMap.get(wk);
    row.tests += 1;
    row.scoreSum += r.percentScore;
    row.scoreCount += 1;
  }

  return [...weekMap.values()]
    .sort((a, b) => a.week.localeCompare(b.week))
    .map((r) => ({
      week: r.week,
      label: r.week.replace("-W", " W"),
      hours: Math.round(r.hours * 10) / 10,
      tests: r.tests,
      avgScore: r.scoreCount ? Math.round((r.scoreSum / r.scoreCount) * 10) / 10 : 0
    }));
}

function buildSubjectPerformance(topics, subjectFilter) {
  const bySubject = new Map();
  for (const t of topics) {
    const sid = (t.subjectId || "general").toLowerCase();
    if (subjectFilter && sid !== subjectFilter.toLowerCase()) continue;
    if (!bySubject.has(sid)) {
      bySubject.set(sid, {
        subjectId: sid,
        subject: subjectLabel(sid),
        correct: 0,
        wrong: 0,
        topics: 0
      });
    }
    const s = bySubject.get(sid);
    s.correct += t.correct;
    s.wrong += t.wrong;
    s.topics += 1;
  }

  return [...bySubject.values()]
    .map((s) => {
      const total = s.correct + s.wrong;
      return {
        subject: s.subject,
        subjectId: s.subjectId,
        accuracy: total ? Math.round((s.correct / total) * 1000) / 10 : 0,
        attempted: total,
        topics: s.topics
      };
    })
    .sort((a, b) => b.accuracy - a.accuracy);
}

function buildReadinessChart(results, readiness) {
  const history = [...results]
    .sort((a, b) => new Date(a.submittedAt) - new Date(b.submittedAt))
    .map((r, i) => {
      const slice = results.slice(0, i + 1);
      const avg =
        slice.reduce((s, x) => s + x.percentScore, 0) / slice.length;
      return {
        date: r.submittedAt.slice(0, 10),
        label: new Date(r.submittedAt).toLocaleDateString("en-IN", {
          month: "short",
          day: "numeric"
        }),
        readiness: Math.min(100, Math.round(avg * 0.85 + (i + 1) * 2)),
        score: r.percentScore
      };
    });

  if (!history.length && readiness) {
    history.push({
      date: toDateStr(new Date()),
      label: "Now",
      readiness: readiness.readinessScore,
      score: 0
    });
  } else if (history.length) {
    history[history.length - 1].readiness = readiness?.readinessScore ?? history[history.length - 1].readiness;
  }

  return {
    history,
    current: readiness
      ? {
          score: readiness.readinessScore,
          probability: readiness.successProbability,
          level: readiness.level,
          label: readiness.label,
          components: readiness.components || {}
        }
      : null
  };
}

function buildPersonalGrowth(events, results, days) {
  const map = new Map();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    map.set(toDateStr(d), { date: toDateStr(d), activities: 0, tests: 0 });
  }
  for (const e of events) {
    if (!inRange(e.at, days)) continue;
    const key = toDateStr(e.at);
    if (map.has(key)) map.get(key).activities += 1;
  }
  for (const r of results) {
    if (!inRange(r.submittedAt, days)) continue;
    const key = toDateStr(r.submittedAt);
    if (map.has(key)) map.get(key).tests += 1;
  }
  let cumulative = 0;
  return [...map.values()].map((row) => {
    cumulative += row.activities + row.tests;
    return {
      date: row.date,
      label: new Date(row.date).toLocaleDateString("en-IN", { month: "short", day: "numeric" }),
      activities: row.activities,
      tests: row.tests,
      cumulative
    };
  });
}

function getAdvancedAnalytics(userId, requesterId, options = {}) {
  if (userId !== requesterId) {
    return { error: "You can only view your own analytics", status: 403 };
  }

  const range = options.range || "30d";
  const days = parseRange(range);
  const examId = options.examId || null;
  const subjectId = options.subjectId || null;

  const base = analytics.getAnalytics(userId, userId, { examId });
  if (base.error) return base;

  const events = dashboard.collectActivityEvents(userId);
  const store = JSON.parse(fs.readFileSync(RESULTS_FILE, "utf8"));
  let results = store.results.filter((r) => r.userId === userId);
  if (examId) {
    results = results.filter(
      (r) => r.examId === examId || (examId.startsWith("ssc") && r.examId?.startsWith("ssc"))
    );
  }
  results = results.filter((r) => inRange(r.submittedAt, days));

  const filteredEvents = events.filter((e) => inRange(e.at, days));

  return {
    filters: { range, examId, subjectId, days },
    summary: {
      ...base.summary,
      readinessScore: base.readiness.readinessScore,
      successProbability: base.readiness.successProbability,
      totalStudyHours: Math.round(
        (filteredEvents.reduce((s, e) => s + (e.minutes || 0), 0) / 60) * 10
      ) / 10
    },
    dailyStudyHours: buildDailyStudyHours(events, days),
    weeklyProgress: buildWeeklyProgress(results, events, days),
    subjectPerformance: buildSubjectPerformance(base.topics, subjectId),
    personalGrowth: buildPersonalGrowth(events, results, days),
    examReadiness: buildReadinessChart(results, base.readiness),
    weakTopics: base.weakTopics.slice(0, 6),
    strongTopics: base.strongTopics.slice(0, 6),
    recommendations: base.recommendations.slice(0, 5)
  };
}

function getPlatformAnalytics(requesterRole, options = {}) {
  if (requesterRole !== "admin") {
    return { error: "Admin access required", status: 403 };
  }

  const days = parseRange(options.range || "30d");
  const users = JSON.parse(fs.readFileSync(USERS_FILE, "utf8")).users;
  const results = loadJson(RESULTS_FILE, { results: [] }).results;
  const quizzes = loadJson(QUIZ_FILE, { scores: [] }).scores;

  const signupsByDay = new Map();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    signupsByDay.set(toDateStr(d), 0);
  }
  for (const u of users) {
    const key = toDateStr(u.createdAt);
    if (signupsByDay.has(key)) signupsByDay.set(key, signupsByDay.get(key) + 1);
  }

  const userGrowth = [...signupsByDay.entries()].map(([date, signups]) => ({
    date,
    label: new Date(date).toLocaleDateString("en-IN", { month: "short", day: "numeric" }),
    signups,
    totalUsers: users.filter((u) => new Date(u.createdAt) <= new Date(date + "T23:59:59")).length
  }));

  const activityByDay = new Map();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    activityByDay.set(toDateStr(d), { tests: 0, quizzes: 0 });
  }
  for (const r of results) {
    if (!inRange(r.submittedAt, days)) continue;
    const k = toDateStr(r.submittedAt);
    if (activityByDay.has(k)) activityByDay.get(k).tests += 1;
  }
  for (const q of quizzes) {
    if (!inRange(q.at, days)) continue;
    const k = toDateStr(q.at);
    if (activityByDay.has(k)) activityByDay.get(k).quizzes += 1;
  }

  return {
    filters: { range: options.range || "30d", days },
    totals: {
      users: users.length,
      students: users.filter((u) => u.role === "student").length,
      teachers: users.filter((u) => u.role === "teacher").length,
      mockTests: results.length,
      quizzes: quizzes.length
    },
    userGrowth,
    platformActivity: [...activityByDay.entries()].map(([date, v]) => ({
      date,
      label: new Date(date).toLocaleDateString("en-IN", { weekday: "short", day: "numeric" }),
      tests: v.tests,
      quizzes: v.quizzes,
      total: v.tests + v.quizzes
    }))
  };
}

function loadJson(file, fb) {
  if (!fs.existsSync(file)) return fb;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

module.exports = {
  getAdvancedAnalytics,
  getPlatformAnalytics
};
