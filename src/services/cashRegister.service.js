// src/services/cashRegister.service.js
console.log("[CASH_REGISTER_SERVICE] cargado · build 2026-04-23-user-priority-v3");
const { Op } = require("sequelize");
const {
  sequelize,
  CashRegister,
  CashMovement,
  Sale,
  Payment,
  Branch,
  User,
  SaleItem,
} = require("../models");

function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}

function toFloat(v, d = 0) {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : d;
}

function upper(v) {
  return String(v || "").trim().toUpperCase();
}

function toPlain(row) {
  if (!row) return row;
  if (typeof row.toJSON === "function") return row.toJSON();
  return row;
}

function getAuthUserId(req) {
  const candidates = [
    req?.user?.id,
    req?.user?.user_id,
    req?.user?.sub,
    req?.auth?.id,
    req?.auth?.userId,
    req?.auth?.user_id,
    req?.jwt?.id,
    req?.jwt?.userId,
    req?.jwt?.sub,
    req?.tokenPayload?.id,
    req?.tokenPayload?.userId,
    req?.tokenPayload?.sub,
    req?.session?.user?.id,
    req?.session?.userId,
    req?.userId,
    req?.usuario?.id,
    req?.usuario?.userId,
    req?.usuario?.user_id,
  ];

  for (const v of candidates) {
    const n = toInt(v, 0);
    if (n > 0) return n;
  }

  try {
    const h = String(req.headers?.authorization || "");
    const m = h.match(/^Bearer\s+(.+)$/i);
    const token = m?.[1];
    if (!token) return 0;

    const parts = token.split(".");
    if (parts.length !== 3) return 0;

    const payloadB64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payloadJson = Buffer.from(payloadB64, "base64").toString("utf8");
    const payload = JSON.parse(payloadJson);

    return (
      toInt(payload?.id, 0) ||
      toInt(payload?.userId, 0) ||
      toInt(payload?.user_id, 0) ||
      toInt(payload?.sub, 0) ||
      0
    );
  } catch {
    return 0;
  }
}

function getAuthBranchId(req) {
  return (
    toInt(req?.ctx?.branchId, 0) ||
    toInt(req?.ctx?.branch_id, 0) ||
    toInt(req?.user?.branch_id, 0) ||
    toInt(req?.user?.branchId, 0) ||
    toInt(req?.auth?.branch_id, 0) ||
    toInt(req?.auth?.branchId, 0) ||
    toInt(req?.usuario?.branch_id, 0) ||
    toInt(req?.usuario?.branchId, 0) ||
    toInt(req?.branch?.id, 0) ||
    toInt(req?.branchId, 0) ||
    toInt(req?.branchContext?.branch_id, 0) ||
    toInt(req?.branchContext?.id, 0) ||
    toInt(req?.body?.branch_id, 0) ||
    toInt(req?.body?.branchId, 0) ||
    toInt(req?.query?.branch_id, 0) ||
    toInt(req?.query?.branchId, 0) ||
    0
  );
}

function normalizeCajaType(v) {
  const x = upper(v);
  if (!x) return "";
  if (["GENERAL", "SHIFT", "BRANCH", "MOBILE"].includes(x)) return x;
  return "";
}

function normalizeInvoiceMode(v) {
  const x = upper(v);
  if (!x) return "";
  if (["NO_FISCAL", "FISCAL", "MIXED", "TICKET_ONLY"].includes(x)) return x;
  return "";
}

function normalizeInvoiceType(v) {
  const x = upper(v);
  if (!x) return "";
  if (["TICKET", "A", "B", "C", "NC"].includes(x)) return x;
  return "";
}

function normalizeMovementType(v) {
  const x = upper(v);
  if (x === "OUT") return "OUT";
  return "IN";
}

