// src/controllers/service.controller.js
//
// Servicio tecnico: ordenes de reparacion.
//
//   - GET    /admin/service/orders            → listado paginado con busqueda
//   - GET    /admin/service/orders/stats      → contadores por estado
//   - GET    /admin/service/orders/:id        → detalle con renglones
//   - POST   /admin/service/orders            → alta (numera MAX+1)
//   - PUT    /admin/service/orders/:id        → editar cabecera / cambiar estado
//   - DELETE /admin/service/orders/:id        → eliminar
//   - POST   /admin/service/orders/:id/items  → agregar repuesto o mano de obra
//   - PUT    /admin/service/orders/:id/items/:itemId
//   - DELETE /admin/service/orders/:id/items/:itemId
//   - POST   /admin/service/orders/:id/notes  → nota interna en el seguimiento
//   - POST   /admin/service/orders/:id/whatsapp → comprobante o aviso de estado
//   - GET    /admin/service/technicians       → tecnicos para derivar
//   - GET    /admin/service/technicians/usuarios → usuarios con su marca (admin)
//   - PUT    /admin/service/technicians/:userId  → marcar / desmarcar (admin)
//   - GET    /admin/service/prices            → lista de precios por modelo
//   - POST   /admin/service/prices/:id/espejo → crea el producto de catalogo
//                                               para cobrar la reparacion por POS
//
// Permisos: el mostrador entero (cajero incluido) puede recibir equipos, ver y
// editar ordenes: es literalmente su trabajo. Eliminar una orden es de admin,
// porque borra el historial de un equipo que puede seguir en el taller.
//
// Numeracion: la serie del sistema (`number`) arranca en 1 y es unica. Las 645
// ordenes migradas del Excel viven con `number` en NULL y el numero del papel
// en `legacy_number`, asi las dos series conviven sin pisarse.
//
// Seguimiento: el alta, cada cambio de estado, cada derivacion a un tecnico,
// las notas y los avisos al cliente quedan en service_order_events
// (services/serviceTracking.service.js). Las ordenes migradas no tienen.

"use strict";

const { Op } = require("sequelize");
const {
  sequelize,
  ServiceOrder,
  ServiceOrderItem,
  ServiceRepairPrice,
  Product,
  Customer,
  User,
  Branch,
} = require("../models");
const access = require("../utils/accessScope");
const seguimiento = require("../services/serviceTracking.service");

const VALID_STATUS = [
  "recibido",
  "diagnostico",
  "presupuestado",
  "aprobado",
  "en_reparacion",
  "reparado",
  "entregado",
  "sin_solucion",
  "no_retirado",
];
const VALID_KIND = ["repuesto", "mano_obra", "otro"];

