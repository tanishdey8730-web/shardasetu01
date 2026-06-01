(function () {
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const roomId = params.get("room");

  let socket = null;
  let roomData = null;
  let notifCount = 0;
  const msgStatus = new Map();

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function setConn(text, ok) {
    const el = $("lr-connection");
    el.textContent = text;
    el.className = "lr-conn " + (ok ? "connected" : "");
  }

  function showToast(n) {
    const el = $("lr-toasts");
    const div = document.createElement("div");
    div.className = "lr-toast";
    div.innerHTML = `<strong>${escapeHtml(n.title || "Notification")}</strong>${escapeHtml(n.body || "")}`;
    el.appendChild(div);
    setTimeout(() => div.remove(), 5000);
    notifCount += 1;
    const badge = $("lr-notif-count");
    badge.hidden = false;
    badge.textContent = String(notifCount);
  }

  function renderVideo(url) {
    const wrap = $("lr-video-wrap");
    if (!url) {
      wrap.innerHTML = '<p class="lr-video-placeholder">Waiting for host to start video…</p>';
      return;
    }
    wrap.innerHTML = `<iframe src="${escapeHtml(url)}" allowfullscreen title="Live class video"></iframe>`;
  }

  function renderPresence(users) {
    $("lr-presence-count").textContent = users?.length || 0;
    $("lr-presence").innerHTML = (users || [])
      .map(
        (u) => `
      <li>
        <span class="lr-presence-dot ${u.status === "away" ? "away" : ""}"></span>
        ${escapeHtml(u.name)}
        ${u.role === "teacher" || u.role === "admin" ? '<span style="color:#38bdf8">★</span>' : ""}
      </li>`
      )
      .join("");
  }

  function statusLabel(status) {
    if (status === "read") return "✓✓ Read";
    if (status === "delivered") return "✓✓ Delivered";
    if (status === "sent") return "✓ Sent";
    return "…";
  }

  function appendMessage(msg, mine) {
    const log = $("lr-chat");
    const div = document.createElement("div");
    div.className = "lr-msg" + (mine ? " mine" : "");
    div.dataset.id = msg.id;
    div.innerHTML = `
      <div class="lr-msg-head">
        <span>${escapeHtml(msg.userName)}</span>
        <span class="lr-msg-status" data-status>${statusLabel(msg.status)}</span>
      </div>
      <div>${escapeHtml(msg.text)}</div>`;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    msgStatus.set(msg.id, msg.status || "sent");

    if (!mine) {
      socket?.emit("chat:received", { roomId, messageId: msg.id });
    }
  }

  function updateMsgStatus(messageId, status) {
    const el = document.querySelector(`.lr-msg[data-id="${messageId}"] [data-status]`);
    if (el) {
      el.textContent = statusLabel(status);
      el.className = "lr-msg-status " + status;
    }
    msgStatus.set(messageId, status);
  }

  function renderPoll(poll) {
    const area = $("lr-poll-area");
    if (!poll || poll.status === "closed") {
      area.innerHTML = poll
        ? `<div class="lr-poll-box"><p>${escapeHtml(poll.question)}</p><p style="color:#94a3b8">Poll closed</p></div>`
        : "<p style='color:#94a3b8;font-size:0.85rem'>No active poll</p>";
      return;
    }
    const total = poll.options.reduce((s, o) => s + o.votes, 0) || 1;
    area.innerHTML = `
      <div class="lr-poll-box">
        <p><strong>${escapeHtml(poll.question)}</strong></p>
        ${poll.options
          .map(
            (o) => `
          <button type="button" data-poll="${poll.id}" data-opt="${o.id}">
            ${escapeHtml(o.text)} — ${o.votes} (${Math.round((o.votes / total) * 100)}%)
          </button>`
          )
          .join("")}
      </div>`;
    area.querySelectorAll("button[data-poll]").forEach((btn) => {
      btn.addEventListener("click", () => {
        socket.emit(
          "poll:vote",
          { roomId, pollId: btn.dataset.poll, optionId: btn.dataset.opt },
          (res) => {
            if (res?.error) alert(res.error);
            else if (res.poll) renderPoll(res.poll);
          }
        );
      });
    });
  }

  function bindSocket() {
    socket.on("chat:message", (msg) => {
      const mine = msg.userId === window.ShardaAuth.getUser()?.id;
      appendMessage(msg, mine);
    });

    socket.on("chat:status", (payload) => {
      updateMsgStatus(payload.messageId, payload.status);
    });

    socket.on("presence:update", (p) => {
      if (p.roomId === roomId) renderPresence(p.users);
    });

    socket.on("poll:update", (p) => {
      renderPoll(p.poll);
      if (p.action === "created") {
        showToast({ title: "New poll", body: p.poll.question });
      }
    });

    socket.on("class:state", (s) => {
      if (s.videoUrl) renderVideo(s.videoUrl);
    });

    socket.on("notification", showToast);

    socket.on("disconnect", () => setConn("Disconnected", false));
    socket.on("connect", () => setConn("Connected", true));
  }

  async function init() {
    if (!roomId) {
      location.href = "live-rooms.html";
      return;
    }

    if (!window.ShardaAuth?.isLoggedIn?.()) {
      $("lr-guest").hidden = false;
      $("lr-login-link").href = `login.html?next=${encodeURIComponent(location.pathname + location.search)}`;
      return;
    }

    $("lr-app").hidden = false;

    const res = await fetch(`/api/live/rooms/${encodeURIComponent(roomId)}`);
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || "Room not found");
      location.href = "live-rooms.html";
      return;
    }

    roomData = data.room;
    $("lr-room-title").textContent = roomData.title;
    $("lr-live-dot").classList.toggle("on", roomData.status === "live");
    renderVideo(roomData.videoUrl);

    const user = window.ShardaAuth.getUser();
    if (user.role === "teacher" || user.role === "admin") {
      $("lr-poll-create").hidden = false;
      if (roomData.hostId === user.id || user.role === "admin") {
        $("lr-host-controls").hidden = false;
        $("lr-set-video").addEventListener("click", () => {
          const url = $("lr-video-url").value.trim();
          socket.emit("class:update", { roomId, videoUrl: url }, () => renderVideo(url));
        });
      }
      $("lr-poll-start").addEventListener("click", () => {
        const opts = [...document.querySelectorAll(".lr-poll-opt")]
          .map((i) => i.value.trim())
          .filter(Boolean);
        socket.emit(
          "poll:create",
          { roomId, question: $("lr-poll-q").value, options: opts.map((t) => ({ text: t })) },
          (res) => {
            if (res?.error) alert(res.error);
            else renderPoll(res.poll);
          }
        );
      });
    }

    try {
      socket = await window.ShardaRealtime.connect();
      bindSocket();
      const joined = await window.ShardaRealtime.joinRoom(socket, roomId);
      renderPresence(joined.presence);
      (joined.messages || []).forEach((m) => {
        appendMessage(m, m.userId === user.id);
      });
      const openPoll = (joined.polls || [])[0];
      if (openPoll) renderPoll(openPoll);
      else renderPoll(null);
    } catch (err) {
      setConn(err.message || "Connection failed", false);
    }

    $("lr-chat-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = $("lr-chat-input").value.trim();
      if (!text || !socket) return;
      const clientMsgId = `c-${Date.now()}`;
      try {
        const res = await window.ShardaRealtime.sendChat(socket, roomId, text, clientMsgId);
        appendMessage(res.message, true);
        $("lr-chat-input").value = "";
      } catch (err) {
        alert(err.message);
      }
    });

    window.addEventListener("beforeunload", () => {
      socket?.emit("room:leave", { roomId });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
