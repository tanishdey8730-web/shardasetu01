const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const USERS_FILE = path.join(__dirname, "data", "users.json");
const EDUCATION_FILE = path.join(__dirname, "data", "education.json");
const IT_EDUCATION_FILE = path.join(__dirname, "data", "it-education.json");
const NOTES_FILE = path.join(__dirname, "data", "generated-notes.json");
const SUMMARIES_FILE = path.join(__dirname, "data", "video-summaries.json");
const RESULTS_FILE = path.join(__dirname, "data", "test-results.json");
const QUIZ_FILE = path.join(__dirname, "data", "quiz-scores.json");
const ADMIN_STORE_FILE = path.join(__dirname, "data", "admin-store.json");

function newId() {
  return crypto.randomBytes(10).toString("hex");
}

function loadJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function saveJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function loadAdminStore() {
  const store = loadJson(ADMIN_STORE_FILE, {
    pending: [],
    customCourses: [],
    customVideos: [],
    hidden: { videoKeys: [], courseIds: [], noteIds: [] }
  });
  if (!store.hidden) store.hidden = { videoKeys: [], courseIds: [], noteIds: [] };
  return store;
}

function saveAdminStore(store) {
  saveJson(ADMIN_STORE_FILE, store);
}

function loadUsers() {
  return loadJson(USERS_FILE, { users: [], refreshTokens: [], sessions: [] });
}

function saveUsers(store) {
  saveJson(USERS_FILE, store);
}

function publicUser(u) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    avatar: u.avatar,
    examGoal: u.examGoal || "",
    emailVerified: Boolean(u.emailVerified),
    disabled: Boolean(u.disabled),
    authProvider: u.authProvider || "local",
    createdAt: u.createdAt,
    updatedAt: u.updatedAt
  };
}

function matchQuery(text, q) {
  if (!q) return true;
  return String(text || "")
    .toLowerCase()
    .includes(String(q).toLowerCase());
}

function videoKey(examId, subjectId, videoId) {
  return `${examId}:${subjectId || "general"}:${videoId}`;
}

function flattenVideosFromEducation(data, source = "gov") {
  const list = [];
  for (const exam of data.competitiveExams || data.itExams || []) {
    const examId = exam.id;
    const examName = exam.name;
    if (exam.videos) {
      for (const [subjectId, videos] of Object.entries(exam.videos)) {
        for (const v of videos || []) {
          list.push({
            id: videoKey(examId, subjectId, v.videoId),
            videoId: v.videoId,
            title: v.title,
            duration: v.duration || "",
            examId,
            examName,
            subjectId,
            source,
            type: "video",
            status: "published"
          });
        }
      }
    }
    for (const pl of exam.playlists || []) {
      list.push({
        id: `playlist:${examId}:${pl.playlistId}`,
        videoId: pl.playlistId,
        title: pl.title,
        channel: pl.channel,
        examId,
        examName,
        subjectId: "playlist",
        source,
        type: "playlist",
        status: "published"
      });
    }
  }
  return list;
}

function getAllCourses() {
  const admin = loadAdminStore();
  const edu = loadJson(EDUCATION_FILE, { competitiveExams: [] });
  const it = loadJson(IT_EDUCATION_FILE, { itExams: [] });
  const courses = [];

  for (const e of edu.competitiveExams || []) {
    courses.push({
      id: e.id,
      name: e.name,
      description: e.description || "",
      parent: e.parent,
      source: "government",
      type: "exam",
      status: admin.hidden.courseIds.includes(e.id) ? "hidden" : "published",
      playlistCount: (e.playlists || []).length
    });
  }
  for (const e of it.itExams || []) {
    courses.push({
      id: e.id,
      name: e.name,
      description: e.description || "",
      source: "it",
      type: "exam",
      status: admin.hidden.courseIds.includes(e.id) ? "hidden" : "published",
      playlistCount: (e.playlists || []).length
    });
  }
  for (const c of admin.customCourses) {
    courses.push({ ...c, source: "custom", type: "exam", status: c.status || "published" });
  }
  for (const p of admin.pending.filter((x) => x.type === "course" && x.status === "pending")) {
    courses.push({
      id: p.id,
      name: p.payload?.name || p.title,
      description: p.payload?.description || "",
      source: "pending",
      type: "exam",
      status: "pending",
      pendingId: p.id
    });
  }
  return courses;
}

