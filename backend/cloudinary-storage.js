const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const STORE_FILE = path.join(__dirname, "data", "cloud-files.json");
const ROOT_FOLDER = "sharda-setu";

const CATEGORIES = {
  image: {
    label: "Image",
    mimes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
    extensions: [".jpg", ".jpeg", ".png", ".webp", ".gif"],
    maxBytes: 5 * 1024 * 1024,
    resourceType: "image"
  },
  pdf: {
    label: "PDF",
    mimes: ["application/pdf"],
    extensions: [".pdf"],
    maxBytes: 12 * 1024 * 1024,
    resourceType: "raw"
  },
  certificate: {
    label: "Certificate",
    mimes: ["application/pdf", "image/jpeg", "image/png", "image/webp"],
    extensions: [".pdf", ".jpg", ".jpeg", ".png", ".webp"],
    maxBytes: 10 * 1024 * 1024,
    resourceType: null
  }
};

let cloudinary = null;

function loadCloudinarySdk() {
  if (cloudinary) return cloudinary;
  try {
    cloudinary = require("cloudinary").v2;
    return cloudinary;
  } catch {
    return null;
  }
}

function isConfigured() {
  const cld = loadCloudinarySdk();
  return Boolean(
    cld &&
      process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET
  );
}

function configure() {
  const cld = loadCloudinarySdk();
  if (!cld || !isConfigured()) return false;
  cld.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true
  });
  return true;
}

function loadStore() {
  if (!fs.existsSync(STORE_FILE)) {
    fs.writeFileSync(STORE_FILE, JSON.stringify({ files: [] }, null, 2));
  }
  return JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
}

function saveStore(store) {
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), "utf8");
}

function resolveResourceType(category, mimeType) {
  const rules = CATEGORIES[category];
  if (!rules) return "raw";
  if (category === "certificate") {
    return mimeType?.startsWith("image/") ? "image" : "raw";
  }
  return rules.resourceType;
}

function validateUpload(category, file) {
  const rules = CATEGORIES[category];
  if (!rules) return { error: "Invalid category. Use: image, pdf, certificate", status: 400 };
  if (!file) return { error: "No file uploaded", status: 400 };

  const name = (file.originalname || "").toLowerCase();
  const ext = path.extname(name);
  const mimeOk = rules.mimes.includes(file.mimetype);
  const extOk = rules.extensions.some((e) => name.endsWith(e));

  if (!mimeOk && !extOk) {
    return {
      error: `Invalid file for ${rules.label}. Allowed: ${rules.extensions.join(", ")}`,
      status: 400
    };
  }

  const size = file.size || file.buffer?.length || 0;
  if (size > rules.maxBytes) {
    return {
      error: `File too large. Max ${Math.round(rules.maxBytes / (1024 * 1024))}MB for ${rules.label}`,
      status: 400
    };
  }

  return { rules };
}

function uploadBuffer(buffer, options) {
  return new Promise((resolve, reject) => {
    if (!configure()) {
      return reject(new Error("Cloudinary is not configured"));
    }
    const cld = loadCloudinarySdk();
    const resourceType = options.resourceType || "auto";
    const stream = cld.uploader.upload_stream(
      {
        folder: options.folder,
        resource_type: resourceType,
        type: "authenticated",
        access_mode: "authenticated",
        public_id: options.publicId,
        overwrite: false,
        context: options.context || {}
      },
      (err, result) => {
        if (err) return reject(err);
        resolve(result);
      }
    );
    stream.end(buffer);
  });
}

function deleteRemote(publicId, resourceType) {
  if (!configure()) return Promise.reject(new Error("Cloudinary not configured"));
  const cld = loadCloudinarySdk();
  return cld.uploader.destroy(publicId, {
    resource_type: resourceType || "image",
    type: "authenticated",
    invalidate: true
  });
}

function getSignedDeliveryUrl(file, ttlSeconds = 3600) {
  if (!configure()) return file.secureUrl || null;
  const cld = loadCloudinarySdk();
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  return cld.url(file.publicId, {
    resource_type: file.resourceType,
    type: "authenticated",
    sign_url: true,
    secure: true,
    expires_at: expiresAt
  });
}

