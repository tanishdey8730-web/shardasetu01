const fs = require("fs");
const path = require("path");

const RESULTS_FILE = path.join(__dirname, "data", "test-results.json");
const QUIZ_SCORES_FILE = path.join(__dirname, "data", "quiz-scores.json");
const BANK_FILE = path.join(__dirname, "data", "question-bank.json");
const ROADMAP_FILE = path.join(__dirname, "data", "learning-roadmaps.json");

const WEAK_THRESHOLD = 55;
const STRONG_THRESHOLD = 75;

function loadResults() {
  if (!fs.existsSync(RESULTS_FILE)) return { results: [] };
  return JSON.parse(fs.readFileSync(RESULTS_FILE, "utf8"));
}

function loadQuizScores() {
  if (!fs.existsSync(QUIZ_SCORES_FILE)) return { scores: [] };
  return JSON.parse(fs.readFileSync(QUIZ_SCORES_FILE, "utf8"));
}

function loadBank() {
  if (!fs.existsSync(BANK_FILE)) return { chapters: [], exams: [] };
  return JSON.parse(fs.readFileSync(BANK_FILE, "utf8"));
}

function loadRoadmap(userId) {
  if (!fs.existsSync(ROADMAP_FILE)) return null;
  const store = JSON.parse(fs.readFileSync(ROADMAP_FILE, "utf8"));
  return store.roadmaps?.find((r) => r.userId === userId) || null;
}

function topicKey(item) {
  return item.chapterId || item.chapterName || item.subjectId || "general";
}

function aggregateTopics(results) {
  const map = new Map();

  for (const r of results) {
    if (!r.breakdown) continue;
    for (const b of r.breakdown) {
      const key = topicKey(b);
      const name = b.chapterName || b.subjectId || key;
      if (!map.has(key)) {
        map.set(key, {
          topicId: key,
          topicName: name,
          subjectId: b.subjectId || null,
          examIds: new Set(),
          attempted: 0,
          correct: 0,
          wrong: 0,
          skipped: 0
        });
      }
      const t = map.get(key);
      t.examIds.add(r.examId);
      if (!b.attempted) {
        t.skipped += 1;
      } else if (b.isCorrect) {
        t.correct += 1;
        t.attempted += 1;
      } else {
        t.wrong += 1;
        t.attempted += 1;
      }
    }
  }

  return [...map.values()].map((t) => {
    const total = t.correct + t.wrong + t.skipped;
    const accuracy =
      t.correct + t.wrong > 0
        ? Math.round((t.correct / (t.correct + t.wrong)) * 1000) / 10
        : 0;
    return {
      topicId: t.topicId,
      topicName: t.topicName,
      subjectId: t.subjectId,
      examIds: [...t.examIds],
      attempted: t.attempted,
      correct: t.correct,
      wrong: t.wrong,
      skipped: t.skipped,
      totalQuestions: total,
      accuracy
    };
  });
}

function classifyTopics(topics) {
  const sorted = [...topics].sort((a, b) => a.accuracy - b.accuracy);
  const weak = sorted.filter(
    (t) => t.correct + t.wrong >= 3 && t.accuracy < WEAK_THRESHOLD
  );
  const strong = sorted.filter(
    (t) => t.correct + t.wrong >= 3 && t.accuracy >= STRONG_THRESHOLD
  );
  return { weak, strong, all: sorted };
}

function scoreTrend(results) {
  return [...results]
    .sort((a, b) => new Date(a.submittedAt) - new Date(b.submittedAt))
    .map((r) => ({
      date: r.submittedAt.slice(0, 10),
      label: new Date(r.submittedAt).toLocaleDateString("en-IN", {
        month: "short",
        day: "numeric"
      }),
      percentScore: r.percentScore,
      accuracy: r.accuracy,
      title: r.title,
      type: r.type,
      examId: r.examId
    }));
}

function computeTrendScore(trend) {
  if (trend.length < 4) return 50;
  const recent = trend.slice(-3).map((t) => t.percentScore);
  const older = trend.slice(-6, -3).map((t) => t.percentScore);
  if (!older.length) return 50;
  const avgRecent = recent.reduce((a, b) => a + b, 0) / recent.length;
  const avgOlder = older.reduce((a, b) => a + b, 0) / older.length;
  const delta = avgRecent - avgOlder;
  return Math.min(100, Math.max(0, 50 + delta * 1.2));
}