async function getCurrentOpenCashRegister({
  branch_id,
  user_id = null,
  transaction = null,
}) {
  const bid = toInt(branch_id, 0);
  const uid = toInt(user_id, 0);

  // 1) Con user_id: devolver SOLO la caja propia del usuario.
  //    Política: 1 caja por usuario, y cada usuario opera únicamente sobre la suya.
  //    No hacemos fallback por branch: si el user no abrió caja, no debe quedar
  //    "enganchado" a la caja de otro cajero (eso haría que sus ventas se
  //    imputaran a la caja de otro y confundía la UI mostrando sesión ajena).
  if (uid) {
    const byUser = await CashRegister.findOne({
      where: { opened_by: uid, status: "OPEN" },
      order: [["opened_at", "DESC"], ["id", "DESC"]],
      transaction,
    });
    console.log("[getCurrentOpenCashRegister] lookup by user", {
      uid,
      requestedBranch: bid,
      found: byUser?.id || null,
      cashRegisterBranch: byUser?.branch_id || null,
    });
    return byUser || null;
  }

  // 2) Sin user_id: búsqueda por branch.
  //    Solo para chequeos internos (ej. assertNoOtherCashRegisterOpen).
  if (bid) {
    const byBranch = await CashRegister.findOne({
      where: { branch_id: bid, status: "OPEN" },
      order: [["opened_at", "DESC"], ["id", "DESC"]],
      transaction,
    });
    if (byBranch) {
      console.log("[getCurrentOpenCashRegister] ✓ match by branch", {
        bid,
        cashRegisterId: byBranch.id,
        cashRegisterOpenedBy: byBranch.opened_by,
      });
      return byBranch;
    }
  }

  console.log("[getCurrentOpenCashRegister] ✗ no match", { bid, uid });
  return null;
}

async function getOpenCashRegisterOrThrow({ branch_id, transaction = null }) {
  const cashRegister = await getCurrentOpenCashRegister({ branch_id, transaction });
  if (!cashRegister) {
    const err = new Error("No hay caja abierta para esta sucursal.");
    err.status = 409;
    err.code = "CAJA_NO_ABIERTA";
    throw err;
  }
  return cashRegister;
}

async function assertUserHasNoOtherCashRegisterOpen({ user_id, transaction = null }) {
  const uid = toInt(user_id, 0);
  if (!uid) return;

  const current = await CashRegister.findOne({
    where: { opened_by: uid, status: "OPEN" },
    order: [["opened_at", "DESC"], ["id", "DESC"]],
    transaction,
  });

  if (current) {
    const err = new Error(
      "Ya tenés una caja abierta. Cerrala antes de abrir otra."
    );
    err.status = 409;
    err.code = "CAJA_USUARIO_YA_ABIERTA";
    err.data = {
      cash_register_id: current.id,
      branch_id: current.branch_id,
      opened_at: current.opened_at,
    };
    throw err;
  }
}

async function assertNoOtherCashRegisterOpen({ branch_id, transaction = null }) {
  const current = await getCurrentOpenCashRegister({ branch_id, transaction });
  if (current) {
    const err = new Error("Ya existe una caja abierta para esta sucursal.");
    err.status = 409;
    err.code = "CAJA_YA_ABIERTA";
    err.data = { cash_register_id: current.id };
    throw err;
  }
  return true;
}

async function createOpeningMovement({
  cash_register_id,
  user_id,
  amount,
  note,
  transaction = null,
}) {
  const openingAmount = Number(toFloat(amount, 0).toFixed(2));
  if (openingAmount <= 0) return null;

  return CashMovement.create(
    {
      cash_register_id,
      user_id,
      type: "IN",
      reason: "APERTURA_CAJA",
      note: note || "Apertura de caja",
      amount: openingAmount,
      happened_at: new Date(),
    },
    { transaction }
  );
}

