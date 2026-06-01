(function () {
  const $ = (id) => document.getElementById(id);

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function formatBytes(n) {
    if (!n) return "0 B";
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    return (n / (1024 * 1024)).toFixed(1) + " MB";
  }

  function isAdmin() {
    return window.ShardaAuth?.getUser?.()?.role === "admin";
  }

  function setupAdminUi() {
    const admin = isAdmin();
    $("fm-admin-link").hidden = !admin;
    $("fm-admin-user-wrap").hidden = !admin;
    $("fm-admin-all-wrap").hidden = !admin;
  }

  async function checkStatus() {
    try {
      const st = await window.ShardaAuth.apiFetch("/api/cloud-files/status");
      const warn = $("fm-config-warn");
      if (!st.configured) {
        warn.hidden = false;
        warn.innerHTML =
          "<strong>Cloudinary not configured.</strong> Add <code>CLOUDINARY_CLOUD_NAME</code>, <code>CLOUDINARY_API_KEY</code>, and <code>CLOUDINARY_API_SECRET</code> to your <code>.env</code> file and restart the server.";
      } else {
        warn.hidden = true;
      }
      return st;
    } catch (_) {
      return { configured: false };
    }
  }

  function listQuery() {
    const q = new URLSearchParams();
    const cat = $("fm-filter-category").value;
    if (cat) q.set("category", cat);
    if (isAdmin()) {
      if ($("fm-filter-all").checked) q.set("all", "true");
      const uid = $("fm-filter-user").value.trim();
      if (uid) q.set("userId", uid);
    }
    const s = q.toString();
    return s ? `?${s}` : "";
  }

  async function loadFiles() {
    const data = await window.ShardaAuth.apiFetch(`/api/cloud-files${listQuery()}`);
    renderStats(data);
    renderFiles(data.files || []);
  }

  function renderStats(data) {
    const el = $("fm-stats");
    const s = data.stats;
    if (s && isAdmin()) {
      el.innerHTML = `
        <div class="fm-stat"><strong>${data.files?.length || 0}</strong> shown</div>
        <div class="fm-stat"><strong>${s.images}</strong> images (total)</div>
        <div class="fm-stat"><strong>${s.pdfs}</strong> PDFs (total)</div>
        <div class="fm-stat"><strong>${s.certificates}</strong> certificates (total)</div>`;
    } else {
      el.innerHTML = `<div class="fm-stat"><strong>${data.files?.length || 0}</strong> files</div>`;
    }
  }

  function renderFiles(files) {
    const el = $("fm-files");
    if (!files.length) {
      el.innerHTML = '<div class="fm-empty">No files yet. Upload an image, PDF, or certificate above.</div>';
      return;
    }
    el.innerHTML = files
      .map(
        (f) => `
      <article class="fm-file-row" data-id="${escapeHtml(f.id)}">
        <div class="fm-file-meta">
          <h4>${escapeHtml(f.title)}</h4>
          <p>
            <span class="fm-tag ${escapeHtml(f.category)}">${escapeHtml(f.category)}</span>
            ${escapeHtml(f.originalName)} · ${formatBytes(f.bytes)}
            ${isAdmin() && f.userId ? ` · user ${escapeHtml(f.userId.slice(0, 8))}…` : ""}
          </p>
          <p>${new Date(f.createdAt).toLocaleString("en-IN")}</p>
        </div>
        <div class="fm-file-actions">
          ${f.url ? `<a href="${escapeHtml(f.url)}" class="btn btn-outline" target="_blank" rel="noopener">Open (signed)</a>` : ""}
          <button type="button" class="btn btn-outline fm-copy" data-url="${escapeHtml(f.url || "")}">Copy URL</button>
          <button type="button" class="btn btn-outline fm-del" data-id="${escapeHtml(f.id)}">Delete</button>
        </div>
      </article>`
      )
      .join("");

    el.querySelectorAll(".fm-del").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Delete this file from Cloudinary?")) return;
        try {
          await window.ShardaAuth.apiFetch(`/api/cloud-files/${btn.dataset.id}`, {
            method: "DELETE"
          });
          await loadFiles();
        } catch (err) {
          alert(err.message || "Delete failed");
        }
      });
    });

    el.querySelectorAll(".fm-copy").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (!btn.dataset.url) return;
        navigator.clipboard?.writeText(btn.dataset.url);
        btn.textContent = "Copied!";
        setTimeout(() => {
          btn.textContent = "Copy URL";
        }, 1500);
      });
    });
  }

  async function upload(category) {
    const inputMap = {
      image: "fm-up-image",
      pdf: "fm-up-pdf",
      certificate: "fm-up-cert"
    };
    const titleMap = {
      image: "fm-title-image",
      pdf: "fm-title-pdf",
      certificate: "fm-title-cert"
    };
    const input = $(inputMap[category]);
    if (!input?.files?.[0]) {
      alert("Choose a file first");
      return;
    }

    const fd = new FormData();
    fd.append("file", input.files[0]);
    fd.append("category", category);
    const title = $(titleMap[category])?.value?.trim();
    if (title) fd.append("title", title);

    const btn = document.querySelector(`.fm-upload-btn[data-category="${category}"]`);
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Uploading…";
    }

    try {
      const token = window.ShardaAuth.getAccessToken?.();
      const base = window.SHARDA_BASE || "";
      const res = await fetch(`${base}api/cloud-files/upload`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      input.value = "";
      if ($(titleMap[category])) $(titleMap[category]).value = "";
      await loadFiles();
    } catch (err) {
      alert(err.message || "Upload failed");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent =
          category === "image"
            ? "Upload image"
            : category === "pdf"
              ? "Upload PDF"
              : "Upload certificate";
      }
    }
  }

  async function init() {
    if (!window.ShardaAuth?.isLoggedIn?.()) {
      $("fm-guest").hidden = false;
      return;
    }

    $("fm-guest").hidden = true;
    $("fm-app").hidden = false;
    setupAdminUi();
    await checkStatus();

    $("fm-refresh").addEventListener("click", () => loadFiles().catch((e) => alert(e.message)));
    $("fm-filter-category").addEventListener("change", () => loadFiles().catch((e) => alert(e.message)));
    $("fm-filter-all")?.addEventListener("change", () => loadFiles().catch((e) => alert(e.message)));
    $("fm-filter-user")?.addEventListener("change", () => loadFiles().catch((e) => alert(e.message)));

    document.querySelectorAll(".fm-upload-btn").forEach((btn) => {
      btn.addEventListener("click", () => upload(btn.dataset.category));
    });

    await loadFiles();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