function computeConsistency(results) {
  if (results.length < 2) return 50;
  const scores = results.map((r) => r.percentScore);
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance =
    scores.reduce((s, x) => s + (x - mean) ** 2, 0) / scores.length;
  const std = Math.sqrt(variance);
  return Math.min(100, Math.max(20, 100 - std * 1.5));
}

function computeTopicMastery(topics) {
  if (!topics.length) return 0;
  const withData = topics.filter((t) => t.correct + t.wrong >= 2);
  if (!withData.length) return 0;
  const mastered = withData.filter((t) => t.accuracy >= 65).length;
  return Math.round((mastered / withData.length) * 1000) / 10;
}

function calculateReadiness({ results, topics, examId, roadmap }) {
  if (!results.length) {
    return {
      readinessScore: 0,
      components: {
        recentPerformance: 0,
        topicMastery: 0,
        trend: 0,
        consistency: 0,
        roadmapProgress: 0
      },
      level: "not_started",
      label: "Start practicing",
      successProbability: 0
    };
  }

  const recent = results.slice(0, 8);
  const recentPerformance =
    recent.reduce((s, r) => s + r.percentScore, 0) / recent.length;

  const mockResults = recent.filter((r) => r.type === "mock");
  const mockAvg = mockResults.length
    ? mockResults.reduce((s, r) => s + r.percentScore, 0) / mockResults.length
    : recentPerformance;

  const topicMastery = computeTopicMastery(topics);
  const trend = computeTrendScore(scoreTrend(results));
  const consistency = computeConsistency(recent);

  let roadmapProgress = 0;
  if (roadmap?.stats?.progressPercent != null) {
    roadmapProgress = roadmap.stats.progressPercent;
  }

  const readinessScore = Math.round(
    recentPerformance * 0.3 +
      mockAvg * 0.15 +
      topicMastery * 0.25 +
      trend * 0.12 +
      consistency * 0.1 +
      roadmapProgress * 0.08
  );

  const clamped = Math.min(100, Math.max(0, readinessScore));

  let level = "developing";
  let label = "Keep practicing";
  if (clamped >= 80) {
    level = "exam_ready";
    label = "Exam ready";
  } else if (clamped >= 65) {
    level = "good";
    label = "Good progress";
  } else if (clamped >= 40) {
    level = "developing";
    label = "Building foundation";
  } else {
    level = "beginner";
    label = "Early stage";
  }

  const successProbability = predictSuccessProbability(clamped, mockAvg, topicMastery);

  return {
    readinessScore: clamped,
    components: {
      recentPerformance: Math.round(recentPerformance * 10) / 10,
      topicMastery,
      trend: Math.round(trend * 10) / 10,
      consistency: Math.round(consistency * 10) / 10,
      roadmapProgress,
      mockAverage: Math.round(mockAvg * 10) / 10
    },
    level,
    label,
    successProbability,
    examId: examId || null
  };
}

function predictSuccessProbability(readiness, mockAvg, topicMastery) {
  const base = readiness * 0.55 + mockAvg * 0.3 + topicMastery * 0.15;
  const prob = Math.round((15 + base * 0.85) * 10) / 10;
  return Math.min(95, Math.max(5, prob));
}

