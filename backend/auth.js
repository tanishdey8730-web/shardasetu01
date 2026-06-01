const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");
const emailService = require("./email-service");

const USERS_FILE = path.join(__dirname, "data", "users.json");
const BCRYPT_ROUNDS = 12;
const ACCESS_TTL = process.env.JWT_ACCESS_TTL || "15m";
const REFRESH_TTL = process.env.JWT_REFRESH_TTL || "7d";
const ROLES = ["student", "teacher", "admin"];

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;

if (!ACCESS_SECRET || !REFRESH_SECRET) {
  console.warn(
    "[auth] JWT_ACCESS_SECRET and JWT_REFRESH_SECRET not set — using insecure dev defaults. Set both in production."
  );
}

const accessSecret = ACCESS_SECRET || "sharda-dev-access-secret-change-me";
const refreshSecret = REFRESH_SECRET || "sharda-dev-refresh-secret-change-me";

function loadStore() {
  if (!fs.existsSync(USERS_FILE)) {
    const initial = { users: [], refreshTokens: [], sessions: [] };
    fs.writeFileSync(USERS_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  const store = JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
  if (!store.refreshTokens) store.refreshTokens = [];
  if (!store.sessions) store.sessions = [];
  let migrated = false;
  for (const u of store.users) {
    if (u.emailVerified === undefined && !u.emailVerificationToken) {
      u.emailVerified = true;
      migrated = true;
    }
    if (!u.authProvider) {
      u.authProvider = u.googleId ? "google" : "local";
      migrated = true;
    }
  }
  if (migrated) saveStore(store);
  return store;
}

function saveStore(store) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(store, null, 2));
}

function newId() {
  return crypto.randomBytes(12).toString("hex");
}

function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

function validatePassword(password) {
  if (!password || password.length < 8) {
    return "Password must be at least 8 characters";
  }
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return "Password must include at least one letter and one number";
  }
  return null;
}

function normalizeRole(role) {
  const r = String(role || "student").toLowerCase();
  if (r === "admin" && process.env.ADMIN_REGISTRATION_SECRET) {
    return "admin";
  }
  if (r === "teacher") return "teacher";
  return "student";
}

async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

function isBcryptHash(stored) {
  return typeof stored === "string" && stored.startsWith("$2");
}

function verifyLegacyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const attempt = crypto.pbkdf2Sync(password, salt, 1000, 64, "sha512").toString("hex");
  return attempt === hash;
}

async function verifyPassword(password, user) {
  const stored = user.passwordHash;
  if (!stored) return false;
  if (isBcryptHash(stored)) {
    return bcrypt.compare(password, stored);
  }
  return verifyLegacyPassword(password, stored);
}

async function upgradePasswordHash(store, user, password) {
  user.passwordHash = await hashPassword(password);
  user.updatedAt = new Date().toISOString();
  saveStore(store);
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    avatar: user.avatar,
    examGoal: user.examGoal || "",
    bio: user.bio || "",
    phone: user.phone || "",
    city: user.city || "",
    emailVerified: Boolean(user.emailVerified),
    authProvider: user.authProvider || "local",
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

function findUserByEmail(store, email) {
  return store.users.find((u) => u.email === normalizeEmail(email));
}

function findUserById(store, id) {
  return store.users.find((u) => u.id === id);
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function signAccessToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      role: user.role,
      emailVerified: Boolean(user.emailVerified)
    },
    accessSecret,
    { expiresIn: ACCESS_TTL }
  );
}

function signRefreshToken(user) {
  return jwt.sign({ sub: user.id, type: "refresh" }, refreshSecret, { expiresIn: REFRESH_TTL });
}

function storeRefreshToken(store, userId, refreshToken) {
  const decoded = jwt.decode(refreshToken);
  const expiresAt = decoded?.exp
    ? new Date(decoded.exp * 1000).toISOString()
    : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  store.refreshTokens = store.refreshTokens.filter((t) => t.userId !== userId);
  store.refreshTokens.push({
    tokenHash: hashToken(refreshToken),
    userId,
    expiresAt
  });
}

