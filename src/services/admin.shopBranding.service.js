// src/services/admin.shopBranding.service.js
// ✅ COPY-PASTE FINAL COMPLETO (CommonJS)

const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { sequelize } = require("../models");

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const UPLOAD_DIR = path.join(process.cwd(), "uploads", "shop");
ensureDir(UPLOAD_DIR);

// Multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase() || ".png";
    const safe = file.fieldname === "favicon" ? "favicon" : "logo";
    cb(null, `${safe}-${Date.now()}${ext}`);
  },
});

const upload = multer({ storage });

async function getRow() {
  const [rows] = await sequelize.query(`
    SELECT id, name, logo_url, favicon_url, updated_at
    FROM shop_branding
    WHERE id = 1
    LIMIT 1
  `);

  const r = rows?.[0] || null;
  if (!r) {
    return {
      name: "San Juan Tecnología",
      logo_url: "",
      favicon_url: "",
      updated_at: new Date().toISOString(),
    };
  }
  return {
    name: r.name || "San Juan Tecnología",
    logo_url: r.logo_url || "",
    favicon_url: r.favicon_url || "",
    updated_at: r.updated_at ? new Date(r.updated_at).toISOString() : new Date().toISOString(),
  };
}

module.exports = {
  async getShopBranding() {
    return await getRow();
  },

  async updateShopBranding({ name }) {
    const n = String(name || "").trim();

    await sequelize.query(
      `
      INSERT INTO shop_branding (id, name, logo_url, favicon_url, updated_at)
      VALUES (1, :name, '', '', NOW())
      ON DUPLICATE KEY UPDATE
        name = :name,
        updated_at = NOW()
      `,
      { replacements: { name: n || "San Juan Tecnología" } }
    );

    return await getRow();
  },

  // middleware multer para controller
  uploadLogoMiddleware: upload.single("file"),
  uploadFaviconMiddleware: upload.single("file"),

  async uploadShopLogo(req) {
    // req.file lo pone multer
    if (!req.file) throw new Error("NO_FILE");

    const rel = `/uploads/shop/${req.file.filename}`;

    await sequelize.query(
      `
      INSERT INTO shop_branding (id, name, logo_url, favicon_url, updated_at)
      VALUES (1, 'San Juan Tecnología', :logo_url, '', NOW())
      ON DUPLICATE KEY UPDATE
        logo_url = :logo_url,
        updated_at = NOW()
      `,
      { replacements: { logo_url: rel } }
    );

    return await getRow();
  },

  async uploadShopFavicon(req) {
    if (!req.file) throw new Error("NO_FILE");

    const rel = `/uploads/shop/${req.file.filename}`;

    await sequelize.query(
      `
      INSERT INTO shop_branding (id, name, logo_url, favicon_url, updated_at)
      VALUES (1, 'San Juan Tecnología', '', :favicon_url, NOW())
      ON DUPLICATE KEY UPDATE
        favicon_url = :favicon_url,
        updated_at = NOW()
      `,
      { replacements: { favicon_url: rel } }
    );

    return await getRow();
  },
};
