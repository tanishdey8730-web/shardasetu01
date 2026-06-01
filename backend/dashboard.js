const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const analytics = require("./analytics");
const gamification = require("./gamification");

const GOALS_FILE = path.join(__dirname, "data", "user-dashboard.json");
const RESULTS_FILE = path.join(__dirname, "data", "test-results.json");
const QUIZ_SCORES_FILE = path.join(__dirname, "data", "quiz-scores.json");
const NOTES_FILE = path.join(__dirname, "data", "generated-notes.json");
const ROADMAP_FILE = path.join(__dirname, "data", "learning-roadmaps.json");
const CONVERSATIONS_FILE = path.join(__dirname, "data", "conversations.json");

function newId() {
  return crypto.randomBytes(8).toString("hex");
}

function toDateStr(d) {
  const x = new Date(d);
  return x.toISOString().slice(0, 10);
}

function loadGoalsStore() {
  if (!fs.existsSync(GOALS_FILE)) {
    fs.writeFileSync(GOALS_FILE, JSON.stringify({ users: {} }, null, 2));
  }
  return JSON.parse(fs.readFileSync(GOALS_FILE, "utf8"));
}

function saveGoalsStore(store) {
  fs.writeFileSync(GOALS_FILE, JSON.stringify(store, null, 2));
}

function loadJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function collectActivityEvents(userId) {
  const events = [];

  const results = loadJson(RESULTS_FILE, { results: [] }).results.filter(
    (r) => r.userId === userId
  );
  for (const r of results) {
    events.push({
      type: "mock_test",
      at: r.submittedAt,
      title: r.title,
      meta: `${r.percentScore}% score`,
      minutes: Math.round((r.timeTakenSeconds || r.durationMinutes * 60 || 900) / 60)
    });
  }

  const quizzes = loadJson(QUIZ_SCORES_FILE, { scores: [] }).scores.filter(
    (s) => s.userId === userId
  );
  for (const q of quizzes) {
    events.push({
      type: "quiz",
      at: q.at,
      title: `Quiz: ${q.subject}`,
      meta: `${q.percent}% · ${q.title || q.medal}`,
      minutes: 12
    });
  }

  const notes = loadJson(NOTES_FILE, { notes: [] }).notes.filter((n) => n.userId === userId);
  for (const n of notes) {
    events.push({
      type: "notes",
      at: n.createdAt,
      title: `Notes: ${n.title}`,
      meta: n.sourceType,
      minutes: 8
    });
  }

  const convStore = loadJson(CONVERSATIONS_FILE, { conversations: [] });
  for (const c of convStore.conversations || []) {
    if (c.owner !== `user:${userId}`) continue;
    const last = c.updatedAt || c.createdAt;
    if (last) {
      events.push({
        type: "assistant",
        at: last,
        title: "Study Assistant chat",
        meta: c.title || "Conversation",
        minutes: 5
      });
    }
  }

  const roadmap = loadJson(ROADMAP_FILE, { roadmaps: [] }).roadmaps.find(
    (r) => r.userId === userId
  );
  if (roadmap) {
    for (const day of roadmap.dailyPlan || []) {
      const completedTasks = (day.tasks || []).filter((t) => t.completed).length;
      if (completedTasks > 0) {
        events.push({
          type: "roadmap",
          at: `${day.date}T18:00:00.000Z`,
          title: `Roadmap: ${day.label}`,
          meta: `${completedTasks} topics completed`,
          minutes: Math.round((day.plannedHours || 2) * 60)
        });
      }
    }
  }

  return events.sort((a, b) => new Date(b.at) - new Date(a.at));
}

function computeStreak(events) {
  const daySet = new Set(events.map((e) => toDateStr(e.at)));
  const days = [...daySet].sort();
  if (!days.length) return { current: 0, longest: 0, lastActive: null };

  const today = toDateStr(new Date());
  let current = 0;
  let d = new Date(today);
  while (daySet.has(toDateStr(d))) {
    current += 1;
    d.setDate(d.getDate() - 1);
  }

  let longest = 0;
  let run = 1;
  for (let i = 1; i < days.length; i++) {
    const prev = new Date(days[i - 1]);
    const cur = new Date(days[i]);
    const diff = (cur - prev) / (24 * 60 * 60 * 1000);
    if (diff === 1) {
      run += 1;
      longest = Math.max(longest, run);
    } else {
      run = 1;
    }
  }
  longest = Math.max(longest, run, current);

  return {
    current,
    longest,
    lastActive: days[days.length - 1] || null
  };
}

