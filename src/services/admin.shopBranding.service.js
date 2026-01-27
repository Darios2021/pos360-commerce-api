// src/services/admin.shopBranding.service.js
// ✅ COPY-PASTE FINAL (con OG 1200x630)
// - kind: "logo"      => se sube como imagen normal (opcional: podés resize)
// - kind: "favicon"   => resize a 64x64 (png)
// - kind: "og-image"  => genera 1200x630 (jpg) y guarda con nombre estable

const sharp = require("sharp");

// ⚠️ COMPLETAR: adaptá esto a tu uploader real (MinIO/S3)
async function putObject({ key, buffer, contentType }) {
  // Ejemplo esperado:
  // return { url: "https://storage-files.cingulado.org/" + key };

  // 🔴 Reemplazá por tu implementación real:
  throw new Error("putObject() no implementado. Pegame tu uploader actual y lo adapto 1:1.");
}

function extFromMime(mime) {
  const m = String(mime || "").toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  if (m.includes("webp")) return "webp";
  if (m.includes("svg")) return "svg";
  return "bin";
}

async function buildFavicon64(buffer) {
  // 64x64 PNG
  return sharp(buffer)
    .resize(64, 64, { fit: "cover" })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function buildOg1200x630(buffer) {
  // 1200x630 JPG con fondo y logo centrado
  const W = 1200, H = 630;

  const logo = await sharp(buffer)
    .resize(520, 520, { fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();

  const bg = sharp({
    create: { width: W, height: H, channels: 3, background: "#0f1115" },
  });

  return bg
    .composite([{ input: logo, gravity: "center" }])
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
}

async function uploadShopAsset({ file, kind }) {
  if (!file || !file.buffer) {
    throw new Error("FILE_REQUIRED");
  }

  const ts = Date.now();
  const safeKind = String(kind || "").trim();

  // defaults
  let key = "";
  let outBuf = file.buffer;
  let contentType = file.mimetype || "application/octet-stream";

  if (safeKind === "favicon") {
    outBuf = await buildFavicon64(file.buffer);
    contentType = "image/png";
    // nombre estable opcional:
    // key = "pos360/shop/favicon.png";
    // o timestamp como ya venías usando:
    key = `pos360/shop/${ts}-favicon.png`;
  } else if (safeKind === "og-image") {
    outBuf = await buildOg1200x630(file.buffer);
    contentType = "image/jpeg";
    // ✅ NOMBRE ESTABLE (esto es lo que querías)
    key = `pos360/shop/og-default.jpg`;
  } else if (safeKind === "logo") {
    // logo: lo subimos tal cual (o si querés, resize a un máximo)
    // outBuf = await sharp(file.buffer).resize(512, 512, { fit: "inside" }).png().toBuffer();
    // contentType = "image/png";
    const ext = extFromMime(file.mimetype);
    key = `pos360/shop/${ts}-logo.${ext}`;
  } else {
    const ext = extFromMime(file.mimetype);
    key = `pos360/shop/${ts}-asset.${ext}`;
  }

  const up = await putObject({ key, buffer: outBuf, contentType });

  if (!up || !up.url) {
    throw new Error("UPLOAD_FAILED");
  }

  return { url: up.url, key, contentType };
}

module.exports = { uploadShopAsset };