function toNum(v, d = 0) {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : d;
}
function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}
function s(v) {
  return String(v ?? "").trim();
}
function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}
function sinAcentos(v) {
  return String(v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
function notFound(res) {
  return res.status(404).json({ ok: false, code: "NOT_FOUND", message: "Orden no encontrada." });
}
function unavailable(res) {
  return res.status(501).json({
    ok: false,
    code: "UNAVAILABLE",
    message: "El modulo de servicio tecnico no esta disponible en esta instalacion.",
  });
}
function soloAdmin(req, res) {
  if (!access.isBranchAdmin(req)) {
    res.status(403).json({
      ok: false,
      code: "FORBIDDEN",
      message: "Solo administradores pueden eliminar ordenes.",
    });
    return false;
  }
  return true;
}

// Nombre visible del usuario, con la misma cascada que usa el presupuestador:
// puede no tener nombre y apellido cargados.
function displayNameOf(u) {
  if (!u) return "";
  const full = [s(u.first_name), s(u.last_name)].filter(Boolean).join(" ").trim();
  return full || s(u.username) || s(u.email);
}

// Numero visible de la orden. Las migradas no tienen serie nueva: se muestran
// con el numero del papel para que el mostrador las siga reconociendo.
function numeroVisible(orden) {
  if (orden?.number) return `OT-${String(orden.number).padStart(5, "0")}`;
  if (orden?.legacy_number) return `#${orden.legacy_number} (libro)`;
  return "sin numero";
}

// El saldo no se escribe a mano: es lo presupuestado menos lo que ya pago.
// Si se dejara editable, la primera diferencia de tipeo desarma la caja.
function recalcSaldo(orden) {
  return round2(Math.max(0, toNum(orden.quoted_amount, 0) - toNum(orden.deposit, 0)));
}

// Suma de los repuestos cargados. Se guarda en la cabecera para poder listar y
// hacer reportes sin traer los renglones de cada orden.
async function recalcCostos(orderId, t) {
  const items = await ServiceOrderItem.findAll({
    where: { order_id: orderId },
    transaction: t,
  });
  const partsCost = round2(
    items.reduce((acc, it) => acc + toNum(it.cost, 0) * toNum(it.qty, 0), 0)
  );
  await ServiceOrder.update({ parts_cost: partsCost }, { where: { id: orderId }, transaction: t });
  return partsCost;
}

function includes() {
  const inc = [];
  if (ServiceOrderItem) {
    inc.push({ model: ServiceOrderItem, as: "items", required: false });
  }
  if (Customer) inc.push({ model: Customer, as: "customer", required: false });
  return inc;
}

async function loadFull(id) {
  return ServiceOrder.findByPk(id, {
    include: includes(),
    order: [[{ model: ServiceOrderItem, as: "items" }, "sort_order", "ASC"]],
  });
}

// La orden con su numero visible y el seguimiento, que es lo que devuelven el
// detalle, el alta y la edicion.
async function respuestaCompleta(id) {
  const full = await loadFull(id);
  if (!full) return null;
  const events = await seguimiento.historial(id);
  return { ...full.toJSON(), numero_visible: numeroVisible(full), events };
}

// Un cajero ve las ordenes que recibio el y las que le derivaron como tecnico.
// Un admin ve toda la sucursal.
function ownerFilter(req) {
  const scope = access.getAccessScope(req);
  if (scope.kind !== "user") return null;
  const yo = scope.userId || -1;
  return { [Op.or]: [{ user_id: yo }, { technician_id: yo }] };
}

// Derivar a un tecnico: el id tiene que ser un usuario marcado como tecnico, y
// el nombre se congela del usuario, no del body. Devuelve null si no se deriva
// a nadie (id vacio) y lanza si el id no es tecnico.
async function resolverTecnico(rawId, t) {
  const id = toInt(rawId, 0) || null;
  if (!id) return { technician_id: null, technician_name: null };
  if (!(await seguimiento.esTecnico(id, t))) {
    const err = new Error("El usuario elegido no esta marcado como tecnico.");
    err.status = 400;
    err.code = "NO_ES_TECNICO";
    throw err;
  }
  return { technician_id: id, technician_name: await seguimiento.userName(id, t) };
}

// ============================================================
// LIST
// ============================================================
exports.list = async (req, res, next) => {
  if (!ServiceOrder) return unavailable(res);
  try {
    const page = Math.max(1, toInt(req.query.page, 1));
    const limit = Math.min(100, Math.max(1, toInt(req.query.limit, 20)));
    const q = s(req.query.q);
    const status = s(req.query.status);

    const where = {};
    if (status && VALID_STATUS.includes(status)) where.status = status;

    if (q) {
      const like = { [Op.like]: `%${q}%` };
      where[Op.or] = [
        { customer_name: like },
        { customer_phone: like },
        { device_brand: like },
        { device_model: like },
        { device_imei: like },
      ];
      // Si tipeo un numero, que matchee las dos series: la del sistema y la
      // del papel. En el mostrador van a seguir buscando por el numero viejo
      // un buen tiempo.
      const asNum = toInt(q.replace(/\D/g, ""), NaN);
      if (Number.isFinite(asNum)) {
        where[Op.or].push({ number: asNum });
        where[Op.or].push({ legacy_number: asNum });
      }
    }

    const y = [];
    const owner = ownerFilter(req);
    if (owner !== null) y.push(owner);

    // ?mios=1 es la cola del tecnico: lo que le derivaron a quien mira.
    if (["1", "true"].includes(s(req.query.mios))) {
      where.technician_id = toInt(req.user?.id, 0) || -1;
    } else if (s(req.query.technician_id)) {
      where.technician_id = toInt(req.query.technician_id, 0) || null;
    }
    if (y.length) where[Op.and] = y;

    // Por defecto no se muestran las 645 migradas: el mostrador quiere ver el
    // trabajo del dia, no el historico. Se piden con ?incluir_historico=1.
    if (!["1", "true"].includes(s(req.query.incluir_historico))) {
      where.source = "app";
    }

    const { rows, count } = await ServiceOrder.findAndCountAll({
      where,
      include: includes(),
      order: [["created_at", "DESC"], ["id", "DESC"]],
      limit,
      offset: (page - 1) * limit,
      distinct: true,
    });

    return res.json({
      ok: true,
      data: rows.map((r) => ({ ...r.toJSON(), numero_visible: numeroVisible(r) })),
      meta: { page, limit, total: count, pages: Math.ceil(count / limit) || 1 },
    });
  } catch (e) {
    next(e);
  }
};

// ============================================================
// STATS
// ============================================================
exports.stats = async (req, res, next) => {
  if (!ServiceOrder) return unavailable(res);
  try {
    const where = {};
    const owner = ownerFilter(req);
    if (owner !== null) Object.assign(where, owner);
    if (["1", "true"].includes(s(req.query.mios))) where.technician_id = toInt(req.user?.id, 0) || -1;
    if (!["1", "true"].includes(s(req.query.incluir_historico))) where.source = "app";

    const rows = await ServiceOrder.findAll({
      attributes: ["status", [sequelize.fn("COUNT", sequelize.col("id")), "n"]],
      where,
      group: ["status"],
      raw: true,
    });

    const porEstado = {};
    for (const st of VALID_STATUS) porEstado[st] = 0;
    let total = 0;
    for (const r of rows) {
      porEstado[r.status] = Number(r.n || 0);
      total += Number(r.n || 0);
    }

    // Lo que importa en el mostrador: cuantos equipos hay en el taller ahora y
    // cuantos estan listos esperando que el cliente los venga a buscar.
    const enTaller =
      porEstado.recibido + porEstado.diagnostico + porEstado.presupuestado +
      porEstado.aprobado + porEstado.en_reparacion;

    return res.json({
      ok: true,
      data: {
        total,
        por_estado: porEstado,
        en_taller: enTaller,
        para_entregar: porEstado.reparado,
        sin_retirar: porEstado.no_retirado,
      },
    });
  } catch (e) {
    next(e);
  }
};

// ============================================================
// GET BY ID
// ============================================================
exports.getById = async (req, res, next) => {
  if (!ServiceOrder) return unavailable(res);
  try {
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, code: "BAD_ID" });

    const data = await respuestaCompleta(id);
    if (!data) return notFound(res);

    return res.json({ ok: true, data });
  } catch (e) {
    next(e);
  }
};

