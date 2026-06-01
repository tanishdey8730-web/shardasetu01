const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const examSystem = require("./exam-system");
const gamification = require("./gamification");
const analytics = require("./analytics");
const dashboard = require("./dashboard");

const PROFILE_EXT_FILE = path.join(__dirname, "data", "user-profiles.json");
const QUIZ_FILE = path.join(__dirname, "data", "quiz-scores.json");
const ROADMAP_FILE = path.join(__dirname, "data", "learning-roadmaps.json");
const AVATAR_DIR = path.join(__dirname, "uploads", "avatars");

const EXAM_LABELS = {
  "ssc-cgl": "SSC CGL",
  "ssc-chsl": "SSC CHSL",
  "ssc-mts": "SSC MTS",
  "ssc-gd": "SSC GD",
  ssc: "SSC",
  cds: "CDS",
  afcat: "AFCAT",
  nda: "NDA",
  capf: "CAPF AC",
  "rrb-ntpc": "RRB NTPC"
};

function loadExtStore() {
  if (!fs.existsSync(PROFILE_EXT_FILE)) {
    fs.writeFileSync(PROFILE_EXT_FILE, JSON.stringify({ users: {} }, null, 2));
  }
  return JSON.parse(fs.readFileSync(PROFILE_EXT_FILE, "utf8"));
}

function saveExtStore(store) {
  fs.writeFileSync(PROFILE_EXT_FILE, JSON.stringify(store, null, 2));
}

function getExtUser(store, userId) {
  if (!store.users[userId]) {
    store.users[userId] = { savedCourses: [], pinnedCertificates: [] };
  }
  return store.users[userId];
}

function loadJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function examLabel(id) {
  return EXAM_LABELS[id] || String(id || "Exam").toUpperCase().replace(/-/g, " ");
}

function buildTestHistory(userId) {
  const mock = examSystem.getResults(userId, userId, {});
  if (mock.error) return { mockTests: [], quizzes: [], summary: {} };

  const quizzes = loadJson(QUIZ_FILE, { scores: [] })
    .scores.filter((s) => s.userId === userId)
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, 50)
    .map((q) => ({
      id: q.id || `quiz-${q.at}`,
      type: "quiz",
      title: q.title || `Quiz: ${q.subject}`,
      subject: q.subject,
      percent: q.percent,
      medal: q.medal,
      at: q.at
    }));

  const mockTests = (mock.results || []).map((r) => ({
    id: r.id,
    type: r.type,
    title: r.title,
    examId: r.examId,
    examName: examLabel(r.examId),
    percentScore: r.percentScore,
    accuracy: r.accuracy,
    correct: r.correct,
    wrong: r.wrong,
    total: r.total,
    submittedAt: r.submittedAt,
    durationMinutes: r.durationMinutes
  }));

  return {
    mockTests,
    quizzes,
    summary: mock.summary || {
      totalAttempts: mockTests.length,
      avgScore: 0,
      bestScore: 0
    }
  };
}

function buildCertificates(userId, testHistory, gamProfile) {
  const certs = [];
  const seen = new Set();

  const add = (cert) => {
    if (seen.has(cert.id)) return;
    seen.add(cert.id);
    certs.push(cert);
  };

  for (const r of testHistory.mockTests || []) {
    if (r.percentScore >= 70) {
      add({
        id: `cert-mock-${r.id}`,
        type: "mock",
        title: `Certificate of Completion`,
        subtitle: `${r.title} — ${r.percentScore}%`,
        examId: r.examId,
        score: r.percentScore,
        issuedAt: r.submittedAt,
        icon: "📝"
      });
    }
    if (r.percentScore >= 90) {
      add({
        id: `cert-excellence-${r.id}`,
        type: "excellence",
        title: `Excellence Award`,
        subtitle: `${r.title} — Outstanding ${r.percentScore}%`,
        examId: r.examId,
        score: r.percentScore,
        issuedAt: r.submittedAt,
        icon: "🏆"
      });
    }
  }

  for (const q of testHistory.quizzes || []) {
    if (q.medal === "gold" || q.percent >= 90) {
      add({
        id: `cert-quiz-${q.id}`,
        type: "quiz",
        title: `Quiz Gold Certificate`,
        subtitle: `${q.title || q.subject} — ${q.percent}%`,
        score: q.percent,
        issuedAt: q.at,
        icon: "🎮"
      });
    }
  }

  const level = gamProfile?.level;
  if (level?.level >= 3) {
    add({
      id: `cert-level-${level.level}`,
      type: "level",
      title: `Level ${level.level} — ${level.title}`,
      subtitle: `Sharda Setu learning milestone`,
      issuedAt: new Date().toISOString(),
      icon: level.icon || "⭐"
    });
  }

  for (const badge of gamProfile?.badges || []) {
    add({
      id: `cert-badge-${badge.id}`,
      type: "badge",
      title: badge.name,
      subtitle: badge.description,
      issuedAt: new Date().toISOString(),
      icon: badge.icon || "🏅"
    });
  }

  const roadmap = loadJson(ROADMAP_FILE, { roadmaps: [] }).roadmaps.find((r) => r.userId === userId);
  if (roadmap?.stats?.progressPercent >= 50) {
    add({
      id: `cert-roadmap-${roadmap.id}`,
      type: "roadmap",
      title: `Study Plan Progress`,
      subtitle: `${roadmap.stats.progressPercent}% of ${roadmap.examName || "roadmap"} completed`,
      issuedAt: roadmap.updatedAt || roadmap.createdAt,
      icon: "🗓️"
    });
  }

  certs.sort((a, b) => new Date(b.issuedAt) - new Date(a.issuedAt));
  return certs;
}

