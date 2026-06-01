const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");
const youtube = require("./youtube-utils");

const STORE_FILE = path.join(__dirname, "data", "video-summaries.json");

const SUMMARIZER_PROMPT = `You are Sharda Setu Video Summarizer for Indian competitive exam students (SSC, NDA, CDS, AFCAT, RRB).

From the video transcript/content below, output valid JSON only (no markdown fence around JSON):
{
  "title": "video topic title",
  "summary": "comprehensive summary in 4-8 paragraphs (plain text, use \\n\\n between paragraphs)",
  "keyPoints": ["bullet 1", "bullet 2", "..."],
  "concepts": [{"name": "string", "explanation": "string"}],
  "formulas": [{"name": "string", "expression": "string", "usage": "string"}],
  "practiceQuestions": [
    {"question": "string", "options": ["A", "B", "C", "D"], "correct": 0, "explanation": "string"}
  ],
  "revisionNotes": "scannable revision sheet with bullets and key reminders (plain text, line breaks)",
  "timestamps": [{"label": "topic section name", "approxMinute": number}]
}

Rules:
- 5-10 keyPoints capturing the lesson flow
- 5-12 concepts with clear explanations
- All important formulas from the lesson
- Exactly 5 practice MCQs exam-style (correct = 0-based index)
- Revision notes must be concise and exam-focused
- timestamps: 3-6 approximate sections if transcript suggests structure; else empty array
- Simple English; Hindi terms OK when standard`;

function newId() {
  return crypto.randomBytes(12).toString("hex");
}

