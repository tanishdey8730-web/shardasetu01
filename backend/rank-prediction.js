const fs = require("fs");
const path = require("path");
const analytics = require("./analytics");

const RESULTS_FILE = path.join(__dirname, "data", "test-results.json");

/** Exam cohort heuristics for rank & selection modelling */
const EXAM_PROFILES = {
  "ssc-cgl": {
    name: "SSC CGL",
    estimatedCandidates: 2_500_000,
    qualifyingPercentile: 88,
    selectionPercentile: 92,
    typicalCutoffPercent: 72,
    rankCap: 15_000,
    selectionLabel: "Tier-I / final merit"
  },
  ssc: {
    name: "SSC",
    estimatedCandidates: 1_800_000,
    qualifyingPercentile: 85,
    selectionPercentile: 90,
    typicalCutoffPercent: 68,
    rankCap: 20_000,
    selectionLabel: "Merit list"
  },
  nda: {
    name: "NDA",
    estimatedCandidates: 600_000,
    qualifyingPercentile: 90,
    selectionPercentile: 94,
    typicalCutoffPercent: 74,
    rankCap: 500,
    selectionLabel: "SSB shortlist"
  },
  cds: {
    name: "CDS",
    estimatedCandidates: 250_000,
    qualifyingPercentile: 89,
    selectionPercentile: 93,
    typicalCutoffPercent: 70,
    rankCap: 400,
    selectionLabel: "SSB interview"
  },
  afcat: {
    name: "AFCAT",
    estimatedCandidates: 300_000,
    qualifyingPercentile: 87,
    selectionPercentile: 91,
    typicalCutoffPercent: 71,
    rankCap: 350,
    selectionLabel: "AFSB call"
  },
  "rrb-ntpc": {
    name: "RRB NTPC",
    estimatedCandidates: 1_200_000,
    qualifyingPercentile: 86,
    selectionPercentile: 90,
    typicalCutoffPercent: 69,
    rankCap: 35_000,
    selectionLabel: "Document verification"
  },
  default: {
    name: "Competitive exam",
    estimatedCandidates: 500_000,
    qualifyingPercentile: 85,
    selectionPercentile: 90,
    typicalCutoffPercent: 68,
    rankCap: 10_000,
    selectionLabel: "Selection"
  }
};

function loadResults() {
  if (!fs.existsSync(RESULTS_FILE)) return { results: [] };
  return JSON.parse(fs.readFileSync(RESULTS_FILE, "utf8"));
}

function filterResults(results, examId) {
  if (!examId) return results;
  return results.filter(
    (r) =>
      r.examId === examId ||
      (examId.startsWith("ssc") && r.examId?.startsWith("ssc"))
  );
}

function getExamProfile(examId) {
  if (!examId) return EXAM_PROFILES.default;
  const key = Object.keys(EXAM_PROFILES).find(
    (k) => k !== "default" && (examId === k || examId.startsWith(k))
  );
  return EXAM_PROFILES[key] || EXAM_PROFILES.default;
}

function scoreToPercentile(score, examId) {
  const profile = getExamProfile(examId);
  const midpoint = profile.typicalCutoffPercent - 8;
  const k = 0.11;
  const p = 100 / (1 + Math.exp(-k * (score - midpoint)));
  return Math.min(99.5, Math.max(0.5, Math.round(p * 10) / 10));
}

function percentileToRank(percentile, profile) {
  const candidates = profile.estimatedCandidates;
  const rank = Math.round(candidates * (1 - percentile / 100));
  return Math.max(1, Math.min(candidates, rank));
}