function buildRecommendations({ weak, strong, readiness, results, examId, roadmap }) {
  const recs = [];

  if (!results.length) {
    recs.push({
      priority: "high",
      type: "practice",
      title: "Take your first mock test",
      detail: "Complete a full-length mock on Mock Tests to unlock AI performance insights.",
      action: "/mock-tests.html"
    });
    return recs;
  }

  for (const t of weak.slice(0, 4)) {
    recs.push({
      priority: "high",
      type: "weak_topic",
      title: `Strengthen ${t.topicName}`,
      detail: `Accuracy ${t.accuracy}% across ${t.correct + t.wrong} questions. Revise concepts and attempt a chapter test.`,
      action: `/mock-tests.html`,
      topicId: t.topicId
    });
  }

  for (const t of strong.slice(0, 2)) {
    recs.push({
      priority: "low",
      type: "strong_topic",
      title: `Maintain ${t.topicName}`,
      detail: `Strong at ${t.accuracy}%. Attempt PYQs or harder mocks to stay sharp.`,
      action: `/mock-tests.html`
    });
  }

  if (readiness.components.mockAverage < 60 && results.some((r) => r.type === "mock")) {
    recs.push({
      priority: "high",
      type: "mock",
      title: "Improve mock test scores",
      detail: `Mock average is ${readiness.components.mockAverage}%. Focus on time management and weak chapters before the next full mock.`,
      action: "/mock-tests.html"
    });
  }

  if (roadmap && roadmap.stats?.overdueCount > 0) {
    recs.push({
      priority: "medium",
      type: "roadmap",
      title: "Catch up on study roadmap",
      detail: `${roadmap.stats.overdueCount} overdue tasks on your learning roadmap. Reschedule and complete them.`,
      action: "/learning-roadmap.html"
    });
  }

  if (readiness.readinessScore >= 70) {
    recs.push({
      priority: "medium",
      type: "assistant",
      title: "Clarify remaining doubts",
      detail: "Use the AI Study Assistant for shortcuts and PYQ discussions on weak areas.",
      action: "/study-assistant.html"
    });
  } else {
    recs.push({
      priority: "medium",
      type: "education",
      title: "Watch topic-wise lessons",
      detail: "Revisit video lessons for weak chapters before your next mock.",
      action: "/online-education.html"
    });
  }

  return recs.slice(0, 8);
}

function chartData({ results, topics, readiness }) {
  const trend = scoreTrend(results);
  const topicChart = topics
    .filter((t) => t.correct + t.wrong >= 2)
    .sort((a, b) => b.accuracy - a.accuracy)
    .slice(0, 12);

  const byType = { chapter: 0, mock: 0, pyq: 0 };
  for (const r of results) {
    if (byType[r.type] !== undefined) byType[r.type] += 1;
  }

  const accuracyBuckets = { correct: 0, wrong: 0, skipped: 0 };
  for (const r of results) {
    accuracyBuckets.correct += r.correct || 0;
    accuracyBuckets.wrong += r.wrong || 0;
    accuracyBuckets.skipped += r.unattempted || 0;
  }

  return {
    scoreTrend: {
      labels: trend.map((t) => t.label),
      datasets: [
        {
          label: "Score %",
          data: trend.map((t) => t.percentScore),
          borderColor: "#1565c0",
          backgroundColor: "rgba(21, 101, 192, 0.1)",
          fill: true,
          tension: 0.3
        },
        {
          label: "Accuracy %",
          data: trend.map((t) => t.accuracy),
          borderColor: "#2e7d32",
          backgroundColor: "transparent",
          tension: 0.3
        }
      ]
    },
    topicAccuracy: {
      labels: topicChart.map((t) => t.topicName.slice(0, 18)),
      data: topicChart.map((t) => t.accuracy),
      colors: topicChart.map((t) =>
        t.accuracy >= STRONG_THRESHOLD
          ? "#2e7d32"
          : t.accuracy < WEAK_THRESHOLD
            ? "#c62828"
            : "#ef6c00"
      )
    },
    readinessGauge: {
      value: readiness.readinessScore,
      successProbability: readiness.successProbability
    },
    attemptMix: {
      labels: ["Chapter", "Mock", "PYQ"],
      data: [byType.chapter, byType.mock, byType.pyq]
    },
    answerDistribution: {
      labels: ["Correct", "Wrong", "Skipped"],
      data: [
        accuracyBuckets.correct,
        accuracyBuckets.wrong,
        accuracyBuckets.skipped
      ],
      colors: ["#2e7d32", "#c62828", "#90a4ae"]
    },
    componentBreakdown: {
      labels: [
        "Recent score",
        "Topic mastery",
        "Trend",
        "Consistency",
        "Roadmap"
      ],
      data: [
        readiness.components.recentPerformance,
        readiness.components.topicMastery,
        readiness.components.trend,
        readiness.components.consistency,
        readiness.components.roadmapProgress
      ]
    }
  };
}