function getAllVideos() {
  const admin = loadAdminStore();
  const edu = loadJson(EDUCATION_FILE, { competitiveExams: [] });
  const it = loadJson(IT_EDUCATION_FILE, { itExams: [] });
  let videos = [
    ...flattenVideosFromEducation(edu, "gov"),
    ...flattenVideosFromEducation(it, "it")
  ];

  videos = videos.filter((v) => !admin.hidden.videoKeys.includes(v.id));

  for (const v of admin.customVideos) {
    videos.push({ ...v, source: "custom", status: v.status || "published" });
  }

  for (const p of admin.pending.filter((x) => x.type === "video" && x.status === "pending")) {
    videos.push({
      id: p.id,
      title: p.payload?.title || p.title,
      videoId: p.payload?.videoId,
      examId: p.payload?.examId,
      examName: p.payload?.examName || p.payload?.examId,
      subjectId: p.payload?.subjectId,
      source: "pending",
      type: "video",
      status: "pending",
      pendingId: p.id
    });
  }

  return videos;
}

function getDashboard() {
  const users = loadUsers().users;
  const notes = loadJson(NOTES_FILE, { notes: [] }).notes;
  const summaries = loadJson(SUMMARIES_FILE, { summaries: [] }).summaries;
  const results = loadJson(RESULTS_FILE, { results: [] }).results;
  const quizzes = loadJson(QUIZ_FILE, { scores: [] }).scores;
  const admin = loadAdminStore();
  const pending = admin.pending.filter((p) => p.status === "pending");

  const roles = users.reduce((acc, u) => {
    acc[u.role] = (acc[u.role] || 0) + 1;
    return acc;
  }, {});

  const last7 = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    last7.push({
      date: key,
      tests: results.filter((r) => r.submittedAt?.startsWith(key)).length,
      signups: users.filter((u) => u.createdAt?.startsWith(key)).length
    });
  }

  return {
    stats: {
      users: users.length,
      activeUsers: users.filter((u) => !u.disabled).length,
      roles,
      notes: notes.length,
      summaries: summaries.length,
      mockTests: results.length,
      quizzes: quizzes.length,
      courses: getAllCourses().length,
      videos: getAllVideos().length,
      pendingApprovals: pending.length
    },
    pendingPreview: pending.slice(0, 5).map(publicPending),
    charts: {
      activityLast7Days: last7
    }
  };
}

function publicPending(p) {
  return {
    id: p.id,
    type: p.type,
    title: p.title,
    status: p.status,
    submittedBy: p.submittedBy,
    submittedAt: p.submittedAt,
    payload: p.payload
  };
}

function listUsers({ q, role, page = 1, pageSize = 20 }) {
  const store = loadUsers();
  let list = store.users.map(publicUser);

  if (role) list = list.filter((u) => u.role === role);
  if (q) {
    list = list.filter(
      (u) => matchQuery(u.name, q) || matchQuery(u.email, q) || matchQuery(u.id, q)
    );
  }

  list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const total = list.length;
  const start = (Number(page) - 1) * Number(pageSize);
  const users = list.slice(start, start + Number(pageSize));

  return { users, total, page: Number(page), pageSize: Number(pageSize) };
}

function updateUser(userId, updates) {
  const store = loadUsers();
  const user = store.users.find((u) => u.id === userId);
  if (!user) return { error: "User not found", status: 404 };

  if (updates.role !== undefined) {
    const r = String(updates.role).toLowerCase();
    if (["student", "teacher", "admin"].includes(r)) user.role = r;
  }
  if (updates.disabled !== undefined) user.disabled = Boolean(updates.disabled);
  if (updates.name !== undefined) user.name = String(updates.name).trim();
  user.updatedAt = new Date().toISOString();
  saveUsers(store);
  return { user: publicUser(user) };
}

function listCourses({ q, source, status }) {
  let courses = getAllCourses();
  if (q) courses = courses.filter((c) => matchQuery(c.name, q) || matchQuery(c.id, q));
  if (source) courses = courses.filter((c) => c.source === source);
  if (status) courses = courses.filter((c) => c.status === status);
  return { courses, total: courses.length };
}

function addCourse(payload) {
  const admin = loadAdminStore();
  const course = {
    id: payload.id || `course-${newId()}`,
    name: String(payload.name || "").trim(),
    description: String(payload.description || "").trim(),
    source: "custom",
    type: "exam",
    status: payload.autoApprove ? "published" : "pending",
    playlistCount: 0,
    createdAt: new Date().toISOString()
  };
  if (!course.name) return { error: "Course name is required", status: 400 };

  if (payload.submitForApproval) {
    const pending = {
      id: newId(),
      type: "course",
      title: course.name,
      status: "pending",
      payload: course,
      submittedBy: payload.submittedBy || "admin",
      submittedAt: new Date().toISOString()
    };
    admin.pending.unshift(pending);
    saveAdminStore(admin);
    return { pending: publicPending(pending), status: 201 };
  }

  admin.customCourses.unshift(course);
  saveAdminStore(admin);
  return { course, status: 201 };
}

