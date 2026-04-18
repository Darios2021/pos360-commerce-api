// src/services/search.service.js
// Meilisearch integration — motor de búsqueda dedicado para e-commerce a escala.
//
// DESIGN:
// - Un índice "products" con documentos por producto (no por branch).
//   branch_ids es un array filterable: [1, 2, 3]
// - Graceful degradation: si Meilisearch no está configurado o falla, el
//   caller cae de regreso a MySQL.
// - Sync asincrónico (fire & forget): no bloquea las respuestas HTTP del backoffice.
// - Reindex completo disponible vía triggerFullReindex().

"use strict";

const { Meilisearch } = require("meilisearch");
const { sequelize } = require("../models");

// ─── Constantes ─────────────────────────────────────────────────────────────

const INDEX_NAME = "products";

const SEARCHABLE_ATTRIBUTES = [
  "name",
  "brand",
  "model",
  "sku",
  "barcode",
  "code",
];

const FILTERABLE_ATTRIBUTES = [
  "branch_ids",
  "category_id",
  "category_name",
  "subcategory_id",
  "subcategory_name",
  "brand",
  "brand_lower",
  "is_active",
  "price",
];

const STOP_WORDS = [
  "de", "para", "con", "el", "la", "los", "las",
  "un", "una", "y", "en", "del", "al", "por", "que",
  "se", "su", "sus", "lo", "le", "a", "o", "e",
];

// Sinónimos bidireccionales para el catálogo en español
const SYNONYMS = {
  "celular":    ["celu", "telefono", "smartphone", "movil", "telephone"],
  "celu":       ["celular", "telefono", "smartphone", "movil"],
  "telefono":   ["celular", "celu", "smartphone", "movil"],
  "smartphone": ["celular", "celu", "telefono", "movil"],
  "movil":      ["celular", "celu", "telefono", "smartphone"],
  "auricular":  ["auriculares", "headset", "headphones", "fono", "audifonos", "cascos"],
  "auriculares":["auricular", "headset", "headphones", "fono", "audifonos"],
  "fono":       ["auricular", "auriculares", "headphones", "headset"],
  "parlante":   ["parlantes", "speaker", "bocina", "altavoz", "altavoces"],
  "parlantes":  ["parlante", "speaker", "bocina", "altavoz"],
  "speaker":    ["parlante", "parlantes", "bocina", "altavoz"],
  "notebook":   ["laptop", "computadora portatil", "portatil"],
  "laptop":     ["notebook", "computadora portatil", "portatil"],
  "tele":       ["television", "televisor", "tv"],
  "television": ["televisor", "tv", "tele"],
  "televisor":  ["television", "tv", "tele"],
  "tv":         ["television", "televisor", "tele"],
  "cargador":   ["cargadores", "charger", "adaptador de corriente"],
  "cargadores": ["cargador", "charger"],
  "cable":      ["cables", "conector"],
  "cables":     ["cable", "conector"],
  "camara":     ["cámara", "camera"],
  "cámara":     ["camara", "camera"],
  "mouse":      ["raton", "ratón"],
  "teclado":    ["keyboard"],
  "inalambrico":["inalámbrico", "wireless", "wifi", "bluetooth"],
  "inalámbrico":["inalambrico", "wireless", "wifi", "bluetooth"],
};

const SORTABLE_ATTRIBUTES = ["price", "name", "id"];

const RANKING_RULES = [
  "words",
  "typo",
  "proximity",
  "attribute",
  "sort",
  "exactness",
];

// ─── Cliente (lazy singleton) ────────────────────────────────────────────────

let _client = null;

function isConfigured() {
  return !!process.env.MEILISEARCH_HOST;
}

function getClient() {
  if (!isConfigured()) return null;
  if (!_client) {
    _client = new Meilisearch({
      host: process.env.MEILISEARCH_HOST,
      apiKey: process.env.MEILISEARCH_MASTER_KEY || process.env.MEILISEARCH_API_KEY || "",
    });
  }
  return _client;
}

function getIndex() {
  const c = getClient();
  if (!c) return null;
  return c.index(INDEX_NAME);
}

// ─── Inicialización del índice (settings) ────────────────────────────────────

async function initIndex() {
  const client = getClient();
  if (!client) return;

  try {
    const index = await client.getOrCreateIndex(INDEX_NAME, { primaryKey: "id" });

    await index.updateSettings({
      searchableAttributes: SEARCHABLE_ATTRIBUTES,
      filterableAttributes: FILTERABLE_ATTRIBUTES,
      sortableAttributes: SORTABLE_ATTRIBUTES,
      rankingRules: RANKING_RULES,
      typoTolerance: {
        enabled: true,
        minWordSizeForTypos: { oneTypo: 4, twoTypos: 8 },
      },
      stopWords: STOP_WORDS,
      synonyms: SYNONYMS,
    });

    console.log("✅ [Meilisearch] Índice configurado:", INDEX_NAME);
  } catch (e) {
    console.warn("⚠️  [Meilisearch] No se pudo inicializar el índice:", e.message);
  }
}

