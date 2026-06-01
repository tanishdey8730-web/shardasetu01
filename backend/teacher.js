const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const examSystem = require("./exam-system");
const adminApi = require("./admin");

const STORE_FILE = path.join(__dirname, "data", "teacher-store.json");
const USERS_FILE = path.join(__dirname, "data", "users.json");
const RESULTS_FILE = path.join(__dirname, "data", "test-results.json");
const QUIZ_FILE = path.join(__dirname, "data", "quiz-scores.json");
const LESSONS_DIR = path.join(__dirname, "uploads", "teacher-lessons");
const NOTES_DIR = path.join(__dirname, "uploads", "teacher-notes");

function newId() {
  return crypto.randomBytes(10).toString("hex");
}

function loadStore() {
  if (!fs.existsSync(STORE_FILE)) {
    fs.writeFileSync(
      STORE_FILE,
      JSON.stringify(
        { lessons: [], teacherNotes: [], quizzes: [], assignments: [], submissions: [], discussions: [] },
        null,
        2
      )
    );
  }
  return JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
}

function saveStore(store) {
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2));
}

function loadJson(file, fb) {
  if (!fs.existsSync(file)) return fb;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function matchQ(text, q) {
  if (!q) return true;
  return String(text || "")
    .toLowerCase()
    .includes(String(q).toLowerCase());
}

function isOwner(teacherId, recordTeacherId, userRole) {
  return recordTeacherId === teacherId || userRole === "admin";
}

function getDashboard(teacherId, role) {
  const store = loadStore();
  const lessons = store.lessons.filter((l) => l.teacherId === teacherId || role === "admin");
  const notes = store.teacherNotes.filter((n) => n.teacherId === teacherId || role === "admin");
  const quizzes = store.quizzes.filter((q) => q.teacherId === teacherId || role === "admin");
  const assignments = store.assignments.filter((a) => a.teacherId === teacherId || role === "admin");
  const discussions = store.discussions.filter((d) => d.teacherId === teacherId || role === "admin");
  const subs = store.submissions.filter((s) => {
    const a = store.assignments.find((x) => x.id === s.assignmentId);
    return a && (a.teacherId === teacherId || role === "admin");
  });

  const pendingModeration = store.discussions.filter(
    (d) =>
      (d.teacherId === teacherId || role === "admin") &&
      (d.flagged || (d.replies || []).some((r) => r.flagged))
  ).length;

  return {
    stats: {
      lessons: lessons.length,
      notes: notes.length,
      quizzes: quizzes.length,
      assignments: assignments.length,
      submissions: subs.length,
      discussions: discussions.length,
      pendingModeration
    },
    recentLessons: lessons.slice(0, 5),
    recentAssignments: assignments.slice(0, 5),
    pendingDiscussions: discussions.filter((d) => d.flagged).slice(0, 5)
  };
}

function addLesson(teacherId, payload, file) {
  const store = loadStore();
  const lesson = {
    id: newId(),
    teacherId,
    title: String(payload.title || "").trim(),
    description: String(payload.description || "").trim(),
    examId: payload.examId || "",
    videoId: payload.videoId || "",
    youtubeUrl: payload.youtubeUrl || "",
    fileUrl: file ? `/uploads/teacher-lessons/${file.filename || path.basename(file.path)}` : "",
    fileName: file?.originalname || "",
    status: payload.submitForApproval ? "pending" : "published",
    views: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  if (!lesson.title) return { error: "Title is required", status: 400 };

  if (payload.submitForApproval) {
    adminApi.submitForApproval({
      userId: teacherId,
      type: "video",
      title: lesson.title,
      payload: {
        title: lesson.title,
        videoId: lesson.videoId,
        examId: lesson.examId,
        examName: lesson.examId,
        subjectId: payload.subjectId || "general"
      }
    });
    lesson.status = "pending";
  }

  store.lessons.unshift(lesson);
  saveStore(store);
  return { lesson, status: 201 };
}

function listLessons(teacherId, role, { q, examId }) {
  const store = loadStore();
  let list = store.lessons.filter((l) => l.teacherId === teacherId || role === "admin");
  if (q) list = list.filter((l) => matchQ(l.title, q) || matchQ(l.description, q));
  if (examId) list = list.filter((l) => l.examId === examId);
  return { lessons: list };
}

function deleteLesson(teacherId, role, lessonId) {
  const store = loadStore();
  const idx = store.lessons.findIndex((l) => l.id === lessonId);
  if (idx < 0) return { error: "Lesson not found", status: 404 };
  if (!isOwner(teacherId, store.lessons[idx].teacherId, role)) {
    return { error: "Access denied", status: 403 };
  }
  store.lessons.splice(idx, 1);
  saveStore(store);
  return { ok: true };
}

function addTeacherNote(teacherId, payload, file) {
  const store = loadStore();
  const note = {
    id: newId(),
    teacherId,
    title: String(payload.title || "").trim(),
    content: String(payload.content || "").trim(),
    examId: payload.examId || "",
    fileUrl: file ? `/uploads/teacher-notes/${path.basename(file.path)}` : "",
    fileName: file?.originalname || "",
    status: payload.submitForApproval ? "pending" : "published",
    downloads: 0,
    createdAt: new Date().toISOString()
  };
  if (!note.title) return { error: "Title is required", status: 400 };

  if (payload.submitForApproval) {
    adminApi.submitForApproval({
      userId: teacherId,
      type: "note",
      title: note.title,
      payload: { noteId: note.id, title: note.title }
    });
    note.status = "pending";
  }

  store.teacherNotes.unshift(note);
  saveStore(store);
  return { note, status: 201 };
}

function listTeacherNotes(teacherId, role, { q }) {
  const store = loadStore();
  let list = store.teacherNotes.filter((n) => n.teacherId === teacherId || role === "admin");
  if (q) list = list.filter((n) => matchQ(n.title, q));
  return { notes: list };
}

function deleteTeacherNote(teacherId, role, noteId) {
  const store = loadStore();
  const idx = store.teacherNotes.findIndex((n) => n.id === noteId);
  if (idx < 0) return { error: "Note not found", status: 404 };
  if (!isOwner(teacherId, store.teacherNotes[idx].teacherId, role)) {
    return { error: "Access denied", status: 403 };
  }
  store.teacherNotes.splice(idx, 1);
  saveStore(store);
  return { ok: true };
}

function createQuiz(teacherId, payload) {
  const store = loadStore();
  const questions = payload.questions || [];
  if (!questions.length) return { error: "At least one question is required", status: 400 };

  const quiz = {
    id: newId(),
    teacherId,
    title: String(payload.title || "Teacher Quiz").trim(),
    examId: payload.examId || "ssc-cgl",
    chapterId: payload.chapterId || "quant-arithmetic",
    durationMinutes: Number(payload.durationMinutes) || 15,
    questions: questions.map((q, i) => ({
      id: `tq-${i}`,
      question: String(q.question || "").trim(),
      options: (q.options || []).map(String).slice(0, 4),
      correct: Math.min(3, Math.max(0, Number(q.correct) || 0)),
      explanation: q.explanation || ""
    })),
    publishedToBank: false,
    attempts: 0,
    createdAt: new Date().toISOString()
  };

  store.quizzes.unshift(quiz);
  saveStore(store);
  return { quiz, status: 201 };
}

function listQuizzes(teacherId, role) {
  const store = loadStore();
  const quizzes = store.quizzes.filter((q) => q.teacherId === teacherId || role === "admin");
  return { quizzes };
}

function publishQuizToBank(teacherId, role, quizId) {
  const store = loadStore();
  const quiz = store.quizzes.find((q) => q.id === quizId);
  if (!quiz) return { error: "Quiz not found", status: 404 };
  if (!isOwner(teacherId, quiz.teacherId, role)) return { error: "Access denied", status: 403 };

  const added = [];
  for (const q of quiz.questions) {
    const result = examSystem.addQuestion({
      examId: quiz.examId,
      chapterId: quiz.chapterId,
      question: q.question,
      options: q.options,
      correct: q.correct,
      explanation: q.explanation,
      types: ["chapter"],
      chapterName: `Teacher: ${quiz.title}`
    });
    if (result.question) added.push(result.question.id);
  }
  quiz.publishedToBank = true;
  quiz.bankQuestionIds = added;
  saveStore(store);
  return { quiz, addedCount: added.length };
}

function createAssignment(teacherId, payload) {
  const store = loadStore();
  const assignment = {
    id: newId(),
    teacherId,
    title: String(payload.title || "").trim(),
    description: String(payload.description || "").trim(),
    examId: payload.examId || "",
    dueDate: payload.dueDate || null,
    maxScore: Number(payload.maxScore) || 100,
    quizId: payload.quizId || null,
    status: "active",
    createdAt: new Date().toISOString()
  };
  if (!assignment.title) return { error: "Title is required", status: 400 };
  store.assignments.unshift(assignment);
  saveStore(store);
  return { assignment, status: 201 };
}

function listAssignments(teacherId, role, { q }) {
  const store = loadStore();
  let list = store.assignments.filter((a) => a.teacherId === teacherId || role === "admin");
  if (q) list = list.filter((a) => matchQ(a.title, q));
  return {
    assignments: list.map((a) => ({
      ...a,
      submissionCount: store.submissions.filter((s) => s.assignmentId === a.id).length
    }))
  };
}

function listAssignmentSubmissions(teacherId, role, assignmentId) {
  const store = loadStore();
  const assignment = store.assignments.find((a) => a.id === assignmentId);
  if (!assignment) return { error: "Assignment not found", status: 404 };
  if (!isOwner(teacherId, assignment.teacherId, role)) return { error: "Access denied", status: 403 };

  const users = loadJson(USERS_FILE, { users: [] }).users;
  const submissions = store.submissions
    .filter((s) => s.assignmentId === assignmentId)
    .map((s) => {
      const u = users.find((x) => x.id === s.studentId);
      return {
        ...s,
        studentName: u?.name || "Student",
        studentEmail: u?.email || ""
      };
    });
  return { assignment, submissions };
}

function gradeSubmission(teacherId, role, submissionId, { score, feedback }) {
  const store = loadStore();
  const sub = store.submissions.find((s) => s.id === submissionId);
  if (!sub) return { error: "Submission not found", status: 404 };
  const assignment = store.assignments.find((a) => a.id === sub.assignmentId);
  if (!assignment || !isOwner(teacherId, assignment.teacherId, role)) {
    return { error: "Access denied", status: 403 };
  }
  sub.score = Number(score);
  sub.feedback = feedback || "";
  sub.gradedAt = new Date().toISOString();
  sub.status = "graded";
  saveStore(store);
  return { submission: sub };
}

function submitAssignment(studentId, assignmentId, payload) {
  const store = loadStore();
  const assignment = store.assignments.find((a) => a.id === assignmentId);
  if (!assignment) return { error: "Assignment not found", status: 404 };
  if (assignment.status !== "active") return { error: "Assignment is closed", status: 400 };
  if (assignment.dueDate && new Date(assignment.dueDate) < new Date()) {
    return { error: "Past due date", status: 400 };
  }

  const existing = store.submissions.find(
    (s) => s.assignmentId === assignmentId && s.studentId === studentId
  );
  if (existing) return { error: "Already submitted", status: 409 };

  const sub = {
    id: newId(),
    assignmentId,
    studentId,
    content: String(payload.content || "").trim(),
    attachmentUrl: payload.attachmentUrl || "",
    score: null,
    feedback: "",
    status: "submitted",
    submittedAt: new Date().toISOString()
  };
  store.submissions.unshift(sub);
  saveStore(store);
  return { submission: sub, status: 201 };
}

function listStudentAssignments(studentId) {
  const store = loadStore();
  const assignments = store.assignments.filter((a) => a.status === "active");
  return {
    assignments: assignments.map((a) => ({
      ...a,
      submitted: store.submissions.some(
        (s) => s.assignmentId === a.id && s.studentId === studentId
      )
    }))
  };
}

function getStudentPerformance(teacherId, role) {
  const store = loadStore();
  const users = loadJson(USERS_FILE, { users: [] }).users.filter((u) => u.role === "student");
  const results = loadJson(RESULTS_FILE, { results: [] }).results;
  const quizzes = loadJson(QUIZ_FILE, { scores: [] }).scores;
  const teacherQuizIds = new Set(
    store.quizzes.filter((q) => q.teacherId === teacherId || role === "admin").map((q) => q.id)
  );

  const assignmentIds = new Set(
    store.assignments.filter((a) => a.teacherId === teacherId || role === "admin").map((a) => a.id)
  );
  const subs = store.submissions.filter((s) => assignmentIds.has(s.assignmentId));

  const byStudent = {};

  for (const u of users) {
    byStudent[u.id] = {
      studentId: u.id,
      name: u.name,
      email: u.email,
      mockAttempts: 0,
      avgMockScore: 0,
      quizAttempts: 0,
      assignmentsSubmitted: 0,
      avgAssignmentScore: null
    };
  }

  for (const r of results) {
    if (!byStudent[r.userId]) continue;
    byStudent[r.userId].mockAttempts += 1;
    byStudent[r.userId].avgMockScore += r.percentScore;
  }

  for (const q of quizzes) {
    if (!byStudent[q.userId]) continue;
    byStudent[q.userId].quizAttempts += 1;
  }

  for (const s of subs) {
    if (!byStudent[s.studentId]) continue;
    byStudent[s.studentId].assignmentsSubmitted += 1;
    if (s.score != null) {
      const cur = byStudent[s.studentId].avgAssignmentScore || 0;
      byStudent[s.studentId].avgAssignmentScore = cur + s.score;
    }
  }

  const students = Object.values(byStudent).map((s) => {
    if (s.mockAttempts) s.avgMockScore = Math.round((s.avgMockScore / s.mockAttempts) * 10) / 10;
    if (s.assignmentsSubmitted && s.avgAssignmentScore != null) {
      s.avgAssignmentScore = Math.round((s.avgAssignmentScore / s.assignmentsSubmitted) * 10) / 10;
    }
    return s;
  });

  students.sort((a, b) => b.avgMockScore - a.avgMockScore);

  return {
    students: students.slice(0, 100),
    summary: {
      totalStudents: users.length,
      assignmentSubmissions: subs.length,
      teacherQuizzes: teacherQuizIds.size
    }
  };
}

function getCourseAnalytics(teacherId, role) {
  const store = loadStore();
  const lessons = store.lessons.filter((l) => l.teacherId === teacherId || role === "admin");
  const notes = store.teacherNotes.filter((n) => n.teacherId === teacherId || role === "admin");
  const assignments = store.assignments.filter((a) => a.teacherId === teacherId || role === "admin");

  const byExam = {};
  for (const l of lessons) {
    const e = l.examId || "general";
    if (!byExam[e]) byExam[e] = { examId: e, lessons: 0, notes: 0, assignments: 0, views: 0 };
    byExam[e].lessons += 1;
    byExam[e].views += l.views || 0;
  }
  for (const n of notes) {
    const e = n.examId || "general";
    if (!byExam[e]) byExam[e] = { examId: e, lessons: 0, notes: 0, assignments: 0, views: 0 };
    byExam[e].notes += 1;
  }
  for (const a of assignments) {
    const e = a.examId || "general";
    if (!byExam[e]) byExam[e] = { examId: e, lessons: 0, notes: 0, assignments: 0, views: 0 };
    byExam[e].assignments += 1;
  }

  return {
    totals: {
      lessonViews: lessons.reduce((s, l) => s + (l.views || 0), 0),
      noteDownloads: notes.reduce((s, n) => s + (n.downloads || 0), 0),
      assignmentCount: assignments.length,
      submissionCount: store.submissions.filter((s) =>
        assignments.some((a) => a.id === s.assignmentId)
      ).length
    },
    byExam: Object.values(byExam)
  };
}

function listDiscussions(teacherId, role, { examId, q, flaggedOnly }) {
  const store = loadStore();
  let list = store.discussions;
  if (role !== "admin") {
    list = list.filter((d) => d.examId === examId || d.teacherId === teacherId || !examId);
  }
  if (examId) list = list.filter((d) => d.examId === examId);
  if (flaggedOnly) list = list.filter((d) => d.flagged || (d.replies || []).some((r) => r.flagged));
  if (q) list = list.filter((d) => matchQ(d.title, q) || matchQ(d.body, q));
  list = [...list].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return { discussions: list };
}

function createDiscussion(userId, userName, payload) {
  const store = loadStore();
  const thread = {
    id: newId(),
    teacherId: payload.teacherId || userId,
    examId: payload.examId || "",
    title: String(payload.title || "").trim(),
    body: String(payload.body || "").trim(),
    authorId: userId,
    authorName: userName,
    pinned: false,
    hidden: false,
    flagged: false,
    replies: [],
    createdAt: new Date().toISOString()
  };
  if (!thread.title) return { error: "Title is required", status: 400 };
  store.discussions.unshift(thread);
  saveStore(store);
  return { discussion: thread, status: 201 };
}

function addReply(userId, userName, discussionId, body) {
  const store = loadStore();
  const thread = store.discussions.find((d) => d.id === discussionId);
  if (!thread) return { error: "Discussion not found", status: 404 };
  if (thread.hidden) return { error: "Discussion is closed", status: 403 };

  const reply = {
    id: newId(),
    authorId: userId,
    authorName: userName,
    body: String(body || "").trim(),
    hidden: false,
    flagged: false,
    createdAt: new Date().toISOString()
  };
  if (!reply.body) return { error: "Reply body is required", status: 400 };
  thread.replies.push(reply);
  saveStore(store);
  return { reply };
}

function moderateDiscussion(teacherId, role, discussionId, updates) {
  const store = loadStore();
  const thread = store.discussions.find((d) => d.id === discussionId);
  if (!thread) return { error: "Not found", status: 404 };
  if (role !== "admin" && thread.teacherId !== teacherId) {
    return { error: "Access denied", status: 403 };
  }

  if (updates.hidden !== undefined) thread.hidden = Boolean(updates.hidden);
  if (updates.pinned !== undefined) thread.pinned = Boolean(updates.pinned);
  if (updates.flagged !== undefined) thread.flagged = Boolean(updates.flagged);
  if (updates.replyId) {
    const reply = (thread.replies || []).find((r) => r.id === updates.replyId);
    if (reply) {
      if (updates.replyHidden !== undefined) reply.hidden = Boolean(updates.replyHidden);
      if (updates.replyFlagged !== undefined) reply.flagged = Boolean(updates.replyFlagged);
      if (updates.deleteReply) {
        thread.replies = thread.replies.filter((r) => r.id !== updates.replyId);
      }
    }
  }
  if (updates.delete) {
    store.discussions = store.discussions.filter((d) => d.id !== discussionId);
    saveStore(store);
    return { ok: true, deleted: true };
  }
  saveStore(store);
  return { discussion: thread };
}

function listPublicDiscussions(examId) {
  const store = loadStore();
  const list = store.discussions
    .filter((d) => !d.hidden && (!examId || d.examId === examId))
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0))
    .map((d) => ({
      id: d.id,
      examId: d.examId,
      title: d.title,
      body: d.body,
      authorName: d.authorName,
      pinned: d.pinned,
      replyCount: (d.replies || []).filter((r) => !r.hidden).length,
      createdAt: d.createdAt,
      replies: (d.replies || [])
        .filter((r) => !r.hidden)
        .map((r) => ({
          id: r.id,
          authorName: r.authorName,
          body: r.body,
          createdAt: r.createdAt
        }))
    }));
  return { discussions: list };
}

module.exports = {
  LESSONS_DIR,
  NOTES_DIR,
  getDashboard,
  addLesson,
  listLessons,
  deleteLesson,
  addTeacherNote,
  listTeacherNotes,
  deleteTeacherNote,
  createQuiz,
  listQuizzes,
  publishQuizToBank,
  createAssignment,
  listAssignments,
  listAssignmentSubmissions,
  gradeSubmission,
  submitAssignment,
  listStudentAssignments,
  getStudentPerformance,
  getCourseAnalytics,
  listDiscussions,
  createDiscussion,
  addReply,
  moderateDiscussion,
  listPublicDiscussions
};