async function openCashRegister({
  branch_id,
  opened_by,
  opening_cash,
  opening_note,
  opening_ip = null,
  caja_type,
  invoice_mode,
  invoice_type,
  transaction = null,
}) {
  const branchId = toInt(branch_id, 0);
  const userId = toInt(opened_by, 0);
  const openingCash = Number(toFloat(opening_cash, 0).toFixed(2));
  const cajaType = normalizeCajaType(caja_type);
  const invoiceMode = normalizeInvoiceMode(invoice_mode);
  const invoiceType = normalizeInvoiceType(invoice_type);

  if (!branchId) {
    const err = new Error("branch_id es requerido.");
    err.status = 400;
    err.code = "BRANCH_REQUIRED";
    throw err;
  }

  if (!userId) {
    const err = new Error("No se pudo determinar el usuario autenticado.");
    err.status = 401;
    err.code = "AUTH_REQUIRED";
    throw err;
  }

  if (!cajaType) {
    const err = new Error("caja_type inválido.");
    err.status = 400;
    err.code = "BAD_CAJA_TYPE";
    throw err;
  }

  if (!invoiceMode) {
    const err = new Error("invoice_mode inválido.");
    err.status = 400;
    err.code = "BAD_INVOICE_MODE";
    throw err;
  }

  if (!invoiceType) {
    const err = new Error("invoice_type inválido.");
    err.status = 400;
    err.code = "BAD_INVOICE_TYPE";
    throw err;
  }

  // Política: un usuario solo puede tener UNA caja abierta a la vez
  // (independiente de la branch). Evita "cajas zombies" al cambiar de sucursal.
  await assertUserHasNoOtherCashRegisterOpen({ user_id: userId, transaction });
  await assertNoOtherCashRegisterOpen({ branch_id: branchId, transaction });

  const cashRegister = await CashRegister.create(
    {
      branch_id: branchId,
      opened_by: userId,
      status: "OPEN",
      opening_cash: openingCash,
      opening_note: opening_note || null,
      opening_ip: opening_ip ? String(opening_ip).slice(0, 45) : null,
      opened_at: new Date(),
      caja_type: cajaType,
      invoice_mode: invoiceMode,
      invoice_type: invoiceType,
    },
    { transaction }
  );

  await createOpeningMovement({
    cash_register_id: cashRegister.id,
    user_id: userId,
    amount: openingCash,
    note: opening_note || "Apertura de caja",
    transaction,
  });

  return cashRegister;
}

async function createManualCashMovement({
  cash_register_id,
  user_id,
  type,
  reason,
  note,
  amount,
  transaction = null,
}) {
  const registerId = toInt(cash_register_id, 0);
  const userId = toInt(user_id, 0);
  const normalizedType = normalizeMovementType(type);
  const numericAmount = Number(toFloat(amount, 0).toFixed(2));
  const cleanReason = String(reason || "").trim();

  if (!registerId) {
    const err = new Error("cash_register_id inválido.");
    err.status = 400;
    err.code = "BAD_CASH_REGISTER_ID";
    throw err;
  }

  if (!userId) {
    const err = new Error("No se pudo determinar el usuario autenticado.");
    err.status = 401;
    err.code = "AUTH_REQUIRED";
    throw err;
  }

  if (!cleanReason) {
    const err = new Error("reason es requerido.");
    err.status = 400;
    err.code = "REASON_REQUIRED";
    throw err;
  }

  if (!(numericAmount > 0)) {
    const err = new Error("amount debe ser mayor a 0.");
    err.status = 400;
    err.code = "BAD_AMOUNT";
    throw err;
  }

  const cashRegister = await CashRegister.findByPk(registerId, { transaction });
  if (!cashRegister) {
    const err = new Error("Caja no encontrada.");
    err.status = 404;
    err.code = "CASH_REGISTER_NOT_FOUND";
    throw err;
  }

  if (String(cashRegister.status) !== "OPEN") {
    const err = new Error("La caja no está abierta.");
    err.status = 409;
    err.code = "CASH_REGISTER_NOT_OPEN";
    throw err;
  }

  return CashMovement.create(
    {
      cash_register_id: registerId,
      user_id: userId,
      type: normalizedType,
      reason: cleanReason,
      note: note || null,
      amount: numericAmount,
      happened_at: new Date(),
    },
    { transaction }
  );
}