// ─── Construcción de documento ───────────────────────────────────────────────

function buildDocument(row) {
  // branch_ids: viene como "1,2,3" (GROUP_CONCAT) o como array
  let branch_ids;
  if (Array.isArray(row.branch_ids)) {
    branch_ids = row.branch_ids.map(Number).filter(Boolean);
  } else {
    branch_ids = String(row.branch_ids || "")
      .split(",")
      .map((x) => Number(x.trim()))
      .filter(Boolean);
  }

  return {
    id: Number(row.product_id || row.id),
    name: String(row.name || ""),
    brand: String(row.brand || ""),
    model: String(row.model || ""),
    sku: String(row.sku || ""),
    barcode: String(row.barcode || ""),
    code: String(row.code || ""),
    description: String(row.description || ""),
    category_id: Number(row.category_id || 0),
    category_name: String(row.category_name || ""),
    subcategory_id: Number(row.subcategory_id || 0),
    subcategory_name: String(row.subcategory_name || ""),
    price: Number(row.price || 0),
    price_list: Number(row.price_list || 0),
    is_active: Number(row.is_active ?? 1),
    is_new: Number(row.is_new ?? 0),
    is_promo: Number(row.is_promo ?? 0),
    branch_ids,
    brand_lower: String(row.brand || "").toLowerCase(),
    updated_at: row.updated_at ? new Date(row.updated_at).getTime() : Date.now(),
  };
}

// ─── Query para obtener datos de un producto ─────────────────────────────────

async function fetchProductRows(productId = null) {
  const where = productId ? `AND p.id = ${Number(productId)}` : "";

  const [rows] = await sequelize.query(`
    SELECT
      p.id              AS product_id,
      p.name,
      p.brand,
      p.model,
      p.sku,
      p.barcode,
      p.code,
      p.description,
      p.category_id,
      c.name            AS category_name,
      p.subcategory_id,
      s.name            AS subcategory_name,
      p.price,
      p.price_list,
      p.is_active,
      p.is_new,
      p.is_promo,
      p.updated_at,
      GROUP_CONCAT(DISTINCT pb.branch_id ORDER BY pb.branch_id SEPARATOR ',') AS branch_ids
    FROM products p
    LEFT JOIN categories    c  ON c.id = p.category_id
    LEFT JOIN subcategories s  ON s.id = p.subcategory_id
    LEFT JOIN product_branches pb ON pb.product_id = p.id AND pb.is_active = 1
    WHERE 1=1 ${where}
    GROUP BY p.id
  `);

  return rows || [];
}

// ─── Sync de un producto (create/update) ─────────────────────────────────────

async function syncProduct(productId) {
  const index = getIndex();
  if (!index) return;

  try {
    const rows = await fetchProductRows(productId);
    if (!rows.length) {
      // Si no existe más, eliminarlo del índice
      await index.deleteDocument(Number(productId)).catch(() => {});
      return;
    }

    const doc = buildDocument(rows[0]);
    await index.addDocuments([doc], { primaryKey: "id" });
  } catch (e) {
    console.warn(`⚠️  [Meilisearch] syncProduct(${productId}) falló:`, e.message);
  }
}

// ─── Eliminar un producto del índice ─────────────────────────────────────────

async function deleteProduct(productId) {
  const index = getIndex();
  if (!index) return;

  try {
    await index.deleteDocument(Number(productId));
  } catch (e) {
    console.warn(`⚠️  [Meilisearch] deleteProduct(${productId}) falló:`, e.message);
  }
}

// ─── Reindex completo ────────────────────────────────────────────────────────

const BATCH_SIZE = 500;

async function triggerFullReindex() {
  const index = getIndex();
  if (!index) {
    console.warn("⚠️  [Meilisearch] No configurado — reindex omitido");
    return { ok: false, reason: "not_configured" };
  }

  console.log("🔄 [Meilisearch] Iniciando reindex completo...");

  try {
    const rows = await fetchProductRows();
    const docs = rows.map(buildDocument);

    console.log(`📦 [Meilisearch] Indexando ${docs.length} productos...`);

    for (let i = 0; i < docs.length; i += BATCH_SIZE) {
      const batch = docs.slice(i, i + BATCH_SIZE);
      await index.addDocuments(batch, { primaryKey: "id" });
      console.log(`   ✓ Batch ${Math.ceil((i + 1) / BATCH_SIZE)} / ${Math.ceil(docs.length / BATCH_SIZE)}`);
    }

    console.log("✅ [Meilisearch] Reindex completo finalizado.");
    return { ok: true, total: docs.length };
  } catch (e) {
    console.error("❌ [Meilisearch] Error en reindex:", e.message);
    return { ok: false, reason: e.message };
  }
}