function computeHoursStudied(events, days = 30) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const recent = events.filter((e) => new Date(e.at) >= cutoff);
  const totalMinutes = recent.reduce((s, e) => s + (e.minutes || 10), 0);
  return {
    totalHours: Math.round((totalMinutes / 60) * 10) / 10,
    periodDays: days,
    thisWeekHours: sumHoursInRange(events, 7),
    todayMinutes: sumMinutesOnDay(events, toDateStr(new Date()))
  };
}

function sumHoursInRange(events, dayCount) {
  const start = new Date();
  start.setDate(start.getDate() - dayCount);
  const mins = events
    .filter((e) => new Date(e.at) >= start)
    .reduce((s, e) => s + (e.minutes || 10), 0);
  return Math.round((mins / 60) * 10) / 10;
}

function sumMinutesOnDay(events, dateStr) {
  return events
    .filter((e) => toDateStr(e.at) === dateStr)
    .reduce((s, e) => s + (e.minutes || 10), 0);
}

function weeklyStudyChart(events) {
  const labels = [];
  const hours = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const ds = toDateStr(d);
    labels.push(
      d.toLocaleDateString("en-IN", { weekday: "short" })
    );
    const mins = events
      .filter((e) => toDateStr(e.at) === ds)
      .reduce((s, e) => s + (e.minutes || 10), 0);
    hours.push(Math.round((mins / 60) * 10) / 10);
  }
  return { labels, data: hours };
}

function coursesCompleted(userId) {
  const results = loadJson(RESULTS_FILE, { results: [] }).results.filter(
    (r) => r.userId === userId
  );
  const quizzes = loadJson(QUIZ_SCORES_FILE, { scores: [] }).scores.filter(
    (s) => s.userId === userId
  );

  const modules = new Set();

  for (const r of results) {
    if (r.percentScore >= 60) {
      modules.add(`mock:${r.examId}:${r.type}`);
    }
    if (r.type === "chapter" && r.chapterId && r.percentScore >= 60) {
      modules.add(`chapter:${r.chapterId}`);
    }
  }

  const subjectsPassed = new Set();
  for (const q of quizzes) {
    if (q.percent >= 60) subjectsPassed.add(q.subject);
  }

  const roadmap = loadJson(ROADMAP_FILE, { roadmaps: [] }).roadmaps.find(
    (r) => r.userId === userId
  );
  let roadmapTasksDone = 0;
  if (roadmap?.dailyPlan) {
    for (const day of roadmap.dailyPlan) {
      roadmapTasksDone += (day.tasks || []).filter((t) => t.completed).length;
    }
  }

  return {
    count: modules.size + subjectsPassed.size,
    mockTestsPassed: results.filter((r) => r.percentScore >= 60).length,
    quizSubjectsPassed: subjectsPassed.size,
    chapterTestsPassed: results.filter(
      (r) => r.type === "chapter" && r.percentScore >= 60
    ).length,
    roadmapTasksCompleted: roadmapTasksDone
  };
}

function getUserGoals(userId) {
  const store = loadGoalsStore();
  const userGoals = store.users[userId]?.goals || [];
  return userGoals.map((g) => ({ ...g }));
}

function buildUpcomingGoals(userId, user, roadmap) {
  const custom = getUserGoals(userId).filter((g) => !g.completed);
  const upcoming = [...custom];

  if (roadmap?.examDate) {
    const daysLeft = Math.ceil(
      (new Date(roadmap.examDate) - new Date()) / (24 * 60 * 60 * 1000)
    );
    if (daysLeft > 0) {
      upcoming.unshift({
        id: "roadmap-exam",
        title: `${roadmap.examName || roadmap.examId} exam`,
        dueDate: roadmap.examDate,
        completed: false,
        system: true,
        detail: `${daysLeft} days remaining`
      });
    }
    if (roadmap.stats?.overdueCount > 0) {
      upcoming.unshift({
        id: "roadmap-catchup",
        title: "Catch up on overdue roadmap tasks",
        dueDate: toDateStr(new Date()),
        completed: false,
        system: true,
        detail: `${roadmap.stats.overdueCount} tasks behind`
      });
    }
  }

  if (!upcoming.length && user?.examGoal) {
    upcoming.push({
      id: "default-1",
      title: `Start ${user.examGoal} preparation`,
      dueDate: null,
      completed: false,
      system: true,
      detail: "Take a mock test or create your learning roadmap"
    });
  }

  return upcoming
    .sort((a, b) => {
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return new Date(a.dueDate) - new Date(b.dueDate);
    })
    .slice(0, 8);
}

