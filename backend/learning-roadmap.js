const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const STORE_FILE = path.join(__dirname, "data", "learning-roadmaps.json");
const SYLLABUS_FILE = path.join(__dirname, "data", "exam-syllabus-templates.json");

const VALID_EXAMS = ["ssc", "ssc-cgl", "ssc-chsl", "ssc-mts", "ssc-gd", "nda", "cds", "afcat", "rrb-ntpc", "capf"];
const MIN_STUDY_DAYS = 14;
const MAX_STUDY_DAYS = 400;
const DEFAULT_HOURS_PER_DAY = 5;
const REVISION_RATIO = 0.12;
const MIN_REVISION_DAYS = 7;

function newId() {
  return crypto.randomBytes(10).toString("hex");
}

function loadStore() {
  if (!fs.existsSync(STORE_FILE)) {
    const initial = { roadmaps: [] };
    fs.writeFileSync(STORE_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  return JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
}

function saveStore(store) {
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2));
}

function loadSyllabusTemplates() {
  return JSON.parse(fs.readFileSync(SYLLABUS_FILE, "utf8"));
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function toDateStr(d) {
  return startOfDay(d).toISOString().slice(0, 10);
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return startOfDay(x);
}

function daysBetween(a, b) {
  const ms = startOfDay(b) - startOfDay(a);
  return Math.max(0, Math.round(ms / (24 * 60 * 60 * 1000)));
}

function normalizeExamId(examId) {
  const id = String(examId || "").toLowerCase().trim();
  if (VALID_EXAMS.includes(id)) return id;
  if (id.startsWith("ssc")) return id === "ssc" ? "ssc" : id;
  if (id.includes("rrb")) return "rrb-ntpc";
  if (id.includes("nda")) return "nda";
  if (id.includes("cds")) return "cds";
  if (id.includes("afcat")) return "afcat";
  return null;
}

const EXAM_TEMPLATE_ALIAS = {
  "ssc-chsl": "ssc",
  "ssc-mts": "ssc",
  "ssc-gd": "ssc",
  capf: "cds"
};

function resolveExamSyllabus(examId) {
  const data = loadSyllabusTemplates();
  const exams = data.exams || {};
  const templateId = EXAM_TEMPLATE_ALIAS[examId] || examId;
  let exam = exams[templateId] || exams[examId];
  if (!exam) return null;

  const subjects = [];
  if (exam.inherits && exams[exam.inherits]) {
    const base = exams[exam.inherits];
    (base.subjects || []).forEach((s) => subjects.push({ ...s, topics: [...(s.topics || [])] }));
  }
  (exam.subjects || []).forEach((s) => subjects.push({ ...s, topics: [...(s.topics || [])] }));
  (exam.extraSubjects || []).forEach((s) => subjects.push({ ...s, topics: [...(s.topics || [])] }));

  const displayNames = {
    "ssc-chsl": "SSC CHSL",
    "ssc-mts": "SSC MTS",
    "ssc-gd": "SSC GD",
    capf: "CAPF AC"
  };

  return {
    examId,
    name: displayNames[examId] || exam.name,
    icon: exam.icon || "📚",
    subjects
  };
}

function flattenTopics(syllabus) {
  const list = [];
  for (const sub of syllabus.subjects) {
    for (const t of sub.topics || []) {
      list.push({
        ...t,
        subjectId: sub.id,
        subjectName: sub.name,
        hours: Math.max(1, Number(t.hours) || 4),
        completed: false
      });
    }
  }
  return list;
}

function distributeTopicsToDays(topics, studyDays, hoursPerDay) {
  const dailyCapacity = Math.max(2, hoursPerDay);
  const days = Array.from({ length: studyDays }, (_, i) => ({
    dayIndex: i,
    tasks: [],
    plannedHours: 0
  }));

  let dayPtr = 0;
  for (const topic of topics) {
    let remaining = topic.hours;
    while (remaining > 0 && dayPtr < studyDays) {
      const day = days[dayPtr];
      const space = dailyCapacity - day.plannedHours;
      if (space <= 0) {
        dayPtr += 1;
        continue;
      }
      const chunk = Math.min(remaining, space, topic.hours);
      const portion =
        chunk >= topic.hours
          ? 1
          : Math.round((chunk / topic.hours) * 100) / 100;

      day.tasks.push({
        topicId: topic.id,
        title: topic.title,
        subjectId: topic.subjectId,
        subjectName: topic.subjectName,
        hours: chunk,
        portion,
        completed: false,
        completedAt: null
      });
      day.plannedHours += chunk;
      remaining -= chunk;
      if (day.plannedHours >= dailyCapacity - 0.01) dayPtr += 1;
    }
    if (dayPtr >= studyDays && remaining > 0) {
      const last = days[studyDays - 1];
      last.tasks.push({
        topicId: topic.id,
        title: topic.title + " (overflow)",
        subjectId: topic.subjectId,
        subjectName: topic.subjectName,
        hours: remaining,
        portion: remaining / topic.hours,
        completed: false,
        completedAt: null
      });
      last.plannedHours += remaining;
    }
  }
  return days;
}

function buildDailyPlan(startDate, studyDays, distributedDays) {
  const plan = [];
  for (let i = 0; i < studyDays; i++) {
    const date = addDays(startDate, i);
    const src = distributedDays[i] || { tasks: [], plannedHours: 0 };
    plan.push({
      id: newId(),
      date: toDateStr(date),
      dayNumber: i + 1,
      label: `Day ${i + 1}`,
      tasks: src.tasks,
      plannedHours: Math.round(src.plannedHours * 10) / 10,
      completed: false,
      isRevision: false
    });
  }
  return plan;
}

function buildRevisionDays(startDate, studyDays, revisionDays) {
  const plan = [];
  for (let i = 0; i < revisionDays; i++) {
    const date = addDays(startDate, studyDays + i);
    plan.push({
      id: newId(),
      date: toDateStr(date),
      dayNumber: studyDays + i + 1,
      label: `Revision ${i + 1}`,
      tasks: [
        {
          topicId: `revision-${i + 1}`,
          title:
            i === revisionDays - 1
              ? "Full mock test + error log review"
              : i % 2 === 0
                ? "Mixed subject revision + PYQs"
                : "Weak topics revision + short notes",
          subjectId: "revision",
          subjectName: "Revision",
          hours: 4,
          portion: 1,
          completed: false,
          completedAt: null
        }
      ],
      plannedHours: 4,
      completed: false,
      isRevision: true
    });
  }
  return plan;
}

function groupIntoWeeks(dailyPlan) {
  const weeks = [];
  for (let i = 0; i < dailyPlan.length; i += 7) {
    const chunk = dailyPlan.slice(i, i + 7);
    const weekNum = weeks.length + 1;
    const topicTitles = [
      ...new Set(chunk.flatMap((d) => d.tasks.map((t) => t.title.split(" (")[0])))
    ];
    const targets = topicTitles.slice(0, 6);
    if (topicTitles.length > 6) targets.push(`+${topicTitles.length - 6} more`);

    weeks.push({
      weekNumber: weekNum,
      startDate: chunk[0].date,
      endDate: chunk[chunk.length - 1].date,
      targets,
      summary: targets.length
        ? `Cover: ${targets.join(", ")}`
        : "Revision & practice week",
      days: chunk.map((d) => d.id),
      completedDays: 0,
      totalDays: chunk.length
    });
  }
  return weeks;
}

function computeProgress(roadmap) {
  const allTasks = roadmap.dailyPlan.flatMap((d) => d.tasks);
  const total = allTasks.length;
  if (!total) return { progressPercent: 0, completedTasks: 0, totalTasks: 0 };

  const completed = allTasks.filter((t) => t.completed).length;
  const progressPercent = Math.round((completed / total) * 1000) / 10;

  const today = toDateStr(new Date());
  const pastDays = roadmap.dailyPlan.filter((d) => d.date < today);
  const overdueTasks = pastDays.flatMap((d) => d.tasks.filter((t) => !t.completed));

  return {
    progressPercent,
    completedTasks: completed,
    totalTasks: total,
    overdueCount: overdueTasks.length,
    daysRemaining: daysBetween(new Date(), roadmap.examDate)
  };
}

function markDayCompletion(day) {
  if (!day.tasks.length) {
    day.completed = false;
    return;
  }
  day.completed = day.tasks.every((t) => t.completed);
}

function adjustSchedule(roadmap) {
  const today = toDateStr(new Date());
  const missed = [];

  for (const day of roadmap.dailyPlan) {
    if (day.date >= today || day.isRevision) continue;
    for (const task of day.tasks) {
      if (!task.completed) {
        missed.push({ ...task, fromDate: day.date, fromDayId: day.id });
        task.rescheduled = true;
      }
    }
    markDayCompletion(day);
  }

  if (!missed.length) {
    roadmap.stats = computeProgress(roadmap);
    return { adjusted: false, movedCount: 0 };
  }

  const futureStudyDays = roadmap.dailyPlan.filter(
    (d) => d.date >= today && !d.isRevision && !d.completed
  );

  let idx = 0;
  let moved = 0;
  for (const item of missed) {
    let placed = false;
    while (idx < futureStudyDays.length && !placed) {
      const day = futureStudyDays[idx];
      const cap = roadmap.hoursPerDay - day.plannedHours;
      if (cap >= item.hours * 0.5 || day.tasks.length < 3) {
        day.tasks.push({
          topicId: item.topicId,
          title: item.title + " (catch-up)",
          subjectId: item.subjectId,
          subjectName: item.subjectName,
          hours: item.hours,
          portion: item.portion,
          completed: false,
          completedAt: null,
          rescheduledFrom: item.fromDate
        });
        day.plannedHours = Math.round((day.plannedHours + item.hours) * 10) / 10;
        placed = true;
        moved += 1;
      }
      idx += 1;
    }
    if (!placed && futureStudyDays.length) {
      const last = futureStudyDays[futureStudyDays.length - 1];
      last.tasks.push({
        topicId: item.topicId,
        title: item.title + " (catch-up)",
        subjectId: item.subjectId,
        subjectName: item.subjectName,
        hours: item.hours,
        portion: item.portion,
        completed: false,
        completedAt: null,
        rescheduledFrom: item.fromDate
      });
      last.plannedHours += item.hours;
      moved += 1;
    }
  }

  roadmap.weeks = groupIntoWeeks(roadmap.dailyPlan);
  roadmap.lastAdjustedAt = new Date().toISOString();
  roadmap.adjustmentCount = (roadmap.adjustmentCount || 0) + 1;
  roadmap.stats = computeProgress(roadmap);

  return { adjusted: true, movedCount: moved };
}

async function aiEnrichPlan(examName, examDate, weeks) {
  const openaiKey = process.env.OPENAI_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!openaiKey && !geminiKey) return null;

  const weekSummaries = weeks.slice(0, 4).map((w) => `Week ${w.weekNumber}: ${w.summary}`).join("\n");
  const prompt = `You are an Indian competitive exam coach. Exam: ${examName}. Target date: ${examDate}.
Given these weekly targets:
${weekSummaries}
Reply with exactly 3 short motivational tips (bullet points, under 30 words each) for the student. No preamble.`;

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
          max_tokens: 200,
          temperature: 0.7
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

function generateRoadmap({ userId, examId, examDate, hoursPerDay, regenerate }) {
  const normalizedExam = normalizeExamId(examId);
  if (!normalizedExam) {
    return { error: "Invalid exam. Choose: ssc, ssc-cgl, nda, cds, afcat, rrb-ntpc", status: 400 };
  }

  const syllabus = resolveExamSyllabus(normalizedExam);
  if (!syllabus) {
    return { error: "Syllabus not found for this exam", status: 404 };
  }

  const examDay = startOfDay(examDate);
  const today = startOfDay(new Date());
  if (examDay <= today) {
    return { error: "Exam date must be in the future", status: 400 };
  }

  const store = loadStore();
  const existing = store.roadmaps.find((r) => r.userId === userId);
  if (existing && !regenerate) {
    adjustSchedule(existing);
    saveStore(store);
    return { roadmap: publicRoadmap(existing), created: false };
  }

  let totalDays = daysBetween(today, examDay);
  totalDays = Math.min(MAX_STUDY_DAYS, Math.max(MIN_STUDY_DAYS, totalDays));

  const revisionDays = Math.max(
    MIN_REVISION_DAYS,
    Math.min(21, Math.ceil(totalDays * REVISION_RATIO))
  );
  const studyDays = totalDays - revisionDays;
  const hpd = Math.min(12, Math.max(2, Number(hoursPerDay) || DEFAULT_HOURS_PER_DAY));

  const topics = flattenTopics(syllabus);
  const distributed = distributeTopicsToDays(topics, studyDays, hpd);
  const dailyStudy = buildDailyPlan(today, studyDays, distributed);
  const dailyRevision = buildRevisionDays(today, studyDays, revisionDays);
  const dailyPlan = [...dailyStudy, ...dailyRevision];
  const weeks = groupIntoWeeks(dailyPlan);

  const roadmap = {
    id: existing?.id || newId(),
    userId,
    examId: normalizedExam,
    examName: syllabus.name,
    examIcon: syllabus.icon,
    examDate: toDateStr(examDay),
    startDate: toDateStr(today),
    hoursPerDay: hpd,
    totalDays,
    studyDays,
    revisionDays,
    dailyPlan,
    weeks,
    syllabus: syllabus.subjects.map((s) => ({
      id: s.id,
      name: s.name,
      topicCount: (s.topics || []).length
    })),
    aiTips: null,
    adjustmentCount: 0,
    lastAdjustedAt: null,
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  roadmap.stats = computeProgress(roadmap);

  if (existing) {
    const idx = store.roadmaps.findIndex((r) => r.userId === userId);
    store.roadmaps[idx] = roadmap;
  } else {
    store.roadmaps.push(roadmap);
  }
  saveStore(store);

  return { roadmap: publicRoadmap(roadmap), created: true, pendingAi: true, roadmapRef: roadmap, store };
}

async function finalizeAiTips(roadmap, store) {
  const tips = await aiEnrichPlan(roadmap.examName, roadmap.examDate, roadmap.weeks);
  if (tips) {
    roadmap.aiTips = tips;
    roadmap.updatedAt = new Date().toISOString();
    saveStore(store);
  }
  return tips;
}

function publicRoadmap(roadmap) {
  const stats = computeProgress(roadmap);
  return {
    id: roadmap.id,
    userId: roadmap.userId,
    examId: roadmap.examId,
    examName: roadmap.examName,
    examIcon: roadmap.examIcon,
    examDate: roadmap.examDate,
    startDate: roadmap.startDate,
    hoursPerDay: roadmap.hoursPerDay,
    totalDays: roadmap.totalDays,
    studyDays: roadmap.studyDays,
    revisionDays: roadmap.revisionDays,
    dailyPlan: roadmap.dailyPlan,
    weeks: roadmap.weeks.map((w) => ({
      ...w,
      completedDays: roadmap.dailyPlan
        .filter((d) => w.days.includes(d.id) && d.completed)
        .length
    })),
    syllabus: roadmap.syllabus,
    aiTips: roadmap.aiTips,
    adjustmentCount: roadmap.adjustmentCount || 0,
    lastAdjustedAt: roadmap.lastAdjustedAt,
    stats,
    createdAt: roadmap.createdAt,
    updatedAt: roadmap.updatedAt
  };
}

function getRoadmapByUser(userId, requesterId) {
  if (userId !== requesterId) {
    return { error: "You can only access your own roadmap", status: 403 };
  }
  const store = loadStore();
  const roadmap = store.roadmaps.find((r) => r.userId === userId);
  if (!roadmap) {
    return { error: "No roadmap found. Create one with POST /api/roadmap", status: 404 };
  }

  const adjust = adjustSchedule(roadmap);
  saveStore(store);

  return {
    roadmap: publicRoadmap(roadmap),
    scheduleAdjusted: adjust.adjusted,
    movedTasks: adjust.movedCount
  };
}

function updateTopicCompletion(userId, requesterId, { topicId, date, completed }) {
  if (userId !== requesterId) {
    return { error: "You can only update your own roadmap", status: 403 };
  }

  const store = loadStore();
  const roadmap = store.roadmaps.find((r) => r.userId === userId);
  if (!roadmap) return { error: "Roadmap not found", status: 404 };

  let found = false;
  for (const day of roadmap.dailyPlan) {
    if (date && day.date !== date) continue;
    for (const task of day.tasks) {
      if (task.topicId === topicId) {
        task.completed = Boolean(completed);
        task.completedAt = task.completed ? new Date().toISOString() : null;
        found = true;
      }
    }
    markDayCompletion(day);
  }

  if (!found) return { error: "Topic not found on the given date", status: 404 };

  roadmap.weeks = groupIntoWeeks(roadmap.dailyPlan);
  roadmap.updatedAt = new Date().toISOString();
  roadmap.stats = computeProgress(roadmap);
  saveStore(store);

  return { roadmap: publicRoadmap(roadmap) };
}

function listExams() {
  return VALID_EXAMS.map((id) => {
    const s = resolveExamSyllabus(id);
    return s ? { id, name: s.name, icon: s.icon } : { id, name: id };
  }).filter((e, i, arr) => arr.findIndex((x) => x.id === e.id) === i);
}

module.exports = {
  generateRoadmap,
  finalizeAiTips,
  getRoadmapByUser,
  updateTopicCompletion,
  listExams,
  normalizeExamId,
  VALID_EXAMS
};