// ============================================================
// CREATE
// ============================================================
exports.create = async (req, res, next) => {
  if (!ServiceOrder) return unavailable(res);
  const t = await sequelize.transaction();
  try {
    const b = req.body || {};

    // Correlativo de la serie nueva: MAX+1 dentro de la transaccion. Las
    // migradas tienen number en NULL, asi que no entran en el MAX.
    const last = await ServiceOrder.max("number", { transaction: t });
    const number = (toInt(last, 0) || 0) + 1;

    const userId = toInt(req.user?.id, 0) || null;
    const branchId = toInt(req.user?.branch_id ?? b.branch_id, 0) || null;

    let recibidoPor = s(b.received_by);
    if (!recibidoPor && userId && User) {
      const u = await User.findByPk(userId, {
        attributes: ["id", "first_name", "last_name", "username", "email"],
        transaction: t,
      });
      recibidoPor = displayNameOf(u);
    }

    const quoted = toNum(b.quoted_amount, 0);
    const deposit = toNum(b.deposit, 0);
    const tecnico = await resolverTecnico(b.technician_id, t);

    const orden = await ServiceOrder.create(
      {
        number,
        legacy_number: null,
        branch_id: branchId,
        user_id: userId,
        received_by: recibidoPor || null,

        customer_id: toInt(b.customer_id, 0) || null,
        customer_name: s(b.customer_name) || "Consumidor Final",
        customer_phone: s(b.customer_phone) || null,
        customer_email: s(b.customer_email) || null,
        customer_address: s(b.customer_address) || null,
        customer_doc: s(b.customer_doc) || null,

        device_brand: s(b.device_brand) || null,
        device_model: s(b.device_model) || null,
        device_imei: s(b.device_imei) || null,
        device_serial: s(b.device_serial) || null,
        device_unlock: s(b.device_unlock) || null,
        device_accessories: s(b.device_accessories) || null,

        intake_condition: s(b.intake_condition) || null,
        reported_fault: s(b.reported_fault) || null,

        technician_id: tecnico.technician_id,
        technician_name: tecnico.technician_name,

        status: VALID_STATUS.includes(s(b.status)) ? s(b.status) : "recibido",
        quoted_amount: quoted,
        deposit,
        balance: round2(Math.max(0, quoted - deposit)),
        estimated_pickup: s(b.estimated_pickup) || null,
        source: "app",
      },
      { transaction: t }
    );

    await seguimiento.registrar(
      { order_id: orden.id, kind: "ingreso", to_status: orden.status, note: s(b.nota) || null },
      { req, t }
    );
    if (tecnico.technician_id) {
      await seguimiento.registrar(
        { order_id: orden.id, kind: "tecnico", ...tecnico },
        { req, t }
      );
    }

    await t.commit();
    return res.status(201).json({ ok: true, data: await respuestaCompleta(orden.id) });
  } catch (e) {
    await t.rollback();
    if (e?.code === "NO_ES_TECNICO") {
      return res.status(400).json({ ok: false, code: e.code, message: e.message });
    }
    next(e);
  }
};

