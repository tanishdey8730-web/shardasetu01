const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const STORE_FILE = path.join(__dirname, "data", "conversations.json");
const MAX_MESSAGE_LEN = 4000;
const MAX_HISTORY_TURNS = 24;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_PER_WINDOW = 30;

const EXAM_FOCUS = ["ssc", "nda", "cds", "afcat", "rrb", "general"];

const SYSTEM_PROMPT = `You are Sharda Setu Study Assistant — an expert tutor for Indian government competitive exams.

Your audience: aspirants preparing for SSC (CGL, CHSL, MTS, GD), NDA, CDS, AFCAT, RRB (NTPC and related), and related defence/railway exams.

Guidelines:
- Answer exam-related doubts clearly in simple English (Hindi terms OK when helpful).
- Explain concepts, formulas, shortcuts, and step-by-step solutions.
- For maths/physics/chemistry, show working and mention common traps.
- Cite syllabus relevance when useful (e.g. SSC Tier-1 vs NDA Paper pattern).
- Use markdown: headings, bullet lists, bold for key terms, code blocks for formulas when needed.
- Keep answers focused; use examples and mnemonics for shortcuts.
- If the question is off-topic (not education/exam prep), politely redirect to study topics.
- Never fabricate official notifications, dates, or cut-offs — say to verify on official sites.
- Encourage ethical preparation; do not help with cheating or leaked papers.`;

const rateBuckets = new Map();

function newId() {
  return crypto.randomBytes(12).toString("hex");
}

function loadStore() {
  if (!fs.existsSync(STORE_FILE)) {
    const initial = { conversations: [] };
    fs.writeFileSync(STORE_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  return JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
}

function saveStore(store) {
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2));
}

function normalizeExamFocus(value) {
  const v = String(value || "general").toLowerCase().trim();
  if (EXAM_FOCUS.includes(v)) return v;
  if (v.includes("ssc")) return "ssc";
  if (v.includes("nda")) return "nda";
  if (v.includes("cds")) return "cds";
  if (v.includes("afcat")) return "afcat";
  if (v.includes("rrb") || v.includes("railway")) return "rrb";
  return "general";
}

function examFocusLabel(focus) {
  const labels = {
    ssc: "SSC (CGL, CHSL, MTS, GD)",
    nda: "NDA",
    cds: "CDS",
    afcat: "AFCAT",
    rrb: "RRB / Railway",
    general: "General competitive exams"
  };
  return labels[focus] || labels.general;
}

function checkRateLimit(key) {
  const now = Date.now();
  let bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.start > RATE_WINDOW_MS) {
    bucket = { start: now, count: 0 };
    rateBuckets.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count > RATE_MAX_PER_WINDOW) {
    return { error: "Too many messages. Please wait a minute and try again.", status: 429 };
  }
  return null;
}

function getProviderConfig() {
  const preferred = (process.env.CHAT_PROVIDER || "auto").toLowerCase();
  const openaiKey = process.env.OPENAI_API_KEY || "";
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";

  if (preferred === "openai" && openaiKey) {
    return { provider: "openai", apiKey: openaiKey };
  }
  if (preferred === "gemini" && geminiKey) {
    return { provider: "gemini", apiKey: geminiKey };
  }
  if (preferred === "auto") {
    if (openaiKey) return { provider: "openai", apiKey: openaiKey };
    if (geminiKey) return { provider: "gemini", apiKey: geminiKey };
  }
  return { provider: null, apiKey: null };
}

function buildMessagesForApi(conversation, examFocus) {
  const focusLine = `Current exam focus: ${examFocusLabel(examFocus)}.`;
  const system = `${SYSTEM_PROMPT}\n\n${focusLine}`;
  const history = conversation.messages.slice(-MAX_HISTORY_TURNS);
  const apiMessages = [{ role: "system", content: system }];
  for (const m of history) {
    if (m.role === "user" || m.role === "assistant") {
      apiMessages.push({ role: m.role, content: m.content });
    }
  }
  return apiMessages;
}

async function callOpenAI(messages) {
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.6,
      max_tokens: 2048
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error?.message || `OpenAI API error (${res.status})`;
    throw new Error(msg);
  }
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty response from OpenAI");
  return { content: content.trim(), provider: "openai", model };
}

async function callGemini(messages) {
  const model = process.env.GEMINI_MODEL || "gemini-1.5-flash";
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

  const systemParts = messages.filter((m) => m.role === "system").map((m) => m.content);
  const systemInstruction = systemParts.join("\n\n");

  const contents = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    contents.push({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }]
    });
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body = {
    contents,
    generationConfig: {
      temperature: 0.6,
      maxOutputTokens: 2048
    }
  };
  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error?.message || `Gemini API error (${res.status})`;
    throw new Error(msg);
  }
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) throw new Error("Empty response from Gemini");
  return { content: content.trim(), provider: "gemini", model };
}

