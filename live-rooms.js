(function () {
  const $ = (id) => document.getElementById(id);

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function toast(n) {
    const el = $("lr-notifications");
    if (!el) return;
    const div = document.createElement("div");
    div.className = "lr-toast";
    div.innerHTML = `<strong>${escapeHtml(n.title || "Notification")}</strong><span>${escapeHtml(n.body || "")}</span>`;
    el.appendChild(div);
    setTimeout(() => div.remove(), 6000);
  }

  async function loadRooms() {
    const res = await fetch("/api/live/rooms");
    const data = await res.json();
    const rooms = data.rooms || [];
    if (!rooms.length) {
      $("lr-rooms").innerHTML = "<p class='lr-empty'>No live classes scheduled.</p>";
      return;
    }
    $("lr-rooms").innerHTML = rooms
      .map(
        (r) => `
      <a class="lr-room-card" href="live-room.html?room=${encodeURIComponent(r.id)}">
        <span class="lr-status ${r.status}">${escapeHtml(r.status)}</span>
        <h3>${escapeHtml(r.title)}</h3>
        <p>${escapeHtml(r.description || "")}</p>
        <footer>${escapeHtml(r.hostName || "Host")} · ${escapeHtml(r.examId || "General")}</footer>
      </a>`
      )
      .join("");
  }

  async function setupRealtimeToasts() {
    if (!window.ShardaAuth?.isLoggedIn?.()) return;
    try {
      const socket = await window.ShardaRealtime.connect();
      socket.on("notification", toast);
    } catch (_) {}
  }

  async function setupCreate() {
    const user = window.ShardaAuth?.getUser?.();
    if (user?.role === "teacher" || user?.role === "admin") {
      $("lr-create").hidden = false;
      $("lr-new-btn").addEventListener("click", async () => {
        try {
          const room = await window.ShardaAuth.apiFetch("/api/live/rooms", {
            method: "POST",
            body: JSON.stringify({
              title: $("lr-new-title").value,
              videoUrl: $("lr-new-video").value,
              status: "live"
            })
          });
          location.href = `live-room.html?room=${encodeURIComponent(room.room.id)}`;
        } catch (err) {
          alert(err.message);
        }
      });
    }
  }

  async function init() {
    await loadRooms();
    setupCreate();
    setupRealtimeToasts();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