function setCourseVisibility(courseId, hidden) {
  const admin = loadAdminStore();
  if (!hidden) {
    admin.hidden.courseIds = admin.hidden.courseIds.filter((id) => id !== courseId);
  } else if (!admin.hidden.courseIds.includes(courseId)) {
    admin.hidden.courseIds.push(courseId);
  }
  saveAdminStore(admin);
  return { ok: true, hidden };
}

function listVideos({ q, examId, subjectId, status, type }) {
  let videos = getAllVideos();
  if (q) videos = videos.filter((v) => matchQuery(v.title, q) || matchQuery(v.videoId, q));
  if (examId) videos = videos.filter((v) => v.examId === examId);
  if (subjectId) videos = videos.filter((v) => v.subjectId === subjectId);
  if (status) videos = videos.filter((v) => v.status === status);
  if (type) videos = videos.filter((v) => v.type === type);
  return { videos, total: videos.length };
}

function addVideo(payload) {
  const admin = loadAdminStore();
  const video = {
    id: payload.id || `vid-${newId()}`,
    videoId: String(payload.videoId || "").trim(),
    title: String(payload.title || "").trim(),
    duration: payload.duration || "",
    examId: payload.examId || "general",
    examName: payload.examName || payload.examId,
    subjectId: payload.subjectId || "maths",
    source: "custom",
    type: payload.type || "video",
    status: payload.autoApprove ? "published" : "pending"
  };
  if (!video.title || !video.videoId) {
    return { error: "title and videoId are required", status: 400 };
  }

  if (payload.submitForApproval) {
    const pending = {
      id: newId(),
      type: "video",
      title: video.title,
      status: "pending",
      payload: video,
      submittedBy: payload.submittedBy || "admin",
      submittedAt: new Date().toISOString()
    };
    admin.pending.unshift(pending);
    saveAdminStore(admin);
    return { pending: publicPending(pending), status: 201 };
  }

  admin.customVideos.unshift(video);
  saveAdminStore(admin);
  return { video, status: 201 };
}

function setVideoVisibility(videoKeyId, hidden) {
  const admin = loadAdminStore();
  if (!hidden) {
    admin.hidden.videoKeys = admin.hidden.videoKeys.filter((k) => k !== videoKeyId);
  } else if (!admin.hidden.videoKeys.includes(videoKeyId)) {
    admin.hidden.videoKeys.push(videoKeyId);
  }
  saveAdminStore(admin);
  return { ok: true, hidden };
}

function listNotes({ q, kind }) {
  const notes = loadJson(NOTES_FILE, { notes: [] }).notes;
  const summaries = loadJson(SUMMARIES_FILE, { summaries: [] }).summaries;
  const admin = loadAdminStore();
  const hidden = new Set(admin.hidden.noteIds || []);

  let items = [];
  if (kind !== "summary") {
    items = items.concat(
      notes.map((n) => ({
        id: n.id,
        kind: "notes",
        title: n.title,
        userId: n.userId,
        sourceType: n.sourceType,
        createdAt: n.createdAt,
        status: hidden.has(n.id) ? "hidden" : "published"
      }))
    );
  }
  if (kind !== "notes") {
    items = items.concat(
      summaries.map((s) => ({
        id: s.id,
        kind: "summary",
        title: s.title,
        userId: s.userId,
        sourceType: "youtube",
        youtubeUrl: s.youtubeUrl,
        createdAt: s.createdAt,
        status: hidden.has(s.id) ? "hidden" : "published"
      }))
    );
  }

  if (q) items = items.filter((n) => matchQuery(n.title, q) || matchQuery(n.userId, q));
  items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return { notes: items.slice(0, 100), total: items.length };
}

function deleteNote(noteId, kind) {
  if (kind === "summary") {
    const store = loadJson(SUMMARIES_FILE, { summaries: [] });
    const before = store.summaries.length;
    store.summaries = store.summaries.filter((n) => n.id !== noteId);
    if (store.summaries.length === before) return { error: "Not found", status: 404 };
    saveJson(SUMMARIES_FILE, store);
    return { ok: true };
  }
  const store = loadJson(NOTES_FILE, { notes: [] });
  const before = store.notes.length;
  store.notes = store.notes.filter((n) => n.id !== noteId);
  if (store.notes.length === before) return { error: "Not found", status: 404 };
  saveJson(NOTES_FILE, store);
  return { ok: true };
}