async function buildCashRegisterSummary({
  cash_register_id,
  transaction = null,
}) {
  const id = toInt(cash_register_id, 0);
  if (!id) {
    const err = new Error("cash_register_id inválido.");
    err.status = 400;
    err.code = "BAD_CASH_REGISTER_ID";
    throw err;
  }

  const cashRegister = await CashRegister.findByPk(id, { transaction });

  if (!cashRegister) {
    const err = new Error("Caja no encontrada.");
    err.status = 404;
    err.code = "CASH_REGISTER_NOT_FOUND";
    throw err;
  }

  // Resolver nombres de cajero y sucursal para el arqueo / PDF
  let cashierName = "";
  let cashierEmail = "";
  let branchName = "";
  try {
    if (User && cashRegister.opened_by) {
      const u = await User.findByPk(cashRegister.opened_by, {
        attributes: ["id", "email", "username", "first_name", "last_name"],
        transaction,
      });
      if (u) {
        const full = [u.first_name, u.last_name]
          .map((x) => String(x || "").trim())
          .filter(Boolean)
          .join(" ");
        cashierName =
          full ||
          String(u.username || "").trim() ||
          String(u.email || "").trim() ||
          "";
        cashierEmail = String(u.email || "").trim();
      }
    }
  } catch (e) {
    console.warn("[CASH_REGISTER_SUMMARY] User load failed", e?.message);
  }

  try {
    if (Branch && cashRegister.branch_id) {
      const b = await Branch.findByPk(cashRegister.branch_id, {
        attributes: ["id", "name"],
        transaction,
      });
      if (b) branchName = String(b.name || "").trim();
    }
  } catch (e) {
    console.warn("[CASH_REGISTER_SUMMARY] Branch load failed", e?.message);
  }

  // Solo ventas activas (PAID / REFUNDED) — CANCELLED queda excluido de los montos
  // Incluye ventas huérfanas (cash_register_id NULL) del mismo branch hechas durante
  // la ventana de apertura de esta caja.
  const branchId = toInt(cashRegister.branch_id, 0);
  const openedAt = cashRegister.opened_at ? new Date(cashRegister.opened_at) : null;
  const closedAt = cashRegister.closed_at ? new Date(cashRegister.closed_at) : null;

  // Cláusula de ventas huérfanas rescatadas por branch + ventana temporal.
  const orphanWhere =
    branchId && openedAt
      ? {
          cash_register_id: null,
          branch_id: branchId,
          sold_at: closedAt
            ? { [Op.between]: [openedAt, closedAt] }
            : { [Op.gte]: openedAt },
        }
      : null;

  // Scope total: { OR: [ { cr_id=id }, { huérfana } ] }
  const scopeOr = orphanWhere
    ? { [Op.or]: [{ cash_register_id: id }, orphanWhere] }
    : { cash_register_id: id };

  console.log("[CASH_REGISTER_SUMMARY] scope →", {
    id,
    branchId,
    openedAt,
    closedAt,
    hasOrphanRescue: !!orphanWhere,
  });

  const sales = await Sale.findAll({
    where: {
      [Op.and]: [scopeOr, { status: { [Op.in]: ["PAID", "REFUNDED"] } }],
    },
    attributes: ["id", "status", "total", "paid_total", "change_total", "sold_at", "cash_register_id", "branch_id"],
    transaction,
  });

  console.log("[CASH_REGISTER_SUMMARY] sales found →", sales.length, sales.map((s) => ({
    id: s.id,
    cr: s.cash_register_id,
    branch: s.branch_id,
    total: s.total,
    sold_at: s.sold_at,
  })));

  const cancelledCount = await Sale.count({
    where: {
      [Op.and]: [scopeOr, { status: "CANCELLED" }],
    },
    transaction,
  });

  // Total de ventas registradas en la sesión (activas + anuladas)
  // Nota: ventas hard-deleted anteriores al fix 2025-04 NO aparecen aquí
  const totalCreated = sales.length + cancelledCount;

  const saleIds = sales.map((s) => toInt(s.id, 0)).filter(Boolean);

  const payments = saleIds.length
    ? await Payment.findAll({
        where: {
          sale_id: {
            [Op.in]: saleIds,
          },
        },
        attributes: ["id", "sale_id", "method", "amount", "installments", "paid_at"],
        transaction,
      })
    : [];

  const movements = await CashMovement.findAll({
    where: {
      cash_register_id: id,
    },
    attributes: ["id", "type", "reason", "note", "amount", "happened_at", "user_id"],
    order: [["happened_at", "ASC"], ["id", "ASC"]],
    transaction,
  });

  const openingCash = Number(cashRegister.opening_cash || 0);

  const manualIn = movements
    .filter((m) => String(m.type) === "IN" && String(m.reason) !== "APERTURA_CAJA")
    .reduce((acc, m) => acc + Number(m.amount || 0), 0);

  const manualOut = movements
    .filter((m) => String(m.type) === "OUT")
    .reduce((acc, m) => acc + Number(m.amount || 0), 0);

  const paymentsByMethod = {};
  const paymentsCountByMethod = {};
  const paymentsBySale = {};
  for (const p of payments) {
    const key = upper(p.method) || "OTHER";
    paymentsByMethod[key] = Number(
      (paymentsByMethod[key] || 0) + Number(p.amount || 0)
    );
    paymentsCountByMethod[key] = Number(paymentsCountByMethod[key] || 0) + 1;

    const sid = toInt(p.sale_id, 0);
    if (sid) {
      if (!paymentsBySale[sid]) paymentsBySale[sid] = [];
      paymentsBySale[sid].push({
        method: key,
        amount: Number(p.amount || 0),
        installments: Number(p.installments || 1) || 1,
        paid_at: p.paid_at,
      });
    }
  }

  // Items (productos) de cada venta — opcional, si SaleItem está disponible
  const itemsBySale = {};
  console.log("[CASH_REGISTER_SUMMARY] SaleItem available?", !!SaleItem, "saleIds:", saleIds);
  if (SaleItem && saleIds.length) {
    try {
      const items = await SaleItem.findAll({
        where: { sale_id: { [Op.in]: saleIds } },
        attributes: [
          "id",
          "sale_id",
          "product_id",
          "product_name_snapshot",
          "quantity",
          "unit_price",
        ],
        transaction,
      });
      console.log("[CASH_REGISTER_SUMMARY] SaleItems loaded:", items.length);
      for (const it of items) {
        const sid = toInt(it.sale_id, 0);
        if (!sid) continue;
        if (!itemsBySale[sid]) itemsBySale[sid] = [];
        itemsBySale[sid].push({
          product_id: toInt(it.product_id, 0),
          name: String(it.product_name_snapshot || "").trim() || "Producto",
          quantity: Number(it.quantity || 0),
          unit_price: Number(it.unit_price || 0),
        });
      }
    } catch (e) {
      console.warn("[CASH_REGISTER_SUMMARY] SaleItem load failed", e?.message, e?.stack);
    }
  }

  // Detalle por venta con sus pagos e items (para arqueo detallado + PDF)
  const salesDetail = sales.map((s) => {
    const sid = toInt(s.id, 0);
    const sPayments = paymentsBySale[sid] || [];
    const primaryMethod = sPayments[0]?.method || "OTHER";
    return {
      id: sid,
      status: String(s.status || ""),
      total: Number(s.total || 0),
      paid_total: Number(s.paid_total || 0),
      change_total: Number(s.change_total || 0),
      sold_at: s.sold_at,
      primary_method: primaryMethod,
      payments: sPayments,
      items: itemsBySale[sid] || [],
    };
  });

  const cashSales = Number(paymentsByMethod.CASH || 0);
  const expectedCash = Number(
    (openingCash + manualIn + cashSales - manualOut).toFixed(2)
  );

  return {
    cash_register: {
      ...toPlain(cashRegister),
      opened_by_name: cashierName || null,
      opened_by_email: cashierEmail || null,
      branch_name: branchName || null,
    },
    totals: {
      opening_cash: openingCash,
      sales_count: sales.length,                    // ventas efectivas (PAID + REFUNDED)
      sales_cancelled_count: cancelledCount,         // ventas anuladas (soft-cancel)
      sales_total_created: totalCreated,             // total creadas en sesión (efectivas + anuladas)
      sales_total: Number(
        sales.reduce((a, s) => a + Number(s.total || 0), 0).toFixed(2)
      ),
      paid_total: Number(
        sales.reduce((a, s) => a + Number(s.paid_total || 0), 0).toFixed(2)
      ),
      manual_in: Number(manualIn.toFixed(2)),
      manual_out: Number(manualOut.toFixed(2)),
      cash_sales: Number(cashSales.toFixed(2)),
      expected_cash: expectedCash,
    },
    payments_by_method: {
      cash: Number(paymentsByMethod.CASH || 0),
      transfer: Number(paymentsByMethod.TRANSFER || 0),
      card: Number(paymentsByMethod.CARD || 0),
      // QR y MERCADOPAGO unificados — pagos viejos guardados como QR se suman acá
      mercadopago: Number((paymentsByMethod.MERCADOPAGO || 0) + (paymentsByMethod.QR || 0)),
      credit_sjt: Number(paymentsByMethod.CREDIT_SJT || 0),
      other: Number(paymentsByMethod.OTHER || 0),
      raw_by_method: paymentsByMethod,
    },
    payments_count_by_method: {
      cash: Number(paymentsCountByMethod.CASH || 0),
      transfer: Number(paymentsCountByMethod.TRANSFER || 0),
      card: Number(paymentsCountByMethod.CARD || 0),
      mercadopago: Number((paymentsCountByMethod.MERCADOPAGO || 0) + (paymentsCountByMethod.QR || 0)),
      credit_sjt: Number(paymentsCountByMethod.CREDIT_SJT || 0),
      other: Number(paymentsCountByMethod.OTHER || 0),
    },
    sales_detail: salesDetail,
    movements: movements.map(toPlain),
    sales: sales.map(toPlain),
  };
}

