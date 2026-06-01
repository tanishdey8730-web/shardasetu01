const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");
const { Document, Packer, Paragraph, TextRun, HeadingLevel } = require("docx");

const STORE_FILE = path.join(__dirname, "data", "generated-notes.json");
const UPLOAD_DIR = path.join(__dirname, "storage", "uploads");
const MAX_SOURCE_CHARS = 28000;
const MAX_PDF_BYTES = 8 * 1024 * 1024;

const NOTES_SCHEMA_PROMPT = `You are Sharda Setu Notes Generator for Indian competitive exam students (SSC, NDA, CDS, AFCAT, RRB).

From the source content below, produce study notes as valid JSON only (no markdown fence around JSON):
{
  "title": "string",
  "summary": "2-3 sentence overview",
  "concepts": [{"name": "string", "explanation": "string"}],
  "formulas": [{"name": "string", "expression": "string", "usage": "string"}],
  "revisionNotes": "concise bullet-style revision sheet as plain text with line breaks",
  "fullNotesMarkdown": "complete structured notes in markdown with ## headings, bullets, bold key terms"
}

Rules:
- Extract 5-12 important concepts
- Extract all key formulas with clear expressions
- Revision notes must be exam-focused and scannable
- Use simple English; Hindi terms OK where standard
- If source is thin, still produce best-effort notes and note limitations in summary`;

function newId() {
  return crypto.randomBytes(12).toString("hex");
}

function loadStore() {
  if (!fs.existsSync(STORE_FILE)) {
    const initial = { notes: [] };
    fs.writeFileSync(STORE_FILE, JSON.stringify(initial, null, 2));
    return initial;
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
  if (preferred === "gemini" && geminiKey) return { provider: "gemini", apiKey: geminiKey };
  if (openaiKey) return { provider: "openai", apiKey: openaiKey };
  if (geminiKey) return { provider: "gemini", apiKey: geminiKey };
  return { provider: null };
}

function parseYoutubeId(url) {
  const s = String(url || "").trim();
  const m =
    s.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/) ||
    s.match(/^([a-zA-Z0-9_-]{11})$/);
  return m ? m[1] : null;
}

async function fetchYoutubeMeta(videoId) {
  const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
  const res = await fetch(oembedUrl);
  if (!res.ok) return { title: "YouTube Video", author: "" };
  return res.json();
}

async function fetchYoutubeTranscript(videoId) {
  try {
    const { YoutubeTranscript } = require("youtube-transcript");
    const chunks = await YoutubeTranscript.fetchTranscript(videoId, { lang: "en" });
    if (chunks?.length) {
      return chunks.map((c) => c.text).join(" ");
    }
    const hi = await YoutubeTranscript.fetchTranscript(videoId, { lang: "hi" });
    if (hi?.length) return hi.map((c) => c.text).join(" ");
  } catch (_) {
    try {
      const { YoutubeTranscript } = require("youtube-transcript");
      const chunks = await YoutubeTranscript.fetchTranscript(videoId);
      if (chunks?.length) return chunks.map((c) => c.text).join(" ");
    } catch (__) {}
  }
  return "";
}

async function extractYoutubeSource(youtubeUrl) {
  const videoId = parseYoutubeId(youtubeUrl);
  if (!videoId) return { error: "Invalid YouTube URL or video ID", status: 400 };

  const [meta, transcript] = await Promise.all([
    fetchYoutubeMeta(videoId),
    fetchYoutubeTranscript(videoId)
  ]);

  let sourceText = "";
  if (transcript) {
    sourceText = `Video title: ${meta.title}\nChannel: ${meta.author_name || meta.author || ""}\n\nTranscript:\n${transcript}`;
  } else {
    sourceText = `Video title: ${meta.title}\nChannel: ${meta.author_name || meta.author || ""}\n\n(No captions available — generate notes from title and general topic knowledge. State in summary that transcript was unavailable.)`;
  }

  return {
    sourceType: "youtube",
    sourceRef: youtubeUrl,
    videoId,
    title: meta.title || "YouTube Lesson Notes",
    sourceText: sourceText.slice(0, MAX_SOURCE_CHARS)
  };
}

async function extractPdfSource(filePath, originalName) {
  let pdfParse;
  try {
    pdfParse = require("pdf-parse");
  } catch {
    return { error: "PDF parser not available", status: 500 };
  }

  const buffer = fs.readFileSync(filePath);
  if (buffer.length > MAX_PDF_BYTES) {
    return { error: "PDF must be under 8 MB", status: 400 };
  }

  const data = await pdfParse(buffer);
  const text = (data.text || "").trim();
  if (text.length < 80) {
    return {
      error: "Could not extract enough text from PDF. Use a text-based PDF (not scanned images).",
      status: 400
    };
  }

  return {
    sourceType: "pdf",
    sourceRef: originalName,
    title: originalName.replace(/\.pdf$/i, "") || "PDF Notes",
    sourceText: text.slice(0, MAX_SOURCE_CHARS)
  };
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

async function callOpenAI(prompt, sourceText) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: NOTES_SCHEMA_PROMPT },
        { role: "user", content: `${prompt}\n\n---SOURCE---\n${sourceText}` }
      ],
      temperature: 0.4,
      max_tokens: 4096
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "OpenAI request failed");
  return data.choices?.[0]?.message?.content || "";
}