function setNoteVisibility(noteId, hidden) {
  const admin = loadAdminStore();
  if (!hidden) {
    admin.hidden.noteIds = (admin.hidden.noteIds || []).filter((id) => id !== noteId);
  } else if (!admin.hidden.noteIds.includes(noteId)) {
    admin.hidden.noteIds.push(noteId);
  }
  saveAdminStore(admin);
  return { ok: true, hidden };
}

function listApprovals({ status = "pending", type, q }) {
  const admin = loadAdminStore();
  let list = admin.pending;
  if (status) list = list.filter((p) => p.status === status);
  if (type) list = list.filter((p) => p.type === type);
  if (q) list = list.filter((p) => matchQuery(p.title, q) || matchQuery(p.type, q));
  list = [...list].sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
  return { approvals: list.map(publicPending), total: list.length };
}

function approveContent(pendingId, reviewerId, note) {
  const admin = loadAdminStore();
  const item = admin.pending.find((p) => p.id === pendingId);
  if (!item) return { error: "Approval item not found", status: 404 };
  if (item.status !== "pending") return { error: "Already reviewed", status: 400 };

  item.status = "approved";
  item.reviewedAt = new Date().toISOString();
  item.reviewedBy = reviewerId;
  item.reviewNote = note || "";

  if (item.type === "course") {
    admin.customCourses.unshift({ ...item.payload, status: "published" });
  } else if (item.type === "video") {
    admin.customVideos.unshift({ ...item.payload, status: "published" });
  } else if (item.type === "note") {
    // notes already exist; just mark visible
    admin.hidden.noteIds = (admin.hidden.noteIds || []).filter((id) => id !== item.payload?.noteId);
  }

  saveAdminStore(admin);
  return { approval: publicPending(item) };
}

function rejectContent(pendingId, reviewerId, note) {
  const admin = loadAdminStore();
  const item = admin.pending.find((p) => p.id === pendingId);
  if (!item) return { error: "Approval item not found", status: 404 };
  item.status = "rejected";
  item.reviewedAt = new Date().toISOString();
  item.reviewedBy = reviewerId;
  item.reviewNote = note || "";
  saveAdminStore(admin);
  return { approval: publicPending(item) };
}

function submitForApproval({ userId, type, title, payload }) {
  const admin = loadAdminStore();
  const item = {
    id: newId(),
    type,
    title: title || payload?.title || payload?.name || "Untitled",
    status: "pending",
    payload,
    submittedBy: userId,
    submittedAt: new Date().toISOString()
  };
  admin.pending.unshift(item);
  saveAdminStore(admin);
  return { pending: publicPending(item), status: 201 };
}

function getAnalytics() {
  const users = loadUsers().users;
  const results = loadJson(RESULTS_FILE, { results: [] }).results;
  const notes = loadJson(NOTES_FILE, { notes: [] }).notes;

  const byExam = {};
  for (const r of results) {
    byExam[r.examId] = (byExam[r.examId] || 0) + 1;
  }

  const avgScore =
    results.length > 0
      ? Math.round((results.reduce((s, r) => s + r.percentScore, 0) / results.length) * 10) / 10
      : 0;

  return {
    userGrowth: users.length,
    verifiedUsers: users.filter((u) => u.emailVerified).length,
    testsByExam: Object.entries(byExam)
      .map(([examId, count]) => ({ examId, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    avgMockScore: avgScore,
    notesGenerated: notes.length,
    topUsersByTests: Object.entries(
      results.reduce((acc, r) => {
        acc[r.userId] = (acc[r.userId] || 0) + 1;
        return acc;
      }, {})
    )
      .map(([userId, count]) => ({ userId, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
  };
}

function getReport(type = "summary") {
  const dash = getDashboard();
  const analytics = getAnalytics();

  if (type === "users") {
    return {
      type,
      generatedAt: new Date().toISOString(),
      users: listUsers({ pageSize: 500 }),
      analytics
    };
  }
  if (type === "content") {
    return {
      type,
      generatedAt: new Date().toISOString(),
      courses: listCourses({}),
      videos: listVideos({}).videos.slice(0, 200),
      notes: listNotes({})
    };
  }

  return {
    type: "summary",
    generatedAt: new Date().toISOString(),
    dashboard: dash,
    analytics
  };
}

module.exports = {
  getDashboard,
  listUsers,
  updateUser,
  listCourses,
  addCourse,
  setCourseVisibility,
  listVideos,
  addVideo,
  setVideoVisibility,
  listNotes,
  deleteNote,
  setNoteVisibility,
  listApprovals,
  approveContent,
  rejectContent,
  submitForApproval,
  getAnalytics,
  getReport
};
