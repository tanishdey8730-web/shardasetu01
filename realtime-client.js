/**
 * Sharda Setu Socket.io client — auth, reconnect, helpers.
 */
(function (global) {
  function getToken() {
    return global.ShardaAuth?.getToken?.() || null;
  }

  function connect(options = {}) {
    if (typeof io === "undefined") {
      return Promise.reject(new Error("Socket.io client not loaded"));
    }
    const token = getToken();
    if (!token) return Promise.reject(new Error("Sign in required for realtime"));

    const base = global.SHARDA_BASE || "";
    const socket = io({
      path: "/socket.io",
      auth: { token },
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 8,
      ...options
    });

    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("Socket connection timeout")), 12000);
      socket.on("connect", () => {
        clearTimeout(t);
        resolve(socket);
      });
      socket.on("connect_error", (err) => {
        clearTimeout(t);
        reject(err);
      });
    });
  }

  function joinRoom(socket, roomId) {
    return new Promise((resolve, reject) => {
      socket.emit("room:join", { roomId, status: "online" }, (res) => {
        if (res?.error) reject(new Error(res.error));
        else resolve(res);
      });
    });
  }

  function sendChat(socket, roomId, text, clientMsgId) {
    return new Promise((resolve, reject) => {
      socket.emit(
        "chat:send",
        { roomId, text, clientMsgId: clientMsgId || `c-${Date.now()}` },
        (res) => {
          if (res?.error) reject(new Error(res.error));
          else resolve(res);
        }
      );
    });
  }

  global.ShardaRealtime = {
    connect,
    joinRoom,
    sendChat,
    getToken
  };
})(window);
