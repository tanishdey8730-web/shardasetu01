const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const STORE_FILE = path.join(__dirname, "data", "generated-questions.json");

const VALID_TYPES = ["mcq", "subjective", "pyq"];
const VALID_DIFFICULTIES = ["easy", "medium", "hard"];

const GENERATOR_PROMPT = `You are Sharda Setu AI Question Generator for Indian competitive exams (SSC, NDA, CDS, AFCAT, RRB).

Generate exam-quality questions and return ONLY valid JSON (no markdown fence):
{
  "topic": "string",
  "questions": [
    {
      "type": "mcq" | "subjective" | "pyq",
      "question": "string",
      "options": ["A", "B", "C", "D"],
      "correct": 0,
      "explanation": "step-by-step why the answer is correct",
      "difficulty": "easy" | "medium" | "hard",
      "topic": "string",
      "marks": number,
      "modelAnswer": "for subjective only — ideal answer",
      "keywords": ["for subjective — key points examiner expects"],
      "pyqYear": number,
      "pyqExam": "for pyq only e.g. SSC CGL Tier 1 2022"
    }
  ]
}

Rules by type:
- mcq: exactly 4 options, correct = 0-based index, marks 1-2
- subjective: NO options field (omit or empty array), include modelAnswer and keywords, marks 5-15, questions need descriptive answers
- pyq: MCQ format like real PYQ — include pyqYear (2018-2024) and pyqExam, exam-authentic wording, trap options like real papers

Difficulty:
- easy: direct formula/fact, single step
- medium: 2-3 steps, moderate traps
- hard: multi-step, strong distractors, time-pressure style

Every question MUST have a clear explanation (for subjective, explain marking scheme in explanation).
Match the requested topic precisely. Hindi terms OK when standard for Indian exams.`;

function newId() {
  return crypto.randomBytes(12).toString("hex");
}

function loadStore() {
  if (!fs.existsSync(STORE_FILE)) {
    fs.writeFileSync(STORE_FILE, JSON.stringify({ sets: [] }, null, 2));
  }
  return JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
}

function saveStore(store) {
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2));
}

function getProviderConfig() {
  const openaiKey = process.env.OPENAI_API_KEY || "";
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
  const preferred = (process.env.CHAT_PROVIDER || "auto").toLowerCase();
  if (preferred === "gemini" && geminiKey) return { provider: "gemini" };
  if (openaiKey) return { provider: "openai" };
  if (geminiKey) return { provider: "gemini" };
  return { provider: null };
}

function parseAiJson(content) {
  const raw = String(content || "").trim();
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
}

async function callAI(systemPrompt, userPrompt) {
  const config = getProviderConfig();
  if (!config.provider) return { error: "AI not configured. Set OPENAI_API_KEY or GEMINI_API_KEY.", status: 503 };

  try {
    if (config.provider === "openai") {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || "gpt-4o-mini",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ],
          temperature: 0.55,
          max_tokens: 5000
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "OpenAI failed");
      return { content: data.choices?.[0]?.message?.content || "", provider: "openai" };
    }

    const model = process.env.GEMINI_MODEL || "gemini-1.5-flash";
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        generationConfig: { temperature: 0.55, maxOutputTokens: 5000 }
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || "Gemini failed");
    return {
      content: data.candidates?.[0]?.content?.parts?.[0]?.text || "",
      provider: "gemini"
    };
  } catch (err) {
    return { error: err.message || "AI request failed", status: 502 };
  }
}

function normalizeType(t) {
  const v = String(t || "mcq").toLowerCase();
  return VALID_TYPES.includes(v) ? v : "mcq";
}

function normalizeDifficulty(d) {
  const v = String(d || "medium").toLowerCase();
  return VALID_DIFFICULTIES.includes(v) ? v : "medium";
}

function normalizeQuestions(rawQuestions, questionType, difficulty, topic) {
  return (rawQuestions || []).map((q, i) => {
    const type = normalizeType(q.type || questionType);
    const base = {
      number: i + 1,
      type,
      question: q.question || "",
      difficulty: normalizeDifficulty(q.difficulty || difficulty),
      topic: q.topic || topic,
      explanation: q.explanation || "",
      marks: q.marks || (type === "subjective" ? 10 : type === "pyq" ? 2 : 1)
    };

    if (type === "subjective") {
      return {
        ...base,
        options: [],
        modelAnswer: q.modelAnswer || "",
        keywords: q.keywords || []
      };
    }

    const options = (q.options || []).slice(0, 4);
    while (options.length < 4) options.push(`Option ${String.fromCharCode(65 + options.length)}`);

    const item = {
      ...base,
      options,
      correct: Math.min(3, Math.max(0, Number(q.correct) || 0))
    };

    if (type === "pyq") {
      item.pyqYear = q.pyqYear || q.year || null;
      item.pyqExam = q.pyqExam || q.exam || "";
    }

    return item;
  });
}