async function closeCashRegister({
  cash_register_id,
  closed_by,
  closing_cash,
  closing_note,
  closing_declared = null,   // { cash, card, transfer, mercadopago, credit_sjt, other }
  transaction = null,
}) {
  const id = toInt(cash_register_id, 0);
  const userId = toInt(closed_by, 0);
  const closingCash = Number(toFloat(closing_cash, 0).toFixed(2));

  if (!id) {
    const err = new Error("cash_register_id inválido.");
    err.status = 400;
    err.code = "BAD_CASH_REGISTER_ID";
    throw err;
  }

  if (!userId) {
    const err = new Error("No se pudo determinar el usuario autenticado.");
    err.status = 401;
    err.code = "AUTH_REQUIRED";
    throw err;
  }

  try {
    const cashRegister = await CashRegister.findByPk(id, { transaction });

    if (!cashRegister) {
      const err = new Error("Caja no encontrada.");
      err.status = 404;
      err.code = "CASH_REGISTER_NOT_FOUND";
      throw err;
    }

    if (String(cashRegister.status) !== "OPEN") {
      const err = new Error("La caja ya está cerrada.");
      err.status = 409;
      err.code = "CASH_REGISTER_ALREADY_CLOSED";
      throw err;
    }

    const summary = await buildCashRegisterSummary({
      cash_register_id: id,
      transaction,
    });

    const expectedCash = Number(summary?.totals?.expected_cash || 0);
    const differenceCash = Number((closingCash - expectedCash).toFixed(2));

    // Normalizar closing_declared: sanitizar montos y descartar keys no válidas
    let declaredJson = null;
    if (closing_declared && typeof closing_declared === "object") {
      const allowed = ["cash", "card", "transfer", "mercadopago", "credit_sjt", "other"];
      declaredJson = {};
      for (const k of allowed) {
        declaredJson[k] = Number(toFloat(closing_declared[k], 0).toFixed(2));
      }
    }

    cashRegister.set({
      status: "CLOSED",
      closed_by: userId,
      closing_cash: closingCash,
      closing_note: closing_note || null,
      closing_declared: declaredJson,
      closed_at: new Date(),
      expected_cash: expectedCash,
      difference_cash: differenceCash,
    });

    await cashRegister.save({
      transaction,
      fields: [
        "status",
        "closed_by",
        "closing_cash",
        "closing_note",
        "closing_declared",
        "closed_at",
        "expected_cash",
        "difference_cash",
      ],
    });

    const updatedCashRegister = await CashRegister.findByPk(id, { transaction });

    // Hook de notificaciones (Telegram). Post-commit para no notificar si la txn falla.
    try {
      const tg = require("./telegramNotifier.service");
      const fire = () => tg.notifyCashRegisterClose({ cash_register_id: id }).catch(() => {});
      if (transaction && typeof transaction.afterCommit === "function") {
        transaction.afterCommit(fire);
      } else {
        fire();
      }
    } catch (_) {}

    return {
      cash_register: toPlain(updatedCashRegister),
      summary,
    };
  } catch (e) {
    console.error("[cashRegister.service.closeCashRegister] error:", {
      message: e?.message,
      code: e?.code,
      status: e?.status,
      data: e?.data,
      stack: e?.stack,
      cash_register_id: id,
      closed_by: userId,
      closing_cash: closingCash,
      closing_note,
    });
    throw e;
  }
}

module.exports = {
  sequelize,
  getAuthUserId,
  getAuthBranchId,
  normalizeCajaType,
  normalizeInvoiceMode,
  normalizeInvoiceType,
  getCurrentOpenCashRegister,
  getOpenCashRegisterOrThrow,
  openCashRegister,
  createManualCashMovement,
  buildCashRegisterSummary,
  closeCashRegister,
};