// ============================================================
// UPDATE
// ============================================================
exports.update = async (req, res, next) => {
  if (!ServiceOrder) return unavailable(res);
  const t = await sequelize.transaction();
  try {
    const id = toInt(req.params.id, 0);
    if (!id) {
      await t.rollback();
      return res.status(400).json({ ok: false, code: "BAD_ID" });
    }

    const orden = await ServiceOrder.findByPk(id, { transaction: t });
    if (!orden) {
      await t.rollback();
      return notFound(res);
    }

    const b = req.body || {};
    const campos = [
      "customer_id", "customer_name", "customer_phone", "customer_email",
      "customer_address", "customer_doc",
      "device_brand", "device_model", "device_imei", "device_serial",
      "device_unlock", "device_accessories",
      "intake_condition", "reported_fault", "technical_report", "suggestions",
      "estimated_pickup", "delivered_by",
    ];
    const patch = {};
    for (const c of campos) {
      if (b[c] === undefined) continue;
      if (c === "customer_id") patch[c] = toInt(b[c], 0) || null;
      else patch[c] = s(b[c]) || null;
    }

    // El tecnico se deriva por id: el nombre sale del usuario y no se acepta
    // del body. Las ordenes migradas traen solo el nombre del Excel y lo
    // conservan mientras nadie las derive a un usuario.
    let derivado = null;
    if (b.technician_id !== undefined) {
      const tecnico = await resolverTecnico(b.technician_id, t);
      const antes = toInt(orden.technician_id, 0) || null;
      if (tecnico.technician_id !== antes) {
        Object.assign(patch, tecnico);
        derivado = tecnico;
      }
    }

    if (b.quoted_amount !== undefined) patch.quoted_amount = toNum(b.quoted_amount, 0);
    if (b.deposit !== undefined) patch.deposit = toNum(b.deposit, 0);
    if (b.total_charged !== undefined) patch.total_charged = toNum(b.total_charged, 0);
    for (const c of ["commission_technician", "commission_seller", "commission_shop"]) {
      if (b[c] !== undefined) patch[c] = toNum(b[c], 0);
    }

    if (b.status !== undefined) {
      const st = s(b.status);
      if (!VALID_STATUS.includes(st)) {
        await t.rollback();
        return res.status(400).json({
          ok: false,
          code: "BAD_STATUS",
          message: `Estado invalido. Validos: ${VALID_STATUS.join(", ")}.`,
        });
      }
      patch.status = st;
      // Pasar a entregado sella la fecha, si no venia una explicita. Es el
      // dato que despues se usa para saber cuanto tardo cada reparacion.
      if (st === "entregado" && !orden.delivered_at && !b.delivered_at) {
        patch.delivered_at = new Date();
      }
    }
    if (b.delivered_at !== undefined) patch.delivered_at = b.delivered_at || null;

    // El saldo siempre se deriva, nunca se recibe del cliente de la API.
    const futura = { ...orden.toJSON(), ...patch };
    patch.balance = recalcSaldo(futura);

    await ServiceOrder.update(patch, { where: { id }, transaction: t });

    const nota = s(b.nota) || null;
    const cambioEstado = patch.status !== undefined && patch.status !== orden.status;
    if (cambioEstado) {
      await seguimiento.registrar(
        { order_id: id, kind: "estado", from_status: orden.status, to_status: patch.status, note: nota },
        { req, t }
      );
    }
    if (derivado) {
      await seguimiento.registrar(
        {
          order_id: id,
          kind: "tecnico",
          ...derivado,
          note: cambioEstado ? null : nota,
        },
        { req, t }
      );
    }

    await t.commit();
    return res.json({
      ok: true,
      data: await respuestaCompleta(id),
      // El front ofrece avisar al cliente solo cuando el estado cambio.
      cambio_estado: cambioEstado,
    });
  } catch (e) {
    await t.rollback();
    if (e?.code === "NO_ES_TECNICO") {
      return res.status(400).json({ ok: false, code: e.code, message: e.message });
    }
    next(e);
  }
};

