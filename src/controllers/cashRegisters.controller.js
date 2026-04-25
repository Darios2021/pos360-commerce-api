const {
  sequelize,
  getAuthUserId,
  getAuthBranchId,
  getCurrentOpenCashRegister,
  openCashRegister,
  createManualCashMovement,
  buildCashRegisterSummary,
  closeCashRegister,
} = require("../services/cashRegister.service");
const access = require("../utils/accessScope");

async function getCurrent(req, res, next) {
  try {
    const branch_id = getAuthBranchId(req);

    if (!branch_id) {
      return res.status(400).json({
        ok: false,
        code: "BRANCH_REQUIRED",
        message: "No se pudo determinar la sucursal activa.",
      });
    }

    const user_id = getAuthUserId(req);
    const cashRegister = await getCurrentOpenCashRegister({
      branch_id,
      user_id,
    });

    // Otras cajas abiertas del mismo usuario (zombies al cambiar de sucursal).
    // El frontend las usa para avisar que hay cajas pendientes de cerrar.
    const { CashRegister } = require("../models");
    const { Op } = require("sequelize");
    const otherOpen = user_id
      ? await CashRegister.findAll({
          where: {
            opened_by: user_id,
            status: "OPEN",
            ...(cashRegister?.id
              ? { id: { [Op.ne]: cashRegister.id } }
              : {}),
          },
          attributes: ["id", "branch_id", "opened_at", "opening_cash"],
          order: [["opened_at", "ASC"]],
        })
      : [];

    // Cajas abiertas en la sucursal actual (supervisión).
    // El usuario actual las ve en modo lectura para saber quién está operando.
    // Se excluye la propia si tuviera una.
    const branchOpenRows = await sequelize.query(
      `
        SELECT
          cr.id,
          cr.branch_id,
          cr.opened_by,
          cr.opened_at,
          cr.opening_cash,
          cr.caja_type,
          cr.invoice_mode,
          cr.invoice_type,
          NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), '') AS opened_by_name,
          u.email    AS opened_by_email,
          u.username AS opened_by_username
        FROM cash_registers cr
        LEFT JOIN users u ON u.id = cr.opened_by
        WHERE cr.status = 'OPEN'
          AND cr.branch_id = :bid
          ${cashRegister?.id ? "AND cr.id <> :ownId" : ""}
        ORDER BY cr.opened_at ASC
      `,
      {
        replacements: {
          bid: branch_id,
          ...(cashRegister?.id ? { ownId: cashRegister.id } : {}),
        },
        type: sequelize.QueryTypes.SELECT,
      }
    );

    const branchOpen = (branchOpenRows || []).map((r) => ({
      id: Number(r.id),
      branch_id: Number(r.branch_id),
      opened_by: Number(r.opened_by),
      opened_at: r.opened_at,
      opening_cash: Number(r.opening_cash || 0),
      caja_type: r.caja_type || null,
      invoice_mode: r.invoice_mode || null,
      invoice_type: r.invoice_type || null,
      opened_by_name:
        r.opened_by_name ||
        r.opened_by_username ||
        r.opened_by_email ||
        `Usuario #${r.opened_by}`,
      opened_by_email: r.opened_by_email || null,
    }));

    return res.json({
      ok: true,
      data: cashRegister || null,
      other_open_registers: otherOpen,
      branch_open_registers: branchOpen,
    });
  } catch (e) {
    console.error("[cashRegisters.getCurrent] error:", e);
    next(e);
  }
}

