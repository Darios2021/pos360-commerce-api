/* scripts/migrate-product-images-to-webp.js
   Migra imágenes existentes de ProductImage a .webp:
   - Descarga objeto actual desde MinIO/S3
   - Convierte a WebP (resize + quality)
   - Sube .webp
   - Actualiza ProductImage.url
   - Opcional: borra original

   Uso:
   - DRY RUN (no cambia nada): node scripts/migrate-product-images-to-webp.js --dry-run
   - Ejecutar:                node scripts/migrate-product-images-to-webp.js
   - Ejecutar y borrar orig:  DELETE_ORIGINAL=true node scripts/migrate-product-images-to-webp.js

   Env opcionales:
   - IMG_MAX_WIDTH=1200
   - IMG_WEBP_QUALITY=75
   - MIGRATE_LIMIT=0 (0 = sin limite)
*/

const sharp = require("sharp");
const { fileTypeFromBuffer } = require("file-type");
const { GetObjectCommand, PutObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { s3, s3Config } = require("../src/config/s3");
const { ProductImage, sequelize } = require("../src/models");

const IMG_MAX_WIDTH = Number(process.env.IMG_MAX_WIDTH || 1200);
const IMG_WEBP_QUALITY = Number(process.env.IMG_WEBP_QUALITY || 75);
const DELETE_ORIGINAL = String(process.env.DELETE_ORIGINAL || "false") === "true";
const MIGRATE_LIMIT = Number(process.env.MIGRATE_LIMIT || 0);

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");

function log(...a) {
  console.log(new Date().toISOString(), ...a);
}

function keyFromPublicUrl(url) {
  if (!url) return null;

  const bucket = s3Config.bucket || process.env.S3_BUCKET;
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

function publicUrlForKey(key) {
  const base = String(process.env.S3_PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  const bucket = s3Config.bucket || process.env.S3_BUCKET;
  const cleanKey = String(key || "").replace(/^\/+/, "");
  if (!base) return `/${bucket}/${cleanKey}`;
  return `${base}/${bucket}/${cleanKey}`;
}

function toWebpKey(originalKey) {
  // cambia extensión a .webp, mantiene path/nombre
  if (!originalKey) return null;
  return originalKey.replace(/\.(jpe?g|png|webp)$/i, ".webp");
}

async function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (c) => chunks.push(c));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

async function downloadObjectToBuffer(bucket, key) {
  const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!out || !out.Body) throw new Error("S3_GET_EMPTY_BODY");
  // Body es stream en Node
  return streamToBuffer(out.Body);
}

async function uploadWebpBuffer(bucket, key, buffer) {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: "image/webp",
      CacheControl: "public, max-age=31536000, immutable",
      // Si tu MinIO no acepta ACL, comentá esta línea
      ACL: "public-read",
    })
  );
}

async function deleteObject(bucket, key) {
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

async function normalizeToWebp(buffer) {
  // Validación real del input por magic bytes
  const ft = await fileTypeFromBuffer(buffer);
  const mime = ft?.mime || "";
  const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
  if (!allowed.has(mime)) {
    const err = new Error(`INPUT_NOT_ALLOWED_${mime || "unknown"}`);
    err.statusCode = 415;
    throw err;
  }

  return sharp(buffer)
    .rotate()
    .resize({ width: IMG_MAX_WIDTH, withoutEnlargement: true })
    .webp({ quality: IMG_WEBP_QUALITY })
    .toBuffer();
}

async function main() {
  log("=== MIGRATE ProductImage -> WebP ===");
  log("Bucket:", s3Config.bucket);
  log("DRY_RUN:", DRY_RUN, "| DELETE_ORIGINAL:", DELETE_ORIGINAL);
  log("IMG_MAX_WIDTH:", IMG_MAX_WIDTH, "| IMG_WEBP_QUALITY:", IMG_WEBP_QUALITY);
  if (MIGRATE_LIMIT > 0) log("MIGRATE_LIMIT:", MIGRATE_LIMIT);

  // Trae imágenes no-webp
  const where = sequelize.where(
    sequelize.fn("LOWER", sequelize.col("url")),
    { [sequelize.Op.notLike]: "%\.webp" }
  );

  // Si tu Sequelize no expone Op así, usamos fallback:
  const Op = sequelize.Sequelize?.Op || require("sequelize").Op;

  const items = await ProductImage.findAll({
    where: {
      [Op.and]: [
        sequelize.where(sequelize.fn("LOWER", sequelize.col("url")), {
          [Op.notLike]: "%.webp",
        }),
      ],
    },
    order: [["id", "ASC"]],
    limit: MIGRATE_LIMIT > 0 ? MIGRATE_LIMIT : undefined,
  });

  log("Encontradas para migrar:", items.length);

  const bucket = s3Config.bucket;
  let ok = 0;
  let skipped = 0;
  let failed = 0;

  for (const img of items) {
    const id = img.id;
    const url = img.url;

    try {
      const key = keyFromPublicUrl(url);
      if (!key) {
        skipped++;
        log(`[SKIP] id=${id} no pude inferir key desde url`);
        continue;
      }

      // Si ya termina en webp, saltar
      if (/\.webp$/i.test(key) || /\.webp$/i.test(url)) {
        skipped++;
        log(`[SKIP] id=${id} ya es webp`);
        continue;
      }

      const newKey = toWebpKey(key);
      if (!newKey) {
        skipped++;
        log(`[SKIP] id=${id} key inválida`);
        continue;
      }

      log(`[DO] id=${id} key=${key} -> ${newKey}`);

      if (DRY_RUN) {
        ok++;
        continue;
      }

      // 1) download
      const inputBuf = await downloadObjectToBuffer(bucket, key);

      // 2) convert
      const webpBuf = await normalizeToWebp(inputBuf);

      // 3) upload
      await uploadWebpBuffer(bucket, newKey, webpBuf);

      // 4) update DB url
      const newUrl = publicUrlForKey(newKey);
      await img.update({ url: newUrl });

      // 5) optional delete original
      if (DELETE_ORIGINAL) {
        try {
          await deleteObject(bucket, key);
        } catch (e) {
          log(`[WARN] id=${id} no pude borrar original: ${e?.message || e}`);
        }
      }

      ok++;
      log(`[OK]  id=${id} -> ${newUrl} (${webpBuf.length} bytes)`);
    } catch (e) {
      failed++;
      log(`[ERR] id=${id} ${e?.message || e}`);
    }
  }

  log("=== RESUMEN ===");
  log("OK:", ok, "SKIP:", skipped, "FAIL:", failed);
  log("Listo.");
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
