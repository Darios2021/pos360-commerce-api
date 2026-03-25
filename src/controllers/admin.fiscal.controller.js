const {
  FiscalConfig,
  FiscalCertificate,
  Branch,
  sequelize,
} = require("../models");

const { encrypt } = require("../services/fiscal/crypto.service");
const {
  onlyDigits,
  isValidCuit,
  requireBranch,
  getConfigByBranch,
  getActiveCertificate,
  validateCertificatePaths,
} = require("../services/fiscal/config.service");

function toBool(v, def = false) {
  if (v === undefined || v === null) return def;
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(s)) return true;
  if (["0", "false", "no", "n", "off"].includes(s)) return false;
  return def;
}

function cleanEnum(v, allowed, def = null) {
  const s = String(v || "").trim();
  return allowed.includes(s) ? s : def;
}

function toInt(v, def = null) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : def;
}

function actorId(req) {
  return req?.usuario?.id || req?.user?.id || req?.auth?.id || null;
}

async function getConfig(req, res, next) {
  try {
    const branchId = toInt(req.query.branch_id, null);

    if (!branchId) {
      return res.status(400).json({
        ok: false,
        message: "branch_id es obligatorio.",
      });
    }

    const row = await getConfigByBranch(branchId);

    return res.json({
      ok: true,
      item: row
        ? {
            id: row.id,
            branch_id: row.branch_id,
            enabled: !!row.enabled,
            environment: row.environment,
            cuit: row.cuit,
            razon_social: row.razon_social,
            punto_venta: row.punto_venta,
            condicion_iva: row.condicion_iva,
            default_invoice_type: row.default_invoice_type,
            wsaa_url: row.wsaa_url,
            wsfe_url: row.wsfe_url,
            cert_active_id: row.cert_active_id,
            notes: row.notes,
            branch: row.branch
              ? {
                  id: row.branch.id,
                  name: row.branch.name,
                  code: row.branch.code,
                  address: row.branch.address,
                  city: row.branch.city,
                  is_active: !!row.branch.is_active,
                }
              : null,
            active_certificate: row.activeCertificate
              ? {
                  id: row.activeCertificate.id,
                  alias: row.activeCertificate.alias,
                  cert_path: row.activeCertificate.cert_path,
                  key_path: row.activeCertificate.key_path,
                  active: !!row.activeCertificate.active,
                  expires_at: row.activeCertificate.expires_at,
                  last_validated_at: row.activeCertificate.last_validated_at,
                }
              : null,
            created_at: row.created_at,
            updated_at: row.updated_at,
          }
        : null,
    });
  } catch (err) {
    next(err);
  }
}

