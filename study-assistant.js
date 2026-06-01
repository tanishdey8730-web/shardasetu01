(function () {
  const GUEST_KEY = "sharda_setu_guest_session";
  const THEME_KEY = "sharda_setu_sa_theme";

  const $ = (id) => document.getElementById(id);

  let conversationId = null;
  let sending = false;
  let recognition = null;

  const els = {
    messages: $("sa-messages"),
    welcome: $("sa-welcome"),
    typing: $("sa-typing"),
    form: $("sa-form"),
    input: $("sa-input"),
    sendBtn: $("sa-send-btn"),
    convList: $("sa-conv-list"),
    examFocus: $("sa-exam-focus"),
    chatTitle: $("sa-chat-title"),
    newChat: $("sa-new-chat"),
    themeBtn: $("sa-theme-btn"),
    voiceBtn: $("sa-voice-btn"),
    deleteBtn: $("sa-delete-btn"),
    statusBanner: $("sa-status-banner"),
    sidebar: $("sa-sidebar"),
    backdrop: $("sa-backdrop"),
    menuBtn: $("sa-menu-btn")
  };

  function getGuestSessionId() {
    let id = localStorage.getItem(GUEST_KEY);
    if (!id) {
      id =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : "g_" + Date.now() + "_" + Math.random().toString(36).slice(2);
      localStorage.setItem(GUEST_KEY, id);
    }
    return id;
  }

  function chatHeaders() {
    const headers = { "Content-Type": "application/json" };
    const token = window.ShardaAuth?.getToken?.();
    if (token) headers.Authorization = `Bearer ${token}`;
    else headers["X-Guest-Session"] = getGuestSessionId();
    return headers;
  }

  async function chatFetch(url, options = {}) {
    const res = await fetch(url, {
      ...options,
      headers: { ...chatHeaders(), ...(options.headers || {}) }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  function renderMarkdown(text) {
    if (!text) return "";
    const raw = typeof marked !== "undefined" ? marked.parse(text, { breaks: true }) : escapeHtml(text);
    if (typeof DOMPurify !== "undefined") {
      return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
    }
    return raw;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function appendMessage(role, content, opts = {}) {
    els.welcome.hidden = true;
    const div = document.createElement("div");
    div.className = `sa-msg ${role}`;
    div.dataset.messageId = opts.id || "";

    const avatar = document.createElement("div");
    avatar.className = "sa-msg-avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = role === "user" ? "🙋" : "🎓";

    const bubble = document.createElement("div");
    bubble.className = "sa-msg-bubble";
    if (role === "assistant") {
      bubble.innerHTML = renderMarkdown(content);
    } else {
      bubble.textContent = content;
    }

    div.appendChild(avatar);
    div.appendChild(bubble);
    els.messages.appendChild(div);
    scrollToBottom();
    return div;
  }

  function scrollToBottom() {
    els.messages.scrollTop = els.messages.scrollHeight;
  }

  function setTyping(visible) {
    els.typing.hidden = !visible;
    if (visible) scrollToBottom();
  }

  function setSending(active) {
    sending = active;
    els.sendBtn.disabled = active;
    els.input.disabled = active;
    setTyping(active);
  }

  function clearMessagesUi() {
    els.messages.querySelectorAll(".sa-msg").forEach((n) => n.remove());
    els.welcome.hidden = false;
  }

  function showStatus(message, isError) {
    els.statusBanner.hidden = false;
    els.statusBanner.innerHTML = `<div class="banner${isError ? " error" : ""}">${escapeHtml(message)}</div>`;
  }

  function hideStatus() {
    els.statusBanner.hidden = true;
    els.statusBanner.innerHTML = "";
  }

  async function loadStatus() {
    try {
      const data = await fetch("/api/chat/status").then((r) => r.json());
      if (!data.configured) {
        showStatus(
          "AI keys not configured on server. Add OPENAI_API_KEY or GEMINI_API_KEY to .env and restart npm start.",
          true
        );
      }
    } catch (_) {}
  }

  async function loadConversations() {
    try {
      const data = await chatFetch("/api/chat/conversations");
      renderConvList(data.conversations || []);
    } catch (err) {
      els.convList.innerHTML = `<p class="sa-conv-empty">${escapeHtml(err.message)}</p>`;
    }
  }

  function renderConvList(list) {
    if (!list.length) {
      els.convList.innerHTML = '<p class="sa-conv-empty">No conversations yet</p>';
      return;
    }
    els.convList.innerHTML = "";
    list.forEach((c) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sa-conv-item" + (c.id === conversationId ? " active" : "");
      btn.innerHTML = `${escapeHtml(c.title)}<small>${escapeHtml(c.examFocus || "general")} · ${c.messageCount} msgs</small>`;
      btn.addEventListener("click", () => openConversation(c.id));
      els.convList.appendChild(btn);
    });
  }

  async function openConversation(id) {
    closeSidebar();
    try {
      const data = await chatFetch(`/api/chat/conversations/${id}`);
      conversationId = data.conversation.id;
      els.examFocus.value = data.conversation.examFocus || "general";
      els.chatTitle.textContent = data.conversation.title || "Conversation";
      els.deleteBtn.hidden = false;
      clearMessagesUi();
      els.welcome.hidden = true;
      data.conversation.messages.forEach((m) => {
        appendMessage(m.role, m.content, { id: m.id });
      });
      await loadConversations();
    } catch (err) {
      showStatus(err.message, true);
    }
  }

  function startNewChat() {
    conversationId = null;
    els.chatTitle.textContent = "New conversation";
    els.deleteBtn.hidden = true;
    clearMessagesUi();
    els.input.focus();
    loadConversations();
    closeSidebar();
  }

  async function sendMessage(text) {
    const message = (text || els.input.value).trim();
    if (!message || sending) return;

    hideStatus();
    els.input.value = "";
    autoResizeInput();
    appendMessage("user", message);
    setSending(true);

    try {
      const body = {
        message,
        examFocus: els.examFocus.value,
        conversationId: conversationId || undefined
      };
      if (!window.ShardaAuth?.getToken?.()) {
        body.guestSessionId = getGuestSessionId();
      }

      const data = await chatFetch("/api/chat", {
        method: "POST",
        body: JSON.stringify(body)
      });

      conversationId = data.conversationId;
      els.chatTitle.textContent = data.title || "Conversation";
      els.deleteBtn.hidden = false;
      appendMessage("assistant", data.assistantMessage.content, {
        id: data.assistantMessage.id
      });
      await loadConversations();
    } catch (err) {
      showStatus(err.message, true);
    } finally {
      setSending(false);
      els.input.focus();
    }
  }

  async function deleteCurrentConversation() {
    if (!conversationId) return;
    if (!confirm("Delete this conversation?")) return;
    try {
      await chatFetch(`/api/chat/conversations/${conversationId}`, { method: "DELETE" });
      startNewChat();
    } catch (err) {
      showStatus(err.message, true);
    }
  }

  function autoResizeInput() {
    const ta = els.input;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 140) + "px";
  }

  function initTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    const prefersDark =
      saved === "dark" || (!saved && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.setAttribute("data-theme", prefersDark ? "dark" : "light");
    els.themeBtn.textContent = prefersDark ? "☀️" : "🌙";
  }

  function toggleTheme() {
    const dark = document.documentElement.getAttribute("data-theme") === "dark";
    const next = dark ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem(THEME_KEY, next);
    els.themeBtn.textContent = next === "dark" ? "☀️" : "🌙";
  }

  function initVoice() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      els.voiceBtn.title = "Voice input not supported in this browser";
      els.voiceBtn.disabled = true;
      return;
    }
    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-IN";

    recognition.onresult = (event) => {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      els.input.value = (els.input.value + " " + transcript).trim();
      autoResizeInput();
    };

    recognition.onend = () => {
      els.voiceBtn.classList.remove("listening");
    };

    recognition.onerror = () => {
      els.voiceBtn.classList.remove("listening");
      showStatus("Could not capture voice. Check microphone permission.", true);
    };

    els.voiceBtn.addEventListener("click", () => {
      if (els.voiceBtn.classList.contains("listening")) {
        recognition.stop();
        els.voiceBtn.classList.remove("listening");
        return;
      }
      try {
        recognition.start();
        els.voiceBtn.classList.add("listening");
      } catch (_) {
        showStatus("Voice recognition is already active.", true);
      }
    });
  }

  function openSidebar() {
    els.sidebar.classList.add("open");
    els.backdrop.classList.add("visible");
  }

  function closeSidebar() {
    els.sidebar.classList.remove("open");
    els.backdrop.classList.remove("visible");
  }

  function bindEvents() {
    els.form.addEventListener("submit", (e) => {
      e.preventDefault();
      sendMessage();
    });

    els.input.addEventListener("input", autoResizeInput);
    els.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    els.newChat.addEventListener("click", startNewChat);
    els.themeBtn.addEventListener("click", toggleTheme);
    els.deleteBtn.addEventListener("click", deleteCurrentConversation);
    els.menuBtn.addEventListener("click", openSidebar);
    els.backdrop.addEventListener("click", closeSidebar);

    document.querySelectorAll("#sa-starter-chips .sa-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        const prompt = chip.getAttribute("data-prompt");
        if (prompt) sendMessage(prompt);
      });
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    initTheme();
    initVoice();
    bindEvents();
    loadStatus();
    loadConversations();
    autoResizeInput();
  });
})();