function analyzeMockPerformance(results) {
  const mocks = results.filter((r) => r.type === "mock");
  const all = results.length ? results : mocks;

  if (!all.length) {
    return {
      mockCount: 0,
      chapterCount: results.filter((r) => r.type === "chapter").length,
      pyqCount: results.filter((r) => r.type === "pyq").length,
      avgScore: 0,
      mockAvg: 0,
      bestScore: 0,
      recentAvg: 0,
      consistency: 0,
      accuracy: 0,
      trend: "insufficient_data",
      trendDelta: 0,
      tests: []
    };
  }

  const sorted = [...all].sort(
    (a, b) => new Date(a.submittedAt) - new Date(b.submittedAt)
  );
  const scores = sorted.map((r) => r.percentScore);
  const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
  const recent = sorted.slice(-5);
  const recentAvg =
    recent.reduce((s, r) => s + r.percentScore, 0) / recent.length;

  const mockScores = mocks.length ? mocks.map((r) => r.percentScore) : scores;
  const mockAvg = mockScores.reduce((a, b) => a + b, 0) / mockScores.length;

  let trend = "stable";
  let trendDelta = 0;
  if (sorted.length >= 3) {
    const last3 = sorted.slice(-3).map((r) => r.percentScore);
    const prev3 = sorted.slice(-6, -3).map((r) => r.percentScore);
    if (prev3.length) {
      const avgLast = last3.reduce((a, b) => a + b, 0) / last3.length;
      const avgPrev = prev3.reduce((a, b) => a + b, 0) / prev3.length;
      trendDelta = Math.round((avgLast - avgPrev) * 10) / 10;
      if (trendDelta > 3) trend = "improving";
      else if (trendDelta < -3) trend = "declining";
    }
  }

  const mean = avgScore;
  const variance =
    scores.reduce((s, x) => s + (x - mean) ** 2, 0) / scores.length;
  const std = Math.sqrt(variance);
  const consistency = Math.min(100, Math.max(0, Math.round(100 - std * 1.5)));

  const accuracy =
    all.reduce((s, r) => s + (r.accuracy || r.percentScore), 0) / all.length;

  return {
    mockCount: mocks.length,
    chapterCount: results.filter((r) => r.type === "chapter").length,
    pyqCount: results.filter((r) => r.type === "pyq").length,
    avgScore: Math.round(avgScore * 10) / 10,
    mockAvg: Math.round(mockAvg * 10) / 10,
    bestScore: Math.max(...scores),
    recentAvg: Math.round(recentAvg * 10) / 10,
    consistency: Math.round(consistency),
    accuracy: Math.round(accuracy * 10) / 10,
    trend,
    trendDelta,
    tests: sorted.slice(-8).map((r) => ({
      id: r.id,
      title: r.title,
      type: r.type,
      percentScore: r.percentScore,
      accuracy: r.accuracy,
      submittedAt: r.submittedAt
    }))
  };
}

function effectivePredictionScore(performance, readinessScore) {
  const weightMock = 0.55;
  const weightRecent = 0.25;
  const weightReadiness = 0.2;
  const base =
    performance.mockAvg * weightMock +
    performance.recentAvg * weightRecent +
    (readinessScore || performance.avgScore) * weightReadiness;
  let adjusted = base;
  if (performance.trend === "improving") adjusted += performance.trendDelta * 0.15;
  if (performance.trend === "declining") adjusted += performance.trendDelta * 0.15;
  return Math.min(100, Math.max(0, Math.round(adjusted * 10) / 10));
}

function predictRank(predictedScore, examId) {
  const profile = getExamProfile(examId);
  const percentile = scoreToPercentile(predictedScore, examId);
  const predictedRank = percentileToRank(percentile, profile);

  const optimisticPct = Math.min(99, percentile + 4);
  const pessimisticPct = Math.max(1, percentile - 4);
  const rankBest = percentileToRank(optimisticPct, profile);
  const rankWorst = percentileToRank(pessimisticPct, profile);

  const displayRank = Math.min(predictedRank, profile.rankCap);

  return {
    predictedRank: displayRank,
    rankRange: {
      best: Math.min(rankBest, profile.rankCap),
      worst: Math.min(rankWorst, profile.rankCap)
    },
    percentile,
    estimatedCandidates: profile.estimatedCandidates,
    examName: profile.name,
    confidence:
      percentile > 0
        ? Math.min(95, Math.max(40, 50 + performanceConsistencyBonus(predictedScore)))
        : 30
  };
}

function performanceConsistencyBonus(score) {
  return Math.min(30, score / 4);
}

function predictSelectionProbability(predictedScore, percentile, examId, performance) {
  const profile = getExamProfile(examId);
  const gapToCutoff = predictedScore - profile.typicalCutoffPercent;
  const gapPercentile = percentile - profile.selectionPercentile;

  let qualifying = sigmoid(gapToCutoff * 0.12) * 100;
  let selection = sigmoid(gapPercentile * 0.15) * 100;

  if (performance.trend === "improving") {
    qualifying = Math.min(98, qualifying + 5);
    selection = Math.min(95, selection + 6);
  } else if (performance.trend === "declining") {
    qualifying = Math.max(5, qualifying - 8);
    selection = Math.max(3, selection - 10);
  }

  qualifying = Math.round(qualifying * 10) / 10;
  selection = Math.round(selection * 10) / 10;

  return {
    qualifyingProbability: qualifying,
    selectionProbability: selection,
    selectionLabel: profile.selectionLabel,
    cutoffReference: profile.typicalCutoffPercent,
    gapToCutoff: Math.round(gapToCutoff * 10) / 10,
    status:
      selection >= 70
        ? "strong"
        : selection >= 45
          ? "moderate"
          : selection >= 20
            ? "borderline"
            : "needs_work"
  };
}

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