// ============================================================
// DELETE
// ============================================================
exports.remove = async (req, res, next) => {
  if (!ServiceOrder) return unavailable(res);
  try {
    if (!soloAdmin(req, res)) return;
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, code: "BAD_ID" });

    const orden = await ServiceOrder.findByPk(id);
    if (!orden) return notFound(res);

    await orden.destroy();
    await sequelize.query("DELETE FROM service_order_events WHERE order_id = :id", {
      replacements: { id },
    }).catch(() => {});
    return res.json({ ok: true, data: { id } });
  } catch (e) {
    next(e);
  }
};

// ============================================================
// SEGUIMIENTO: NOTAS Y AVISOS
// ============================================================
exports.addNote = async (req, res, next) => {
  if (!ServiceOrder) return unavailable(res);
  try {
    const id = toInt(req.params.id, 0);
    const orden = id ? await ServiceOrder.findByPk(id, { attributes: ["id"] }) : null;
    if (!orden) return notFound(res);

    const nota = s(req.body?.nota);
    if (!nota) return res.status(400).json({ ok: false, code: "SIN_NOTA", message: "Falta el texto de la nota." });

    await seguimiento.registrar({ order_id: id, kind: "nota", note: nota.slice(0, 2000) }, { req });
    return res.status(201).json({ ok: true, data: await seguimiento.historial(id) });
  } catch (e) {
    next(e);
  }
};

// tipo = comprobante (al recibir el equipo) | estado (el estado actual).
exports.whatsapp = async (req, res, next) => {
  if (!ServiceOrder) return unavailable(res);
  try {
    const id = toInt(req.params.id, 0);
    const orden = id ? await ServiceOrder.findByPk(id) : null;
    if (!orden) return notFound(res);

    const tipo = s(req.body?.tipo) === "comprobante" ? "comprobante" : "estado";
    const r = await seguimiento.avisarPorWhatsApp(orden, { tipo, numero: numeroVisible(orden), req });
    if (!r.ok) return res.status(400).json(r);

    return res.json({ ok: true, data: { ...r, events: await seguimiento.historial(id) } });
  } catch (e) {
    next(e);
  }
};

// ============================================================
// TECNICOS
// ============================================================
exports.technicians = async (req, res, next) => {
  try {
    return res.json({ ok: true, data: await seguimiento.listarTecnicos() });
  } catch (e) {
    next(e);
  }
};

exports.technicianUsers = async (req, res, next) => {
  try {
    if (!access.isBranchAdmin(req)) {
      return res.status(403).json({ ok: false, code: "FORBIDDEN", message: "Solo administradores." });
    }
    return res.json({ ok: true, data: await seguimiento.listarUsuariosConMarca() });
  } catch (e) {
    next(e);
  }
};