function revokeRefreshToken(store, refreshToken) {
  if (!refreshToken) return;
  const hash = hashToken(refreshToken);
  store.refreshTokens = store.refreshTokens.filter((t) => t.tokenHash !== hash);
}

function revokeAllRefreshTokens(store, userId) {
  store.refreshTokens = store.refreshTokens.filter((t) => t.userId !== userId);
}

function issueTokenPair(store, user) {
  const token = signAccessToken(user);
  const refreshToken = signRefreshToken(user);
  storeRefreshToken(store, user.id, refreshToken);
  return { token, refreshToken };
}

function verifyAccessToken(token) {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, accessSecret);
    return payload;
  } catch {
    return null;
  }
}

function verifyRefreshTokenStored(store, refreshToken) {
  if (!refreshToken) return null;
  let payload;
  try {
    payload = jwt.verify(refreshToken, refreshSecret);
  } catch {
    return null;
  }
  if (payload.type !== "refresh") return null;
  const hash = hashToken(refreshToken);
  const row = store.refreshTokens.find((t) => t.tokenHash === hash && t.userId === payload.sub);
  if (!row) return null;
  if (new Date(row.expiresAt) < new Date()) {
    store.refreshTokens = store.refreshTokens.filter((t) => t.tokenHash !== hash);
    return null;
  }
  return payload;
}

function getSession(token) {
  if (!token) return null;
  const store = loadStore();

  const payload = verifyAccessToken(token);
  if (payload?.sub) {
    const user = findUserById(store, payload.sub);
    if (user?.disabled) return null;
    return user ? publicUser(user) : null;
  }

  const session = store.sessions.find((s) => s.token === token);
  if (!session) return null;
  if (new Date(session.expiresAt) < new Date()) {
    store.sessions = store.sessions.filter((s) => s.token !== token);
    saveStore(store);
    return null;
  }
  const user = findUserById(store, session.userId);
  if (user?.disabled) return null;
  return user ? publicUser(user) : null;
}

function extractToken(req) {
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) return header.slice(7);
  return req.headers["x-auth-token"] || null;
}

function hasRole(user, ...roles) {
  return user && roles.includes(user.role);
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });
    if (!hasRole(req.user, ...roles)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    next();
  };
}

function requireEmailVerified(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });
  if (!req.user.emailVerified) {
    return res.status(403).json({
      error: "Email verification required",
      code: "EMAIL_NOT_VERIFIED"
    });
  }
  next();
}

function requireProfileUser(req) {
  const token = extractToken(req);
  const user = getSession(token);
  if (!user) return { error: "Please sign in to use offline access.", status: 401 };
  if (!user.name || !user.email) {
    return { error: "Complete your Sharda Setu profile first.", status: 403 };
  }
  return { user, token };
}

function createVerificationToken() {
  return crypto.randomBytes(32).toString("hex");
}