function linearRegression(points) {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: points[0]?.y ?? 50 };
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
    sumXY += p.x * p.y;
    sumX2 += p.x * p.x;
  }
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX || 1);
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

function predictFutureTrends(results, predictedScore) {
  const sorted = [...results].sort(
    (a, b) => new Date(a.submittedAt) - new Date(b.submittedAt)
  );

  if (sorted.length < 2) {
    return {
      direction: "unknown",
      projectedScores: [],
      summary: "Complete at least 2 mock tests to project future performance.",
      confidence: "low"
    };
  }

  const points = sorted.map((r, i) => ({
    x: i,
    y: r.percentScore,
    label: new Date(r.submittedAt).toLocaleDateString("en-IN", {
      month: "short",
      day: "numeric"
    })
  }));

  const { slope, intercept } = linearRegression(points);
  const lastX = points.length - 1;
  const projections = [];
  for (let i = 1; i <= 4; i++) {
    const x = lastX + i;
    const raw = intercept + slope * x;
    const score = Math.min(100, Math.max(0, Math.round(raw * 10) / 10));
    projections.push({
      label: `Mock +${i}`,
      projectedScore: score,
      index: x
    });
  }

  const direction =
    slope > 0.8 ? "upward" : slope < -0.8 ? "downward" : "flat";
  const endScore = projections[projections.length - 1]?.projectedScore ?? predictedScore;

  return {
    direction,
    slopePerTest: Math.round(slope * 10) / 10,
    projectedScores: projections,
    historical: points.map((p) => ({
      label: p.label,
      score: p.y
    })),
    summary:
      direction === "upward"
        ? `Scores trending up (~${Math.abs(Math.round(slope * 10) / 10)} pts per test). Projected ~${endScore}% in 4 mocks if you maintain pace.`
        : direction === "downward"
          ? `Scores trending down. Projected ~${endScore}% in 4 mocks unless you revise weak areas.`
          : `Scores are stable. Projected ~${endScore}% in upcoming mocks with consistent practice.`,
    confidence: sorted.length >= 5 ? "medium" : "low"
  };
}

