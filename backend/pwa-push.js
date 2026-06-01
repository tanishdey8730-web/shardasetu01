const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const STORE_FILE = path.join(__dirname, "data", "push-subscriptions.json");

function loadStore() {
  if (!fs.existsSync(STORE_FILE)) {
    fs.writeFileSync(STORE_FILE, JSON.stringify({ subscriptions: [] }, null, 2));
  }
  return JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
}

function saveStore(store) {
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), "utf8");
}

function getVapidKeys() {
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (pub && priv) return { publicKey: pub, privateKey: priv };
  return null;
}

function getWebPush() {
  try {
    return require("web-push");
  } catch {
    return null;
  }
}

function ensureVapid() {
  const wp = getWebPush();
  const keys = getVapidKeys();
  if (!wp || !keys) return null;
  wp.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:info@shardasetu.edu",
    keys.publicKey,
    keys.privateKey
  );
  return wp;
}

function getPublicKey() {
  const keys = getVapidKeys();
  return keys?.publicKey || null;
}

function subscribe(userId, subscription) {
  if (!subscription?.endpoint) {
    return { error: "Invalid subscription", status: 400 };
  }
  const store = loadStore();
  store.subscriptions = store.subscriptions.filter(
    (s) => !(s.userId === userId && s.endpoint === subscription.endpoint)
  );
  store.subscriptions.push({
    id: crypto.randomUUID(),
    userId,
    subscription,
    createdAt: new Date().toISOString()
  });
  if (store.subscriptions.length > 5000) {
    store.subscriptions = store.subscriptions.slice(-5000);
  }
  saveStore(store);
  return { ok: true };
}

function unsubscribe(userId, endpoint) {
  const store = loadStore();
  store.subscriptions = store.subscriptions.filter(
    (s) => !(s.userId === userId && s.endpoint === endpoint)
  );
  saveStore(store);
  return { ok: true };
}

async function sendToUser(userId, payload) {
  const wp = ensureVapid();
  if (!wp) return { error: "Push not configured", status: 503 };

  const store = loadStore();
  const subs = store.subscriptions.filter((s) => s.userId === userId);
  const body = JSON.stringify(payload);
  let sent = 0;
  const stale = [];

  for (const row of subs) {
    try {
      await wp.sendNotification(row.subscription, body);
      sent += 1;
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) stale.push(row.endpoint);
    }
  }

  if (stale.length) {
    store.subscriptions = store.subscriptions.filter((s) => !stale.includes(s.endpoint));
    saveStore(store);
  }

  return { sent, total: subs.length };
}

async function sendToAll(payload, roleFilter) {
  const wp = ensureVapid();
  if (!wp) return { error: "Push not configured", status: 503 };

  const store = loadStore();
  const body = JSON.stringify(payload);
  let sent = 0;

  for (const row of store.subscriptions) {
    try {
      await wp.sendNotification(row.subscription, body);
      sent += 1;
    } catch (_) {}
  }

  return { sent, total: store.subscriptions.length };
}

function getStatus() {
  const store = loadStore();
  return {
    configured: Boolean(getVapidKeys() && getWebPush()),
    subscriptions: store.subscriptions.length,
    publicKey: getPublicKey()
  };
}

module.exports = {
  getPublicKey,
  getStatus,
  subscribe,
  unsubscribe,
  sendToUser,
  sendToAll
};
