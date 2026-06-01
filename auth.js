const AUTH_KEY = "sharda_setu_auth";

function getAuth() {
  try {
    return JSON.parse(localStorage.getItem(AUTH_KEY) || "null");
  } catch {
    return null;
  }
}

function setAuth(data) {
  if (data) localStorage.setItem(AUTH_KEY, JSON.stringify(data));
  else localStorage.removeItem(AUTH_KEY);
}

function getToken() {
  return getAuth()?.token || null;
}

function getRefreshToken() {
  return getAuth()?.refreshToken || null;
}

function getUser() {
  return getAuth()?.user || null;
}

function isLoggedIn() {
  return Boolean(getToken());
}

let refreshPromise = null;

async function refreshSession() {
  const refreshToken = getRefreshToken();
  if (!refreshToken) throw new Error("Session expired");

  if (!refreshPromise) {
    refreshPromise = fetch("/api/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken })
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Session expired");
        const prev = getAuth() || {};
        setAuth({
          user: data.user,
          token: data.token,
          refreshToken: data.refreshToken
        });
        return data;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

async function apiFetch(url, options = {}, retry = true) {
  const token = getToken();
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res = await fetch(url, { ...options, headers });
  let data = await res.json().catch(() => ({}));

  if (res.status === 401 && retry && getRefreshToken()) {
    try {
      await refreshSession();
      return apiFetch(url, options, false);
    } catch (_) {
      setAuth(null);
      throw new Error(data.error || "Session expired. Please sign in again.");
    }
  }

  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function saveAuthResponse(data) {
  setAuth({
    user: data.user,
    token: data.token,
    refreshToken: data.refreshToken || getRefreshToken()
  });
  return data;
}

async function register(payload) {
  const data = await apiFetch("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  return saveAuthResponse(data);
}

async function login(payload) {
  const data = await apiFetch("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  return saveAuthResponse(data);
}

async function logout() {
  const token = getToken();
  const refreshToken = getRefreshToken();
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({ refreshToken })
    });
  } catch (_) {}
  setAuth(null);
  window.location.href = "index.html";
}

async function forgotPassword(email) {
  const res = await fetch("/api/auth/forgot-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

async function resetPassword(token, password) {
  const res = await fetch("/api/auth/reset-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, password })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Reset failed");
  return data;
}

async function verifyEmail(token) {
  const res = await fetch(`/api/auth/verify-email?token=${encodeURIComponent(token)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Verification failed");
  const auth = getAuth();
  if (auth && data.user) {
    auth.user = data.user;
    setAuth(auth);
  }
  return data;
}

async function resendVerification(email) {
  const res = await fetch("/api/auth/resend-verification", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function loginWithGoogle() {
  window.location.href = "/api/auth/google";
}

function handleOAuthCallback() {
  const hash = window.location.hash.replace(/^#/, "");
  const params = new URLSearchParams(hash);
  const token = params.get("token");
  const refreshToken = params.get("refreshToken");
  const err = new URLSearchParams(window.location.search).get("error");

  if (err) throw new Error(err);
  if (!token) throw new Error("Missing authentication token");

  setAuth({
    user: null,
    token,
    refreshToken
  });
  return fetchProfile();
}

async function fetchProfile() {
  const data = await apiFetch("/api/profile/me");
  const auth = getAuth();
  if (auth) {
    auth.user = data.user;
    setAuth(auth);
  }
  return data.user;
}

async function updateProfile(updates) {
  const data = await apiFetch("/api/profile/me", {
    method: "PUT",
    body: JSON.stringify(updates)
  });
  const auth = getAuth();
  if (auth) {
    auth.user = data.user;
    setAuth(auth);
  }
  return data.user;
}

function renderHeaderAuth(container) {
  if (!container) return;
  const user = getUser();

  if (user) {
    const unverified = user.emailVerified === false;
    container.innerHTML = `
      <div class="profile-menu">
        <button type="button" class="profile-trigger" id="profile-trigger" aria-expanded="false">
          <img class="profile-avatar" src="${escapeAttr(user.avatar)}" alt="${escapeAttr(user.name)}" width="36" height="36"/>
          <span class="profile-name">${escapeHtml(user.name.split(" ")[0])}</span>
          ${unverified ? '<span class="auth-dot-unverified" title="Email not verified"></span>' : ""}
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path fill="currentColor" d="M2 4l4 4 4-4"/></svg>
        </button>
        <div class="profile-dropdown" id="profile-dropdown" hidden>
          <div class="profile-dropdown-head">
            <img src="${escapeAttr(user.avatar)}" alt="" width="48" height="48"/>
            <div>
              <strong>${escapeHtml(user.name)}</strong>
              <span>${escapeHtml(user.email)}</span>
              <span class="role-badge">${roleLabel(user.role)}</span>
          ${user.role === "teacher" || user.role === "admin" ? '<a href="teacher-dashboard.html">Teacher Dashboard</a>' : ""}
            </div>
          </div>
          ${unverified ? '<a href="verify-email.html" class="verify-banner-link">⚠ Verify your email</a>' : ""}
          <a href="profile.html">My Profile</a>
          <a href="online-education.html">My Courses</a>
          <a href="offline.html">Offline Library</a>
          <a href="study-assistant.html">Study Assistant</a>
          <a href="learning-roadmap.html">My Roadmap</a>
          <a href="mock-tests.html">Mock Tests</a>
          <a href="performance-analytics.html">Analytics</a>
          <a href="notes-generator.html">Notes</a>
          <a href="student-dashboard.html">Dashboard</a>
          ${user.role === "admin" ? '<a href="admin-dashboard.html">Admin</a>' : ""}
          <button type="button" id="logout-btn">Sign Out</button>
        </div>
      </div>`;

    const trigger = document.getElementById("profile-trigger");
    const dropdown = document.getElementById("profile-dropdown");
    trigger?.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = dropdown.hidden;
      dropdown.hidden = !open;
      trigger.setAttribute("aria-expanded", String(open));
    });
    document.addEventListener("click", () => {
      dropdown.hidden = true;
      trigger?.setAttribute("aria-expanded", "false");
    });
    document.getElementById("logout-btn")?.addEventListener("click", logout);
  } else {
    container.innerHTML = `
      <a href="login.html"><button class="btn btn-ghost" type="button">Login</button></a>
      <a href="signup.html"><button class="btn btn-primary" type="button">Sign Up</button></a>`;
  }
}

function roleLabel(role) {
  if (role === "admin") return "Admin";
  if (role === "teacher") return "Teacher";
  return "Student";
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

function initHeader() {
  renderHeaderAuth(document.getElementById("auth-slot"));
}

window.ShardaAuth = {
  getAuth,
  getToken,
  getRefreshToken,
  getUser,
  isLoggedIn,
  apiFetch,
  refreshSession,
  register,
  login,
  logout,
  forgotPassword,
  resetPassword,
  verifyEmail,
  resendVerification,
  loginWithGoogle,
  handleOAuthCallback,
  fetchProfile,
  updateProfile,
  renderHeaderAuth,
  initHeader
};

document.addEventListener("DOMContentLoaded", initHeader);