async function aiInsights(payload) {
  const openaiKey = process.env.OPENAI_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!openaiKey && !geminiKey) return null;

  const weakList = payload.weakTopics.map((t) => `${t.topicName} (${t.accuracy}%)`).join(", ");
  const prompt = `You are an Indian competitive exam coach. Student analytics:
Exam focus: ${payload.examId || "general"}
Readiness: ${payload.readinessScore}/100
Success probability: ${payload.successProbability}%
Weak topics: ${weakList || "none yet"}
Recent avg score: ${payload.avgScore}%
Give 2 short personalized study tips (bullet points, under 35 words each). No greeting.`;

  try {
    if (openaiKey) {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openaiKey}`
        },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || "gpt-4o-mini",
          messages: [{ role: "user", content: prompt }],
          max_tokens: 180,
          temperature: 0.65
        })
      });
      const data = await res.json();
      if (res.ok && data.choices?.[0]?.message?.content) {
        return data.choices[0].message.content.trim();
      }
    }
    if (geminiKey) {
      const model = process.env.GEMINI_MODEL || "gemini-1.5-flash";
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }]
        })
      });
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (res.ok && text) return text.trim();
    }
  } catch (_) {}
  return null;
}

function filterResults(results, examId) {
  if (!examId) return results;
  return results.filter(
    (r) => r.examId === examId || (examId.startsWith("ssc") && r.examId.startsWith("ssc"))
  );
}

function getAnalytics(userId, requesterId, options = {}) {
  if (userId !== requesterId) {
    return { error: "You can only view your own analytics", status: 403 };
  }

  const examId = options.examId || null;
  const store = loadResults();
  let results = store.results.filter((r) => r.userId === userId);
  results = filterResults(results, examId);

  const quizStore = loadQuizScores();
  const quizAttempts = quizStore.scores.filter((s) => s.userId === userId);

  const topics = aggregateTopics(results);
  const { weak, strong } = classifyTopics(topics);
  const roadmap = loadRoadmap(userId);
  const readiness = calculateReadiness({ results, topics, examId, roadmap });
  const recommendations = buildRecommendations({
    weak,
    strong,
    readiness,
    results,
    examId,
    roadmap
  });
  const charts = chartData({ results, topics, readiness });

  const summary = {
    totalTests: results.length,
    totalQuizGames: quizAttempts.length,
    avgScore: results.length
      ? Math.round(
          (results.reduce((s, r) => s + r.percentScore, 0) / results.length) * 10
        ) / 10
      : quizAttempts.length
        ? Math.round(
            (quizAttempts.reduce((s, q) => s + q.percent, 0) / quizAttempts.length) * 10
          ) / 10
        : 0,
    avgAccuracy: results.length
      ? Math.round(
          (results.reduce((s, r) => s + r.accuracy, 0) / results.length) * 10
        ) / 10
      : 0,
    bestScore: results.length ? Math.max(...results.map((r) => r.percentScore)) : 0,
    weakTopicCount: weak.length,
    strongTopicCount: strong.length
  };

  return {
    summary,
    weakTopics: weak,
    strongTopics: strong,
    topics,
    readiness,
    recommendations,
    charts,
    recentTests: results.slice(0, 10).map((r) => ({
      id: r.id,
      title: r.title,
      examId: r.examId,
      type: r.type,
      percentScore: r.percentScore,
      accuracy: r.accuracy,
      submittedAt: r.submittedAt
    })),
    quizHighlights: quizAttempts.slice(0, 5).map((q) => ({
      subject: q.subject,
      percent: q.percent,
      medal: q.medal,
      at: q.at
    })),
    examId,
    aiInsights: null,
    _aiPayload: {
      examId,
      readinessScore: readiness.readinessScore,
      successProbability: readiness.successProbability,
      weakTopics: weak,
      avgScore: summary.avgScore
    }
  };
}

function getReadinessScore(userId, requesterId, options = {}) {
  const data = getAnalytics(userId, requesterId, options);
  if (data.error) return data;

  return {
    readinessScore: data.readiness.readinessScore,
    successProbability: data.readiness.successProbability,
    level: data.readiness.level,
    label: data.readiness.label,
    components: data.readiness.components,
    weakTopics: data.weakTopics.slice(0, 5),
    strongTopics: data.strongTopics.slice(0, 5),
    recommendations: data.recommendations.slice(0, 5),
    examId: data.examId,
    reportUrl: "/exam-readiness.html"
  };
}

async function finalizeAiInsights(analytics) {
  if (!analytics._aiPayload) return null;
  const text = await aiInsights(analytics._aiPayload);
  delete analytics._aiPayload;
  analytics.aiInsights = text;
  return text;
}

module.exports = {
  getAnalytics,
  getReadinessScore,
  finalizeAiInsights,
  calculateReadiness,
  aggregateTopics
};