async function putConfig(req, res, next) {
  const t = await sequelize.transaction();

  try {
    const branchId = toInt(req.body?.branch_id, null);
    const enabled = toBool(req.body?.enabled, false);
    const environment = cleanEnum(req.body?.environment, ["testing", "production"], "testing");
    const cuit = onlyDigits(req.body?.cuit);
    const razonSocial = String(req.body?.razon_social || "").trim() || null;
    const puntoVenta = toInt(req.body?.punto_venta, null);
    const condicionIva = cleanEnum(
      req.body?.condicion_iva,
      ["RESPONSABLE_INSCRIPTO", "MONOTRIBUTO", "EXENTO", "CONSUMIDOR_FINAL", "OTRO"],
      "RESPONSABLE_INSCRIPTO"
    );
    const defaultInvoiceType = cleanEnum(
      req.body?.default_invoice_type,
      ["TICKET", "A", "B", "C", "M", "NC", "ND", "OTHER"],
      "B"
    );
    const wsaaUrl = String(req.body?.wsaa_url || "").trim() || null;
    const wsfeUrl = String(req.body?.wsfe_url || "").trim() || null;
    const certActiveId = toInt(req.body?.cert_active_id, null);
    const notes = String(req.body?.notes || "").trim() || null;

    if (!branchId) {
      await t.rollback();
      return res.status(400).json({ ok: false, message: "branch_id es obligatorio." });
    }

    await requireBranch(branchId);

    if (!isValidCuit(cuit)) {
      await t.rollback();
      return res.status(400).json({ ok: false, message: "CUIT inválido. Debe tener 11 dígitos." });
    }

    if (!puntoVenta || puntoVenta < 1) {
      await t.rollback();
      return res.status(400).json({ ok: false, message: "punto_venta inválido." });
    }

    if (certActiveId) {
      const cert = await FiscalCertificate.findOne({
        where: { id: certActiveId, branch_id: branchId },
        transaction: t,
      });

      if (!cert) {
        await t.rollback();
        return res.status(400).json({
          ok: false,
          message: "cert_active_id no pertenece a la sucursal indicada.",
        });
      }
    }

    let row = await FiscalConfig.findOne({
      where: { branch_id: branchId },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!row) {
      row = await FiscalConfig.create(
        {
          branch_id: branchId,
          enabled: enabled ? 1 : 0,
          environment,
          cuit,
          razon_social: razonSocial,
          punto_venta: puntoVenta,
          condicion_iva: condicionIva,
          default_invoice_type: defaultInvoiceType,
          wsaa_url: wsaaUrl,
          wsfe_url: wsfeUrl,
          cert_active_id: certActiveId,
          notes,
        },
        { transaction: t }
      );
    } else {
      await row.update(
        {
          enabled: enabled ? 1 : 0,
          environment,
          cuit,
          razon_social: razonSocial,
          punto_venta: puntoVenta,
          condicion_iva: condicionIva,
          default_invoice_type: defaultInvoiceType,
          wsaa_url: wsaaUrl,
          wsfe_url: wsfeUrl,
          cert_active_id: certActiveId,
          notes,
        },
        { transaction: t }
      );
    }

    await t.commit();

    const fresh = await getConfigByBranch(branchId);

    return res.json({
      ok: true,
      actor_id: actorId(req),
      item: fresh,
    });
  } catch (err) {
    try {
      await t.rollback();
    } catch (_) {}
    next(err);
  }
}

async function listCertificates(req, res, next) {
  try {
    const branchId = toInt(req.query.branch_id, null);

    if (!branchId) {
      return res.status(400).json({
        ok: false,
        message: "branch_id es obligatorio.",
      });
    }

    await requireBranch(branchId);

    const rows = await FiscalCertificate.findAll({
      where: { branch_id: branchId },
      order: [["id", "DESC"]],
    });

    return res.json({
      ok: true,
      items: rows.map((r) => ({
        id: r.id,
        branch_id: r.branch_id,
        alias: r.alias,
        cert_path: r.cert_path,
        key_path: r.key_path,
        active: !!r.active,
        expires_at: r.expires_at,
        last_validated_at: r.last_validated_at,
        created_at: r.created_at,
        updated_at: r.updated_at,
      })),
    });
  } catch (err) {
    next(err);
  }
}

async function upsertCertificate(req, res, next) {
  const t = await sequelize.transaction();

  try {
    const branchId = toInt(req.body?.branch_id, null);
    const alias = String(req.body?.alias || "").trim() || null;
    const certPath = String(req.body?.cert_path || "").trim();
    const keyPath = String(req.body?.key_path || "").trim();
    const passphrase = String(req.body?.passphrase || "").trim() || null;
    const active = toBool(req.body?.active, true);
    const expiresAt = req.body?.expires_at || null;

    if (!branchId) {
      await t.rollback();
      return res.status(400).json({ ok: false, message: "branch_id es obligatorio." });
    }

    await requireBranch(branchId);

    const valid = validateCertificatePaths(certPath, keyPath);
    if (!valid.ok) {
      await t.rollback();
      return res.status(400).json({ ok: false, message: valid.message });
    }

    if (active) {
      await FiscalCertificate.update(
        { active: 0 },
        { where: { branch_id: branchId }, transaction: t }
      );
    }

    const cert = await FiscalCertificate.create(
      {
        branch_id: branchId,
        alias,
        cert_path: valid.cert_path,
        key_path: valid.key_path,
        passphrase_encrypted: passphrase ? encrypt(passphrase) : null,
        active: active ? 1 : 0,
        expires_at: expiresAt || null,
      },
      { transaction: t }
    );

    let cfg = await FiscalConfig.findOne({
      where: { branch_id: branchId },
      transaction: t,
    });

    if (cfg && active) {
      await cfg.update(
        { cert_active_id: cert.id },
        { transaction: t }
      );
    }

    await t.commit();

    return res.json({
      ok: true,
      actor_id: actorId(req),
      item: {
        id: cert.id,
        branch_id: cert.branch_id,
        alias: cert.alias,
        cert_path: cert.cert_path,
        key_path: cert.key_path,
        active: !!cert.active,
        expires_at: cert.expires_at,
        created_at: cert.created_at,
        updated_at: cert.updated_at,
      },
    });
  } catch (err) {
    try {
      await t.rollback();
    } catch (_) {}
    next(err);
  }
}

async function testConnection(req, res, next) {
  try {
    const branchId = toInt(req.body?.branch_id ?? req.query?.branch_id, null);

    if (!branchId) {
      return res.status(400).json({
        ok: false,
        message: "branch_id es obligatorio.",
      });
    }

    const branch = await requireBranch(branchId);
    const config = await getConfigByBranch(branchId);
    const cert = await getActiveCertificate(branchId);

    if (!config) {
      return res.status(400).json({
        ok: false,
        message: "La sucursal no tiene fiscal_config.",
      });
    }

    if (!config.enabled) {
      return res.status(400).json({
        ok: false,
        message: "La configuración fiscal está desactivada.",
      });
    }

    if (!cert) {
      return res.status(400).json({
        ok: false,
        message: "No hay certificado activo para la sucursal.",
      });
    }

    const paths = validateCertificatePaths(cert.cert_path, cert.key_path);
    if (!paths.ok) {
      return res.status(400).json({
        ok: false,
        message: paths.message,
      });
    }

    await cert.update({ last_validated_at: new Date() });

    return res.json({
      ok: true,
      message: "Prueba local OK. Configuración y certificados encontrados.",
      item: {
        branch: {
          id: branch.id,
          name: branch.name,
          code: branch.code,
        },
        config: {
          id: config.id,
          environment: config.environment,
          cuit: config.cuit,
          punto_venta: config.punto_venta,
          default_invoice_type: config.default_invoice_type,
          wsaa_url: config.wsaa_url,
          wsfe_url: config.wsfe_url,
          enabled: !!config.enabled,
        },
        certificate: {
          id: cert.id,
          alias: cert.alias,
          cert_path: cert.cert_path,
          key_path: cert.key_path,
          expires_at: cert.expires_at,
          last_validated_at: new Date(),
        },
      },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getConfig,
  putConfig,
  listCertificates,
  upsertCertificate,
  testConnection,
};