function loadStore() {
  if (!fs.existsSync(STORE_FILE)) {
    fs.writeFileSync(STORE_FILE, JSON.stringify({ summaries: [] }, null, 2));
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

async function callAI(systemPrompt, userPrompt, sourceText) {
  const config = getProviderConfig();
  if (!config.provider) return { error: "AI not configured", status: 503 };

  const userContent = `${userPrompt}\n\n---SOURCE---\n${sourceText}`;

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
            { role: "user", content: userContent }
          ],
          temperature: 0.45,
          max_tokens: 4500
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
        contents: [{ role: "user", parts: [{ text: userContent }] }],
        generationConfig: { temperature: 0.45, maxOutputTokens: 4500 }
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

function publicSummary(record) {
  return {
    id: record.id,
    userId: record.userId,
    youtubeUrl: record.youtubeUrl,
    videoId: record.videoId,
    title: record.title,
    channel: record.channel,
    hasTranscript: record.hasTranscript,
    summary: record.summary,
    keyPoints: record.keyPoints,
    concepts: record.concepts,
    formulas: record.formulas,
    practiceQuestions: record.practiceQuestions,
    revisionNotes: record.revisionNotes,
    timestamps: record.timestamps,
    provider: record.provider,
    createdAt: record.createdAt
  };
}

async function summarizeVideo({ userId, youtubeUrl, examFocus }) {
  if (!userId) return { error: "Sign in required", status: 401 };
  if (!youtubeUrl) return { error: "youtubeUrl is required", status: 400 };

  const source = await youtube.extractYoutubeSource(youtubeUrl);
  if (source.error) return source;

  const prompt = `Exam focus: ${examFocus || "general competitive exams (SSC, NDA, CDS, AFCAT, RRB)"}. Summarize this YouTube lesson for exam preparation.`;
  const ai = await callAI(SUMMARIZER_PROMPT, prompt, source.sourceText);
  if (ai.error) return ai;

  const parsed = parseAiJson(ai.content);
  const data = parsed || {
    title: source.title,
    summary: ai.content,
    keyPoints: [],
    concepts: [],
    formulas: [],
    practiceQuestions: [],
    revisionNotes: "",
    timestamps: []
  };

  if (!data.title) data.title = source.title;

  const record = {
    id: newId(),
    userId,
    youtubeUrl: source.sourceRef,
    videoId: source.videoId,
    title: data.title,
    channel: source.channel,
    hasTranscript: source.hasTranscript,
    summary: data.summary || "",
    keyPoints: data.keyPoints || [],
    concepts: data.concepts || [],
    formulas: data.formulas || [],
    practiceQuestions: (data.practiceQuestions || []).slice(0, 8),
    revisionNotes: data.revisionNotes || "",
    timestamps: data.timestamps || [],
    provider: ai.provider,
    createdAt: new Date().toISOString()
  };

  const store = loadStore();
  store.summaries.unshift(record);
  if (store.summaries.length > 300) store.summaries = store.summaries.slice(0, 300);
  saveStore(store);

  return { summary: publicSummary(record), status: 201 };
}

function listSummaries(userId) {
  const store = loadStore();
  return {
    summaries: store.summaries
      .filter((s) => s.userId === userId)
      .slice(0, 25)
      .map((s) => ({
        id: s.id,
        title: s.title,
        videoId: s.videoId,
        youtubeUrl: s.youtubeUrl,
        hasTranscript: s.hasTranscript,
        createdAt: s.createdAt
      }))
  };
}

function getSummary(summaryId, userId) {
  const store = loadStore();
  const record = store.summaries.find((s) => s.id === summaryId);
  if (!record) return { error: "Summary not found", status: 404 };
  if (record.userId !== userId) return { error: "Access denied", status: 403 };
  return { summary: publicSummary(record) };
}

async function exportPdf(summaryId, userId) {
  const result = getSummary(summaryId, userId);
  if (result.error) return result;
  const s = result.summary;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: "A4" });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () =>
      resolve({
        buffer: Buffer.concat(chunks),
        contentType: "application/pdf",
        filename: `${(s.title || "summary").replace(/[^\w\s-]/g, "").slice(0, 50)}.pdf`
      })
    );
    doc.on("error", reject);

    doc.fontSize(18).font("Helvetica-Bold").text(s.title, { align: "center" });
    doc.moveDown(0.5);
    doc
      .fontSize(9)
      .font("Helvetica")
      .fillColor("#555")
      .text(`Sharda Setu Video Summary · ${s.channel || "YouTube"} · ${s.youtubeUrl}`, {
        align: "center"
      });
    doc.moveDown(1.5);
    doc.fillColor("#000");

    doc.font("Helvetica-Bold").fontSize(13).text("Summary");
    doc.font("Helvetica").fontSize(10).text(s.summary || "", { lineGap: 4 });
    doc.moveDown();

    if (s.keyPoints?.length) {
      doc.font("Helvetica-Bold").fontSize(13).text("Key Points");
      s.keyPoints.forEach((p) => doc.font("Helvetica").fontSize(10).text(`• ${p}`, { lineGap: 2 }));
      doc.moveDown();
    }

    doc.font("Helvetica-Bold").fontSize(13).text("Concepts");
    (s.concepts || []).forEach((c) => {
      doc.font("Helvetica-Bold").fontSize(10).text(c.name);
      doc.font("Helvetica").text(c.explanation || "", { indent: 10, lineGap: 2 });
    });
    doc.moveDown();

    doc.font("Helvetica-Bold").fontSize(13).text("Formulas");
    (s.formulas || []).forEach((f) => {
      doc
        .font("Helvetica")
        .fontSize(10)
        .text(`${f.name}: ${f.expression}${f.usage ? ` — ${f.usage}` : ""}`);
    });
    doc.moveDown();

    doc.font("Helvetica-Bold").fontSize(13).text("Practice Questions");
    (s.practiceQuestions || []).forEach((q, i) => {
      doc.font("Helvetica-Bold").fontSize(10).text(`Q${i + 1}. ${q.question}`);
      (q.options || []).forEach((opt, j) => {
        const mark = j === q.correct ? " ✓" : "";
        doc.font("Helvetica").text(`   ${String.fromCharCode(65 + j)}. ${opt}${mark}`);
      });
      if (q.explanation) doc.font("Helvetica").text(`   Explanation: ${q.explanation}`, { lineGap: 2 });
      doc.moveDown(0.3);
    });

    doc.font("Helvetica-Bold").fontSize(13).text("Revision Notes");
    doc.font("Helvetica").fontSize(10).text(s.revisionNotes || "", { lineGap: 3 });

    doc.end();
  });
}

function getStatus() {
  return { configured: Boolean(getProviderConfig().provider) };
}

module.exports = {
  summarizeVideo,
  listSummaries,
  getSummary,
  exportPdf,
  getStatus
};