async function register({ name, email, password, role, adminSecret }) {
  const store = loadStore();
  const normalized = normalizeEmail(email);
  if (!name?.trim()) return { error: "Name is required", status: 400 };
  if (!normalized) return { error: "Valid email is required", status: 400 };

  const pwErr = validatePassword(password);
  if (pwErr) return { error: pwErr, status: 400 };

  if (findUserByEmail(store, normalized)) {
    return { error: "Email already registered", status: 409 };
  }

  let assignedRole = normalizeRole(role);
  if (assignedRole === "admin") {
    if (!process.env.ADMIN_REGISTRATION_SECRET || adminSecret !== process.env.ADMIN_REGISTRATION_SECRET) {
      assignedRole = "student";
    }
  }

  const verifyToken = createVerificationToken();
  const user = {
    id: newId(),
    name: name.trim(),
    email: normalized,
    passwordHash: await hashPassword(password),
    role: assignedRole,
    avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(name.trim())}&background=2b6ef4&color=fff&size=128`,
    examGoal: "",
    bio: "",
    phone: "",
    city: "",
    emailVerified: false,
    emailVerificationToken: verifyToken,
    emailVerificationExpires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    passwordResetToken: null,
    passwordResetExpires: null,
    googleId: null,
    authProvider: "local",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  store.users.push(user);
  const tokens = issueTokenPair(store, user);
  saveStore(store);

  try {
    await emailService.sendVerificationEmail(user, verifyToken);
  } catch (err) {
    console.error("[auth] verification email failed:", err.message);
  }

  return {
    user: publicUser(user),
    token: tokens.token,
    refreshToken: tokens.refreshToken,
    message: "Account created. Please verify your email."
  };
}

async function login({ email, password }) {
  const store = loadStore();
  const normalized = normalizeEmail(email);
  const user = findUserByEmail(store, normalized);

  if (!user || !user.passwordHash) {
    return { error: "Invalid email or password", status: 401 };
  }

  if (user.disabled) return { error: "Account is disabled. Contact support.", status: 403 };

  const valid = await verifyPassword(password, user);
  if (!valid) return { error: "Invalid email or password", status: 401 };

  if (!isBcryptHash(user.passwordHash)) {
    await upgradePasswordHash(store, user, password);
  }

  const tokens = issueTokenPair(store, user);
  saveStore(store);

  return {
    user: publicUser(user),
    token: tokens.token,
    refreshToken: tokens.refreshToken
  };
}

function logout({ accessToken, refreshToken }) {
  const store = loadStore();
  if (refreshToken) revokeRefreshToken(store, refreshToken);
  if (accessToken) {
    const payload = verifyAccessToken(accessToken);
    if (payload?.sub) revokeAllRefreshTokens(store, payload.sub);
  }
  const legacy = store.sessions.find((s) => s.token === accessToken);
  if (legacy) {
    store.sessions = store.sessions.filter((s) => s.token !== accessToken);
  }
  saveStore(store);
  return { ok: true };
}

function refresh({ refreshToken }) {
  const store = loadStore();
  const payload = verifyRefreshTokenStored(store, refreshToken);
  if (!payload) return { error: "Invalid or expired refresh token", status: 401 };

  const user = findUserById(store, payload.sub);
  if (!user) return { error: "User not found", status: 404 };

  revokeRefreshToken(store, refreshToken);
  const tokens = issueTokenPair(store, user);
  saveStore(store);

  return {
    user: publicUser(user),
    token: tokens.token,
    refreshToken: tokens.refreshToken
  };
}

async function forgotPassword({ email }) {
  const store = loadStore();
  const user = findUserByEmail(store, email);
  if (!user || user.authProvider === "google") {
    return {
      ok: true,
      message: "If that email is registered, you will receive a reset link shortly."
    };
  }

  const resetToken = createVerificationToken();
  user.passwordResetToken = resetToken;
  user.passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  user.updatedAt = new Date().toISOString();
  saveStore(store);

  try {
    await emailService.sendPasswordResetEmail(user, resetToken);
  } catch (err) {
    console.error("[auth] reset email failed:", err.message);
  }

  return {
    ok: true,
    message: "If that email is registered, you will receive a reset link shortly."
  };
}

async function resetPassword({ token, password }) {
  const store = loadStore();
  const pwErr = validatePassword(password);
  if (pwErr) return { error: pwErr, status: 400 };
  if (!token) return { error: "Reset token is required", status: 400 };

  const user = store.users.find(
    (u) =>
      u.passwordResetToken === token &&
      u.passwordResetExpires &&
      new Date(u.passwordResetExpires) > new Date()
  );

  if (!user) return { error: "Invalid or expired reset link", status: 400 };

  user.passwordHash = await hashPassword(password);
  user.passwordResetToken = null;
  user.passwordResetExpires = null;
  user.updatedAt = new Date().toISOString();
  revokeAllRefreshTokens(store, user.id);
  saveStore(store);

  return { ok: true, message: "Password updated. You can sign in now." };
}

function verifyEmail({ token }) {
  const store = loadStore();
  if (!token) return { error: "Verification token is required", status: 400 };

  const user = store.users.find(
    (u) =>
      u.emailVerificationToken === token &&
      u.emailVerificationExpires &&
      new Date(u.emailVerificationExpires) > new Date()
  );

  if (!user) return { error: "Invalid or expired verification link", status: 400 };

  user.emailVerified = true;
  user.emailVerificationToken = null;
  user.emailVerificationExpires = null;
  user.updatedAt = new Date().toISOString();
  saveStore(store);

  return { ok: true, message: "Email verified successfully.", user: publicUser(user) };
}

async function resendVerification({ email }) {
  const store = loadStore();
  const user = findUserByEmail(store, email);
  if (!user) {
    return { ok: true, message: "If that email is registered, a verification link was sent." };
  }
  if (user.emailVerified) {
    return { error: "Email is already verified", status: 400 };
  }

  const verifyToken = createVerificationToken();
  user.emailVerificationToken = verifyToken;
  user.emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  saveStore(store);

  try {
    await emailService.sendVerificationEmail(user, verifyToken);
  } catch (err) {
    console.error("[auth] resend verification failed:", err.message);
  }

  return { ok: true, message: "If that email is registered, a verification link was sent." };
}

function getGoogleClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI || `${emailService.getAppUrl()}/api/auth/google/callback`;
  if (!clientId || !clientSecret) return null;
  return new OAuth2Client(clientId, clientSecret, redirectUri);
}

function getGoogleAuthUrl() {
  const client = getGoogleClient();
  if (!client) return { error: "Google OAuth is not configured", status: 503 };

  const url = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["openid", "email", "profile"]
  });
  return { url };
}

async function handleGoogleCallback(code) {
  const client = getGoogleClient();
  if (!client) return { error: "Google OAuth is not configured", status: 503 };
  if (!code) return { error: "Authorization code missing", status: 400 };

  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token,
    audience: process.env.GOOGLE_CLIENT_ID
  });
  const payload = ticket.getPayload();
  if (!payload?.email) return { error: "Google account has no email", status: 400 };

  const store = loadStore();
  const normalized = normalizeEmail(payload.email);
  let user = store.users.find((u) => u.googleId === payload.sub || u.email === normalized);

  if (!user) {
    user = {
      id: newId(),
      name: payload.name || payload.email.split("@")[0],
      email: normalized,
      passwordHash: null,
      role: "student",
      avatar: payload.picture || `https://ui-avatars.com/api/?name=${encodeURIComponent(payload.name || "User")}`,
      examGoal: "",
      bio: "",
      phone: "",
      city: "",
      emailVerified: payload.email_verified === true,
      emailVerificationToken: null,
      emailVerificationExpires: null,
      passwordResetToken: null,
      passwordResetExpires: null,
      googleId: payload.sub,
      authProvider: "google",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    store.users.push(user);
  } else {
    user.googleId = payload.sub;
    user.authProvider = "google";
    if (payload.picture) user.avatar = payload.picture;
    if (payload.email_verified) user.emailVerified = true;
    user.updatedAt = new Date().toISOString();
  }

  const tokenPair = issueTokenPair(store, user);
  saveStore(store);

  return {
    user: publicUser(user),
    token: tokenPair.token,
    refreshToken: tokenPair.refreshToken
  };
}

