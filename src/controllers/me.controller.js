// src/controllers/me.controller.js
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const path = require("path");
const AWS = require("aws-sdk");

const { User } = require("../models");

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

function s3Client() {
  return new AWS.S3({
    endpoint: mustEnv("S3_ENDPOINT"),
    accessKeyId: mustEnv("S3_ACCESS_KEY"),
    secretAccessKey: mustEnv("S3_SECRET_KEY"),
    s3ForcePathStyle: true,
    signatureVersion: "v4",
    sslEnabled: String(process.env.S3_SSL_ENABLED ?? "true") === "true",
    region: process.env.S3_REGION || "us-east-1",
  });
}

function publicUrlFor(key) {
  const base = process.env.S3_PUBLIC_BASE_URL || process.env.S3_ENDPOINT;
  const bucket = mustEnv("S3_BUCKET");
  const cleanBase = String(base).replace(/\/$/, "");
  return `${cleanBase}/${bucket}/${key}`;
}

// (opcional) intentar inferir Key desde URL pública
function keyFromPublicUrl(url) {
  if (!url) return null;
  const bucket = process.env.S3_BUCKET;
  if (!bucket) return null;

  try {
    const u = new URL(url);
    const p = u.pathname.replace(/^\/+/, "");
    const idx = p.indexOf(`${bucket}/`);
    if (idx === -1) return null;
    return p.substring(idx + `${bucket}/`.length);
  } catch {
    const s = String(url);
    const marker = `/${bucket}/`;
    const i = s.indexOf(marker);
    if (i === -1) return null;
    return s.substring(i + marker.length);
  }
}

function safeUser(u, roles = []) {
  return {
    id: u.id,
    email: u.email,
    username: u.username,
    first_name: u.first_name ?? null,
    last_name: u.last_name ?? null,
    avatar_url: u.avatar_url ?? null,
    roles: Array.isArray(roles) ? roles : [],
  };
}

function getUserIdFromReq(req) {
  // Tu JWT payload trae { sub, email, username, roles... }
  const p = req.user || {};
  return p.sub || p.id || null;
}

function safeAccessFromReq(req) {
  // ✅ No rompe nada: es un extra opcional
  // Se llena si en rutas agregamos attachAccessContext (o si algún mw lo setea).
  const a = req.access || {};
  return {
    roles: Array.isArray(a.roles) ? a.roles : Array.isArray(req.user?.roles) ? req.user.roles : [],
    permissions: Array.isArray(a.permissions) ? a.permissions : [],
    branch_ids: Array.isArray(a.branch_ids) ? a.branch_ids : [],
    is_super_admin: Boolean(a.is_super_admin) || (Array.isArray(a.roles) ? a.roles.includes("super_admin") : false),
  };
}

// GET /me
async function getMe(req, res) {
  const userId = getUserIdFromReq(req);
  if (!userId) return res.status(401).json({ ok: false, code: "UNAUTHORIZED" });

  const u = await User.findByPk(userId);
  if (!u) return res.status(404).json({ ok: false, code: "NOT_FOUND", message: "Usuario no encontrado" });

  // ✅ mantenemos "data" EXACTO para no romper frontend
  // ✅ agregamos "access" como extra (no obligatorio)
  return res.json({
    ok: true,
    data: safeUser(u, req.user?.roles || []),
    access: safeAccessFromReq(req),
  });
}

// PATCH /me
async function updateMe(req, res) {
  const userId = getUserIdFromReq(req);
  if (!userId) return res.status(401).json({ ok: false, code: "UNAUTHORIZED" });

  const u = await User.findByPk(userId);
  if (!u) return res.status(404).json({ ok: false, code: "NOT_FOUND", message: "Usuario no encontrado" });

  const { first_name, last_name } = req.body || {};

  u.first_name = (first_name ?? "").toString().trim() || null;
  u.last_name = (last_name ?? "").toString().trim() || null;

  await u.save();

  return res.json({
    ok: true,
    data: safeUser(u, req.user?.roles || []),
    access: safeAccessFromReq(req),
  });
}

// POST /me/avatar (multipart file)
async function uploadAvatar(req, res) {
  const userId = getUserIdFromReq(req);
  if (!userId) return res.status(401).json({ ok: false, code: "UNAUTHORIZED" });

  const u = await User.findByPk(userId);
  if (!u) return res.status(404).json({ ok: false, code: "NOT_FOUND", message: "Usuario no encontrado" });

  const file = req.file;
  if (!file) {
    return res.status(400).json({ ok: false, code: "NO_FILE", message: "No se recibió archivo" });
  }

  const mime = String(file.mimetype || "").toLowerCase();
  if (!/^image\/(jpeg|png|webp)$/.test(mime)) {
    return res.status(400).json({
      ok: false,
      code: "BAD_FILE",
      message: "Tipo inválido. Usá jpg/png/webp",
    });
  }

  const ext = path.extname(file.originalname || "").toLowerCase() || (mime.includes("png") ? ".png" : ".jpg");
  const key = `avatars/user_${userId}/${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`;

  const s3 = s3Client();
  const bucket = mustEnv("S3_BUCKET");

  await s3
    .putObject({
      Bucket: bucket,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
      ACL: "public-read",
      CacheControl: "public, max-age=31536000",
    })
    .promise();

  // borrar avatar anterior si existe (opcional)
  const deleteOld = String(process.env.S3_DELETE_ON_AVATAR_REPLACE ?? "true") === "true";
  if (deleteOld) {
    const oldKey = u.avatar_key || keyFromPublicUrl(u.avatar_url);
    if (oldKey) {
      try {
        await s3.deleteObject({ Bucket: bucket, Key: oldKey }).promise();
      } catch (e) {
        console.warn("⚠️ No se pudo borrar avatar anterior:", e?.message || e);
      }
    }
  }

  u.avatar_key = key;
  u.avatar_url = publicUrlFor(key);
  await u.save();

  return res.json({
    ok: true,
    data: safeUser(u, req.user?.roles || []),
    access: safeAccessFromReq(req),
  });
}

// POST /me/password
async function changePassword(req, res) {
  const userId = getUserIdFromReq(req);
  if (!userId) return res.status(401).json({ ok: false, code: "UNAUTHORIZED" });

  const { current_password, new_password } = req.body || {};
  if (!current_password || !new_password) {
    return res.status(400).json({
      ok: false,
      code: "BAD_REQUEST",
      message: "current_password y new_password son obligatorios",
    });
  }
  if (String(new_password).length < 8) {
    return res.status(400).json({
      ok: false,
      code: "WEAK_PASSWORD",
      message: "La nueva contraseña debe tener al menos 8 caracteres",
    });
  }

  const u = await User.findByPk(userId);
  if (!u) return res.status(404).json({ ok: false, code: "NOT_FOUND", message: "Usuario no encontrado" });

  const stored = String(u.password || "");

  // ✅ Soporta bcrypt o texto plano (por si hoy tu DB está en texto)
  let ok = false;
  if (stored.startsWith("$2a$") || stored.startsWith("$2b$") || stored.startsWith("$2y$")) {
    ok = await bcrypt.compare(String(current_password), stored);
  } else {
    ok = String(current_password) === stored;
  }

  if (!ok) {
    return res.status(400).json({ ok: false, code: "INVALID_PASSWORD", message: "Contraseña actual inválida" });
  }

  const hash = await bcrypt.hash(String(new_password), 10);
  u.password = hash;
  await u.save();

  return res.json({ ok: true, message: "Contraseña actualizada" });
}

module.exports = { getMe, updateMe, uploadAvatar, changePassword };
