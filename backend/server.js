const express = require("express");
const http = require("http");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const auth = require("./auth");
const quiz = require("./quiz");
const offline = require("./offline");
const chat = require("./chat");
const learningRoadmap = require("./learning-roadmap");
const examSystem = require("./exam-system");
const analytics = require("./analytics");
const advancedAnalytics = require("./advanced-analytics");
const examReadiness = require("./exam-readiness");
const rankPrediction = require("./rank-prediction");
const notesGenerator = require("./notes-generator");
const videoSummarizer = require("./video-summarizer");
const questionGenerator = require("./question-generator");
const dashboard = require("./dashboard");
const gamification = require("./gamification");
const studentProfile = require("./student-profile");
const adminApi = require("./admin");
const teacher = require("./teacher");
const cloudinaryStorage = require("./cloudinary-storage");
const pwaPush = require("./pwa-push");
const liveRoomsApi = require("./live-rooms");
const realtime = require("./realtime");
const multer = require("multer");

if (!fs.existsSync(studentProfile.AVATAR_DIR)) {
  fs.mkdirSync(studentProfile.AVATAR_DIR, { recursive: true });
}
[teacher.LESSONS_DIR, teacher.NOTES_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const teacherLessonUpload = multer({
  dest: teacher.LESSONS_DIR,
  limits: { fileSize: 12 * 1024 * 1024 }
});

const teacherNoteUpload = multer({
  dest: teacher.NOTES_DIR,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype === "application/pdf" ||
      file.mimetype.startsWith("text/") ||
      file.originalname?.toLowerCase().match(/\.(pdf|txt|md|doc|docx)$/);
    if (ok) cb(null, true);
    else cb(new Error("Allowed: PDF, TXT, MD, DOC"));
  }
});

const cloudFileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 }
});

const notesUpload = multer({
  dest: notesGenerator.UPLOAD_DIR,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/pdf" || file.originalname?.toLowerCase().endsWith(".pdf")) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF files are allowed"));
    }
  }
});

// Load .env from project root when present (optional; no extra dependency)
try {
  const envPath = path.join(__dirname, "..", ".env");
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, "utf8")
      .split(/\r?\n/)
      .forEach((line) => {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
        if (!m || process.env[m[1]] !== undefined) return;
        let val = m[2].trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        process.env[m[1]] = val;
      });
  }
} catch (_) {}

const app = express();
const httpServer = http.createServer(app);
realtime.init(httpServer, auth);
const ROOT = path.join(__dirname, "..");
const REQUESTED_PORT = Number(process.env.PORT) || 3000;
const MAX_PORT_TRIES = 10;

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(ROOT));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

function loadEducation() {
  const file = path.join(__dirname, "data", "education.json");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function loadItEducation() {
  const file = path.join(__dirname, "data", "it-education.json");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function loadRoadmaps() {
  const file = path.join(__dirname, "data", "roadmaps.json");
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const examFile = path.join(__dirname, "data", "exam-roadmaps.json");
  if (fs.existsSync(examFile)) {
    const examData = JSON.parse(fs.readFileSync(examFile, "utf8"));
    Object.assign(data, examData);
  }
  return data;
}

function loadBanners() {
  const file = path.join(__dirname, "data", "banners.json");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function requireAuth(req, res, next) {
  const token = auth.extractToken(req);
  const user = auth.getSession(token);
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  req.user = user;
  req.token = token;
  next();
}

function requireProfile(req, res, next) {
  const result = auth.requireProfileUser(req);
  if (result.error) return res.status(result.status).json({ error: result.error });
  req.user = result.user;
  req.token = result.token;
  next();
}

const requireAdmin = auth.requireRole("admin");
const requireTeacher = auth.requireRole("teacher", "admin");
const requireVerifiedEmail = auth.requireEmailVerified;

function chatContext(req, res, next) {
  const token = auth.extractToken(req);
  const user = auth.getSession(token);
  req.user = user || null;
  req.guestSessionId =
    req.headers["x-guest-session"] ||
    req.body?.guestSessionId ||
    null;
  next();
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "sharda-setu" });
});

app.get("/api/banners", (_req, res) => {
  res.json(loadBanners());
});

app.get("/api/online-education", (_req, res) => {
  res.json(loadEducation());
});

app.get("/api/online-education/exams", (_req, res) => {
  const data = loadEducation();
  res.json({ exams: data.competitiveExams });
});

app.get("/api/online-education/exams/:id", (req, res) => {
  const data = loadEducation();
  const exam = data.competitiveExams.find((e) => e.id === req.params.id);
  if (!exam) return res.status(404).json({ error: "Exam not found" });
  res.json(exam);
});

app.get("/api/online-education/subjects", (_req, res) => {
  const data = loadEducation();
  res.json({ subjects: data.subjects, playlists: data.subjectPlaylists });
});

app.get("/api/it-education", (_req, res) => {
  res.json(loadItEducation());
});

app.get("/api/it-education/exams", (_req, res) => {
  const data = loadItEducation();
  res.json({ exams: data.itExams });
});

app.get("/api/it-education/exams/:id", (req, res) => {
  const data = loadItEducation();
  const exam = data.itExams.find((e) => e.id === req.params.id);
  if (!exam) return res.status(404).json({ error: "Exam not found" });
  res.json(exam);
});