async function generateReply(messages) {
  const config = getProviderConfig();
  if (!config.provider) {
    return {
      error:
        "AI is not configured. Set OPENAI_API_KEY or GEMINI_API_KEY in your environment. See .env.example.",
      status: 503
    };
  }
  try {
    if (config.provider === "openai") {
      return { ...(await callOpenAI(messages)), status: 200 };
    }
    return { ...(await callGemini(messages)), status: 200 };
  } catch (err) {
    return { error: err.message || "AI request failed", status: 502 };
  }
}

function ownerKey(userId, guestSessionId) {
  if (userId) return `user:${userId}`;
  if (guestSessionId) return `guest:${guestSessionId}`;
  return null;
}

function findConversation(store, conversationId, owner) {
  return store.conversations.find(
    (c) => c.id === conversationId && c.owner === owner
  );
}

function listConversations(owner) {
  const store = loadStore();
  return store.conversations
    .filter((c) => c.owner === owner)
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .map((c) => ({
      id: c.id,
      title: c.title,
      examFocus: c.examFocus,
      messageCount: c.messages.length,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt
    }));
}

function getConversation(conversationId, owner) {
  const store = loadStore();
  const conv = findConversation(store, conversationId, owner);
  if (!conv) return { error: "Conversation not found", status: 404 };
  return {
    conversation: {
      id: conv.id,
      title: conv.title,
      examFocus: conv.examFocus,
      messages: conv.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt
      })),
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt
    }
  };
}

function deleteConversation(conversationId, owner) {
  const store = loadStore();
  const idx = store.conversations.findIndex(
    (c) => c.id === conversationId && c.owner === owner
  );
  if (idx === -1) return { error: "Conversation not found", status: 404 };
  store.conversations.splice(idx, 1);
  saveStore(store);
  return { ok: true };
}

function titleFromMessage(text) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= 48) return clean;
  return `${clean.slice(0, 45)}…`;
}

async function handleChat({
  message,
  conversationId,
  examFocus,
  userId,
  guestSessionId
}) {
  const owner = ownerKey(userId, guestSessionId);
  if (!owner) {
    return {
      error: "Sign in or provide a guest session id (X-Guest-Session header).",
      status: 400
    };
  }

  const text = String(message || "").trim();
  if (!text) return { error: "message is required", status: 400 };
  if (text.length > MAX_MESSAGE_LEN) {
    return { error: `Message must be under ${MAX_MESSAGE_LEN} characters`, status: 400 };
  }

  const rateKey = userId || guestSessionId;
  const rateErr = checkRateLimit(rateKey);
  if (rateErr) return rateErr;

  const focus = normalizeExamFocus(examFocus);
  const store = loadStore();
  let conversation;

  if (conversationId) {
    conversation = findConversation(store, conversationId, owner);
    if (!conversation) return { error: "Conversation not found", status: 404 };
    if (examFocus) conversation.examFocus = focus;
  } else {
    conversation = {
      id: newId(),
      owner,
      userId: userId || null,
      guestSessionId: guestSessionId || null,
      title: titleFromMessage(text),
      examFocus: focus,
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    store.conversations.push(conversation);
  }

  const userMsg = {
    id: newId(),
    role: "user",
    content: text,
    createdAt: new Date().toISOString()
  };
  conversation.messages.push(userMsg);
  conversation.updatedAt = new Date().toISOString();
  if (conversation.messages.filter((m) => m.role === "user").length === 1) {
    conversation.title = titleFromMessage(text);
  }

  const apiMessages = buildMessagesForApi(conversation, conversation.examFocus);
  const aiResult = await generateReply(apiMessages);
  if (aiResult.error) {
    conversation.messages.pop();
    saveStore(store);
    return { error: aiResult.error, status: aiResult.status };
  }

  const assistantMsg = {
    id: newId(),
    role: "assistant",
    content: aiResult.content,
    provider: aiResult.provider,
    model: aiResult.model,
    createdAt: new Date().toISOString()
  };
  conversation.messages.push(assistantMsg);
  conversation.updatedAt = new Date().toISOString();
  saveStore(store);

  return {
    conversationId: conversation.id,
    title: conversation.title,
    examFocus: conversation.examFocus,
    userMessage: userMsg,
    assistantMessage: assistantMsg,
    provider: aiResult.provider
  };
}

function getStatus() {
  const config = getProviderConfig();
  return {
    configured: Boolean(config.provider),
    provider: config.provider,
    exams: EXAM_FOCUS.filter((e) => e !== "general"),
    maxMessageLength: MAX_MESSAGE_LEN
  };
}

module.exports = {
  handleChat,
  listConversations,
  getConversation,
  deleteConversation,
  getStatus,
  normalizeExamFocus,
  EXAM_FOCUS
};