function updateProfile(userId, updates, actor) {
  const store = loadStore();
  const user = findUserById(store, userId);
  if (!user) return { error: "User not found", status: 404 };

  const isSelf = actor?.id === userId;
  const isAdmin = actor?.role === "admin";

  const allowed = ["name", "examGoal", "bio", "phone", "city", "avatar"];
  for (const key of allowed) {
    if (updates[key] !== undefined) user[key] = String(updates[key]).trim();
  }

  if (updates.role !== undefined && (isAdmin || (isSelf && updates.role !== "admin"))) {
    const next = normalizeRole(updates.role);
    if (next !== "admin" || isAdmin) user.role = next;
  }

  user.updatedAt = new Date().toISOString();
  saveStore(store);
  return { user: publicUser(user) };
}

function getStatus() {
  return {
    jwt: Boolean(ACCESS_SECRET && REFRESH_SECRET),
    googleOAuth: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    smtp: emailService.isSmtpConfigured(),
    roles: ROLES
  };
}

module.exports = {
  ROLES,
  register,
  login,
  logout,
  refresh,
  forgotPassword,
  resetPassword,
  verifyEmail,
  resendVerification,
  getGoogleAuthUrl,
  handleGoogleCallback,
  getSession,
  extractToken,
  requireProfileUser,
  requireRole,
  requireEmailVerified,
  hasRole,
  publicUser,
  updateProfile,
  getStatus,
  validatePassword
};