async function uploadFile(userId, file, options = {}) {
  if (!isConfigured()) {
    return {
      error: "Cloudinary is not configured. Set CLOUDINARY_* in .env",
      status: 503
    };
  }

  const category = options.category || "image";
  const validation = validateUpload(category, file);
  if (validation.error) return validation;

  const buffer = file.buffer || (file.path ? fs.readFileSync(file.path) : null);
  if (!buffer) return { error: "Empty file", status: 400 };

  const resourceType = resolveResourceType(category, file.mimetype);
  const subfolder = options.subfolder || category;
  const folder = `${ROOT_FOLDER}/${userId}/${subfolder}`;
  const baseName = path
    .basename(file.originalname || "file", path.extname(file.originalname || ""))
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 48);
  const publicId = `${baseName}_${Date.now().toString(36)}`;

  let result;
  try {
    result = await uploadBuffer(buffer, {
      folder,
      resourceType,
      publicId,
      context: {
        user_id: userId,
        category,
        title: options.title || file.originalname || ""
      }
    });
  } catch (err) {
    return { error: err.message || "Cloudinary upload failed", status: 502 };
  }

  if (file.path) {
    try {
      fs.unlinkSync(file.path);
    } catch (_) {}
  }

  const record = {
    id: crypto.randomUUID(),
    userId,
    category,
    title: options.title || file.originalname || "Untitled",
    originalName: file.originalname || "file",
    mimeType: file.mimetype,
    bytes: result.bytes,
    publicId: result.public_id,
    resourceType: result.resource_type,
    format: result.format,
    folder: result.folder,
    secureUrl: result.secure_url,
    accessMode: "authenticated",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const store = loadStore();
  store.files.push(record);
  saveStore(store);

  return {
    file: toPublicFile(record, { includeSignedUrl: true })
  };
}

function toPublicFile(record, opts = {}) {
  const out = {
    id: record.id,
    userId: record.userId,
    category: record.category,
    title: record.title,
    originalName: record.originalName,
    mimeType: record.mimeType,
    bytes: record.bytes,
    format: record.format,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
  if (opts.includeSignedUrl) {
    out.url = getSignedDeliveryUrl(record);
    out.urlExpiresIn = 3600;
  }
  return out;
}

function findFile(id) {
  const store = loadStore();
  return store.files.find((f) => f.id === id) || null;
}

function listFiles(requesterId, requesterRole, options = {}) {
  const store = loadStore();
  let files = store.files;

  if (options.userId && requesterRole === "admin") {
    files = files.filter((f) => f.userId === options.userId);
  } else if (options.all && requesterRole === "admin") {
    // all files
  } else {
    files = files.filter((f) => f.userId === requesterId);
  }

  if (options.category) {
    files = files.filter((f) => f.category === options.category);
  }

  files = files.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const limit = Math.min(200, options.limit || 100);
  const total = files.length;
  files = files.slice(0, limit);

  const stats = {
    total,
    images: store.files.filter((f) => f.category === "image").length,
    pdfs: store.files.filter((f) => f.category === "pdf").length,
    certificates: store.files.filter((f) => f.category === "certificate").length
  };

  return {
    configured: isConfigured(),
    files: files.map((f) => toPublicFile(f, { includeSignedUrl: true })),
    stats: requesterRole === "admin" ? stats : undefined
  };
}

function getFileAccess(fileId, requesterId, requesterRole) {
  const record = findFile(fileId);
  if (!record) return { error: "File not found", status: 404 };
  if (record.userId !== requesterId && requesterRole !== "admin") {
    return { error: "Forbidden", status: 403 };
  }
  return {
    file: {
      ...toPublicFile(record, { includeSignedUrl: true }),
      publicId: requesterRole === "admin" ? record.publicId : undefined
    }
  };
}

async function deleteFile(fileId, requesterId, requesterRole) {
  const store = loadStore();
  const idx = store.files.findIndex((f) => f.id === fileId);
  if (idx < 0) return { error: "File not found", status: 404 };

  const record = store.files[idx];
  if (record.userId !== requesterId && requesterRole !== "admin") {
    return { error: "Forbidden", status: 403 };
  }

  if (isConfigured()) {
    try {
      await deleteRemote(record.publicId, record.resourceType);
    } catch (err) {
      return { error: err.message || "Cloudinary delete failed", status: 502 };
    }
  }

  store.files.splice(idx, 1);
  saveStore(store);
  return { ok: true, id: fileId };
}

function getStatus() {
  return {
    configured: isConfigured(),
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || null,
    categories: Object.keys(CATEGORIES),
    rootFolder: ROOT_FOLDER,
    secure: true,
    accessMode: "authenticated"
  };
}

module.exports = {
  isConfigured,
  getStatus,
  uploadFile,
  listFiles,
  getFileAccess,
  deleteFile,
  getSignedDeliveryUrl,
  validateUpload,
  CATEGORIES,
  uploadAvatar: async (userId, file) => {
    const result = await uploadFile(userId, file, {
      category: "image",
      subfolder: "avatars",
      title: "Profile avatar"
    });
    if (result.error) return result;
    return { avatarUrl: result.file.url };
  }
};