exports.setTechnician = async (req, res, next) => {
  try {
    if (!access.isBranchAdmin(req)) {
      return res.status(403).json({ ok: false, code: "FORBIDDEN", message: "Solo administradores." });
    }
    const userId = toInt(req.params.userId, 0);
    if (!userId) return res.status(400).json({ ok: false, code: "BAD_ID" });
    const u = User ? await User.findByPk(userId, { attributes: ["id"] }) : null;
    if (!u) return res.status(404).json({ ok: false, code: "NOT_FOUND", message: "Usuario no encontrado." });

    await seguimiento.marcarTecnico(userId, req.body?.es_tecnico !== false);
    return res.json({ ok: true, data: await seguimiento.listarUsuariosConMarca() });
  } catch (e) {
    next(e);
  }
};

// ============================================================
// RENGLONES
// ============================================================
exports.addItem = async (req, res, next) => {
  if (!ServiceOrder || !ServiceOrderItem) return unavailable(res);
  const t = await sequelize.transaction();
  try {
    const orderId = toInt(req.params.id, 0);
    const orden = await ServiceOrder.findByPk(orderId, { transaction: t });
    if (!orden) {
      await t.rollback();
      return notFound(res);
    }

    const b = req.body || {};
    const qty = toNum(b.qty, 1) || 1;
    const cost = toNum(b.cost, 0);
    const unitPrice = toNum(b.unit_price, cost);

    const ultimo = await ServiceOrderItem.max("sort_order", {
      where: { order_id: orderId },
      transaction: t,
    });

    const item = await ServiceOrderItem.create(
      {
        order_id: orderId,
        product_id: toInt(b.product_id, 0) || null,
        kind: VALID_KIND.includes(s(b.kind)) ? s(b.kind) : "repuesto",
        sku: s(b.sku) || null,
        description: s(b.description),
        qty,
        cost,
        unit_price: unitPrice,
        line_total: round2(unitPrice * qty),
        sort_order: (toInt(ultimo, 0) || 0) + 1,
      },
      { transaction: t }
    );

    await recalcCostos(orderId, t);
    await t.commit();
    return res.status(201).json({ ok: true, data: item });
  } catch (e) {
    await t.rollback();
    next(e);
  }
};

exports.updateItem = async (req, res, next) => {
  if (!ServiceOrderItem) return unavailable(res);
  const t = await sequelize.transaction();
  try {
    const orderId = toInt(req.params.id, 0);
    const itemId = toInt(req.params.itemId, 0);

    const item = await ServiceOrderItem.findOne({
      where: { id: itemId, order_id: orderId },
      transaction: t,
    });
    if (!item) {
      await t.rollback();
      return res.status(404).json({ ok: false, code: "NOT_FOUND", message: "Renglon no encontrado." });
    }

    const b = req.body || {};
    const patch = {};
    if (b.description !== undefined) patch.description = s(b.description);
    if (b.sku !== undefined) patch.sku = s(b.sku) || null;
    if (b.kind !== undefined && VALID_KIND.includes(s(b.kind))) patch.kind = s(b.kind);
    if (b.qty !== undefined) patch.qty = toNum(b.qty, 1) || 1;
    if (b.cost !== undefined) patch.cost = toNum(b.cost, 0);
    if (b.unit_price !== undefined) patch.unit_price = toNum(b.unit_price, 0);

    const qty = patch.qty ?? toNum(item.qty, 1);
    const unitPrice = patch.unit_price ?? toNum(item.unit_price, 0);
    patch.line_total = round2(unitPrice * qty);

    await item.update(patch, { transaction: t });
    await recalcCostos(orderId, t);
    await t.commit();
    return res.json({ ok: true, data: item });
  } catch (e) {
    await t.rollback();
    next(e);
  }
};

exports.removeItem = async (req, res, next) => {
  if (!ServiceOrderItem) return unavailable(res);
  const t = await sequelize.transaction();
  try {
    const orderId = toInt(req.params.id, 0);
    const itemId = toInt(req.params.itemId, 0);

    const item = await ServiceOrderItem.findOne({
      where: { id: itemId, order_id: orderId },
      transaction: t,
    });
    if (!item) {
      await t.rollback();
      return res.status(404).json({ ok: false, code: "NOT_FOUND", message: "Renglon no encontrado." });
    }

    await item.destroy({ transaction: t });
    await recalcCostos(orderId, t);
    await t.commit();
    return res.json({ ok: true, data: { id: itemId } });
  } catch (e) {
    await t.rollback();
    next(e);
  }
};

