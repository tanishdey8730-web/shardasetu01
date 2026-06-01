/**
 * Sharda Setu PWA — service worker, install, push, background sync
 */
(function (global) {
  const SYNC_TAG = "sharda-background-sync";
  const QUEUE_KEY = "sharda_pwa_sync_queue";
  const PUSH_ASKED_KEY = "sharda_pwa_push_asked";

  function base() {
    return global.SHARDA_BASE || "/";
  }

  function scopeUrl() {
    const b = base();
    return b.endsWith("/") ? b : b + "/";
  }

  /* —— Sync queue —— */
  function loadQueue() {
    try {
      return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
    } catch {
      return [];
    }
  }

  function saveQueue(q) {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-50)));
  }

  function queueRequest(entry) {
    const q = loadQueue();
    q.push({
      id: `q-${Date.now()}`,
      url: entry.url,
      method: entry.method || "POST",
      headers: entry.headers || {},
      body: entry.body,
      at: new Date().toISOString()
    });
    saveQueue(q);
    registerBackgroundSync();
    updateQueueHint();
  }

  async function flushQueue() {
    const q = loadQueue();
    if (!q.length || !navigator.onLine) return { flushed: 0, remaining: q.length };

    const token = global.ShardaAuth?.getToken?.();
    const remaining = [];
    let flushed = 0;

    for (const item of q) {
      try {
        const res = await fetch(item.url, {
          method: item.method,
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...item.headers
          },
          body: item.body
        });
        if (res.ok) flushed += 1;
        else remaining.push(item);
      } catch {
        remaining.push(item);
      }
    }

    saveQueue(remaining);
    updateQueueHint();
    return { flushed, remaining: remaining.length };
  }

  function registerBackgroundSync() {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.ready
      .then((reg) => {
        if (reg.sync && typeof reg.sync.register === "function") {
          return reg.sync.register(SYNC_TAG);
        }
      })
      .catch(() => {});
  }

  function updateQueueHint() {
    const el = document.getElementById("pwa-queue-hint");
    if (!el) return;
    const n = loadQueue().length;
    if (n) {
      el.hidden = false;
      el.textContent = `${n} action(s) waiting to sync when online.`;
    } else {
      el.hidden = true;
    }
  }

  /* —— Service worker —— */
  async function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return null;

    const reg = await navigator.serviceWorker.register(scopeUrl() + "service-worker.js", {
      scope: scopeUrl()
    });

    reg.addEventListener("updatefound", () => {
      const sw = reg.installing;
      if (!sw) return;
      sw.addEventListener("statechange", () => {
        if (sw.state === "installed" && navigator.serviceWorker.controller) {
          showUpdateToast();
        }
      });
    });

    navigator.serviceWorker.addEventListener("message", (e) => {
      if (e.data?.type === "FLUSH_SYNC_QUEUE") flushQueue();
    });

    return reg;
  }

  function showUpdateToast() {
    const el = document.createElement("div");
    el.className = "pwa-install-banner";
    el.innerHTML = `
      <p>A new version is ready.</p>
      <div class="pwa-install-actions">
        <button type="button" class="pwa-install-yes">Update</button>
        <button type="button" class="pwa-install-no">Later</button>
      </div>`;
    el.querySelector(".pwa-install-yes").onclick = () => {
      navigator.serviceWorker.controller?.postMessage({ type: "SKIP_WAITING" });
      location.reload();
    };
    el.querySelector(".pwa-install-no").onclick = () => el.remove();
    document.body.appendChild(el);
  }

  /* —— Install prompt —— */
  let deferredInstall = null;

  function setupInstallPrompt() {
    global.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      deferredInstall = e;
      showInstallBanner();
    });

    global.addEventListener("appinstalled", () => {
      deferredInstall = null;
      hideInstallBanner();
    });
  }

  function showInstallBanner() {
    if (localStorage.getItem("sharda_pwa_install_dismissed") === "1") return;
    if (global.matchMedia("(display-mode: standalone)").matches) return;

    let el = document.getElementById("pwa-install-banner");
    if (!el) {
      el = document.createElement("div");
      el.id = "pwa-install-banner";
      el.className = "pwa-install-banner";
      el.innerHTML = `
        <p><strong>Install Sharda Setu</strong> — quick access, offline study &amp; notifications.</p>
        <div class="pwa-install-actions">
          <button type="button" class="pwa-install-yes">Install</button>
          <button type="button" class="pwa-install-no">Not now</button>
        </div>`;
      document.body.appendChild(el);
      el.querySelector(".pwa-install-yes").addEventListener("click", async () => {
        if (!deferredInstall) return;
        deferredInstall.prompt();
        await deferredInstall.userChoice;
        deferredInstall = null;
        hideInstallBanner();
      });
      el.querySelector(".pwa-install-no").addEventListener("click", () => {
        localStorage.setItem("sharda_pwa_install_dismissed", "1");
        hideInstallBanner();
      });
    }
    el.hidden = false;
  }

  function hideInstallBanner() {
    const el = document.getElementById("pwa-install-banner");
    if (el) el.hidden = true;
  }

  /* —— Push notifications —— */
  async function subscribePush() {
    if (!("PushManager" in global) || !("Notification" in global)) {
      throw new Error("Push not supported in this browser");
    }

    const perm = await Notification.requestPermission();
    if (perm !== "granted") throw new Error("Notification permission denied");

    const reg = await navigator.serviceWorker.ready;
    const keyRes = await fetch(scopeUrl() + "api/pwa/vapid-public-key");
    const { publicKey } = await keyRes.json();
    if (!publicKey) throw new Error("Push not configured on server");

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    });

    const token = global.ShardaAuth?.getToken?.();
    await fetch(scopeUrl() + "api/pwa/push-subscribe", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({ subscription: sub.toJSON() })
    });

    localStorage.setItem(PUSH_ASKED_KEY, "1");
    return sub;
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
    return out;
  }

  async function maybePromptPush() {
    if (!global.ShardaAuth?.isLoggedIn?.()) return;
    if (localStorage.getItem(PUSH_ASKED_KEY) === "1") return;
    if (Notification.permission === "granted") return;
    setTimeout(() => {
      if (confirm("Enable push notifications for class alerts and study reminders?")) {
        subscribePush().catch(() => {});
      } else {
        localStorage.setItem(PUSH_ASKED_KEY, "1");
      }
    }, 3000);
  }

  /* —— Mobile UI —— */
  function injectMobileNav() {
    if (document.querySelector(".pwa-bottom-nav")) return;
    const path = location.pathname.split("/").pop() || "index.html";
    const links = [
      { href: "index.html", icon: "🏠", label: "Home" },
      { href: "online-education.html", icon: "📚", label: "Learn" },
      { href: "mock-tests.html", icon: "📝", label: "Tests" },
      { href: "live-rooms.html", icon: "📡", label: "Live" },
      { href: "profile.html", icon: "👤", label: "Profile" }
    ];
    const nav = document.createElement("nav");
    nav.className = "pwa-bottom-nav";
    nav.setAttribute("aria-label", "Mobile navigation");
    nav.innerHTML = links
      .map(
        (l) =>
          `<a href="${l.href}" class="${path === l.href ? "active" : ""}"><span>${l.icon}</span><span>${l.label}</span></a>`
      )
      .join("");
    document.body.appendChild(nav);
    document.body.classList.add("pwa-has-nav");
  }

  function setupOnlineBadge() {
    const badge = document.createElement("div");
    badge.className = "pwa-online-badge";
    badge.id = "pwa-online-badge";
    document.body.appendChild(badge);
    const update = () => {
      badge.textContent = navigator.onLine ? "Online" : "Offline";
      badge.classList.toggle("online", navigator.onLine);
    };
    global.addEventListener("online", () => {
      update();
      flushQueue();
      registerBackgroundSync();
    });
    global.addEventListener("offline", update);
    update();
  }

  /* —— Hook apiFetch for offline queue —— */
  function hookApiFetch() {
    if (!global.ShardaAuth?.apiFetch) return;
    const orig = global.ShardaAuth.apiFetch.bind(global.ShardaAuth);
    global.ShardaAuth.apiFetch = async function (url, options = {}, retry = true) {
      try {
        return await orig(url, options, retry);
      } catch (err) {
        const method = (options.method || "GET").toUpperCase();
        if (!navigator.onLine && method !== "GET" && method !== "HEAD") {
          queueRequest({
            url: url.startsWith("http") ? url : base().replace(/\/$/, "") + url,
            method,
            body: options.body
          });
          throw new Error("Saved offline — will sync when you're back online.");
        }
        throw err;
      }
    };
  }

  async function init() {
    setupInstallPrompt();
    setupOnlineBadge();
    injectMobileNav();
    updateQueueHint();
    hookApiFetch();

    await registerServiceWorker();

    global.addEventListener("load", () => {
      flushQueue();
      maybePromptPush();
    });
  }

  global.ShardaPWA = {
    queueRequest,
    flushQueue,
    subscribePush,
    registerBackgroundSync,
    showInstallBanner
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window);