function buildImprovementSuggestions(ctx) {
  const {
    performance,
    predictedScore,
    selection,
    rank,
    examId,
    weaknesses,
    readinessReport
  } = ctx;
  const profile = getExamProfile(examId);
  const suggestions = [];

  if (!performance.mockCount && !performance.tests.length) {
    return [
      {
        priority: 1,
        category: "start",
        title: "Take full-length mock tests",
        detail:
          "Rank prediction needs mock test data. Complete at least 2–3 timed mocks for accurate rank and selection estimates.",
        action: "mock-tests.html",
        impact: "high"
      }
    ];
  }

  const pointsNeeded = Math.max(0, profile.typicalCutoffPercent - predictedScore + 2);
  if (pointsNeeded > 0) {
    suggestions.push({
      priority: 1,
      category: "score_boost",
      title: `Gain ~${Math.round(pointsNeeded)}% to approach cutoff`,
      detail: `Your predicted score is ${predictedScore}% vs typical cutoff ~${profile.typicalCutoffPercent}%. Focused weak-topic drills can close this gap in 3–4 weeks.`,
      action: "exam-readiness.html",
      impact: "high",
      metric: `+${Math.round(pointsNeeded)}%`
    });
  }

  if (performance.trend === "declining") {
    suggestions.push({
      priority: 1,
      category: "trend",
      title: "Reverse score decline",
      detail: `Recent mocks dropped ${Math.abs(performance.trendDelta)} pts. Review last 2 mock analyses and redo incorrect questions.`,
      action: "performance-analytics.html",
      impact: "high"
    });
  }

  if (selection.selectionProbability < 50) {
    suggestions.push({
      priority: 2,
      category: "selection",
      title: "Improve selection odds",
      detail: `Selection probability is ${selection.selectionProbability}%. Target ${profile.selectionPercentile}th percentile (~${profile.typicalCutoffPercent}%+ mocks) with weekly full mocks.`,
      action: "mock-tests.html",
      impact: "high"
    });
  }

  for (const w of (weaknesses || []).slice(0, 3)) {
    suggestions.push({
      priority: 2,
      category: "weakness",
      title: `Strengthen ${w.topicName || w.subject}`,
      detail: w.summary || `Low accuracy (${w.accuracy}%) hurts rank percentile.`,
      action: "mock-tests.html",
      impact: w.severity === "critical" ? "high" : "medium"
    });
  }

  if (performance.consistency < 55) {
    suggestions.push({
      priority: 2,
      category: "consistency",
      title: "Stabilize mock scores",
      detail: `Score variance is high (consistency ${performance.consistency}/100). Sectional tests build predictable full-mock performance.`,
      action: "mock-tests.html",
      impact: "medium"
    });
  }

  if (rank.percentile < profile.qualifyingPercentile && performance.trend !== "declining") {
    suggestions.push({
      priority: 3,
      category: "rank",
      title: "Climb percentile ladder",
      detail: `At ${rank.percentile}th percentile (rank ~${rank.predictedRank.toLocaleString("en-IN")}). Each +5% mock score typically shifts rank by thousands.`,
      action: "rank-prediction.html",
      impact: "medium"
    });
  }

  const recs = readinessReport?.recommendations || [];
  for (const r of recs.slice(0, 2)) {
    if (suggestions.length >= 8) break;
    if (suggestions.some((s) => s.title === r.title)) continue;
    suggestions.push({
      priority: r.priority || 3,
      category: r.category || "readiness",
      title: r.title,
      detail: r.detail,
      action: (r.action || "").replace(/^\//, ""),
      impact: r.impact || "medium"
    });
  }

  if (performance.trend === "improving") {
    suggestions.push({
      priority: 4,
      category: "maintain",
      title: "Validate with a fresh full mock",
      detail: "Momentum is positive. One new full mock under exam conditions will refine rank prediction confidence.",
      action: "mock-tests.html",
      impact: "low"
    });
  }

  return suggestions
    .sort((a, b) => a.priority - b.priority)
    .slice(0, 8)
    .map((s, i) => ({ ...s, rank: i + 1 }));
}

function getRankPrediction(userId, requesterId, options = {}) {
  if (userId !== requesterId) {
    return { error: "You can only view your own rank prediction", status: 403 };
  }

  const examId = options.examId || "ssc-cgl";
  const store = loadResults();
  let results = store.results.filter((r) => r.userId === userId);
  results = filterResults(results, examId);

  const performance = analyzeMockPerformance(results);
  const baseAnalytics = analytics.getAnalytics(userId, userId, { examId });
  const readinessScore = baseAnalytics.error
    ? 0
    : baseAnalytics.readiness?.readinessScore ?? 0;

  const weaknesses = baseAnalytics.error
    ? []
    : (baseAnalytics.weakTopics || []).map((t) => ({
        topicName: t.topicName,
        subject: t.subjectId,
        accuracy: t.accuracy,
        severity: t.accuracy < 40 ? "critical" : t.accuracy < 55 ? "high" : "medium",
        summary: `${t.topicName} at ${t.accuracy}% accuracy — revise before next mock.`
      }));

  const predictedScore = effectivePredictionScore(performance, readinessScore);
  const rank = predictRank(predictedScore, examId);
  rank.confidence = Math.min(
    95,
    Math.max(
      35,
      rank.confidence +
        (performance.mockCount >= 3 ? 15 : performance.mockCount * 5) +
        (performance.consistency > 60 ? 10 : 0)
    )
  );

  const selection = predictSelectionProbability(
    predictedScore,
    rank.percentile,
    examId,
    performance
  );
  const futureTrends = predictFutureTrends(results, predictedScore);
  const suggestions = buildImprovementSuggestions({
    performance,
    predictedScore,
    selection,
    rank,
    examId,
    weaknesses,
    readinessReport: baseAnalytics.error ? null : baseAnalytics
  });

  const profile = getExamProfile(examId);

  return {
    examId,
    examName: profile.name,
    generatedAt: new Date().toISOString(),
    performance,
    predictedScore,
    readinessScore,
    rank: {
      predicted: rank.predictedRank,
      range: rank.rankRange,
      percentile: rank.percentile,
      estimatedCandidates: rank.estimatedCandidates,
      confidence: Math.round(rank.confidence)
    },
    selection,
    futureTrends,
    suggestions,
    disclaimer:
      "Rank and selection estimates are AI/heuristic projections based on your mock tests, not official results. Actual cutoffs vary by year and category."
  };
}

module.exports = {
  getRankPrediction,
  analyzeMockPerformance,
  scoreToPercentile,
  EXAM_PROFILES
};