function buildProgressReport(userId, userProfile) {
  const dash = dashboard.getDashboard(userId, userId, userProfile);
  if (dash.error) return null;

  const examId = userProfile?.examGoal?.includes("ssc")
    ? "ssc-cgl"
    : userProfile?.examGoal || null;
  const readiness = analytics.getReadinessScore(userId, userId, { examId });

  const roadmap = loadJson(ROADMAP_FILE, { roadmaps: [] }).roadmaps.find((r) => r.userId === userId);

  return {
    generatedAt: new Date().toISOString(),
    streak: dash.streak,
    hoursStudied: dash.hoursStudied,
    coursesCompleted: dash.coursesCompleted,
    readiness: readiness.error
      ? null
      : {
          score: readiness.readinessScore,
          probability: readiness.successProbability,
          weakTopics: (readiness.weakTopics || []).slice(0, 5),
          strongTopics: (readiness.strongTopics || []).slice(0, 5),
          recommendations: (readiness.recommendations || []).slice(0, 4)
        },
    scoreChart: dash.charts?.scoreProgress || { labels: [], scores: [] },
    roadmap: roadmap
      ? {
          examName: roadmap.examName,
          examDate: roadmap.examDate,
          progressPercent: roadmap.stats?.progressPercent || 0,
          tasksCompleted: roadmap.stats?.completedTasks || 0,
          totalTasks: roadmap.stats?.totalTasks || 0
        }
      : null,
    recentActivity: (dash.recentActivity || []).slice(0, 8)
  };
}

function getStudentProfile(userId, requesterId, authUser) {
  if (userId !== requesterId) {
    return { error: "You can only view your own profile", status: 403 };
  }

  const extStore = loadExtStore();
  const ext = getExtUser(extStore, userId);

  const gam = gamification.getProfile(userId, userId);
  const testHistory = buildTestHistory(userId);
  const certificates = buildCertificates(userId, testHistory, gam.error ? null : gam);
  const progressReport = buildProgressReport(userId, authUser);

  const achievements = gam.error
    ? []
    : [
        ...(gam.achievements || []).map((a) => ({
          id: a.id,
          name: a.name,
          description: a.description,
          icon: a.icon,
          unlocked: a.unlocked,
          progress: a.progress,
          target: a.target,
          metric: a.metric
        })),
        ...(gam.badges || []).map((b) => ({
          id: `badge-${b.id}`,
          name: b.name,
          description: b.description,
          icon: b.icon,
          unlocked: true,
          type: "badge"
        }))
      ];

  return {
    user: authUser,
    stats: {
      level: gam.level || null,
      xp: gam.xp || 0,
      testAttempts: testHistory.summary?.totalAttempts || 0,
      quizCount: testHistory.quizzes?.length || 0,
      certificatesCount: certificates.length,
      savedCoursesCount: ext.savedCourses.length
    },
    testHistory,
    certificates,
    savedCourses: ext.savedCourses,
    achievements,
    progressReport,
    gamification: gam.error ? null : { level: gam.level, xp: gam.xp, rank: gam.rank }
  };
}

function saveCourse(userId, payload) {
  const { courseId, title, examId, url, thumbnail, type } = payload || {};
  if (!courseId || !title) return { error: "courseId and title are required", status: 400 };

  const store = loadExtStore();
  const ext = getExtUser(store, userId);
  const existing = ext.savedCourses.findIndex((c) => c.courseId === courseId);
  const item = {
    courseId,
    title: String(title).trim(),
    examId: examId || "",
    url: url || "",
    thumbnail: thumbnail || "",
    type: type || "playlist",
    savedAt: new Date().toISOString()
  };

  if (existing >= 0) ext.savedCourses[existing] = item;
  else ext.savedCourses.unshift(item);

  if (ext.savedCourses.length > 50) ext.savedCourses = ext.savedCourses.slice(0, 50);
  saveExtStore(store);
  return { savedCourses: ext.savedCourses };
}

function removeSavedCourse(userId, courseId) {
  const store = loadExtStore();
  const ext = getExtUser(store, userId);
  ext.savedCourses = ext.savedCourses.filter((c) => c.courseId !== courseId);
  saveExtStore(store);
  return { savedCourses: ext.savedCourses };
}

function setAvatarFromUpload(userId, file) {
  if (!file) return { error: "No file uploaded", status: 400 };

  const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  if (!allowed.includes(file.mimetype)) {
    return { error: "Only JPEG, PNG, WebP or GIF images allowed", status: 400 };
  }

  if (!fs.existsSync(AVATAR_DIR)) {
    fs.mkdirSync(AVATAR_DIR, { recursive: true });
  }

  const ext = path.extname(file.originalname) || ".jpg";
  const safeExt = [".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(ext.toLowerCase())
    ? ext.toLowerCase()
    : ".jpg";
  const filename = `${userId}${safeExt}`;
  const dest = path.join(AVATAR_DIR, filename);

  try {
    if (file.buffer) {
      fs.writeFileSync(dest, file.buffer);
    } else if (file.path) {
      try {
        fs.renameSync(file.path, dest);
      } catch {
        fs.copyFileSync(file.path, dest);
        try {
          fs.unlinkSync(file.path);
        } catch (_) {}
      }
    } else {
      return { error: "Invalid file data", status: 400 };
    }
  } catch (err) {
    return { error: err.message || "Failed to save avatar", status: 500 };
  }

  const avatarUrl = `/uploads/avatars/${filename}?t=${Date.now()}`;
  return { avatarUrl };
}

module.exports = {
  AVATAR_DIR,
  getStudentProfile,
  saveCourse,
  removeSavedCourse,
  setAvatarFromUpload
};