function scoreProgressChart(userId) {
  const results = loadJson(RESULTS_FILE, { results: [] })
    .results.filter((r) => r.userId === userId)
    .sort((a, b) => new Date(a.submittedAt) - new Date(b.submittedAt))
    .slice(-10);

  return {
    labels: results.map((r) =>
      new Date(r.submittedAt).toLocaleDateString("en-IN", {
        month: "short",
        day: "numeric"
      })
    ),
    scores: results.map((r) => r.percentScore),
    accuracy: results.map((r) => r.accuracy)
  };
}

function roadmapProgressChart(roadmap) {
  if (!roadmap?.stats) return { percent: 0, label: "No roadmap" };
  return {
    percent: roadmap.stats.progressPercent || 0,
    label: roadmap.examName || "Study plan",
    examDate: roadmap.examDate
  };
}

function activityIcon(type) {
  const map = {
    mock_test: "📝",
    quiz: "🎮",
    notes: "📒",
    assistant: "🤖",
    roadmap: "🗓️"
  };
  return map[type] || "📌";
}

function getDashboard(userId, requesterId, userProfile) {
  if (userId !== requesterId) {
    return { error: "You can only view your own dashboard", status: 403 };
  }

  const events = collectActivityEvents(userId);
  const streak = computeStreak(events);
  const hours = computeHoursStudied(events);
  const courses = coursesCompleted(userId);
  const roadmap = loadJson(ROADMAP_FILE, { roadmaps: [] }).roadmaps.find(
    (r) => r.userId === userId
  );

  let readinessData = analytics.getReadinessScore(userId, userId, {
    examId: userProfile?.examGoal?.includes("ssc")
      ? "ssc-cgl"
      : userProfile?.examGoal?.toLowerCase().includes("nda")
        ? "nda"
        : null
  });
  if (readinessData.error) {
    readinessData = {
      readinessScore: 0,
      successProbability: 0,
      level: "not_started",
      label: "Start practicing",
      recommendations: [
        {
          title: "Take your first mock test",
          detail: "Unlock readiness tracking and analytics.",
          action: "/mock-tests.html"
        }
      ],
      components: {}
    };
  }

  const upcomingGoals = buildUpcomingGoals(userId, userProfile, roadmap);

  const recentActivity = events.slice(0, 12).map((e) => ({
    type: e.type,
    icon: activityIcon(e.type),
    title: e.title,
    meta: e.meta,
    at: e.at,
    relative: formatRelative(e.at)
  }));

  const recommendations = readinessData.recommendations || [];

  gamification.applyStreakBadges(userId, streak.current);
  const gamificationProfile = gamification.getProfile(userId, userId);

  return {
    user: {
      name: userProfile?.name,
      examGoal: userProfile?.examGoal,
      avatar: userProfile?.avatar
    },
    streak,
    hoursStudied: hours,
    coursesCompleted: courses,
    readiness: {
      score: readinessData.readinessScore ?? 0,
      successProbability: readinessData.successProbability ?? 0,
      level: readinessData.level,
      label: readinessData.label
    },
    upcomingGoals,
    recentActivity,
    recommendations,
    charts: {
      weeklyStudy: weeklyStudyChart(events),
      scoreProgress: scoreProgressChart(userId),
      roadmapProgress: roadmapProgressChart(roadmap),
      readinessBreakdown: readinessData.components || {}
    },
    quickLinks: [
      { label: "Mock Tests", href: "mock-tests.html", icon: "📝" },
      { label: "Analytics", href: "performance-analytics.html", icon: "📊" },
      { label: "Roadmap", href: "learning-roadmap.html", icon: "🗓️" },
      { label: "Study Assistant", href: "study-assistant.html", icon: "🤖" },
      { label: "Notes", href: "notes-generator.html", icon: "📒" },
      { label: "Education", href: "online-education.html", icon: "▶️" }
    ],
    gamification: gamificationProfile.error ? null : gamificationProfile
  };
}

function formatRelative(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function addGoal(userId, { title, dueDate }) {
  if (!title?.trim()) return { error: "title is required", status: 400 };
  const store = loadGoalsStore();
  if (!store.users[userId]) store.users[userId] = { goals: [] };
  const goal = {
    id: newId(),
    title: title.trim(),
    dueDate: dueDate || null,
    completed: false,
    createdAt: new Date().toISOString()
  };
  store.users[userId].goals.push(goal);
  saveGoalsStore(store);
  return { goal };
}

function toggleGoal(userId, goalId, completed) {
  const store = loadGoalsStore();
  const goals = store.users[userId]?.goals;
  if (!goals) return { error: "Goal not found", status: 404 };
  const g = goals.find((x) => x.id === goalId);
  if (!g) return { error: "Goal not found", status: 404 };
  g.completed = Boolean(completed);
  saveGoalsStore(store);
  return { goal: g };
}

module.exports = {
  getDashboard,
  addGoal,
  toggleGoal,
  collectActivityEvents
};
