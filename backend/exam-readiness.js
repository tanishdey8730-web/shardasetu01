const fs = require("fs");
const path = require("path");
const analytics = require("./analytics");

const HISTORY_FILE = path.join(__dirname, "data", "readiness-history.json");
const MAX_HISTORY_PER_USER = 120;

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

const TARGET_ACCURACY = 75;

function subjectLabel(id) {
  if (!id) return "General";
  const k = String(id).toLowerCase();
  return SUBJECT_LABELS[k] || k.charAt(0).toUpperCase() + k.slice(1);
}

function loadHistory() {
  if (!fs.existsSync(HISTORY_FILE)) return { entries: [] };
  return JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
}

function saveHistory(store) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(store, null, 2), "utf8");
}

function filterResults(results, examId) {
  if (!examId) return results;
  return results.filter(
    (r) =>
      r.examId === examId ||
      (examId.startsWith("ssc") && r.examId?.startsWith("ssc"))
  );
}

function aggregateSubjectScores(topics, results) {
  const map = new Map();

  for (const t of topics) {
    const sid = (t.subjectId || "general").toLowerCase();
    if (!map.has(sid)) {
      map.set(sid, {
        subjectId: sid,
        subject: subjectLabel(sid),
        correct: 0,
        wrong: 0,
        skipped: 0,
        topics: 0,
        topicIds: []
      });
    }
    const row = map.get(sid);
    row.correct += t.correct;
    row.wrong += t.wrong;
    row.skipped += t.skipped;
    row.topics += 1;
    row.topicIds.push(t.topicId);
  }

  for (const r of results) {
    if (!r.breakdown) continue;
    for (const b of r.breakdown) {
      const sid = (b.subjectId || "general").toLowerCase();
      if (map.has(sid)) continue;
      map.set(sid, {
        subjectId: sid,
        subject: subjectLabel(sid),
        correct: 0,
        wrong: 0,
        skipped: 0,
        topics: 0,
        topicIds: []
      });
    }
  }

  return [...map.values()]
    .map((s) => {
      const attempted = s.correct + s.wrong;
      const accuracy = attempted
        ? Math.round((s.correct / attempted) * 1000) / 10
        : 0;
      const gap = Math.max(0, TARGET_ACCURACY - accuracy);
      const score = attempted
        ? Math.min(100, Math.round(accuracy * 0.85 + Math.min(attempted, 50) * 0.3))
        : 0;

      let level = "not_started";
      if (attempted >= 3) {
        if (accuracy >= 80) level = "strong";
        else if (accuracy >= 65) level = "good";
        else if (accuracy >= 45) level = "developing";
        else level = "weak";
      } else if (attempted > 0) {
        level = "early";
      }

      return {
        subjectId: s.subjectId,
        subject: s.subject,
        score,
        accuracy,
        gapToTarget: Math.round(gap * 10) / 10,
        attempted,
        topics: s.topics,
        level,
        progressPercent: Math.min(100, Math.round((accuracy / TARGET_ACCURACY) * 100))
      };
    })
    .sort((a, b) => a.accuracy - b.accuracy);
}

function analyzeWeaknesses(topics, subjectScores) {
  const weakTopics = topics
    .filter((t) => t.correct + t.wrong >= 2 && t.accuracy < 65)
    .sort((a, b) => a.accuracy - b.accuracy);

  const weaknesses = weakTopics.map((t) => {
    const attempted = t.correct + t.wrong;
    let severity = "medium";
    if (t.accuracy < 40) severity = "critical";
    else if (t.accuracy < 50) severity = "high";
    else if (t.accuracy < 55) severity = "high";

    const gap = TARGET_ACCURACY - t.accuracy;
    const impact = Math.min(25, Math.round(gap * 0.35 + Math.min(attempted, 20) * 0.4));

    return {
      type: "topic",
      topicId: t.topicId,
      topicName: t.topicName,
      subjectId: t.subjectId,
      subject: subjectLabel(t.subjectId),
      accuracy: t.accuracy,
      attempted,
      severity,
      impactOnReadiness: impact,
      gapToTarget: Math.round(gap * 10) / 10,
      summary: `${t.topicName} is ${t.accuracy}% accurate — ${severity === "critical" ? "urgent" : "needs"} revision.`
    };
  });

  for (const s of subjectScores.filter((x) => x.level === "weak" || x.level === "developing")) {
    if (weakTopics.some((t) => (t.subjectId || "").toLowerCase() === s.subjectId)) continue;
    weaknesses.push({
      type: "subject",
      subjectId: s.subjectId,
      subject: s.subject,
      topicName: s.subject,
      accuracy: s.accuracy,
      attempted: s.attempted,
      severity: s.accuracy < 45 ? "critical" : "high",
      impactOnReadiness: Math.min(20, Math.round(s.gapToTarget * 0.25)),
      gapToTarget: s.gapToTarget,
      summary: `${s.subject} overall at ${s.accuracy}% — below exam target.`
    });
  }

  return weaknesses
    .sort((a, b) => {
      const sev = { critical: 0, high: 1, medium: 2 };
      return (sev[a.severity] ?? 3) - (sev[b.severity] ?? 3) || b.impactOnReadiness - a.impactOnReadiness;
    })
    .slice(0, 12);
}