app.get("/api/roadmaps", (_req, res) => {
  res.json(loadRoadmaps());
});

app.get("/api/auth/status", (_req, res) => {
  res.json(auth.getStatus());
});

app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, password, role, adminSecret } = req.body || {};
    if (!name || !email || !password) {
      return res.status(400).json({ error: "Name, email and password are required" });
    }
    const result = await auth.register({ name, email, password, role, adminSecret });
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || "Registration failed" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }
    const result = await auth.login({ email, password });
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || "Login failed" });
  }
});

app.post("/api/auth/refresh", (req, res) => {
  const { refreshToken } = req.body || {};
  const result = auth.refresh({ refreshToken });
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

app.post("/api/auth/logout", (req, res) => {
  const token = auth.extractToken(req);
  const { refreshToken } = req.body || {};
  res.json(auth.logout({ accessToken: token, refreshToken }));
});

app.post("/api/auth/forgot-password", async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: "Email is required" });
    const result = await auth.forgotPassword({ email });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || "Request failed" });
  }
});

app.post("/api/auth/reset-password", async (req, res) => {
  try {
    const { token, password } = req.body || {};
    const result = await auth.resetPassword({ token, password });
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || "Reset failed" });
  }
});

app.get("/api/auth/verify-email", (req, res) => {
  const result = auth.verifyEmail({ token: req.query.token });
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

app.post("/api/auth/resend-verification", async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: "Email is required" });
    const result = await auth.resendVerification({ email });
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || "Request failed" });
  }
});

app.get("/api/auth/google", (_req, res) => {
  const result = auth.getGoogleAuthUrl();
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.redirect(result.url);
});

app.get("/api/auth/google/callback", async (req, res) => {
  try {
    const result = await auth.handleGoogleCallback(req.query.code);
    const appUrl = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
    if (result.error) {
      return res.redirect(`${appUrl}/auth-callback.html?error=${encodeURIComponent(result.error)}`);
    }
    const hash = new URLSearchParams({
      token: result.token,
      refreshToken: result.refreshToken
    }).toString();
    res.redirect(`${appUrl}/auth-callback.html#${hash}`);
  } catch (err) {
    const appUrl = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
    res.redirect(`${appUrl}/auth-callback.html?error=${encodeURIComponent(err.message)}`);
  }
});