// ─── Búsqueda principal (para listCatalog) ───────────────────────────────────

async function searchCatalog({
  branch_id,
  q = "",
  category_id = null,
  brands = [],               // array de strings
  price_min = null,
  price_max = null,
  sort = "",
  page = 1,
  limit = 24,
}) {
  const index = getIndex();
  if (!index) throw new Error("Meilisearch not configured");

  const filters = [`branch_ids = ${Number(branch_id)}`, "is_active = 1"];

  if (category_id) filters.push(`category_id = ${Number(category_id)}`);

  if (brands.length) {
    const brandFilters = brands.map((b) => `brand_lower = "${String(b).toLowerCase().replace(/"/g, '\\"')}"`);
    filters.push(`(${brandFilters.join(" OR ")})`);
  }

  if (price_min !== null) filters.push(`price >= ${Number(price_min)}`);
  if (price_max !== null) filters.push(`price <= ${Number(price_max)}`);

  // Sort
  let sortArr = [];
  if (sort === "price_asc") sortArr = ["price:asc"];
  else if (sort === "price_desc") sortArr = ["price:desc"];
  else if (sort === "name_asc") sortArr = ["name:asc"];
  // relevance / newest: no sort override → Meilisearch ranking rules aplican

  const pg = Math.max(1, Number(page));
  const lim = Math.min(100, Math.max(1, Number(limit)));

  const result = await index.search(q || "", {
    filter: filters.join(" AND "),
    sort: sortArr.length ? sortArr : undefined,
    limit: lim,
    offset: (pg - 1) * lim,
    matchingStrategy: "last",
    facets: ["brand", "category_name", "subcategory_name"],
    attributesToRetrieve: [
      "id", "name", "brand", "model", "sku", "barcode", "code",
      "category_id", "category_name", "subcategory_id", "subcategory_name",
      "price", "price_list", "is_active", "is_new", "is_promo", "description",
      "branch_ids",
    ],
  });

  // Normalizar items
  const items = (result.hits || []).map((h) => ({
    product_id: h.id,
    name: h.name,
    brand: h.brand,
    model: h.model,
    sku: h.sku,
    barcode: h.barcode,
    code: h.code,
    category_id: h.category_id,
    category_name: h.category_name,
    subcategory_id: h.subcategory_id,
    subcategory_name: h.subcategory_name,
    price: h.price,
    price_list: h.price_list,
    is_active: h.is_active,
    is_new: h.is_new,
    is_promo: h.is_promo,
    description: h.description,
    branch_id: Number(branch_id),
  }));

  const total = result.estimatedTotalHits ?? result.totalHits ?? items.length;

  // Transformar facetDistribution a formato usable por el frontend
  const fd = result.facetDistribution || {};

  const brandsFacet = Object.entries(fd.brand || {})
    .map(([k, c]) => ({ key: k, label: k, count: c }))
    .sort((a, b) => b.count - a.count);

  const catsFacet = Object.entries(fd.category_name || {})
    .map(([name, count]) => {
      // Buscar category_id desde los items actuales
      const match = items.find(i => i.category_name === name);
      return { key: match ? String(match.category_id) : name, label: name, count };
    })
    .sort((a, b) => b.count - a.count);

  return { items, total, page: pg, limit: lim, brandsFacet, catsFacet };
}

// ─── Sugerencias (autocomplete) ───────────────────────────────────────────────

async function searchSuggestions({ branch_id, q, limit = 8 }) {
  const index = getIndex();
  if (!index) throw new Error("Meilisearch not configured");

  const result = await index.search(q, {
    filter: [`branch_ids = ${Number(branch_id)}`, "is_active = 1"].join(" AND "),
    limit: Math.min(15, Math.max(1, Number(limit))),
    matchingStrategy: "last",
    attributesToRetrieve: [
      "id", "name", "brand", "model",
      "category_id", "category_name",
      "subcategory_id", "subcategory_name",
    ],
  });

  return (result.hits || []).map((h) => ({
    product_id: h.id,
    name: h.name,
    brand: h.brand,
    model: h.model,
    category_id: h.category_id,
    category_name: h.category_name,
    subcategory_id: h.subcategory_id,
    subcategory_name: h.subcategory_name,
  }));
}

// ─── Health check ─────────────────────────────────────────────────────────────

async function healthCheck() {
  const client = getClient();
  if (!client) return { configured: false };

  try {
    const health = await client.health();
    const stats = await getIndex().getStats().catch(() => null);
    return {
      configured: true,
      status: health.status,
      total_documents: stats?.numberOfDocuments ?? null,
    };
  } catch (e) {
    return { configured: true, status: "error", error: e.message };
  }
}

module.exports = {
  isConfigured,
  initIndex,
  syncProduct,
  deleteProduct,
  triggerFullReindex,
  searchCatalog,
  searchSuggestions,
  healthCheck,
};
