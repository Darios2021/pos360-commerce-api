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
// ADMIN LIST: listado completo de cajas con filtros, paginación y KPIs.
// Usado por la vista de supervisión.
//
// Query params:
//   status      : "OPEN" | "CLOSED" | "ALL" (default ALL)
//   branch_id   : number (opcional)
//   user_id     : number (opcional) — filtra por cajero que abrió
//   date_from   : ISO date (opcional) — filtro sobre opened_at
//   date_to     : ISO date (opcional)
//   q           : string — busca en nombre de cajero, email, notas
//   page, limit : paginación (default 1, 25)
// ──────────────────────────────────────────────────────────────
async function adminList(req, res, next) {
  try {
    const toInt = (v, d = 0) => {
      const n = parseInt(String(v ?? ""), 10);
      return Number.isFinite(n) ? n : d;
    };

    const statusRaw = String(req.query?.status || "ALL").toUpperCase();
    const status = ["OPEN", "CLOSED"].includes(statusRaw) ? statusRaw : null;
    const branchId = toInt(req.query?.branch_id, 0);
    const userId = toInt(req.query?.user_id, 0);
    const dateFrom = String(req.query?.date_from || "").trim();
    const dateTo = String(req.query?.date_to || "").trim();
    const q = String(req.query?.q || "").trim();
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
    if (branchId) {
      where.push("cr.branch_id = :branchId");
      repl.branchId = branchId;
    }
    if (userId) {
      where.push("cr.opened_by = :userId");
      repl.userId = userId;
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

    const items = (rows || []).map((r) => ({
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
    }));

    // KPIs globales (no filtrados por página, sí por filtros aplicados).
    const kpiRows = await sequelize.query(
      `
        SELECT
          SUM(CASE WHEN cr.status = 'OPEN' THEN 1 ELSE 0 END)   AS open_count,
          SUM(CASE WHEN cr.status = 'CLOSED' THEN 1 ELSE 0 END) AS closed_count,
          COALESCE(SUM(CASE WHEN cr.status = 'CLOSED' THEN cr.difference_cash ELSE 0 END), 0) AS total_difference,
          COALESCE(SUM(cr.opening_cash), 0) AS total_opening
        FROM cash_registers cr
        LEFT JOIN users u ON u.id = cr.opened_by
        ${whereSql}
      `,
      { replacements: repl, type: sequelize.QueryTypes.SELECT }
    );

    // KPIs del día de hoy (independientes de filtros).
    const todayRows = await sequelize.query(
      `
        SELECT
          (
            SELECT COUNT(*) FROM cash_registers
            WHERE status = 'OPEN'
          ) AS open_now,
          (
            SELECT COUNT(*) FROM cash_registers
            WHERE status = 'CLOSED'
              AND DATE(closed_at) = CURDATE()
          ) AS closed_today,
          (
            SELECT COALESCE(SUM(difference_cash), 0) FROM cash_registers
            WHERE status = 'CLOSED'
              AND DATE(closed_at) = CURDATE()
          ) AS difference_today,
          (
            SELECT COALESCE(SUM(s.total), 0) FROM sales s
            WHERE s.status IN ('PAID', 'REFUNDED')
              AND DATE(s.sold_at) = CURDATE()
          ) AS sales_total_today
      `,
      { type: sequelize.QueryTypes.SELECT }
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
        open_now:        Number(todayRows?.[0]?.open_now || 0),
        closed_today:    Number(todayRows?.[0]?.closed_today || 0),
        difference_today: Number(todayRows?.[0]?.difference_today || 0),
        sales_total_today: Number(todayRows?.[0]?.sales_total_today || 0),
      },
    });
  } catch (e) {
    console.error("[cashRegisters.adminList] error:", e);
    next(e);
  }
}

module.exports = {
  getCurrent,
  open,
  addMovement,
  getSummary,
  close,
  adminList,
};