function buildRecommendationEngine(ctx) {
  const {
    readiness,
    weaknesses,
    subjectScores,
    results,
    examId,
    roadmap,
    historyDelta
  } = ctx;
  const recs = [];

  if (!results.length) {
    return [
      {
        id: "start-mock",
        priority: 1,
        category: "practice",
        title: "Take your first mock test",
        detail: "Complete a timed mock to unlock readiness scoring, subject breakdowns, and history tracking.",
        action: "mock-tests.html",
        impact: "high",
        estimatedGain: 15
      }
    ];
  }

  for (const w of weaknesses.filter((x) => x.severity === "critical" || x.severity === "high").slice(0, 3)) {
    recs.push({
      id: `weak-${w.topicId || w.subjectId}`,
      priority: w.severity === "critical" ? 1 : 2,
      category: "weakness",
      title: w.type === "topic" ? `Revise ${w.topicName}` : `Strengthen ${w.subject}`,
      detail: w.summary + ` Target +${w.impactOnReadiness} readiness points with focused practice.`,
      action: "mock-tests.html",
      impact: w.severity === "critical" ? "high" : "medium",
      estimatedGain: w.impactOnReadiness,
      subjectId: w.subjectId,
      topicId: w.topicId
    });
  }

  const weakestSubject = subjectScores.find((s) => s.level === "weak" || s.level === "developing");
  if (weakestSubject && !recs.some((r) => r.subjectId === weakestSubject.subjectId)) {
    recs.push({
      id: `subject-${weakestSubject.subjectId}`,
      priority: 2,
      category: "subject",
      title: `Focus on ${weakestSubject.subject}`,
      detail: `Subject score ${weakestSubject.score}/100 (${weakestSubject.accuracy}% accuracy). Watch lessons then attempt chapter tests.`,
      action: "online-education.html",
      impact: "medium",
      estimatedGain: Math.round(weakestSubject.gapToTarget * 0.2),
      subjectId: weakestSubject.subjectId
    });
  }

  if (readiness.components?.mockAverage < 60 && results.some((r) => r.type === "mock")) {
    recs.push({
      id: "mock-strategy",
      priority: 2,
      category: "strategy",
      title: "Improve mock test strategy",
      detail: `Mock average ${readiness.components.mockAverage}%. Practice sectional tests and time management before the next full mock.`,
      action: "mock-tests.html",
      impact: "high",
      estimatedGain: 8
    });
  }

  if (readiness.components?.trend < 45 && results.length >= 4) {
    recs.push({
      id: "trend-recovery",
      priority: 2,
      category: "trend",
      title: "Reverse declining scores",
      detail: "Recent tests trend downward. Review last 3 mock analyses and redo weak chapters.",
      action: "performance-analytics.html",
      impact: "medium",
      estimatedGain: 6
    });
  }

  if (roadmap?.stats?.overdueCount > 0) {
    recs.push({
      id: "roadmap-catchup",
      priority: 3,
      category: "roadmap",
      title: "Catch up on study roadmap",
      detail: `${roadmap.stats.overdueCount} overdue tasks. Completing them improves roadmap progress in your readiness score.`,
      action: "learning-roadmap.html",
      impact: "medium",
      estimatedGain: 5
    });
  }

  if (historyDelta != null && historyDelta < -5) {
    recs.push({
      id: "history-drop",
      priority: 2,
      category: "recovery",
      title: "Recover lost readiness",
      detail: `Score dropped ${Math.abs(historyDelta)} points vs last week. Take a diagnostic chapter test to identify gaps.`,
      action: "exam-readiness.html",
      impact: "high",
      estimatedGain: Math.min(10, Math.abs(historyDelta))
    });
  } else if (historyDelta != null && historyDelta >= 5) {
    recs.push({
      id: "maintain-momentum",
      priority: 4,
      category: "maintain",
      title: "Maintain momentum",
      detail: `Up ${historyDelta} points this week. Schedule a full mock to validate progress.`,
      action: "mock-tests.html",
      impact: "low",
      estimatedGain: 2
    });
  }

  if (readiness.readinessScore >= 75) {
    recs.push({
      id: "exam-prep",
      priority: 3,
      category: "exam_prep",
      title: "Exam-week revision plan",
      detail: "You're in good shape. Focus on PYQs, speed drills, and light revision of strong topics.",
      action: "question-generator.html",
      impact: "medium",
      estimatedGain: 3
    });
  } else {
    recs.push({
      id: "daily-practice",
      priority: 3,
      category: "habit",
      title: "Daily weak-topic drill",
      detail: "15–20 questions per day on your top 2 weak areas builds consistency in your readiness score.",
      action: "learn-game.html",
      impact: "medium",
      estimatedGain: 4
    });
  }

  return recs
    .sort((a, b) => a.priority - b.priority)
    .slice(0, 10)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

function recordHistory(userId, examId, snapshot) {
  const store = loadHistory();
  const today = new Date().toISOString().slice(0, 10);
  const key = `${userId}:${examId || "all"}`;

  const lastToday = store.entries.find(
    (e) =>
      e.userId === userId &&
      (e.examId || null) === (examId || null) &&
      e.date === today
  );

  const entry = {
    userId,
    examId: examId || null,
    date: today,
    recordedAt: new Date().toISOString(),
    readinessScore: snapshot.readinessScore,
    successProbability: snapshot.successProbability,
    level: snapshot.level,
    subjectScores: snapshot.subjectScores,
    weakCount: snapshot.weakCount
  };

  if (lastToday) {
    lastToday.readinessScore = entry.readinessScore;
    lastToday.successProbability = entry.successProbability;
    lastToday.level = entry.level;
    lastToday.subjectScores = entry.subjectScores;
    lastToday.weakCount = entry.weakCount;
    lastToday.recordedAt = entry.recordedAt;
  } else {
    store.entries.push(entry);
  }

  const userEntries = store.entries.filter((e) => e.userId === userId);
  if (userEntries.length > MAX_HISTORY_PER_USER) {
    const toRemove = userEntries.length - MAX_HISTORY_PER_USER;
    let removed = 0;
    store.entries = store.entries.filter((e) => {
      if (e.userId !== userId) return true;
      if (removed < toRemove) {
        removed += 1;
        return false;
      }
      return true;
    });
  }

  saveHistory(store);
  return entry;
}

function getHistory(userId, examId, limit = 60) {
  const store = loadHistory();
  let entries = store.entries.filter((e) => e.userId === userId);
  if (examId) {
    entries = entries.filter(
      (e) => e.examId === examId || (examId.startsWith("ssc") && e.examId?.startsWith("ssc"))
    );
  }
  entries = entries.sort((a, b) => a.date.localeCompare(b.date)).slice(-limit);

  return entries.map((e) => ({
    date: e.date,
    label: new Date(e.date + "T12:00:00").toLocaleDateString("en-IN", {
      month: "short",
      day: "numeric"
    }),
    readinessScore: e.readinessScore,
    successProbability: e.successProbability,
    level: e.level,
    weakCount: e.weakCount
  }));
}

function computeHistoryDelta(history) {
  if (history.length < 2) return null;
  const recent = history[history.length - 1].readinessScore;
  const weekAgo = history.length >= 8 ? history[history.length - 8].readinessScore : history[0].readinessScore;
  return Math.round((recent - weekAgo) * 10) / 10;
}

function buildProgressIndicators(readiness, subjectScores, components) {
  const items = [
    { key: "recentPerformance", label: "Recent performance", value: components.recentPerformance || 0, weight: 30 },
    { key: "topicMastery", label: "Topic mastery", value: components.topicMastery || 0, weight: 25 },
    { key: "mockAverage", label: "Mock average", value: components.mockAverage || 0, weight: 15 },
    { key: "trend", label: "Score trend", value: components.trend || 0, weight: 12 },
    { key: "consistency", label: "Consistency", value: components.consistency || 0, weight: 10 },
    { key: "roadmapProgress", label: "Roadmap progress", value: components.roadmapProgress || 0, weight: 8 }
  ];

  return {
    overall: readiness.readinessScore,
    successProbability: readiness.successProbability,
    level: readiness.level,
    label: readiness.label,
    components: items.map((c) => ({
      ...c,
      percent: Math.min(100, Math.max(0, Math.round(c.value))),
      status: c.value >= 70 ? "good" : c.value >= 45 ? "fair" : "low"
    })),
    subjects: subjectScores.map((s) => ({
      subjectId: s.subjectId,
      subject: s.subject,
      progressPercent: s.progressPercent,
      score: s.score,
      level: s.level,
      status: s.level === "strong" || s.level === "good" ? "good" : s.level === "developing" ? "fair" : "low"
    }))
  };
}

function getExamReadinessReport(userId, requesterId, options = {}) {
  if (userId !== requesterId) {
    return { error: "You can only view your own readiness report", status: 403 };
  }

  const examId = options.examId || null;
  const base = analytics.getAnalytics(userId, userId, { examId });
  if (base.error) return base;

  const resultsFile = path.join(__dirname, "data", "test-results.json");
  const allResults = JSON.parse(fs.readFileSync(resultsFile, "utf8")).results.filter(
    (r) => r.userId === userId
  );
  const results = filterResults(allResults, examId);

  const topics = base.topics || [];
  const readiness = base.readiness;
  const subjectScores = aggregateSubjectScores(topics, results);
  const weaknesses = analyzeWeaknesses(topics, subjectScores);

  const history = getHistory(userId, examId);
  const historyDelta = computeHistoryDelta(history);

  const roadmapPath = path.join(__dirname, "data", "learning-roadmaps.json");
  let roadmap = null;
  if (fs.existsSync(roadmapPath)) {
    const rs = JSON.parse(fs.readFileSync(roadmapPath, "utf8"));
    roadmap = rs.roadmaps?.find((r) => r.userId === userId) || null;
  }

  const recommendationsFinal = buildRecommendationEngine({
    readiness,
    weaknesses,
    subjectScores,
    results,
    examId,
    roadmap,
    historyDelta
  });

  const snapshot = {
    readinessScore: readiness.readinessScore,
    successProbability: readiness.successProbability,
    level: readiness.level,
    subjectScores: subjectScores.map((s) => ({
      subjectId: s.subjectId,
      score: s.score,
      accuracy: s.accuracy
    })),
    weakCount: weaknesses.length
  };

  recordHistory(userId, examId, snapshot);

  const historyUpdated = getHistory(userId, examId);

  return {
    examId,
    generatedAt: new Date().toISOString(),
    readiness: {
      score: readiness.readinessScore,
      successProbability: readiness.successProbability,
      level: readiness.level,
      label: readiness.label,
      components: readiness.components
    },
    subjectScores,
    weaknesses,
    strengths: base.strongTopics.slice(0, 6),
    recommendations: recommendationsFinal,
    progress: buildProgressIndicators(readiness, subjectScores, readiness.components),
    history: historyUpdated,
    historyDelta,
    summary: {
      totalTests: results.length,
      weakTopics: weaknesses.filter((w) => w.type === "topic").length,
      weakSubjects: subjectScores.filter((s) => s.level === "weak" || s.level === "developing").length,
      strongestSubject: subjectScores.length
        ? [...subjectScores].sort((a, b) => b.accuracy - a.accuracy)[0]
        : null,
      projectedGain: recommendationsFinal
        .slice(0, 3)
        .reduce((s, r) => s + (r.estimatedGain || 0), 0)
    }
  };
}

function getReadinessHistoryOnly(userId, requesterId, options = {}) {
  if (userId !== requesterId) {
    return { error: "Forbidden", status: 403 };
  }
  return {
    examId: options.examId || null,
    history: getHistory(userId, options.examId || null, options.limit || 90),
    delta: computeHistoryDelta(getHistory(userId, options.examId || null))
  };
}

module.exports = {
  getExamReadinessReport,
  getReadinessHistoryOnly,
  aggregateSubjectScores,
  analyzeWeaknesses,
  recordHistory
};