function buildAnswerKey(questions) {
  return questions.map((q) => {
    if (q.type === "subjective") {
      return {
        number: q.number,
        type: q.type,
        answer: q.modelAnswer,
        keywords: q.keywords,
        marks: q.marks
      };
    }
    const letter = String.fromCharCode(65 + q.correct);
    return {
      number: q.number,
      type: q.type,
      answer: `${letter}. ${q.options[q.correct] || ""}`,
      correctIndex: q.correct,
      marks: q.marks,
      pyqYear: q.pyqYear,
      pyqExam: q.pyqExam
    };
  });
}

function publicSet(record) {
  return {
    id: record.id,
    userId: record.userId,
    topic: record.topic,
    examId: record.examId,
    subject: record.subject,
    questionType: record.questionType,
    difficulty: record.difficulty,
    count: record.count,
    questions: record.questions,
    answerKey: record.answerKey,
    provider: record.provider,
    createdAt: record.createdAt
  };
}

async function generateQuestions({
  userId,
  topic,
  examId,
  subject,
  questionType,
  difficulty,
  count
}) {
  if (!userId) return { error: "Sign in required", status: 401 };

  const topicStr = String(topic || "").trim();
  if (!topicStr) return { error: "topic is required", status: 400 };

  const qType = normalizeType(questionType);
  const diff = normalizeDifficulty(difficulty);
  const num = Math.min(20, Math.max(1, Number(count) || 5));

  const examLabel = examId || "general competitive exams";
  const subjectLine = subject ? `Subject: ${subject}.` : "";

  const typeInstructions = {
    mcq: `Generate exactly ${num} multiple-choice questions (4 options each).`,
    subjective: `Generate exactly ${num} subjective/descriptive questions with model answers.`,
    pyq: `Generate exactly ${num} previous-year-exam style MCQs mimicking ${examLabel} PYQ pattern.`
  };

  const userPrompt = `${typeInstructions[qType]}
Topic: ${topicStr}
Exam: ${examLabel}
${subjectLine}
Difficulty: ${diff} (all questions should be ${diff} level unless mix is impossible — then majority ${diff})

Return the JSON object with a "questions" array of length ${num}.`;

  const ai = await callAI(GENERATOR_PROMPT, userPrompt);
  if (ai.error) return ai;

  const parsed = parseAiJson(ai.content);
  const questions = normalizeQuestions(
    parsed?.questions || [],
    qType,
    diff,
    parsed?.topic || topicStr
  );

  if (!questions.length) {
    return { error: "AI did not return valid questions. Try again.", status: 502 };
  }

  const answerKey = buildAnswerKey(questions);

  const record = {
    id: newId(),
    userId,
    topic: parsed?.topic || topicStr,
    examId: examId || "general",
    subject: subject || "",
    questionType: qType,
    difficulty: diff,
    count: questions.length,
    questions,
    answerKey,
    provider: ai.provider,
    createdAt: new Date().toISOString()
  };

  const store = loadStore();
  store.sets.unshift(record);
  if (store.sets.length > 400) store.sets = store.sets.slice(0, 400);
  saveStore(store);

  return {
    set: publicSet(record),
    answerKey,
    status: 201
  };
}

function listSets(userId) {
  const store = loadStore();
  return {
    sets: store.sets
      .filter((s) => s.userId === userId)
      .slice(0, 30)
      .map((s) => ({
        id: s.id,
        topic: s.topic,
        questionType: s.questionType,
        difficulty: s.difficulty,
        count: s.count,
        examId: s.examId,
        createdAt: s.createdAt
      }))
  };
}

function getSet(setId, userId) {
  const store = loadStore();
  const record = store.sets.find((s) => s.id === setId);
  if (!record) return { error: "Question set not found", status: 404 };
  if (record.userId !== userId) return { error: "Access denied", status: 403 };
  return { set: publicSet(record) };
}

function getStatus() {
  return { configured: Boolean(getProviderConfig().provider) };
}

module.exports = {
  generateQuestions,
  listSets,
  getSet,
  getStatus,
  VALID_TYPES,
  VALID_DIFFICULTIES
};