async function open(req, res) {
  const t = await sequelize.transaction();
  try {
    const branch_id = getAuthBranchId(req);
    const opened_by = getAuthUserId(req);

    console.log("[cashRegisters.open] input:", {
      branch_id,
      opened_by,
      body: req.body,
    });

    const opening_ip =
      (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
      req.ip ||
      req.socket?.remoteAddress ||
      null;

    const cashRegister = await openCashRegister({
      branch_id,
      opened_by,
      opening_cash: req.body?.opening_cash,
      opening_note: req.body?.opening_note,
      opening_ip,
      caja_type:    req.body?.caja_type,
      invoice_mode: req.body?.invoice_mode,
      invoice_type: req.body?.invoice_type,
      transaction:  t,
    });

    await t.commit();

    return res.status(201).json({
      ok: true,
      message: "Caja abierta correctamente.",
      data: cashRegister,
    });
  } catch (e) {
    try {
      await t.rollback();
    } catch {}

    console.error("[cashRegisters.open] error:", {
      message: e?.message,
      code: e?.code,
      status: e?.status,
      data: e?.data,
      stack: e?.stack,
      body: req.body,
    });

    return res.status(e.status || 500).json({
      ok: false,
      code: e.code || "CASH_REGISTER_OPEN_ERROR",
      message: e.message || "No se pudo abrir la caja.",
      data: e.data || null,
    });
  }
}

async function addMovement(req, res) {
  const t = await sequelize.transaction();
  try {
    const cash_register_id = req.params.id;
    const user_id = getAuthUserId(req);

    console.log("[cashRegisters.addMovement] input:", {
      cash_register_id,
      user_id,
      body: req.body,
    });

    // Sellado de scope para movimientos manuales (IN/OUT):
    //  - super_admin / branch admin: pueden imputar movimientos a cualquier caja
    //    de su sucursal (admin: su sucursal, super_admin: cualquier sucursal).
    //  - cajero: solo movimientos sobre SU propia caja.
    const superAdmin = access.isSuperAdmin(req);
    if (!superAdmin) {
      const branchAdmin = access.isBranchAdmin(req);
      const ctxBranchId = parseInt(req?.ctx?.branchId, 10) || getAuthBranchId(req);

      const { CashRegister } = require("../models");
      const cr = await CashRegister.findByPk(cash_register_id, {
        attributes: ["id", "branch_id", "opened_by", "status"],
        transaction: t,
      });
      if (!cr) {
        await t.rollback();
        return res.status(404).json({
          ok: false,
          code: "CASH_REGISTER_NOT_FOUND",
          message: "Caja no encontrada.",
        });
      }
      if (parseInt(cr.branch_id, 10) !== parseInt(ctxBranchId, 10)) {
        await t.rollback();
        return res.status(403).json({
          ok: false,
          code: "FORBIDDEN_BRANCH",
          message: "No podés operar sobre cajas de otra sucursal.",
        });
      }
      if (!branchAdmin && parseInt(cr.opened_by, 10) !== parseInt(user_id, 10)) {
        await t.rollback();
        return res.status(403).json({
          ok: false,
          code: "FORBIDDEN_USER",
          message: "Solo podés agregar movimientos a tu propia caja.",
        });
      }
    }

    const movement = await createManualCashMovement({
      cash_register_id,
      user_id,
      type: req.body?.type,
      reason: req.body?.reason,
      note: req.body?.note,
      amount: req.body?.amount,
      transaction: t,
    });

    await t.commit();

    return res.status(201).json({
      ok: true,
      message: "Movimiento de caja registrado.",
      data: movement,
    });
  } catch (e) {
    try {
      await t.rollback();
    } catch {}

    console.error("[cashRegisters.addMovement] error:", {
      message: e?.message,
      code: e?.code,
      status: e?.status,
      data: e?.data,
      stack: e?.stack,
      body: req.body,
      params: req.params,
    });

    return res.status(e.status || 500).json({
      ok: false,
      code: e.code || "CASH_MOVEMENT_ERROR",
      message: e.message || "No se pudo registrar el movimiento.",
      data: e.data || null,
    });
  }
}

async function getSummary(req, res) {
  try {
    const cash_register_id = req.params.id;

    console.log("[cashRegisters.getSummary] input:", {
      cash_register_id,
    });

    // Sellado de scope:
    //  - super_admin: ve cualquier caja.
    //  - branch admin: solo cajas de su sucursal activa.
    //  - cajero: solo SUS propias cajas.
    const superAdmin  = access.isSuperAdmin(req);
    if (!superAdmin) {
      const branchAdmin = access.isBranchAdmin(req);
      const ctxBranchId = parseInt(req?.ctx?.branchId, 10) || getAuthBranchId(req);
      const ctxUserId   = getAuthUserId(req);

      const { CashRegister } = require("../models");
      const cr = await CashRegister.findByPk(cash_register_id, {
        attributes: ["id", "branch_id", "opened_by"],
      });
      if (!cr) {
        return res.status(404).json({
          ok: false,
          code: "CASH_REGISTER_NOT_FOUND",
          message: "Caja no encontrada.",
        });
      }
      if (parseInt(cr.branch_id, 10) !== parseInt(ctxBranchId, 10)) {
        return res.status(403).json({
          ok: false,
          code: "FORBIDDEN_BRANCH",
          message: "No podés ver el resumen de una caja de otra sucursal.",
        });
      }
      if (!branchAdmin && parseInt(cr.opened_by, 10) !== parseInt(ctxUserId, 10)) {
        return res.status(403).json({
          ok: false,
          code: "FORBIDDEN_USER",
          message: "Solo podés ver el resumen de tu propia caja.",
        });
      }
    }

    const summary = await buildCashRegisterSummary({ cash_register_id });

    return res.json({
      ok: true,
      data: summary,
    });
  } catch (e) {
    console.error("[cashRegisters.getSummary] error:", {
      message: e?.message,
      code: e?.code,
      status: e?.status,
      data: e?.data,
      stack: e?.stack,
      params: req.params,
    });

    return res.status(e.status || 500).json({
      ok: false,
      code: e.code || "CASH_REGISTER_SUMMARY_ERROR",
      message: e.message || "No se pudo obtener el resumen de caja.",
      data: e.data || null,
    });
  }
}

async function close(req, res) {
  const t = await sequelize.transaction();
  try {
    const cash_register_id = req.params.id;
    const closed_by = getAuthUserId(req);

    console.log("[cashRegisters.close] input:", {
      cash_register_id,
      closed_by,
      body: req.body,
    });

    // Sellado de scope para cierre:
    //  - super_admin: cierra cualquier caja.
    //  - branch admin: cierra cualquier caja de SU sucursal.
    //  - cajero: solo cierra SU propia caja.
    const superAdmin  = access.isSuperAdmin(req);
    if (!superAdmin) {
      const branchAdmin = access.isBranchAdmin(req);
      const ctxBranchId = parseInt(req?.ctx?.branchId, 10) || getAuthBranchId(req);

      const { CashRegister } = require("../models");
      const cr = await CashRegister.findByPk(cash_register_id, {
        attributes: ["id", "branch_id", "opened_by", "status"],
        transaction: t,
      });
      if (!cr) {
        await t.rollback();
        return res.status(404).json({
          ok: false,
          code: "CASH_REGISTER_NOT_FOUND",
          message: "Caja no encontrada.",
        });
      }
      if (parseInt(cr.branch_id, 10) !== parseInt(ctxBranchId, 10)) {
        await t.rollback();
        return res.status(403).json({
          ok: false,
          code: "FORBIDDEN_BRANCH",
          message: "No podés cerrar una caja de otra sucursal.",
        });
      }
      if (!branchAdmin && parseInt(cr.opened_by, 10) !== parseInt(closed_by, 10)) {
        await t.rollback();
        return res.status(403).json({
          ok: false,
          code: "FORBIDDEN_USER",
          message: "Solo podés cerrar tu propia caja.",
        });
      }
    }

    const out = await closeCashRegister({
      cash_register_id,
      closed_by,
      closing_cash:     req.body?.closing_cash,
      closing_note:     req.body?.closing_note,
      closing_declared: req.body?.closing_declared ?? null,
      transaction: t,
    });

    await t.commit();

    return res.json({
      ok: true,
      message: "Caja cerrada correctamente.",
      data: out,
    });
  } catch (e) {
    try {
      await t.rollback();
    } catch {}

    console.error("[cashRegisters.close] error:", {
      message: e?.message,
      code: e?.code,
      status: e?.status,
      data: e?.data,
      stack: e?.stack,
      body: req.body,
      params: req.params,
    });

    return res.status(e.status || 500).json({
      ok: false,
      code: e.code || "CASH_REGISTER_CLOSE_ERROR",
      message: e.message || "No se pudo cerrar la caja.",
      data: e.data || null,
    });
  }
}

// ──────────────────────────────────────────────────────────────
// Reglas de auditoría.
// Si en el futuro se sacan a settings por branch/org, centralizarlas acá.
// ──────────────────────────────────────────────────────────────
const AUDIT_MAX_SESSION_HOURS = 8;           // límite de turno
const AUDIT_MAX_SESSION_MINUTES = AUDIT_MAX_SESSION_HOURS * 60;
const AUDIT_SHORTAGE_SEVERE_PCT = 0.10;      // >10% del fondo → grave
const AUDIT_SHORTAGE_SEVERE_ABS = 5000;      // o > $5.000 absoluto
const AUDIT_SURPLUS_BIG_PCT = 0.05;          // >5% del fondo → sobrante sospechoso
const AUDIT_SURPLUS_BIG_ABS = 1000;          // o > $1.000 absoluto
const AUDIT_BIG_OUT_PCT = 0.20;              // egresos > 20% fondo
const AUDIT_BIG_OUT_MIN = 500;               // y > $500 absoluto

function computeAuditFlags(row) {
  const flags = [];
  const opening = Number(row.opening_cash || 0);
  const diff = row.difference_cash != null ? Number(row.difference_cash) : null;
  const manualOut = Number(row.manual_out || 0);
  const openedAt = row.opened_at ? new Date(row.opened_at).getTime() : null;
  const closedAt = row.closed_at ? new Date(row.closed_at).getTime() : null;
  const isOpen = String(row.status || "").toUpperCase() === "OPEN";
  const referenceEnd = closedAt || Date.now();
  const durationHours = openedAt ? (referenceEnd - openedAt) / 3600000 : 0;

  // Faltante de caja.
  if (diff != null && diff < 0) {
    const absDiff = Math.abs(diff);
    const pct = opening > 0 ? absDiff / opening : 0;
    const severe = absDiff >= AUDIT_SHORTAGE_SEVERE_ABS || pct >= AUDIT_SHORTAGE_SEVERE_PCT;
    flags.push({
      code: "SHORTAGE",
      severity: severe ? "high" : "medium",
      label: severe ? "Faltante grave" : "Faltante",
      detail:
        `Diferencia negativa de $${absDiff.toFixed(2)}` +
        (opening > 0 ? ` (${(pct * 100).toFixed(1)}% del fondo)` : ""),
      value: -absDiff,
    });
  }

  // Sobrante atípico.
  if (diff != null && diff > 0) {
    const pct = opening > 0 ? diff / opening : 0;
    if (diff >= AUDIT_SURPLUS_BIG_ABS || pct >= AUDIT_SURPLUS_BIG_PCT) {
      flags.push({
        code: "SURPLUS",
        severity: "medium",
        label: "Sobrante atípico",
        detail:
          `Diferencia positiva de $${diff.toFixed(2)}` +
          (opening > 0 ? ` (${(pct * 100).toFixed(1)}% del fondo)` : ""),
        value: diff,
      });
    }
  }

  // Excedió el turno de 8h.
  if (durationHours > AUDIT_MAX_SESSION_HOURS) {
    flags.push({
      code: isOpen ? "LONG_OPEN" : "OVERTIME",
      severity: isOpen ? "high" : "medium",
      label: isOpen ? "Sesión abierta excedida" : "Turno excedido",
      detail: `${durationHours.toFixed(1)}h abierta · límite ${AUDIT_MAX_SESSION_HOURS}h`,
      value: durationHours,
    });
  }

  // Egresos manuales grandes frente al fondo.
  if (
    opening > 0 &&
    manualOut > AUDIT_BIG_OUT_MIN &&
    manualOut > opening * AUDIT_BIG_OUT_PCT
  ) {
    flags.push({
      code: "BIG_MANUAL_OUT",
      severity: "low",
      label: "Egresos manuales altos",
      detail: `$${manualOut.toFixed(2)} en egresos (${((manualOut / opening) * 100).toFixed(0)}% del fondo)`,
      value: manualOut,
    });
  }

  const severityRank = { high: 3, medium: 2, low: 1 };
  const topSeverity = flags.reduce(
    (top, f) => (severityRank[f.severity] > severityRank[top] ? f.severity : top),
    "low"
  );

  return {
    flags,
    has_alerts: flags.length > 0,
    top_severity: flags.length ? topSeverity : null,
  };
}

// ──────────────────────────────────────────────────────────────
// ADMIN LIST: listado completo de cajas con filtros, paginación, KPIs
// y auditoría automática (faltantes / sobrantes / turnos excedidos).
//
// Query params:
//   status        : "OPEN" | "CLOSED" | "ALL" (default ALL)
//   branch_id     : number (opcional)
//   user_id       : number (opcional) — filtra por cajero que abrió
//   date_from     : ISO date (opcional) — filtro sobre opened_at
//   date_to       : ISO date (opcional)
//   q             : string — busca en nombre de cajero, email, notas
//   alerts_only   : "1" — solo cajas con alertas
//   overtime_only : "1" — solo cajas que pasaron las 8h
//   shortage_only : "1" — solo cajas con faltante
//   page, limit   : paginación (default 1, 25)
// ──────────────────────────────────────────────────────────────
async function adminList(req, res, next) {
  try {
    const toInt = (v, d = 0) => {
      const n = parseInt(String(v ?? ""), 10);
      return Number.isFinite(n) ? n : d;
    };

    // Scope efectivo:
    //  - super_admin: ve todas las cajas (puede filtrar con ?branch_id=, ?user_id=)
    //  - branch admin: ve solo cajas de su sucursal activa (no puede salirse)
    //  - cajero / otros: ve solo SUS propias cajas (opened_by = userId)
    const superAdmin  = access.isSuperAdmin(req);
    const branchAdmin = access.isBranchAdmin(req); // incluye super_admin
    const isCajero    = !branchAdmin;

    const ctxBranchId = toInt(req?.ctx?.branchId, 0) || getAuthBranchId(req);
    const ctxUserId   = getAuthUserId(req);

    const statusRaw = String(req.query?.status || "ALL").toUpperCase();
    const status = ["OPEN", "CLOSED"].includes(statusRaw) ? statusRaw : null;
    const branchIdQuery = toInt(req.query?.branch_id, 0);
    const userIdQuery   = toInt(req.query?.user_id, 0);
    const dateFrom = String(req.query?.date_from || "").trim();
    const dateTo = String(req.query?.date_to || "").trim();
    const q = String(req.query?.q || "").trim();
    const alertsOnly = String(req.query?.alerts_only || "") === "1";
    const overtimeOnly = String(req.query?.overtime_only || "") === "1";
    const shortageOnly = String(req.query?.shortage_only || "") === "1";
    const page = Math.max(1, toInt(req.query?.page, 1));
    const limit = Math.min(200, Math.max(1, toInt(req.query?.limit, 25)));
    const offset = (page - 1) * limit;

    // Construcción de WHERE dinámico con replacements seguros.
    const where = [];
    const repl = {};

    if (status) {
      where.push("cr.status = :status");
      repl.status = status;
    }

    // Resolver branchId efectivo según rol.
    let effectiveBranchId = 0;
    if (superAdmin) {
      effectiveBranchId = branchIdQuery; // 0 = sin filtro
    } else {
      // branch admin / cajero: forzado a su sucursal activa
      effectiveBranchId = ctxBranchId;
      if (!effectiveBranchId) {
        return res.status(400).json({
          ok: false,
          code: "BRANCH_REQUIRED",
          message: "No se pudo determinar la sucursal del usuario.",
        });
      }
    }
    if (effectiveBranchId) {
      where.push("cr.branch_id = :branchId");
      repl.branchId = effectiveBranchId;
    }

    // Resolver userId efectivo:
    //  - cajero: forzado a SUS cajas (no puede ver las de otros)
    //  - branch admin / super_admin: opcional ?user_id=
    let effectiveUserId = 0;
    if (isCajero) {
      effectiveUserId = ctxUserId;
      if (!effectiveUserId) {
        return res.status(401).json({
          ok: false,
          code: "AUTH_REQUIRED",
          message: "No se pudo determinar el usuario autenticado.",
        });
      }
    } else if (userIdQuery) {
      effectiveUserId = userIdQuery;
    }
    if (effectiveUserId) {
      where.push("cr.opened_by = :userId");
      repl.userId = effectiveUserId;
    }
    if (dateFrom) {
      where.push("cr.opened_at >= :dateFrom");
      repl.dateFrom = dateFrom;
    }
    if (dateTo) {
      where.push("cr.opened_at <= :dateTo");
      repl.dateTo = dateTo;
    }
    if (q) {
      where.push(`(
        u.email LIKE :q
        OR u.username LIKE :q
        OR CONCAT_WS(' ', u.first_name, u.last_name) LIKE :q
        OR cr.opening_note LIKE :q
        OR cr.closing_note LIKE :q
      )`);
      repl.q = `%${q}%`;
    }

    // Reglas de auditoría (mismos umbrales que computeAuditFlags).
    const OVERTIME_EXPR = `(TIMESTAMPDIFF(MINUTE, cr.opened_at, IFNULL(cr.closed_at, NOW())) > ${AUDIT_MAX_SESSION_MINUTES})`;
    const SHORTAGE_EXPR = `(cr.difference_cash IS NOT NULL AND cr.difference_cash < 0)`;
    const SURPLUS_EXPR = `(
      cr.difference_cash IS NOT NULL AND cr.difference_cash > 0
      AND (
        cr.difference_cash >= ${AUDIT_SURPLUS_BIG_ABS}
        OR (cr.opening_cash > 0 AND cr.difference_cash >= cr.opening_cash * ${AUDIT_SURPLUS_BIG_PCT})
      )
    )`;
    const ANY_ALERT_EXPR = `(${OVERTIME_EXPR} OR ${SHORTAGE_EXPR} OR ${SURPLUS_EXPR})`;

    if (shortageOnly) where.push(SHORTAGE_EXPR);
    if (overtimeOnly) where.push(OVERTIME_EXPR);
    if (alertsOnly && !shortageOnly && !overtimeOnly) where.push(ANY_ALERT_EXPR);

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    // Count total
    const countRows = await sequelize.query(
      `
        SELECT COUNT(*) AS total
        FROM cash_registers cr
        LEFT JOIN users u ON u.id = cr.opened_by
        ${whereSql}
      `,
      { replacements: repl, type: sequelize.QueryTypes.SELECT }
    );
    const total = Number(countRows?.[0]?.total || 0);

    // Página solicitada. Incluye datos de apertura/cierre, cajero, branch
    // y métricas de ventas/movimientos calculadas con subqueries.
    const rows = await sequelize.query(
      `
        SELECT
          cr.id,
          cr.branch_id,
          cr.opened_by,
          cr.closed_by,
          cr.status,
          cr.opening_cash,
          cr.opening_note,
          cr.opened_at,
          cr.closing_cash,
          cr.closing_note,
          cr.closed_at,
          cr.expected_cash,
          cr.difference_cash,
          cr.caja_type,
          cr.invoice_mode,
          cr.invoice_type,
          cr.opening_ip,
          cr.created_at,
          NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), '') AS opened_by_name,
          u.email    AS opened_by_email,
          u.username AS opened_by_username,
          NULLIF(TRIM(CONCAT_WS(' ', uc.first_name, uc.last_name)), '') AS closed_by_name,
          uc.email    AS closed_by_email,
          b.name      AS branch_name,
          (
            SELECT COUNT(*) FROM sales s
            WHERE s.cash_register_id = cr.id AND s.status IN ('PAID', 'REFUNDED')
          ) AS sales_count,
          (
            SELECT COALESCE(SUM(s.total), 0) FROM sales s
            WHERE s.cash_register_id = cr.id AND s.status IN ('PAID', 'REFUNDED')
          ) AS sales_total,
          (
            SELECT COUNT(*) FROM sales s
            WHERE s.cash_register_id = cr.id AND s.status = 'CANCELLED'
          ) AS sales_cancelled,
          (
            SELECT COALESCE(SUM(m.amount), 0) FROM cash_movements m
            WHERE m.cash_register_id = cr.id AND m.type = 'IN' AND m.reason <> 'APERTURA_CAJA'
          ) AS manual_in,
          (
            SELECT COALESCE(SUM(m.amount), 0) FROM cash_movements m
            WHERE m.cash_register_id = cr.id AND m.type = 'OUT'
          ) AS manual_out,
          (
            SELECT COUNT(*) FROM cash_movements m
            WHERE m.cash_register_id = cr.id
          ) AS movements_count
        FROM cash_registers cr
        LEFT JOIN users u  ON u.id  = cr.opened_by
        LEFT JOIN users uc ON uc.id = cr.closed_by
        LEFT JOIN branches b ON b.id = cr.branch_id
        ${whereSql}
        ORDER BY
          CASE WHEN cr.status = 'OPEN' THEN 0 ELSE 1 END ASC,
          cr.opened_at DESC
        LIMIT :limit OFFSET :offset
      `,
      {
        replacements: { ...repl, limit, offset },
        type: sequelize.QueryTypes.SELECT,
      }
    );

    const items = (rows || []).map((r) => {
      const base = {
        id: Number(r.id),
        branch_id: Number(r.branch_id),
        branch_name: r.branch_name || `Sucursal #${r.branch_id}`,
        opened_by: Number(r.opened_by),
        opened_by_name:
          r.opened_by_name || r.opened_by_username || r.opened_by_email || `Usuario #${r.opened_by}`,
        opened_by_email: r.opened_by_email || null,
        closed_by: r.closed_by ? Number(r.closed_by) : null,
        closed_by_name: r.closed_by_name || r.closed_by_email || null,
        status: r.status,
        opening_cash: Number(r.opening_cash || 0),
        opening_note: r.opening_note || null,
        opened_at: r.opened_at,
        closing_cash: r.closing_cash != null ? Number(r.closing_cash) : null,
        closing_note: r.closing_note || null,
        closed_at: r.closed_at || null,
        expected_cash: r.expected_cash != null ? Number(r.expected_cash) : null,
        difference_cash: r.difference_cash != null ? Number(r.difference_cash) : null,
        caja_type: r.caja_type || null,
        invoice_mode: r.invoice_mode || null,
        invoice_type: r.invoice_type || null,
        opening_ip: r.opening_ip || null,
        sales_count: Number(r.sales_count || 0),
        sales_total: Number(r.sales_total || 0),
        sales_cancelled: Number(r.sales_cancelled || 0),
        manual_in: Number(r.manual_in || 0),
        manual_out: Number(r.manual_out || 0),
        movements_count: Number(r.movements_count || 0),
      };
      const audit = computeAuditFlags(base);
      return { ...base, audit };
    });

    // KPIs globales (no filtrados por página, sí por filtros aplicados).
    const kpiRows = await sequelize.query(
      `
        SELECT
          SUM(CASE WHEN cr.status = 'OPEN' THEN 1 ELSE 0 END)   AS open_count,
          SUM(CASE WHEN cr.status = 'CLOSED' THEN 1 ELSE 0 END) AS closed_count,
          COALESCE(SUM(CASE WHEN cr.status = 'CLOSED' THEN cr.difference_cash ELSE 0 END), 0) AS total_difference,
          COALESCE(SUM(cr.opening_cash), 0) AS total_opening,
          SUM(CASE WHEN ${SHORTAGE_EXPR} THEN 1 ELSE 0 END) AS shortage_count,
          COALESCE(SUM(CASE WHEN ${SHORTAGE_EXPR} THEN cr.difference_cash ELSE 0 END), 0) AS shortage_total,
          SUM(CASE WHEN ${OVERTIME_EXPR} THEN 1 ELSE 0 END) AS overtime_count,
          SUM(CASE WHEN ${ANY_ALERT_EXPR} THEN 1 ELSE 0 END) AS alerts_count
        FROM cash_registers cr
        LEFT JOIN users u ON u.id = cr.opened_by
        ${whereSql}
      `,
      { replacements: repl, type: sequelize.QueryTypes.SELECT }
    );

    // KPIs del día de hoy. Aplico el mismo scope que la lista para coherencia.
    //  - super_admin sin filtros: vista global.
    //  - branch admin / cajero: scope obligatorio a su sucursal (y a su userId si es cajero).
    const todayBranchSql = effectiveBranchId ? "AND branch_id = :branchId" : "";
    const todaySaleBranchSql = effectiveBranchId ? "AND s.branch_id = :branchId" : "";
    const todayUserSql = effectiveUserId ? "AND opened_by = :userId" : "";
    const todaySaleUserSql = effectiveUserId ? "AND s.user_id = :userId" : "";
    const todayRows = await sequelize.query(
      `
        SELECT
          (
            SELECT COUNT(*) FROM cash_registers
            WHERE status = 'OPEN'
              ${todayBranchSql}
              ${todayUserSql}
          ) AS open_now,
          (
            SELECT COUNT(*) FROM cash_registers
            WHERE status = 'CLOSED'
              AND DATE(closed_at) = CURDATE()
              ${todayBranchSql}
              ${todayUserSql}
          ) AS closed_today,
          (
            SELECT COALESCE(SUM(difference_cash), 0) FROM cash_registers
            WHERE status = 'CLOSED'
              AND DATE(closed_at) = CURDATE()
              ${todayBranchSql}
              ${todayUserSql}
          ) AS difference_today,
          (
            SELECT COALESCE(SUM(s.total), 0) FROM sales s
            WHERE s.status IN ('PAID', 'REFUNDED')
              AND DATE(s.sold_at) = CURDATE()
              ${todaySaleBranchSql}
              ${todaySaleUserSql}
          ) AS sales_total_today
      `,
      {
        type: sequelize.QueryTypes.SELECT,
        replacements: {
          ...(effectiveBranchId ? { branchId: effectiveBranchId } : {}),
          ...(effectiveUserId   ? { userId: effectiveUserId } : {}),
        },
      }
    );

    return res.json({
      ok: true,
      data: items,
      meta: {
        page,
        limit,
        total,
        has_more: offset + items.length < total,
      },
      kpis: {
        filtered_open:  Number(kpiRows?.[0]?.open_count || 0),
        filtered_closed: Number(kpiRows?.[0]?.closed_count || 0),
        filtered_difference: Number(kpiRows?.[0]?.total_difference || 0),
        filtered_opening: Number(kpiRows?.[0]?.total_opening || 0),
        filtered_alerts: Number(kpiRows?.[0]?.alerts_count || 0),
        filtered_shortage_count: Number(kpiRows?.[0]?.shortage_count || 0),
        filtered_shortage_total: Number(kpiRows?.[0]?.shortage_total || 0),
        filtered_overtime: Number(kpiRows?.[0]?.overtime_count || 0),
        open_now:        Number(todayRows?.[0]?.open_now || 0),
        closed_today:    Number(todayRows?.[0]?.closed_today || 0),
        difference_today: Number(todayRows?.[0]?.difference_today || 0),
        sales_total_today: Number(todayRows?.[0]?.sales_total_today || 0),
      },
      audit_thresholds: {
        max_session_hours: AUDIT_MAX_SESSION_HOURS,
        shortage_severe_pct: AUDIT_SHORTAGE_SEVERE_PCT,
        shortage_severe_abs: AUDIT_SHORTAGE_SEVERE_ABS,
        surplus_big_pct: AUDIT_SURPLUS_BIG_PCT,
        surplus_big_abs: AUDIT_SURPLUS_BIG_ABS,
      },
    });
  } catch (e) {
    console.error("[cashRegisters.adminList] error:", e);
    next(e);
  }
}

// ──────────────────────────────────────────────────────────────
// ADMIN FORCE CLOSE
// Cierra una caja OPEN sin importar el dueño (solo admin/super_admin).
// Ofrece dos modos:
//   - body.mode === "neutral" (default): declared = expected → diferencia 0
//   - body.mode === "expected_real": calcula expected_cash desde ventas/movs
//     y cierra con declared = expected_real → también diferencia 0 pero
//     reflejando el cash real esperado (más correcto si tuvo ventas).
// ──────────────────────────────────────────────────────────────
async function adminForceClose(req, res) {
  const t = await sequelize.transaction();
  try {
    if (!access.isBranchAdmin(req)) {
      await t.rollback();
      return res.status(403).json({
        ok: false,
        code: "FORBIDDEN",
        message: "Solo administradores pueden cerrar cajas de otros usuarios.",
      });
    }

    const id = parseInt(req.params.id, 10);
    if (!id) {
      await t.rollback();
      return res.status(400).json({ ok: false, code: "BAD_ID", message: "id inválido" });
    }

    const { CashRegister, Sale, Payment, CashMovement } = require("../models");

    const cr = await CashRegister.findByPk(id, { transaction: t });
    if (!cr) {
      await t.rollback();
      return res.status(404).json({ ok: false, code: "CASH_REGISTER_NOT_FOUND", message: "Caja no encontrada." });
    }

    // Branch admin: solo puede cerrar cajas de sus sucursales habilitadas.
    if (!access.isSuperAdmin(req)) {
      const allowed = access.getAllowedBranchIds(req);
      if (!allowed.includes(parseInt(cr.branch_id, 10))) {
        await t.rollback();
        return res.status(403).json({
          ok: false,
          code: "FORBIDDEN_BRANCH",
          message: "No podés cerrar cajas de otra sucursal.",
        });
      }
    }

    if (String(cr.status) !== "OPEN") {
      await t.rollback();
      return res.status(409).json({
        ok: false,
        code: "ALREADY_CLOSED",
        message: "La caja ya está cerrada.",
      });
    }

    const mode = String(req.body?.mode || "neutral").toLowerCase();
    const reason = String(req.body?.reason || "").trim();
    const closed_by = parseInt(req.user?.id || req.user?.sub || 0, 10) || cr.opened_by;
    const opening = Number(cr.opening_cash || 0);

    let expectedCash = opening;
    if (mode === "expected_real") {
      // Recalcular expected = opening + cash_sales + manual_in − manual_out
      const { Op } = require("sequelize");
      const [cashRow] = await sequelize.query(
        `SELECT COALESCE(SUM(p.amount),0) AS cash_total
         FROM payments p
         INNER JOIN sales s ON s.id = p.sale_id
         WHERE s.cash_register_id = :id
           AND s.status IN ('PAID','REFUNDED')
           AND UPPER(p.method) IN ('CASH','EFECTIVO')`,
        { type: sequelize.QueryTypes.SELECT, replacements: { id }, transaction: t }
      );
      const [movsRow] = await sequelize.query(
        `SELECT
           COALESCE(SUM(CASE WHEN type='IN' AND reason <> 'APERTURA_CAJA' THEN amount ELSE 0 END),0) AS manual_in,
           COALESCE(SUM(CASE WHEN type='OUT' THEN amount ELSE 0 END),0) AS manual_out
         FROM cash_movements
         WHERE cash_register_id = :id`,
        { type: sequelize.QueryTypes.SELECT, replacements: { id }, transaction: t }
      );
      expectedCash = Number(opening) + Number(cashRow?.cash_total || 0)
        + Number(movsRow?.manual_in || 0) - Number(movsRow?.manual_out || 0);
    }

    const closingNote = [
      cr.closing_note,
      `Cierre administrativo forzado (${mode}) por user #${closed_by} el ${new Date().toISOString()}`,
      reason ? `Motivo: ${reason}` : null,
    ].filter(Boolean).join(" | ");

    await cr.update(
      {
        status: "CLOSED",
        closed_by,
        closed_at: new Date(),
        closing_cash: expectedCash,
        expected_cash: expectedCash,
        difference_cash: 0,
        closing_note: closingNote,
      },
      {
        transaction: t,
        fields: ["status", "closed_by", "closed_at", "closing_cash", "expected_cash", "difference_cash", "closing_note"],
      }
    );

    await t.commit();

    // Hook de Telegram (post-commit, fire-and-forget).
    try {
      const tg = require("../services/telegramNotifier.service");
      tg.notifyCashRegisterClose({ cash_register_id: id }).catch(() => {});
    } catch (_) {}

    return res.json({
      ok: true,
      message: "Caja cerrada por administrador.",
      data: { id, expected_cash: expectedCash, mode },
    });
  } catch (e) {
    try { await t.rollback(); } catch {}
    console.error("[cashRegisters.adminForceClose] error:", e);
    return res.status(500).json({
      ok: false,
      code: "ADMIN_CLOSE_ERROR",
      message: e?.message || "No se pudo cerrar la caja.",
    });
  }
}

// ──────────────────────────────────────────────────────────────
// ADMIN DELETE
// Hard-delete de una sesión de caja (solo admin/super_admin).
// Por defecto la caja debe estar CERRADA (no permite borrar OPEN).
// Borra: cash_movements asociados, payments y sale_items de las ventas
// asociadas, y las propias ventas. Esta operación es irreversible.
//
// Si la caja tiene ventas, requiere ?force=1 para confirmar el borrado
// completo (similar al patrón de deleteSale).
// ──────────────────────────────────────────────────────────────
async function adminDelete(req, res) {
  const t = await sequelize.transaction();
  try {
    if (!access.isBranchAdmin(req)) {
      await t.rollback();
      return res.status(403).json({
        ok: false,
        code: "FORBIDDEN",
        message: "Solo administradores pueden eliminar cajas.",
      });
    }

    const id = parseInt(req.params.id, 10);
    if (!id) {
      await t.rollback();
      return res.status(400).json({ ok: false, code: "BAD_ID", message: "id inválido" });
    }

    const { CashRegister } = require("../models");
    const cr = await CashRegister.findByPk(id, { transaction: t });
    if (!cr) {
      await t.rollback();
      return res.status(404).json({ ok: false, code: "CASH_REGISTER_NOT_FOUND", message: "Caja no encontrada." });
    }

    if (!access.isSuperAdmin(req)) {
      const allowed = access.getAllowedBranchIds(req);
      if (!allowed.includes(parseInt(cr.branch_id, 10))) {
        await t.rollback();
        return res.status(403).json({
          ok: false,
          code: "FORBIDDEN_BRANCH",
          message: "No podés eliminar cajas de otra sucursal.",
        });
      }
    }

    if (String(cr.status) === "OPEN") {
      await t.rollback();
      return res.status(409).json({
        ok: false,
        code: "CANNOT_DELETE_OPEN",
        message: "Cerrá la caja antes de eliminarla. Podés usar el cierre administrativo.",
      });
    }

    const force = String(req.query.force || "0") === "1";

    // Contar ventas y movimientos para advertir / requerir force.
    const [salesCount] = await sequelize.query(
      `SELECT COUNT(*) AS n FROM sales WHERE cash_register_id = :id`,
      { type: sequelize.QueryTypes.SELECT, replacements: { id }, transaction: t }
    );
    const totalSales = Number(salesCount?.n || 0);

    if (totalSales > 0 && !force) {
      await t.rollback();
      return res.status(409).json({
        ok: false,
        code: "CASH_REGISTER_HAS_SALES",
        message: `Esta caja tiene ${totalSales} venta(s) asociada(s). Si eliminás la caja se borran también las ventas, pagos e items. Usá ?force=1 para confirmar.`,
        data: { total_sales: totalSales },
      });
    }

    // Borrado en cascada (orden importante para FKs).
    if (totalSales > 0) {
      await sequelize.query(
        `DELETE p FROM payments p
         INNER JOIN sales s ON s.id = p.sale_id
         WHERE s.cash_register_id = :id`,
        { replacements: { id }, transaction: t }
      );
      await sequelize.query(
        `DELETE si FROM sale_items si
         INNER JOIN sales s ON s.id = si.sale_id
         WHERE s.cash_register_id = :id`,
        { replacements: { id }, transaction: t }
      );
      await sequelize.query(
        `DELETE FROM sales WHERE cash_register_id = :id`,
        { replacements: { id }, transaction: t }
      );
    }

    await sequelize.query(
      `DELETE FROM cash_movements WHERE cash_register_id = :id`,
      { replacements: { id }, transaction: t }
    );

    await cr.destroy({ transaction: t });

    await t.commit();
    return res.json({
      ok: true,
      message: `Caja #${id} eliminada${totalSales > 0 ? ` junto con ${totalSales} venta(s)` : ""}.`,
      data: { id, deleted_sales: totalSales },
    });
  } catch (e) {
    try { await t.rollback(); } catch {}
    console.error("[cashRegisters.adminDelete] error:", e);
    return res.status(500).json({
      ok: false,
      code: "ADMIN_DELETE_ERROR",
      message: e?.message || "No se pudo eliminar la caja.",
    });
  }
}

module.exports = {
  getCurrent,
  open,
  addMovement,
  getSummary,
  close,
  adminList,
  adminForceClose,
  adminDelete,
};