app.get("/api/profile/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

app.put("/api/profile/me", requireAuth, (req, res) => {
  const result = auth.updateProfile(req.user.id, req.body || {}, req.user);
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

app.get("/api/student-profile", requireAuth, (req, res) => {
  const data = studentProfile.getStudentProfile(req.user.id, req.user.id, req.user);
  if (data.error) return res.status(data.status).json({ error: data.error });
  res.json(data);
});

app.post("/api/profile/avatar", requireAuth, cloudFileUpload.single("avatar"), async (req, res) => {
  try {
    let upload;
    if (cloudinaryStorage.isConfigured()) {
      upload = await cloudinaryStorage.uploadAvatar(req.user.id, req.file);
    } else {
      upload = studentProfile.setAvatarFromUpload(req.user.id, req.file);
    }
    if (upload.error) return res.status(upload.status).json({ error: upload.error });
    const result = auth.updateProfile(req.user.id, { avatar: upload.avatarUrl }, req.user);
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.json({ user: result.user, avatarUrl: upload.avatarUrl });
  } catch (err) {
    res.status(500).json({ error: err.message || "Avatar upload failed" });
  }
});

app.post("/api/profile/saved-courses", requireAuth, (req, res) => {
  const result = studentProfile.saveCourse(req.user.id, req.body || {});
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.status(201).json(result);
});

app.delete("/api/profile/saved-courses/:courseId", requireAuth, (req, res) => {
  res.json(studentProfile.removeSavedCourse(req.user.id, req.params.courseId));
});

app.get("/api/quiz", (_req, res) => {
  const data = quiz.loadQuizzes();
  res.json({
    title: data.title,
    description: data.description,
    categories: data.categories || [],
    subjects: data.subjects,
    questionsPerQuiz: data.questionsPerQuiz,
    ranks: data.ranks
  });
});

app.get("/api/quiz/:subject", (req, res) => {
  const questions = quiz.getPublicQuestions(req.params.subject);
  if (!questions) return res.status(404).json({ error: "Subject not found" });
  res.json({ subject: req.params.subject, questions });
});

app.post("/api/quiz/:subject/submit", (req, res) => {
  const { answers } = req.body || {};
  if (!Array.isArray(answers)) {
    return res.status(400).json({ error: "answers array is required" });
  }
  const result = quiz.evaluateQuiz(req.params.subject, answers);
  if (result.error) return res.status(result.status).json({ error: result.error });

  const token = auth.extractToken(req);
  const user = auth.getSession(token);
  if (user) {
    quiz.saveScore(user.id, result);
    const xp = gamification.recordAction(user.id, "quiz_complete", { percent: result.percent });
    result.gamification = xp;
  }

  res.json(result);
});

/* —— Admin Dashboard —— */
app.get("/api/admin/dashboard", requireAuth, requireAdmin, (_req, res) => {
  res.json(adminApi.getDashboard());
});

app.get("/api/admin/analytics", requireAuth, requireAdmin, (_req, res) => {
  res.json(adminApi.getAnalytics());
});

app.get("/api/admin/reports", requireAuth, requireAdmin, (req, res) => {
  res.json(adminApi.getReport(req.query.type || "summary"));
});

app.get("/api/admin/users", requireAuth, requireAdmin, (req, res) => {
  res.json(
    adminApi.listUsers({
      q: req.query.q,
      role: req.query.role,
      page: req.query.page,
      pageSize: req.query.pageSize
    })
  );
});

app.patch("/api/admin/users/:userId", requireAuth, requireAdmin, (req, res) => {
  const result = adminApi.updateUser(req.params.userId, req.body || {});
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

app.get("/api/admin/courses", requireAuth, requireAdmin, (req, res) => {
  res.json(
    adminApi.listCourses({
      q: req.query.q,
      source: req.query.source,
      status: req.query.status
    })
  );
});

app.post("/api/admin/courses", requireAuth, requireAdmin, (req, res) => {
  const result = adminApi.addCourse({ ...req.body, submittedBy: req.user.id, autoApprove: true });
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.status(result.status).json(result);
});

app.patch("/api/admin/courses/:courseId/visibility", requireAuth, requireAdmin, (req, res) => {
  res.json(adminApi.setCourseVisibility(req.params.courseId, Boolean(req.body?.hidden)));
});

app.get("/api/admin/videos", requireAuth, requireAdmin, (req, res) => {
  res.json(
    adminApi.listVideos({
      q: req.query.q,
      examId: req.query.examId,
      subjectId: req.query.subjectId,
      status: req.query.status,
      type: req.query.type
    })
  );
});

app.post("/api/admin/videos", requireAuth, requireAdmin, (req, res) => {
  const result = adminApi.addVideo({ ...req.body, submittedBy: req.user.id, autoApprove: true });
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.status(result.status).json(result);
});

app.patch("/api/admin/videos/visibility", requireAuth, requireAdmin, (req, res) => {
  const { id, hidden } = req.body || {};
  if (!id) return res.status(400).json({ error: "id is required" });
  res.json(adminApi.setVideoVisibility(id, Boolean(hidden)));
});

app.get("/api/admin/notes", requireAuth, requireAdmin, (req, res) => {
  res.json(adminApi.listNotes({ q: req.query.q, kind: req.query.kind }));
});

app.delete("/api/admin/notes/:noteId", requireAuth, requireAdmin, (req, res) => {
  const result = adminApi.deleteNote(req.params.noteId, req.query.kind || "notes");
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

app.patch("/api/admin/notes/:noteId/visibility", requireAuth, requireAdmin, (req, res) => {
  res.json(adminApi.setNoteVisibility(req.params.noteId, Boolean(req.body?.hidden)));
});

app.get("/api/admin/approvals", requireAuth, requireAdmin, (req, res) => {
  res.json(
    adminApi.listApprovals({
      status: req.query.status,
      type: req.query.type,
      q: req.query.q
    })
  );
});

app.post("/api/admin/approvals/:id/approve", requireAuth, requireAdmin, (req, res) => {
  const result = adminApi.approveContent(req.params.id, req.user.id, req.body?.note);
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

app.post("/api/admin/approvals/:id/reject", requireAuth, requireAdmin, (req, res) => {
  const result = adminApi.rejectContent(req.params.id, req.user.id, req.body?.note);
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

app.post("/api/content/submit", requireAuth, requireTeacher, (req, res) => {
  const { type, title, payload } = req.body || {};
  if (!type || !payload) return res.status(400).json({ error: "type and payload required" });
  const result = adminApi.submitForApproval({ userId: req.user.id, type, title, payload });
  res.status(result.status).json(result);
});

app.get("/api/admin/overview", requireAuth, requireAdmin, (_req, res) => {
  res.json(adminApi.getDashboard().stats);
});

/* —— Teacher Dashboard —— */
function teacherCtx(req, res, next) {
  req.teacherRole = req.user.role;
  next();
}

app.get("/api/teacher/dashboard", requireAuth, requireTeacher, teacherCtx, (req, res) => {
  res.json(teacher.getDashboard(req.user.id, req.user.role));
});

app.get("/api/teacher/lessons", requireAuth, requireTeacher, teacherCtx, (req, res) => {
  res.json(
    teacher.listLessons(req.user.id, req.user.role, {
      q: req.query.q,
      examId: req.query.examId
    })
  );
});

app.post(
  "/api/teacher/lessons",
  requireAuth,
  requireTeacher,
  teacherLessonUpload.single("file"),
  (req, res) => {
    try {
      const result = teacher.addLesson(req.user.id, req.body || {}, req.file);
      if (result.error) return res.status(result.status).json({ error: result.error });
      res.status(result.status).json(result);
    } catch (err) {
      res.status(500).json({ error: err.message || "Upload failed" });
    }
  }
);

app.delete("/api/teacher/lessons/:id", requireAuth, requireTeacher, (req, res) => {
  const result = teacher.deleteLesson(req.user.id, req.user.role, req.params.id);
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

app.get("/api/teacher/notes", requireAuth, requireTeacher, (req, res) => {
  res.json(teacher.listTeacherNotes(req.user.id, req.user.role, { q: req.query.q }));
});

app.post(
  "/api/teacher/notes",
  requireAuth,
  requireTeacher,
  teacherNoteUpload.single("file"),
  (req, res) => {
    try {
      const result = teacher.addTeacherNote(req.user.id, req.body || {}, req.file);
      if (result.error) return res.status(result.status).json({ error: result.error });
      res.status(result.status).json(result);
    } catch (err) {
      res.status(500).json({ error: err.message || "Upload failed" });
    }
  }
);

app.delete("/api/teacher/notes/:id", requireAuth, requireTeacher, (req, res) => {
  const result = teacher.deleteTeacherNote(req.user.id, req.user.role, req.params.id);
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

app.get("/api/teacher/quizzes", requireAuth, requireTeacher, (req, res) => {
  res.json(teacher.listQuizzes(req.user.id, req.user.role));
});

app.post("/api/teacher/quizzes", requireAuth, requireTeacher, (req, res) => {
  const result = teacher.createQuiz(req.user.id, req.body || {});
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.status(result.status).json(result);
});

app.post("/api/teacher/quizzes/:id/publish", requireAuth, requireTeacher, (req, res) => {
  const result = teacher.publishQuizToBank(req.user.id, req.user.role, req.params.id);
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

app.get("/api/teacher/assignments", requireAuth, requireTeacher, (req, res) => {
  res.json(teacher.listAssignments(req.user.id, req.user.role, { q: req.query.q }));
});

app.post("/api/teacher/assignments", requireAuth, requireTeacher, (req, res) => {
  const result = teacher.createAssignment(req.user.id, req.body || {});
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.status(result.status).json(result);
});

app.get("/api/teacher/assignments/:id/submissions", requireAuth, requireTeacher, (req, res) => {
  const result = teacher.listAssignmentSubmissions(req.user.id, req.user.role, req.params.id);
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

app.patch("/api/teacher/submissions/:id", requireAuth, requireTeacher, (req, res) => {
  const result = teacher.gradeSubmission(req.user.id, req.user.role, req.params.id, req.body || {});
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

app.get("/api/teacher/performance", requireAuth, requireTeacher, (req, res) => {
  res.json(teacher.getStudentPerformance(req.user.id, req.user.role));
});

app.get("/api/teacher/analytics", requireAuth, requireTeacher, (req, res) => {
  res.json(teacher.getCourseAnalytics(req.user.id, req.user.role));
});

app.get("/api/teacher/discussions", requireAuth, requireTeacher, (req, res) => {
  res.json(
    teacher.listDiscussions(req.user.id, req.user.role, {
      examId: req.query.examId,
      q: req.query.q,
      flaggedOnly: req.query.flagged === "1"
    })
  );
});

app.post("/api/teacher/discussions", requireAuth, requireTeacher, (req, res) => {
  const result = teacher.createDiscussion(req.user.id, req.user.name, {
    ...req.body,
    teacherId: req.user.id
  });
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.status(result.status).json(result);
});

app.patch("/api/teacher/discussions/:id", requireAuth, requireTeacher, (req, res) => {
  const result = teacher.moderateDiscussion(req.user.id, req.user.role, req.params.id, req.body || {});
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

app.get("/api/discussions", (req, res) => {
  res.json(teacher.listPublicDiscussions(req.query.examId));
});

app.post("/api/discussions", requireAuth, (req, res) => {
  const result = teacher.createDiscussion(req.user.id, req.user.name, req.body || {});
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.status(result.status).json(result);
});

app.post("/api/discussions/:id/replies", requireAuth, (req, res) => {
  const result = teacher.addReply(req.user.id, req.user.name, req.params.id, req.body?.body);
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

app.get("/api/assignments", requireAuth, (req, res) => {
  res.json(teacher.listStudentAssignments(req.user.id));
});

app.post("/api/assignments/:id/submit", requireAuth, (req, res) => {
  const result = teacher.submitAssignment(req.user.id, req.params.id, req.body || {});
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.status(result.status).json(result);
});

/* —— Offline video library (profile required) —— */

app.get("/api/offline/status", requireProfile, requireVerifiedEmail, (_req, res) => {
  res.json({
    enabled: offline.isEngineReady(),
    maxPerUser: 30,
    requiresProfile: true
  });
});

app.get("/api/offline", requireProfile, requireVerifiedEmail, (req, res) => {
  res.json({ downloads: offline.listForUser(req.user.id), user: { id: req.user.id, name: req.user.name } });
});

app.get("/api/offline/:id", requireProfile, requireVerifiedEmail, (req, res) => {
  const row = offline.findForUser(req.user.id, req.params.id);
  if (!row) return res.status(404).json({ error: "Download not found" });
  const { id, userId, filename, ...pub } = row;
  res.json({
    download: {
      id: row.id,
      videoId: row.videoId,
      title: row.title,
      source: row.source,
      examId: row.examId,
      subjectId: row.subjectId,
      status: row.status,
      error: row.error || "",
      fileSize: row.fileSize || 0,
      createdAt: row.createdAt,
      completedAt: row.completedAt || null
    }
  });
});

app.post("/api/offline/download", requireProfile, requireVerifiedEmail, (req, res) => {
  const result = offline.startDownload(req.user.id, req.body || {});
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.status(result.alreadyExists ? 200 : 202).json(result);
});

app.get("/api/offline/:id/file", (req, res) => {
  const token =
    auth.extractToken(req) ||
    (req.query.access_token ? String(req.query.access_token) : null);
  const user = auth.getSession(token);
  if (!user) return res.status(401).json({ error: "Please sign in to watch offline videos." });
  if (!user.name || !user.email) {
    return res.status(403).json({ error: "Complete your Sharda Setu profile first." });
  }
  const result = offline.streamDownload(user.id, req.params.id, req, res);
  if (result && result.error) return res.status(result.status).json({ error: result.error });
});

app.delete("/api/offline/:id", requireProfile, requireVerifiedEmail, (req, res) => {
  const result = offline.removeDownload(req.user.id, req.params.id);
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

/* —— AI Study Assistant —— */
app.get("/api/chat/status", (_req, res) => {
  res.json(chat.getStatus());
});

app.get("/api/chat/conversations", chatContext, (req, res) => {
  const owner = req.user
    ? `user:${req.user.id}`
    : req.guestSessionId
      ? `guest:${req.guestSessionId}`
      : null;
  if (!owner) {
    return res.status(400).json({ error: "Sign in or send X-Guest-Session header" });
  }
  res.json({ conversations: chat.listConversations(owner) });
});

app.get("/api/chat/conversations/:id", chatContext, (req, res) => {
  const owner = req.user
    ? `user:${req.user.id}`
    : req.guestSessionId
      ? `guest:${req.guestSessionId}`
      : null;
  if (!owner) {
    return res.status(400).json({ error: "Sign in or send X-Guest-Session header" });
  }
  const result = chat.getConversation(req.params.id, owner);
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

app.delete("/api/chat/conversations/:id", chatContext, (req, res) => {
  const owner = req.user
    ? `user:${req.user.id}`
    : req.guestSessionId
      ? `guest:${req.guestSessionId}`
      : null;
  if (!owner) {
    return res.status(400).json({ error: "Sign in or send X-Guest-Session header" });
  }
  const result = chat.deleteConversation(req.params.id, owner);
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

app.post("/api/chat", chatContext, async (req, res) => {
  const { message, conversationId, examFocus, guestSessionId } = req.body || {};
  const result = await chat.handleChat({
    message,
    conversationId,
    examFocus,
    userId: req.user?.id,
    guestSessionId: req.user ? null : guestSessionId || req.guestSessionId
  });
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

/* —— Personalized Learning Roadmap —— */
app.get("/api/roadmap/exams", (_req, res) => {
  res.json({ exams: learningRoadmap.listExams() });
});

app.post("/api/roadmap", requireAuth, async (req, res) => {
  const { examId, examDate, hoursPerDay, regenerate } = req.body || {};
  if (!examId || !examDate) {
    return res.status(400).json({ error: "examId and examDate are required" });
  }
  const result = learningRoadmap.generateRoadmap({
    userId: req.user.id,
    examId,
    examDate,
    hoursPerDay,
    regenerate: Boolean(regenerate)
  });
  if (result.error) return res.status(result.status).json({ error: result.error });

  if (result.pendingAi && result.roadmapRef && result.store) {
    await learningRoadmap.finalizeAiTips(result.roadmapRef, result.store);
    const refreshed = learningRoadmap.getRoadmapByUser(req.user.id, req.user.id);
    if (!refreshed.error) {
      return res.status(result.created ? 201 : 200).json({
        roadmap: refreshed.roadmap,
        created: result.created
      });
    }
  }

  res.status(result.created ? 201 : 200).json({
    roadmap: result.roadmap,
    created: result.created
  });
});

app.get("/api/roadmap/:userId", requireAuth, (req, res) => {
  const result = learningRoadmap.getRoadmapByUser(req.params.userId, req.user.id);
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

app.patch("/api/roadmap/:userId", requireAuth, (req, res) => {
  const { topicId, date, completed } = req.body || {};
  if (!topicId) return res.status(400).json({ error: "topicId is required" });
  const result = learningRoadmap.updateTopicCompletion(req.params.userId, req.user.id, {
    topicId,
    date,
    completed: completed !== false
  });
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

/* —— Online Examination & Mock Tests —— */
app.get("/api/exam-catalog", (_req, res) => {
  res.json(examSystem.getCatalog());
});

app.get("/api/question-bank", (req, res) => {
  res.json(
    examSystem.listQuestionBank({
      examId: req.query.examId,
      chapterId: req.query.chapterId,
      type: req.query.type,
      pyqYear: req.query.pyqYear,
      page: req.query.page,
      pageSize: req.query.pageSize
    })
  );
});

app.post("/api/question-bank", requireAuth, requireTeacher, (req, res) => {
  const result = examSystem.addQuestion(req.body || {});
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.status(result.status).json(result);
});

app.post("/api/tests", requireAuth, (req, res) => {
  const { examId, type, chapterId, pyqYear, templateId, questionCount, durationMinutes } =
    req.body || {};
  const result = examSystem.createTest({
    userId: req.user.id,
    examId,
    type,
    chapterId,
    pyqYear,
    templateId,
    questionCount,
    durationMinutes
  });
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.status(result.status).json(result);
});

app.get("/api/tests/:testId", requireAuth, (req, res) => {
  const result = examSystem.getSession(req.params.testId, req.user.id);
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

app.post("/api/submit-test", requireAuth, (req, res) => {
  const { testId, answers, timeTakenSeconds } = req.body || {};
  if (!testId) return res.status(400).json({ error: "testId is required" });
  const result = examSystem.submitTest({
    testId,
    userId: req.user.id,
    answers,
    timeTakenSeconds
  });
  if (result.error) return res.status(result.status).json({ error: result.error });
  const xp = gamification.recordAction(req.user.id, "mock_complete", {
    percentScore: result.result?.percentScore
  });
  res.json({ ...result, gamification: xp });
});

app.get("/api/results", requireAuth, (req, res) => {
  const userId = req.query.userId || req.user.id;
  const result = examSystem.getResults(userId, req.user.id, {
    examId: req.query.examId,
    type: req.query.type,
    limit: req.query.limit
  });
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

app.get("/api/results/:resultId", requireAuth, (req, res) => {
  const result = examSystem.getResultDetail(req.params.resultId, req.user.id);
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

/* —— Performance Analytics —— */
app.get("/api/analytics", requireAuth, async (req, res) => {
  const userId = req.query.userId || req.user.id;
  const data = analytics.getAnalytics(userId, req.user.id, {
    examId: req.query.examId || null
  });
  if (data.error) return res.status(data.status).json({ error: data.error });
  await analytics.finalizeAiInsights(data);
  res.json(data);
});

app.get("/api/readiness-score", requireAuth, async (req, res) => {
  const userId = req.query.userId || req.user.id;
  const data = analytics.getReadinessScore(userId, req.user.id, {
    examId: req.query.examId || null
  });
  if (data.error) return res.status(data.status).json({ error: data.error });
  res.json(data);
});

app.get("/api/analytics/advanced", requireAuth, (req, res) => {
  const userId = req.query.userId || req.user.id;
  const data = advancedAnalytics.getAdvancedAnalytics(userId, req.user.id, {
    range: req.query.range || "30d",
    examId: req.query.examId || null,
    subjectId: req.query.subjectId || null
  });
  if (data.error) return res.status(data.status).json({ error: data.error });
  res.json(data);
});

app.get("/api/analytics/platform", requireAuth, requireAdmin, (req, res) => {
  const data = advancedAnalytics.getPlatformAnalytics(req.user.role, {
    range: req.query.range || "30d"
  });
  if (data.error) return res.status(data.status).json({ error: data.error });
  res.json(data);
});

/* —— Exam Readiness Score —— */
app.get("/api/exam-readiness", requireAuth, (req, res) => {
  const userId = req.query.userId || req.user.id;
  const data = examReadiness.getExamReadinessReport(userId, req.user.id, {
    examId: req.query.examId || null
  });
  if (data.error) return res.status(data.status).json({ error: data.error });
  res.json(data);
});

app.get("/api/exam-readiness/history", requireAuth, (req, res) => {
  const userId = req.query.userId || req.user.id;
  const data = examReadiness.getReadinessHistoryOnly(userId, req.user.id, {
    examId: req.query.examId || null,
    limit: parseInt(req.query.limit, 10) || 90
  });
  if (data.error) return res.status(data.status).json({ error: data.error });
  res.json(data);
});

/* —— AI Rank Prediction —— */
app.get("/api/rank-prediction", requireAuth, (req, res) => {
  const userId = req.query.userId || req.user.id;
  const data = rankPrediction.getRankPrediction(userId, req.user.id, {
    examId: req.query.examId || "ssc-cgl"
  });
  if (data.error) return res.status(data.status).json({ error: data.error });
  res.json(data);
});

/* —— PWA (push notifications) —— */
app.get("/api/pwa/vapid-public-key", (_req, res) => {
  res.json({ publicKey: pwaPush.getPublicKey(), configured: Boolean(pwaPush.getPublicKey()) });
});

app.get("/api/pwa/status", (_req, res) => {
  res.json(pwaPush.getStatus());
});

app.post("/api/pwa/push-subscribe", requireAuth, (req, res) => {
  const result = pwaPush.subscribe(req.user.id, req.body?.subscription);
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

app.post("/api/pwa/push-unsubscribe", requireAuth, (req, res) => {
  res.json(pwaPush.unsubscribe(req.user.id, req.body?.endpoint));
});

app.post("/api/pwa/push-test", requireAuth, async (req, res) => {
  if (req.user.role !== "admin" && req.user.role !== "teacher") {
    return res.status(403).json({ error: "Forbidden" });
  }
  const targetId = req.body?.userId || req.user.id;
  const result = await pwaPush.sendToUser(targetId, {
    title: req.body?.title || "Sharda Setu",
    body: req.body?.body || "Test notification",
    url: req.body?.url || "./index.html",
    tag: "test"
  });
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

/* —— Live classes (REST; realtime via Socket.io) —— */
app.get("/api/live/rooms", (_req, res) => {
  res.json({ rooms: liveRoomsApi.listRooms() });
});

app.get("/api/live/rooms/:id", (req, res) => {
  const room = liveRoomsApi.getRoom(req.params.id);
  if (!room) return res.status(404).json({ error: "Room not found" });
  res.json({
    room,
    messages: liveRoomsApi.getMessages(req.params.id, 80),
    polls: liveRoomsApi.getPolls(req.params.id)
  });
});

app.post("/api/live/rooms", requireAuth, requireTeacher, (req, res) => {
  const room = liveRoomsApi.createRoom(req.user, req.body || {});
  res.status(201).json({ room });
});

app.patch("/api/live/rooms/:id/status", requireAuth, (req, res) => {
  const result = liveRoomsApi.updateRoomStatus(
    req.params.id,
    req.body?.status || "ended",
    req.user.id,
    req.user.role
  );
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

/* —— Cloudinary file storage —— */
app.get("/api/cloud-files/status", requireAuth, (_req, res) => {
  res.json(cloudinaryStorage.getStatus());
});

app.get("/api/cloud-files", requireAuth, (req, res) => {
  const data = cloudinaryStorage.listFiles(req.user.id, req.user.role, {
    category: req.query.category || null,
    userId: req.query.userId || null,
    all: req.query.all === "true",
    limit: parseInt(req.query.limit, 10) || 100
  });
  res.json(data);
});

app.get("/api/cloud-files/:id", requireAuth, (req, res) => {
  const data = cloudinaryStorage.getFileAccess(req.params.id, req.user.id, req.user.role);
  if (data.error) return res.status(data.status).json({ error: data.error });
  res.json(data);
});

app.post("/api/cloud-files/upload", requireAuth, cloudFileUpload.single("file"), async (req, res) => {
  try {
    const category = req.body.category || "image";
    const result = await cloudinaryStorage.uploadFile(req.user.id, req.file, {
      category,
      title: req.body.title || null
    });
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || "Upload failed" });
  }
});

app.delete("/api/cloud-files/:id", requireAuth, async (req, res) => {
  try {
    const result = await cloudinaryStorage.deleteFile(
      req.params.id,
      req.user.id,
      req.user.role
    );
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || "Delete failed" });
  }
});

/* —— AI Notes Generator —— */
app.get("/api/notes/status", (_req, res) => {
  res.json(notesGenerator.getStatus());
});

app.get("/api/notes", requireAuth, (req, res) => {
  res.json(notesGenerator.listNotes(req.user.id));
});

app.get("/api/notes/:noteId", requireAuth, (req, res) => {
  const result = notesGenerator.getNote(req.params.noteId, req.user.id);
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

app.post("/api/generate-notes", requireAuth, notesUpload.single("pdf"), async (req, res) => {
  try {
    let result;
    if (req.file) {
      result = await notesGenerator.createNotes({
        userId: req.user.id,
        sourceType: "pdf",
        pdfPath: req.file.path,
        pdfOriginalName: req.file.originalname,
        examFocus: req.body?.examFocus,
        noteType: req.body?.noteType
      });
    } else {
      const body = req.body || {};
      result = await notesGenerator.createNotes({
        userId: req.user.id,
        sourceType: body.sourceType || "youtube",
        youtubeUrl: body.youtubeUrl,
        examFocus: body.examFocus,
        noteType: body.noteType
      });
    }
    if (result.error) return res.status(result.status).json({ error: result.error });
    if (result.note) {
      result.gamification = gamification.recordAction(req.user.id, "notes_generated");
    }
    res.status(result.status).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to generate notes" });
  }
});

/* —— Gamification —— */
app.get("/api/gamification", requireAuth, (req, res) => {
  const data = gamification.getProfile(req.user.id, req.user.id);
  if (data.error) return res.status(data.status).json({ error: data.error });
  res.json(data);
});

app.get("/api/gamification/leaderboard", requireAuth, (req, res) => {
  const period = req.query.period === "weekly" ? "weekly" : "alltime";
  const board = gamification.getLeaderboard(period, 30).map((e) => ({
    ...e,
    isYou: e.userId === req.user.id
  }));
  res.json({ period, leaderboard: board });
});

app.post("/api/gamification/challenges/claim", requireAuth, (req, res) => {
  const { challengeId, period } = req.body || {};
  if (!challengeId || !period) {
    return res.status(400).json({ error: "challengeId and period (daily|weekly) required" });
  }
  const result = gamification.claimChallenge(req.user.id, challengeId, period);
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

app.post("/api/gamification/notifications/read", requireAuth, (req, res) => {
  res.json(gamification.markNotificationsRead(req.user.id));
});

/* —— Student Dashboard —— */
app.get("/api/dashboard", requireAuth, (req, res) => {
  const data = dashboard.getDashboard(req.user.id, req.user.id, req.user);
  if (data.error) return res.status(data.status).json({ error: data.error });
  res.json(data);
});

app.post("/api/dashboard/goals", requireAuth, (req, res) => {
  const result = dashboard.addGoal(req.user.id, req.body || {});
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.status(201).json(result);
});

app.patch("/api/dashboard/goals/:goalId", requireAuth, (req, res) => {
  const result = dashboard.toggleGoal(req.user.id, req.params.goalId, req.body?.completed);
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

app.get("/api/notes/:noteId/export/:format", requireAuth, async (req, res) => {
  try {
    const result = await notesGenerator.exportNote(
      req.params.noteId,
      req.user.id,
      req.params.format
    );
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.setHeader("Content-Type", result.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`);
    res.send(result.buffer);
  } catch (err) {
    res.status(500).json({ error: err.message || "Export failed" });
  }
});

/* —— YouTube Video Summarizer —— */
app.get("/api/summaries/status", (_req, res) => {
  res.json(videoSummarizer.getStatus());
});

app.get("/api/summaries", requireAuth, (req, res) => {
  res.json(videoSummarizer.listSummaries(req.user.id));
});

app.get("/api/summaries/:summaryId/export/pdf", requireAuth, async (req, res) => {
  try {
    const result = await videoSummarizer.exportPdf(req.params.summaryId, req.user.id);
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.setHeader("Content-Type", result.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`);
    res.send(result.buffer);
  } catch (err) {
    res.status(500).json({ error: err.message || "PDF export failed" });
  }
});

app.get("/api/summaries/:summaryId", requireAuth, (req, res) => {
  const result = videoSummarizer.getSummary(req.params.summaryId, req.user.id);
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

app.post("/api/summarize-video", requireAuth, async (req, res) => {
  try {
    const { youtubeUrl, examFocus } = req.body || {};
    const result = await videoSummarizer.summarizeVideo({
      userId: req.user.id,
      youtubeUrl,
      examFocus
    });
    if (result.error) return res.status(result.status).json({ error: result.error });
    result.gamification = gamification.recordAction(req.user.id, "video_summary");
    res.status(result.status).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to summarize video" });
  }
});

/* —— AI Question Generator —— */
app.get("/api/question-generator/status", (_req, res) => {
  res.json(questionGenerator.getStatus());
});

app.get("/api/question-generator", requireAuth, (req, res) => {
  res.json(questionGenerator.listSets(req.user.id));
});

app.get("/api/question-generator/:setId", requireAuth, (req, res) => {
  const result = questionGenerator.getSet(req.params.setId, req.user.id);
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

app.post("/api/question-generator", requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const result = await questionGenerator.generateQuestions({
      userId: req.user.id,
      topic: body.topic,
      examId: body.examId,
      subject: body.subject,
      questionType: body.questionType,
      difficulty: body.difficulty,
      count: body.count
    });
    if (result.error) return res.status(result.status).json({ error: result.error });
    result.gamification = gamification.recordAction(req.user.id, "questions_generated");
    res.status(result.status).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to generate questions" });
  }
});

function start(port, attemptsLeft) {
  const server = httpServer.listen(port, () => {
    const used = server.address().port;
    if (used !== REQUESTED_PORT) {
      console.log(`[warn] Port ${REQUESTED_PORT} was busy. Started on ${used} instead.`);
    }
    console.log(`Sharda Setu backend running at http://localhost:${used}`);
    console.log(`Home: http://localhost:${used}/index.html`);
    console.log(`Learn with Game: http://localhost:${used}/learn-game.html`);
    console.log(`Offline Library: http://localhost:${used}/offline.html (sign in required)`);
    console.log(`Study Assistant: http://localhost:${used}/study-assistant.html`);
    console.log(`Learning Roadmap: http://localhost:${used}/learning-roadmap.html`);
    console.log(`Mock Tests: http://localhost:${used}/mock-tests.html`);
    console.log(`Performance Analytics: http://localhost:${used}/performance-analytics.html`);
    console.log(`Advanced Analytics: http://localhost:${used}/analytics-dashboard.html`);
    console.log(`Exam Readiness: http://localhost:${used}/exam-readiness.html`);
    console.log(`Rank Prediction: http://localhost:${used}/rank-prediction.html`);
    console.log(`File Manager: http://localhost:${used}/file-manager.html`);
    console.log(`PWA: installable — manifest + service worker enabled`);
    console.log(`Live Classes: http://localhost:${used}/live-rooms.html`);
    console.log(`Socket.io: enabled on same port`);
    console.log(`Notes Generator: http://localhost:${used}/notes-generator.html`);
    console.log(`Video Summarizer: http://localhost:${used}/video-summarizer.html`);
    console.log(`Question Generator: http://localhost:${used}/question-generator.html`);
    console.log(`Admin Dashboard: http://localhost:${used}/admin-dashboard.html`);
    console.log(`Teacher Dashboard: http://localhost:${used}/teacher-dashboard.html`);
    console.log(`Student Dashboard: http://localhost:${used}/student-dashboard.html`);
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE" && attemptsLeft > 0) {
      console.log(`[warn] Port ${port} is in use. Trying ${port + 1}…`);
      setTimeout(() => start(port + 1, attemptsLeft - 1), 250);
    } else {
      console.error("Failed to start server:", err.message);
      process.exit(1);
    }
  });
}

start(REQUESTED_PORT, MAX_PORT_TRIES);