async function callGemini(prompt, sourceText) {
  const model = process.env.GEMINI_MODEL || "gemini-1.5-flash";
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: NOTES_SCHEMA_PROMPT }] },
      contents: [
        {
          role: "user",
          parts: [{ text: `${prompt}\n\n---SOURCE---\n${sourceText}` }]
        }
      ],
      generationConfig: { temperature: 0.4, maxOutputTokens: 4096 }
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Gemini request failed");
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

async function generateNotesFromSource(source, options = {}) {
  const config = getProviderConfig();
  if (!config.provider) {
    return {
      error: "AI not configured. Set OPENAI_API_KEY or GEMINI_API_KEY in .env",
      status: 503
    };
  }

  const examFocus = options.examFocus || "general";
  const noteType = options.noteType || "full";
  const prompt = `Exam focus: ${examFocus}. Note style: ${noteType} (full = detailed, revision = shorter revision emphasis).`;

  try {
    const raw =
      config.provider === "openai"
        ? await callOpenAI(prompt, source.sourceText)
        : await callGemini(prompt, source.sourceText);

    const parsed = parseAiJson(raw);
    const notes = parsed || {
      title: source.title,
      summary: "Notes generated (structured parse fallback).",
      concepts: [],
      formulas: [],
      revisionNotes: raw,
      fullNotesMarkdown: raw
    };

    if (!notes.title) notes.title = source.title;

    return { notes, provider: config.provider, rawFallback: !parsed };
  } catch (err) {
    return { error: err.message || "AI generation failed", status: 502 };
  }
}

function publicNote(record) {
  return {
    id: record.id,
    userId: record.userId,
    sourceType: record.sourceType,
    sourceRef: record.sourceRef,
    title: record.title,
    summary: record.summary,
    concepts: record.concepts,
    formulas: record.formulas,
    revisionNotes: record.revisionNotes,
    fullNotesMarkdown: record.fullNotesMarkdown,
    provider: record.provider,
    createdAt: record.createdAt
  };
}

async function createNotes({ userId, sourceType, youtubeUrl, pdfPath, pdfOriginalName, examFocus, noteType }) {
  if (!userId) return { error: "Sign in required", status: 401 };

  let source;
  if (sourceType === "youtube") {
    if (!youtubeUrl) return { error: "youtubeUrl is required", status: 400 };
    source = await extractYoutubeSource(youtubeUrl);
  } else if (sourceType === "pdf") {
    if (!pdfPath) return { error: "PDF file is required", status: 400 };
    source = await extractPdfSource(pdfPath, pdfOriginalName);
    try {
      fs.unlinkSync(pdfPath);
    } catch (_) {}
  } else {
    return { error: "sourceType must be youtube or pdf", status: 400 };
  }

  if (source.error) return source;

  const gen = await generateNotesFromSource(source, { examFocus, noteType });
  if (gen.error) return gen;

  const record = {
    id: newId(),
    userId,
    sourceType: source.sourceType,
    sourceRef: source.sourceRef,
    videoId: source.videoId || null,
    title: gen.notes.title,
    summary: gen.notes.summary,
    concepts: gen.notes.concepts || [],
    formulas: gen.notes.formulas || [],
    revisionNotes: gen.notes.revisionNotes || "",
    fullNotesMarkdown: gen.notes.fullNotesMarkdown || "",
    provider: gen.provider,
    createdAt: new Date().toISOString()
  };

  const store = loadStore();
  store.notes.unshift(record);
  if (store.notes.length > 500) store.notes = store.notes.slice(0, 500);
  saveStore(store);

  return { note: publicNote(record), status: 201 };
}

function getNote(noteId, userId) {
  const store = loadStore();
  const note = store.notes.find((n) => n.id === noteId);
  if (!note) return { error: "Note not found", status: 404 };
  if (note.userId !== userId) return { error: "Access denied", status: 403 };
  return { note };
}

function listNotes(userId) {
  const store = loadStore();
  return {
    notes: store.notes
      .filter((n) => n.userId === userId)
      .slice(0, 30)
      .map((n) => ({
        id: n.id,
        title: n.title,
        sourceType: n.sourceType,
        createdAt: n.createdAt,
        conceptCount: (n.concepts || []).length
      }))
  };
}

