const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const STORE_FILE = path.join(__dirname, "data", "live-rooms.json");
const MAX_MESSAGES_PER_ROOM = 500;

function loadStore() {
  if (!fs.existsSync(STORE_FILE)) {
    const initial = { rooms: [], messages: {}, polls: {} };
    fs.writeFileSync(STORE_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  const store = JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
  if (!store.messages) store.messages = {};
  if (!store.polls) store.polls = {};
  return store;
}

function saveStore(store) {
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), "utf8");
}

function listRooms() {
  const store = loadStore();
  return store.rooms
    .map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      hostId: r.hostId,
      hostName: r.hostName,
      examId: r.examId,
      videoUrl: r.videoUrl,
      status: r.status,
      scheduledAt: r.scheduledAt,
      createdAt: r.createdAt
    }))
    .sort((a, b) => {
      const order = { live: 0, scheduled: 1, ended: 2 };
      return (order[a.status] ?? 3) - (order[b.status] ?? 3);
    });
}

function getRoom(roomId) {
  const store = loadStore();
  const room = store.rooms.find((r) => r.id === roomId);
  if (!room) return null;
  return { ...room };
}

function createRoom(host, body) {
  const store = loadStore();
  const room = {
    id: `room-${crypto.randomBytes(6).toString("hex")}`,
    title: String(body.title || "Live class").slice(0, 120),
    description: String(body.description || "").slice(0, 500),
    hostId: host.id,
    hostName: host.name,
    examId: body.examId || null,
    videoUrl: body.videoUrl || "",
    status: body.status === "scheduled" ? "scheduled" : "live",
    scheduledAt: body.scheduledAt || null,
    createdAt: new Date().toISOString()
  };
  store.rooms.unshift(room);
  store.messages[room.id] = [];
  store.polls[room.id] = [];
  saveStore(store);
  return room;
}

function updateRoomStatus(roomId, status, userId, role) {
  const store = loadStore();
  const room = store.rooms.find((r) => r.id === roomId);
  if (!room) return { error: "Room not found", status: 404 };
  if (room.hostId !== userId && role !== "admin") {
    return { error: "Only host or admin can update room", status: 403 };
  }
  room.status = status;
  saveStore(store);
  return { room };
}

function getMessages(roomId, limit = 80) {
  const store = loadStore();
  if (!store.rooms.find((r) => r.id === roomId)) return [];
  const list = store.messages[roomId] || [];
  return list.slice(-limit);
}

function addMessage(roomId, msg) {
  const store = loadStore();
  if (!store.messages[roomId]) store.messages[roomId] = [];
  store.messages[roomId].push(msg);
  if (store.messages[roomId].length > MAX_MESSAGES_PER_ROOM) {
    store.messages[roomId] = store.messages[roomId].slice(-MAX_MESSAGES_PER_ROOM);
  }
  saveStore(store);
  return msg;
}

function updateMessageStatus(roomId, messageId, patch) {
  const store = loadStore();
  const list = store.messages[roomId];
  if (!list) return null;
  const msg = list.find((m) => m.id === messageId);
  if (!msg) return null;
  Object.assign(msg, patch);
  saveStore(store);
  return msg;
}

function getPolls(roomId) {
  const store = loadStore();
  return store.polls[roomId] || [];
}

function createPoll(roomId, host, data) {
  const store = loadStore();
  if (!store.polls[roomId]) store.polls[roomId] = [];
  const poll = {
    id: `poll-${crypto.randomBytes(5).toString("hex")}`,
    roomId,
    question: String(data.question || "").slice(0, 300),
    options: (data.options || []).slice(0, 6).map((o, i) => ({
      id: `opt-${i}`,
      text: String(o.text || o).slice(0, 120),
      votes: 0
    })),
    createdBy: host.id,
    createdByName: host.name,
    status: "open",
    voters: {},
    createdAt: new Date().toISOString()
  };
  if (poll.options.length < 2) return { error: "At least 2 options required", status: 400 };
  store.polls[roomId].unshift(poll);
  saveStore(store);
  return poll;
}

function votePoll(roomId, pollId, userId, optionId) {
  const store = loadStore();
  const polls = store.polls[roomId] || [];
  const poll = polls.find((p) => p.id === pollId);
  if (!poll || poll.status !== "open") return { error: "Poll not available", status: 400 };
  if (poll.voters[userId]) return { error: "Already voted", status: 400 };
  const opt = poll.options.find((o) => o.id === optionId);
  if (!opt) return { error: "Invalid option", status: 400 };
  opt.votes += 1;
  poll.voters[userId] = optionId;
  saveStore(store);
  return poll;
}

function closePoll(roomId, pollId, userId, role) {
  const store = loadStore();
  const polls = store.polls[roomId] || [];
  const poll = polls.find((p) => p.id === pollId);
  if (!poll) return { error: "Poll not found", status: 404 };
  const room = store.rooms.find((r) => r.id === roomId);
  if (poll.createdBy !== userId && room?.hostId !== userId && role !== "admin") {
    return { error: "Forbidden", status: 403 };
  }
  poll.status = "closed";
  saveStore(store);
  return poll;
}

module.exports = {
  listRooms,
  getRoom,
  createRoom,
  updateRoomStatus,
  getMessages,
  addMessage,
  updateMessageStatus,
  getPolls,
  createPoll,
  votePoll,
  closePoll
};
