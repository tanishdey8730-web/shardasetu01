const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const CONFIG_FILE = path.join(__dirname, "data", "gamification-config.json");
const USERS_FILE = path.join(__dirname, "data", "gamification-users.json");
const AUTH_USERS_FILE = path.join(__dirname, "data", "users.json");
const QUIZ_FILE = path.join(__dirname, "data", "quiz-scores.json");
const RESULTS_FILE = path.join(__dirname, "data", "test-results.json");
const NOTES_FILE = path.join(__dirname, "data", "generated-notes.json");

function newId() {
  return crypto.randomBytes(8).toString("hex");
}

function toDateStr(d = new Date()) {
  return new Date(d).toISOString().slice(0, 10);
}

function weekKey(d = new Date()) {
  const x = new Date(d);
  const day = x.getUTCDay() || 7;
  x.setUTCDate(x.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((x - yearStart) / 86400000 + 1) / 7);
  return `${x.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
}

function loadUsers() {
  if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify({ users: {} }, null, 2));
  }
  return JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
}

function saveUsers(store) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(store, null, 2));
}

function getOrCreateUser(store, userId) {
  if (!store.users[userId]) {
    store.users[userId] = {
      xp: 0,
      xpThisWeek: 0,
      weekKey: weekKey(),
      badges: [],
      achievements: [],
      challengesCompleted: 0,
      stats: { quizzes: 0, mocks: 0, notes: 0, goldQuizzes: 0 },
      daily: { date: null, challenges: [], claimed: [] },
      weekly: { week: null, challenges: [], claimed: [] },
      notifications: [],
      lastLoginDate: null,
      synced: false
    };
  }
  const u = store.users[userId];
  const wk = weekKey();
  if (u.weekKey !== wk) {
    u.xpThisWeek = 0;
    u.weekKey = wk;
    u.weekly = { week: wk, challenges: [], claimed: [] };
  }
  return u;
}

function getLevelInfo(xp, config) {
  const levels = config.levels;
  let current = levels[0];
  let next = levels[1] || null;
  for (let i = levels.length - 1; i >= 0; i--) {
    if (xp >= levels[i].minXp) {
      current = levels[i];
      next = levels[i + 1] || null;
      break;
    }
  }
  const xpInLevel = xp - current.minXp;
  const xpToNext = next ? next.minXp - xp : 0;
  const progressPercent = next
    ? Math.round((xpInLevel / (next.minXp - current.minXp)) * 1000) / 10
    : 100;
  return {
    level: current.level,
    title: current.title,
    icon: current.icon,
    minXp: current.minXp,
    nextLevel: next?.level || null,
    nextTitle: next?.title || null,
    xpToNext,
    progressPercent
  };
}

function pushNotification(user, { type, message, xp, badgeId, achievementId }) {
  user.notifications.unshift({
    id: newId(),
    type,
    message,
    xp: xp || 0,
    badgeId: badgeId || null,
    achievementId: achievementId || null,
    read: false,
    at: new Date().toISOString()
  });
  if (user.notifications.length > 40) user.notifications = user.notifications.slice(0, 40);
}

function awardBadge(user, config, badgeId) {
  if (user.badges.includes(badgeId)) return null;
  const badge = config.badges.find((b) => b.id === badgeId);
  if (!badge) return null;
  user.badges.push(badgeId);
  pushNotification(user, {
    type: "badge",
    message: `Badge unlocked: ${badge.name} ${badge.icon}`,
    badgeId
  });
  return badge;
}

function checkBadgesAndAchievements(user, config) {
  const xp = user.xp;
  const s = user.stats;

  if (xp > 0) awardBadge(user, config, "first_steps");
  if (s.quizzes >= 1) awardBadge(user, config, "quiz_starter");
  if (s.mocks >= 1) awardBadge(user, config, "mock_rookie");
  if (s.goldQuizzes >= 1) awardBadge(user, config, "gold_mind");
  if (s.notes >= 1) awardBadge(user, config, "note_taker");
  if (xp >= 1000) awardBadge(user, config, "xp_1000");
  if (user.challengesCompleted >= 10) awardBadge(user, config, "challenge_master");

  const level = getLevelInfo(xp, config).level;
  if (level >= 5) awardBadge(user, config, "level_5");
  if (level >= 10) awardBadge(user, config, "level_10");

  for (const ach of config.achievements) {
    if (user.achievements.includes(ach.id)) continue;
    let progress = 0;
    if (ach.metric === "quizzes") progress = s.quizzes;
    else if (ach.metric === "mocks") progress = s.mocks;
    else if (ach.metric === "notes") progress = s.notes;
    else if (ach.metric === "xp") progress = xp;

    if (progress >= ach.target) {
      user.achievements.push(ach.id);
      const bonus = config.xpRewards.achievement;
      user.xp += bonus;
      user.xpThisWeek += bonus;
      pushNotification(user, {
        type: "achievement",
        message: `Achievement: ${ach.name} ${ach.icon} (+${bonus} XP)`,
        xp: bonus,
        achievementId: ach.id
      });
    }
  }
}

function addXp(user, config, amount, reason) {
  if (amount <= 0) return { xpGained: 0 };
  const prevLevel = getLevelInfo(user.xp, config).level;
  user.xp += amount;
  user.xpThisWeek += amount;
  pushNotification(user, {
    type: "xp",
    message: `+${amount} XP — ${reason}`,
    xp: amount
  });
  const newLevel = getLevelInfo(user.xp, config).level;
  if (newLevel > prevLevel) {
    const info = getLevelInfo(user.xp, config);
    pushNotification(user, {
      type: "level_up",
      message: `Level up! You are now ${info.title} ${info.icon} (Level ${info.level})`,
      xp: 0
    });
  }
  checkBadgesAndAchievements(user, config);
  return { xpGained: amount, leveledUp: newLevel > prevLevel };
}

function pickChallenges(pool, count, seedStr) {
  let hash = 0;
  for (let i = 0; i < seedStr.length; i++) hash = (hash * 31 + seedStr.charCodeAt(i)) | 0;
  const sorted = [...pool].sort((a, b) => {
    const ha = Math.abs(hash + a.id.length) % 1000;
    const hb = Math.abs(hash + b.id.length) % 1000;
    return ha - hb;
  });
  return sorted.slice(0, count);
}

function ensureChallenges(user, config, userId) {
  const today = toDateStr();
  if (user.daily.date !== today) {
    user.daily = {
      date: today,
      challenges: pickChallenges(config.dailyChallengePool, 2, `${today}:${userId}`),
      claimed: [],
      progress: {}
    };
  }
  const wk = weekKey();
  if (user.weekly.week !== wk) {
    user.weekly = {
      week: wk,
      challenges: pickChallenges(config.weeklyChallengePool, 2, `${wk}:${userId}`),
      claimed: [],
      progress: {}
    };
  }
}

function computeMetrics(userId) {
  const today = toDateStr();
  const wk = weekKey();
  const startOfWeek = new Date();
  startOfWeek.setDate(startOfWeek.getDate() - 6);

  const quizzes = loadJson(QUIZ_FILE, { scores: [] }).scores.filter((s) => s.userId === userId);
  const mocks = loadJson(RESULTS_FILE, { results: [] }).results.filter((r) => r.userId === userId);

  const quizToday = quizzes.filter((q) => toDateStr(q.at) === today).length;
  const mockToday = mocks.filter((m) => toDateStr(m.submittedAt) === today).length;
  const quizWeek = quizzes.filter((q) => new Date(q.at) >= startOfWeek).length;
  const mockWeek = mocks.filter((m) => new Date(m.submittedAt) >= startOfWeek).length;
  const score70Today = [
    ...quizzes.filter((q) => toDateStr(q.at) === today && q.percent >= 70),
    ...mocks.filter((m) => toDateStr(m.submittedAt) === today && m.percentScore >= 70)
  ].length;

  const activeDays = new Set();
  [...quizzes, ...mocks].forEach((e) => {
    const d = toDateStr(e.at || e.submittedAt);
    if (new Date(d) >= startOfWeek) activeDays.add(d);
  });

  const store = loadUsers();
  const u = store.users[userId];
  const xpWeek = u?.xpThisWeek || 0;

  return {
    quiz_today: quizToday,
    mock_today: mockToday,
    activity_today: quizToday + mockToday > 0 ? 1 : 0,
    score_70_today: score70Today >= 1 ? 1 : 0,
    quiz_week: quizWeek,
    mock_week: mockWeek,
    xp_week: xpWeek,
    active_days_week: activeDays.size
  };
}

function loadJson(file, fb) {
  if (!fs.existsSync(file)) return fb;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function challengeProgress(ch, metrics) {
  const current = metrics[ch.metric] ?? 0;
  return {
    ...ch,
    current: Math.min(current, ch.target),
    target: ch.target,
    completed: current >= ch.target,
    progressPercent: Math.min(100, Math.round((current / ch.target) * 100))
  };
}

function recordAction(userId, action, meta = {}) {
  const config = loadConfig();
  const store = loadUsers();
  const user = getOrCreateUser(store, userId);
  ensureChallenges(user, config, userId);

  let xp = 0;
  let reason = action;

  switch (action) {
    case "quiz_complete":
      user.stats.quizzes += 1;
      xp = config.xpRewards.quiz_complete;
      if (meta.percent >= 90) {
        user.stats.goldQuizzes += 1;
        xp += config.xpRewards.quiz_gold;
        awardBadge(user, config, "gold_mind");
        reason = "Quiz completed (Gold bonus!)";
      } else {
        reason = "Quiz completed";
      }
      break;
    case "mock_complete":
      user.stats.mocks += 1;
      xp = config.xpRewards.mock_complete;
      if (meta.percentScore >= 80) {
        xp += config.xpRewards.mock_high_score;
        awardBadge(user, config, "mock_ace");
        reason = "Mock test completed (High score!)";
      } else reason = "Mock test completed";
      break;
    case "notes_generated":
      user.stats.notes += 1;
      xp = config.xpRewards.notes_generated;
      reason = "AI notes generated";
      break;
    case "video_summary":
      user.stats.videoSummaries = (user.stats.videoSummaries || 0) + 1;
      xp = config.xpRewards.video_summary || 55;
      reason = "Video summarized";
      break;
    case "questions_generated":
      user.stats.questionsGenerated = (user.stats.questionsGenerated || 0) + 1;
      xp = config.xpRewards.questions_generated || 45;
      reason = "AI questions generated";
      break;
    case "roadmap_task":
      xp = config.xpRewards.roadmap_task;
      reason = "Roadmap task completed";
      break;
    case "assistant_chat":
      xp = config.xpRewards.assistant_chat;
      reason = "Study Assistant used";
      break;
    default:
      break;
  }

  const result = xp > 0 ? addXp(user, config, xp, reason) : {};
  saveUsers(store);
  return { ...result, totalXp: user.xp };
}

function recordDailyLogin(userId) {
  const config = loadConfig();
  const store = loadUsers();
  const user = getOrCreateUser(store, userId);
  ensureChallenges(user, config, userId);
  const today = toDateStr();
  let gained = null;
  if (user.lastLoginDate !== today) {
    user.lastLoginDate = today;
    gained = addXp(user, config, config.xpRewards.daily_login, "Daily login bonus");
  }
  checkBadgesAndAchievements(user, config);
  saveUsers(store);
  return gained;
}

function syncFromHistory(userId) {
  const store = loadUsers();
  const user = getOrCreateUser(store, userId);
  if (user.synced) return { synced: false };

  const quizzes = loadJson(QUIZ_FILE, { scores: [] }).scores.filter((s) => s.userId === userId);
  const mocks = loadJson(RESULTS_FILE, { results: [] }).results.filter((r) => r.userId === userId);
  const notes = loadJson(NOTES_FILE, { notes: [] }).notes.filter((n) => n.userId === userId);

  user.stats.quizzes = quizzes.length;
  user.stats.mocks = mocks.length;
  user.stats.notes = notes.length;
  user.stats.goldQuizzes = quizzes.filter((q) => q.percent >= 90).length;

  const config = loadConfig();
  let bonusXp = 0;
  bonusXp += quizzes.length * 20;
  bonusXp += mocks.length * 40;
  bonusXp += notes.length * 30;
  user.xp += bonusXp;
  user.xpThisWeek += Math.min(bonusXp, 200);
  user.synced = true;
  checkBadgesAndAchievements(user, config);
  if (bonusXp > 0) {
    pushNotification(user, {
      type: "sync",
      message: `Welcome back! +${bonusXp} XP synced from your past activity.`,
      xp: bonusXp
    });
  }
  saveUsers(store);
  return { synced: true, xpSynced: bonusXp };
}

function claimChallenge(userId, challengeId, period) {
  const config = loadConfig();
  const store = loadUsers();
  const user = getOrCreateUser(store, userId);
  ensureChallenges(user, config, userId);
  const metrics = computeMetrics(userId);

  const bucket = period === "weekly" ? user.weekly : user.daily;
  if (!bucket) return { error: "Invalid period", status: 400 };

  const ch = bucket.challenges.find((c) => c.id === challengeId);
  if (!ch) return { error: "Challenge not found", status: 404 };

  const prog = challengeProgress(ch, metrics);
  if (!prog.completed) return { error: "Challenge not completed yet", status: 400 };
  if (bucket.claimed.includes(challengeId)) {
    return { error: "Already claimed", status: 400 };
  }

  bucket.claimed.push(challengeId);
  user.challengesCompleted += 1;
  const xp =
    period === "weekly" ? config.xpRewards.challenge_weekly : config.xpRewards.challenge_daily;
  const gained = addXp(user, config, ch.xp || xp, `${period} challenge: ${ch.title}`);
  saveUsers(store);
  return { claimed: true, xpGained: gained.xpGained, totalXp: user.xp };
}

function getLeaderboard(period = "alltime", limit = 25) {
  const config = loadConfig();
  const store = loadUsers();
  const authStore = loadJson(AUTH_USERS_FILE, { users: [] });

  const entries = Object.entries(store.users).map(([userId, data]) => ({
    userId,
    xp: period === "weekly" ? data.xpThisWeek || 0 : data.xp || 0,
    level: getLevelInfo(data.xp || 0, config)
  }));

  entries.sort((a, b) => b.xp - a.xp);

  return entries.slice(0, limit).map((e, i) => {
    const authUser = authStore.users.find((u) => u.id === e.userId);
    const name = authUser?.name || "Student";
    const parts = name.split(" ");
    const display =
      parts.length > 1
        ? `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`
        : parts[0];
    return {
      rank: i + 1,
      userId: e.userId,
      displayName: display,
      avatar: authUser?.avatar || null,
      xp: e.xp,
      level: e.level.level,
      levelTitle: e.level.title,
      levelIcon: e.level.icon,
      isYou: false
    };
  });
}

function getProfile(userId, requesterId) {
  if (userId !== requesterId) {
    return { error: "Access denied", status: 403 };
  }

  syncFromHistory(userId);
  recordDailyLogin(userId);

  const config = loadConfig();
  const store = loadUsers();
  const user = getOrCreateUser(store, userId);
  ensureChallenges(user, config, userId);
  const metrics = computeMetrics(userId);

  const daily = user.daily.challenges.map((c) => ({
    ...challengeProgress(c, metrics),
    period: "daily",
    claimed: user.daily.claimed.includes(c.id)
  }));
  const weekly = user.weekly.challenges.map((c) => ({
    ...challengeProgress(c, metrics),
    period: "weekly",
    claimed: user.weekly.claimed.includes(c.id)
  }));

  const level = getLevelInfo(user.xp, config);
  const badges = user.badges
    .map((id) => config.badges.find((b) => b.id === id))
    .filter(Boolean);
  const achievements = config.achievements.map((a) => ({
    ...a,
    unlocked: user.achievements.includes(a.id),
    progress:
      a.metric === "quizzes"
        ? user.stats.quizzes
        : a.metric === "mocks"
          ? user.stats.mocks
          : a.metric === "notes"
            ? user.stats.notes
            : user.xp
  }));

  const leaderboard = getLeaderboard("alltime", 25).map((e) => ({
    ...e,
    isYou: e.userId === userId
  }));
  const weeklyBoard = getLeaderboard("weekly", 25).map((e) => ({
    ...e,
    isYou: e.userId === userId
  }));

  const userRank =
    leaderboard.findIndex((e) => e.userId === userId) + 1 || leaderboard.length + 1;

  const unreadNotifications = user.notifications.filter((n) => !n.read);

  return {
    xp: user.xp,
    xpThisWeek: user.xpThisWeek,
    level,
    badges,
    allBadges: config.badges.map((b) => ({
      ...b,
      earned: user.badges.includes(b.id)
    })),
    achievements,
    dailyChallenges: daily,
    weeklyChallenges: weekly,
    leaderboard,
    weeklyLeaderboard: weeklyBoard,
    rank: userRank > 0 ? userRank : null,
    stats: user.stats,
    notifications: user.notifications.slice(0, 15),
    unreadCount: unreadNotifications.length
  };
}

function markNotificationsRead(userId) {
  const store = loadUsers();
  const user = getOrCreateUser(store, userId);
  user.notifications.forEach((n) => {
    n.read = true;
  });
  saveUsers(store);
  return { ok: true };
}

function applyStreakBadges(userId, streakDays) {
  const config = loadConfig();
  const store = loadUsers();
  const user = getOrCreateUser(store, userId);
  if (streakDays >= 3) awardBadge(user, config, "streak_3");
  if (streakDays >= 7) awardBadge(user, config, "streak_7");
  if (streakDays >= 30) awardBadge(user, config, "streak_30");
  saveUsers(store);
}

module.exports = {
  recordAction,
  recordDailyLogin,
  getProfile,
  getLeaderboard,
  claimChallenge,
  markNotificationsRead,
  applyStreakBadges,
  syncFromHistory,
  getLevelInfo
};