function buildExportSections(note) {
  const lines = [];
  lines.push({ type: "h1", text: note.title });
  lines.push({ type: "p", text: note.summary });
  lines.push({ type: "h2", text: "Key Concepts" });
  for (const c of note.concepts || []) {
    lines.push({ type: "h3", text: c.name });
    lines.push({ type: "p", text: c.explanation });
  }
  lines.push({ type: "h2", text: "Formulas" });
  for (const f of note.formulas || []) {
    lines.push({
      type: "p",
      text: `${f.name}: ${f.expression}${f.usage ? ` — ${f.usage}` : ""}`
    });
  }
  lines.push({ type: "h2", text: "Revision Notes" });
  lines.push({ type: "p", text: note.revisionNotes });
  lines.push({ type: "h2", text: "Full Notes" });
  lines.push({ type: "p", text: note.fullNotesMarkdown });
  return lines;
}

async function exportPdf(note) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: "A4" });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(20).font("Helvetica-Bold").text(note.title, { align: "center" });
    doc.moveDown();
    doc.fontSize(10).font("Helvetica").fillColor("#555").text(
      `Sharda Setu · Generated ${new Date(note.createdAt).toLocaleDateString()}`,
      { align: "center" }
    );
    doc.moveDown(1.5);
    doc.fillColor("#000").fontSize(11);

    doc.font("Helvetica-Bold").fontSize(13).text("Summary");
    doc.font("Helvetica").fontSize(11).text(note.summary || "", { lineGap: 4 });
    doc.moveDown();

    doc.font("Helvetica-Bold").fontSize(13).text("Key Concepts");
    doc.moveDown(0.3);
    for (const c of note.concepts || []) {
      doc.font("Helvetica-Bold").text(`• ${c.name}`);
      doc.font("Helvetica").text(c.explanation || "", { indent: 12, lineGap: 3 });
      doc.moveDown(0.4);
    }

    doc.font("Helvetica-Bold").fontSize(13).text("Formulas");
    doc.moveDown(0.3);
    for (const f of note.formulas || []) {
      doc
        .font("Helvetica")
        .text(`${f.name}: ${f.expression}${f.usage ? ` — ${f.usage}` : ""}`, { lineGap: 3 });
    }
    doc.moveDown();

    doc.font("Helvetica-Bold").fontSize(13).text("Revision Notes");
    doc.font("Helvetica").fontSize(11).text(note.revisionNotes || "", { lineGap: 4 });
    doc.moveDown();

    doc.font("Helvetica-Bold").fontSize(13).text("Detailed Notes");
    doc.font("Helvetica").fontSize(10).text(
      (note.fullNotesMarkdown || "").replace(/[#*_`]/g, ""),
      { lineGap: 3 }
    );

    doc.end();
  });
}

async function exportDocx(note) {
  const children = [
    new Paragraph({
      text: note.title,
      heading: HeadingLevel.HEADING_1
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: note.summary || "",
          size: 22
        })
      ]
    })
  ];

  children.push(
    new Paragraph({ text: "Key Concepts", heading: HeadingLevel.HEADING_2 })
  );
  for (const c of note.concepts || []) {
    children.push(
      new Paragraph({ text: c.name, heading: HeadingLevel.HEADING_3 }),
      new Paragraph({ children: [new TextRun(c.explanation || "")] })
    );
  }

  children.push(
    new Paragraph({ text: "Formulas", heading: HeadingLevel.HEADING_2 })
  );
  for (const f of note.formulas || []) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `${f.name}: ${f.expression}`,
            bold: true
          }),
          new TextRun(f.usage ? ` — ${f.usage}` : "")
        ]
      })
    );
  }

  children.push(
    new Paragraph({ text: "Revision Notes", heading: HeadingLevel.HEADING_2 }),
    new Paragraph({ children: [new TextRun(note.revisionNotes || "")] }),
    new Paragraph({ text: "Full Notes", heading: HeadingLevel.HEADING_2 }),
    new Paragraph({
      children: [new TextRun((note.fullNotesMarkdown || "").replace(/[#*_`]/g, ""))]
    })
  );

  const doc = new Document({
    sections: [{ children }]
  });
  return Packer.toBuffer(doc);
}

async function exportNote(noteId, userId, format) {
  const result = getNote(noteId, userId);
  if (result.error) return result;
  const note = result.note;

  const safeName = note.title.replace(/[^\w\s-]/g, "").slice(0, 60) || "notes";

  if (format === "pdf") {
    const buffer = await exportPdf(note);
    return {
      buffer,
      contentType: "application/pdf",
      filename: `${safeName}.pdf`
    };
  }
  if (format === "docx") {
    const buffer = await exportDocx(note);
    return {
      buffer,
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      filename: `${safeName}.docx`
    };
  }
  return { error: "format must be pdf or docx", status: 400 };
}

function getStatus() {
  const config = getProviderConfig();
  return { configured: Boolean(config.provider), provider: config.provider };
}

module.exports = {
  createNotes,
  getNote,
  listNotes,
  exportNote,
  getStatus,
  UPLOAD_DIR,
  parseYoutubeId
};