// ============================================================
// LISTA DE PRECIOS
// ============================================================
// El buscador del mostrador: se tipea el modelo y sale el precio con el
// desglose y las cuotas, que es lo que el Excel resolvia con una hoja aparte.
exports.prices = async (req, res, next) => {
  if (!ServiceRepairPrice) return unavailable(res);
  try {
    const q = s(req.query.q);
    const limit = Math.min(100, Math.max(1, toInt(req.query.limit, 30)));

    const where = { is_active: true };
    if (q) where.model = { [Op.like]: `%${q}%` };
    if (s(req.query.repair_type)) where.repair_type = s(req.query.repair_type);

    const rows = await ServiceRepairPrice.findAll({
      where,
      order: [["model", "ASC"]],
      limit,
    });

    return res.json({ ok: true, data: rows });
  } catch (e) {
    next(e);
  }
};

// ============================================================
// ESPEJO EN EL CATALOGO
// ============================================================
// La lista de precios es la fuente de verdad del precio de una reparacion,
// porque guarda el desglose (repuesto / tecnico / local / vendedor) que el
// catalogo no tiene. Pero para cobrar hace falta un producto: el POS cobra
// productos, no filas de una tabla auxiliar.
//
// Esto crea ese producto espejo y lo deja linkeado en `product_id`. Es
// idempotente: si ya existe, devuelve el que hay en vez de duplicarlo.
//
// El producto sale con `track_stock` en 0 (una reparacion no tiene stock) y
// fuera de la tienda publica: es para el mostrador, no para vender online.
exports.mirrorPrice = async (req, res, next) => {
  if (!ServiceRepairPrice || !Product) return unavailable(res);
  const t = await sequelize.transaction();
  try {
    if (!access.isBranchAdmin(req)) {
      await t.rollback();
      return res.status(403).json({
        ok: false,
        code: "FORBIDDEN",
        message: "Solo administradores pueden crear productos del catalogo.",
      });
    }

    const id = toInt(req.params.id, 0);
    const precio = id ? await ServiceRepairPrice.findByPk(id, { transaction: t }) : null;
    if (!precio) {
      await t.rollback();
      return res.status(404).json({ ok: false, code: "NOT_FOUND", message: "Precio no encontrado." });
    }

    // Ya espejado y el producto sigue vivo: no se duplica.
    if (precio.product_id) {
      const existente = await Product.findByPk(precio.product_id, { transaction: t });
      if (existente) {
        await t.commit();
        return res.json({ ok: true, data: { price: precio, product: existente, creado: false } });
      }
    }

    // SKU estable derivado del modelo: si alguien lo corre de nuevo despues de
    // borrar el link, reencuentra el producto en vez de crear otro.
    const slug = sinAcentos(precio.model).toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 46);
    const sku = `SERV-${precio.repair_type.toUpperCase().slice(0, 6)}-${slug}`.slice(0, 64);

    let producto = await Product.findOne({ where: { sku }, transaction: t });
    let creado = false;

    if (!producto) {
      const branchId = toInt(req.user?.branch_id ?? req.body?.branch_id, 0) || 1;
      const total = Number(precio.total_price || 0);
      producto = await Product.create(
        {
          branch_id: branchId,
          created_by: toInt(req.user?.id, 0) || null,
          sku,
          name: `Reparacion ${precio.repair_type} - ${precio.model}`.slice(0, 200),
          description: "Servicio de reparacion. El precio y el reparto de comisiones viven en la lista de servicio tecnico.",
          brand: "SERVICIO TECNICO",
          model: precio.model,
          // Una reparacion no se stockea ni se publica en la tienda.
          track_stock: false,
          sheet_has_stock: false,
          is_active: true,
          cost: Number(precio.parts_cost || 0),
          price: total,
          price_list: total,
          price_discount: total,
          price_reseller: total,
        },
        { transaction: t }
      );
      creado = true;
    }

    await precio.update({ product_id: producto.id }, { transaction: t });
    await t.commit();

    return res.status(creado ? 201 : 200).json({
      ok: true,
      data: { price: precio, product: producto, creado },
    });
  } catch (e) {
    await t.rollback();
    next(e);
  }
};
