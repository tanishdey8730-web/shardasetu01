const liveRooms = require("./live-rooms");
let pwaPush = null;
try {
  pwaPush = require("./pwa-push");
} catch (_) {}

/** roomId -> Map<userId, presence> */
const presenceByRoom = new Map();

/** userId -> Set<socketId> */
const socketsByUser = new Map();

function init(httpServer, auth) {
  const { Server } = require("socket.io");
  const io = new Server(httpServer, {
    cors: { origin: true, credentials: true },
    maxHttpBufferSize: 1e6
  });

  io.use((socket, next) => {
    const token =
      socket.handshake.auth?.token ||
      (socket.handshake.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const user = auth.getSession(token);
    if (!user) return next(new Error("Authentication required"));
    socket.user = user;
    next();
  });

  function userRoom(userId) {
    return `user:${userId}`;
  }

  function trackSocket(userId, socketId, add) {
    if (!socketsByUser.has(userId)) socketsByUser.set(userId, new Set());
    const set = socketsByUser.get(userId);
    if (add) set.add(socketId);
    else {
      set.delete(socketId);
      if (!set.size) socketsByUser.delete(userId);
    }
  }

  function getPresenceList(roomId) {
    const map = presenceByRoom.get(roomId);
    if (!map) return [];
    return [...map.values()];
  }

  function setPresence(roomId, user, status = "online") {
    if (!presenceByRoom.has(roomId)) presenceByRoom.set(roomId, new Map());
    const map = presenceByRoom.get(roomId);
    map.set(user.id, {
      userId: user.id,
      name: user.name,
      role: user.role,
      status,
      lastSeen: new Date().toISOString()
    });
    return getPresenceList(roomId);
  }

  function removePresence(roomId, userId) {
    const map = presenceByRoom.get(roomId);
    if (!map) return [];
    map.delete(userId);
    if (!map.size) presenceByRoom.delete(roomId);
    return getPresenceList(roomId);
  }

  function pushNotification(userId, notification) {
    const payload = {
      id: `ntf-${Date.now()}`,
      ...notification,
      at: new Date().toISOString(),
      read: false
    };
    io.to(userRoom(userId)).emit("notification", payload);
    if (pwaPush?.sendToUser) {
      pwaPush
        .sendToUser(userId, {
          title: notification.title || "Sharda Setu",
          body: notification.body || "",
          url: notification.url ? `./${String(notification.url).replace(/^\//, "")}` : "./live-rooms.html",
          tag: notification.type || "realtime"
        })
        .catch(() => {});
    }
    return payload;
  }

  function broadcastPresence(roomId) {
    io.to(roomId).emit("presence:update", { roomId, users: getPresenceList(roomId) });
  }

  io.on("connection", (socket) => {
    const user = socket.user;
    trackSocket(user.id, socket.id, true);
    socket.join(userRoom(user.id));

    socket.emit("connected", {
      userId: user.id,
      name: user.name,
      role: user.role
    });

    socket.on("room:join", (payload, ack) => {
      const roomId = payload?.roomId;
      if (!roomId) return ack?.({ error: "roomId required" });
      const room = liveRooms.getRoom(roomId);
      if (!room) return ack?.({ error: "Room not found" });

      socket.join(roomId);
      socket.data.activeRoom = roomId;
      const users = setPresence(roomId, user, payload?.status || "online");

      const history = liveRooms.getMessages(roomId, 60);
      const polls = liveRooms.getPolls(roomId).filter((p) => p.status === "open");

      io.to(roomId).emit("presence:update", { roomId, users });
      socket.to(roomId).emit("notification", {
        id: `ntf-${Date.now()}`,
        type: "presence",
        title: `${user.name} joined`,
        body: room.title,
        roomId,
        at: new Date().toISOString(),
        read: false
      });

      ack?.({
        ok: true,
        room,
        messages: history,
        polls,
        presence: users
      });
    });

    socket.on("room:leave", (payload) => {
      const roomId = payload?.roomId || socket.data.activeRoom;
      if (!roomId) return;
      socket.leave(roomId);
      const users = removePresence(roomId, user.id);
      socket.data.activeRoom = null;
      io.to(roomId).emit("presence:update", { roomId, users });
    });

    socket.on("presence:set", (payload) => {
      const roomId = payload?.roomId || socket.data.activeRoom;
      if (!roomId) return;
      const users = setPresence(roomId, user, payload.status || "online");
      io.to(roomId).emit("presence:update", { roomId, users });
    });

    socket.on("class:update", (payload, ack) => {
      const roomId = payload?.roomId || socket.data.activeRoom;
      const room = liveRooms.getRoom(roomId);
      if (!room) return ack?.({ error: "Room not found" });
      if (room.hostId !== user.id && user.role !== "admin" && user.role !== "teacher") {
        return ack?.({ error: "Only host can control class" });
      }
      const update = {
        roomId,
        videoUrl: payload.videoUrl,
        slide: payload.slide,
        status: payload.status,
        by: user.name,
        at: new Date().toISOString()
      };
      io.to(roomId).emit("class:state", update);
      ack?.({ ok: true });
    });

    socket.on("chat:send", (payload, ack) => {
      const roomId = payload?.roomId || socket.data.activeRoom;
      const text = String(payload?.text || "").trim();
      if (!roomId || !text) return ack?.({ error: "Invalid message" });
      if (text.length > 2000) return ack?.({ error: "Message too long" });

      const message = {
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        roomId,
        userId: user.id,
        userName: user.name,
        role: user.role,
        text,
        clientMsgId: payload.clientMsgId || null,
        status: "sent",
        deliveredTo: [],
        readBy: [],
        createdAt: new Date().toISOString()
      };

      liveRooms.addMessage(roomId, message);
      socket.emit("chat:status", {
        messageId: message.id,
        clientMsgId: message.clientMsgId,
        status: "sent"
      });

      socket.to(roomId).emit("chat:message", message);
      ack?.({ ok: true, message });

      const others = getPresenceList(roomId).filter((p) => p.userId !== user.id);
      if (others.length) {
        setTimeout(() => {
          const updated = liveRooms.updateMessageStatus(roomId, message.id, {
            status: "delivered"
          });
          if (updated) {
            socket.emit("chat:status", {
              messageId: message.id,
              clientMsgId: message.clientMsgId,
              status: "delivered"
            });
          }
        }, 300);
      }
    });

    socket.on("chat:received", (payload) => {
      const roomId = payload?.roomId || socket.data.activeRoom;
      const messageId = payload?.messageId;
      if (!roomId || !messageId) return;
      const store = liveRooms;
      const msg = store.updateMessageStatus(roomId, messageId, {});
      if (!msg) return;
      if (!msg.deliveredTo.includes(user.id)) {
        msg.deliveredTo.push(user.id);
        store.updateMessageStatus(roomId, messageId, {
          deliveredTo: msg.deliveredTo,
          status: "delivered"
        });
        io.to(roomId).emit("chat:status", { messageId, status: "delivered" });
      }
    });

    socket.on("chat:read", (payload) => {
      const roomId = payload?.roomId || socket.data.activeRoom;
      const ids = payload?.messageIds || [];
      for (const messageId of ids) {
        const msg = liveRooms.updateMessageStatus(roomId, messageId, {});
        if (!msg || msg.readBy.includes(user.id)) continue;
        msg.readBy.push(user.id);
        liveRooms.updateMessageStatus(roomId, messageId, {
          readBy: msg.readBy,
          status: "read"
        });
        io.to(roomId).emit("chat:status", { messageId, status: "read", userId: user.id });
      }
    });

    socket.on("poll:create", (payload, ack) => {
      const roomId = payload?.roomId || socket.data.activeRoom;
      if (!roomId) return ack?.({ error: "roomId required" });
      if (user.role !== "teacher" && user.role !== "admin") {
        return ack?.({ error: "Teachers only" });
      }
      const result = liveRooms.createPoll(roomId, user, payload);
      if (result.error) return ack?.(result);
      io.to(roomId).emit("poll:update", { poll: result, action: "created" });
      getPresenceList(roomId).forEach((p) => {
        if (p.userId !== user.id) {
          pushNotification(p.userId, {
            type: "poll",
            title: "New live poll",
            body: result.question,
            roomId
          });
        }
      });
      ack?.({ ok: true, poll: result });
    });

    socket.on("poll:vote", (payload, ack) => {
      const roomId = payload?.roomId || socket.data.activeRoom;
      const result = liveRooms.votePoll(roomId, payload.pollId, user.id, payload.optionId);
      if (result.error) return ack?.(result);
      io.to(roomId).emit("poll:update", { poll: result, action: "voted" });
      ack?.({ ok: true, poll: result });
    });

    socket.on("poll:close", (payload, ack) => {
      const roomId = payload?.roomId || socket.data.activeRoom;
      const result = liveRooms.closePoll(roomId, payload.pollId, user.id, user.role);
      if (result.error) return ack?.(result);
      io.to(roomId).emit("poll:update", { poll: result, action: "closed" });
      ack?.({ ok: true, poll: result });
    });

    socket.on("notification:read", (payload) => {
      socket.emit("notification:read_ack", { id: payload?.id });
    });

    socket.on("disconnecting", () => {
      for (const roomId of socket.rooms) {
        if (roomId.startsWith("user:") || roomId === socket.id) continue;
        removePresence(roomId, user.id);
        io.to(roomId).emit("presence:update", { roomId, users: getPresenceList(roomId) });
      }
    });

    socket.on("disconnect", () => {
      trackSocket(user.id, socket.id, false);
    });
  });

  return { io, pushNotification };
}

module.exports = { init };
