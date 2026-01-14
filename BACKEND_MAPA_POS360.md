# POS360 Commerce API — Mapa del Backend (estado actual)

> Objetivo del mapa:
> - Tener una vista rápida de carpetas/módulos
> - Recordar lo que ya se alineó (DB + backend)
> - Marcar faltantes y riesgos
> - Mantener un % estimado de avance por módulo

---

## 0) Estructura del repo

- src/
  - config/
    - env.js                 -> variables (JWT_SECRET, expiración, etc.)
    - sequelize.js            -> conexión MySQL + Sequelize
    - s3.js                   -> MinIO/S3 (uploads)
    - cors.js                 -> CORS
  - controllers/
    - auth.controller.js
    - products.controller.js
    - categories.controller.js
    - subcategories.controller.js
    - branches.controller.js
    - warehouses.controller.js
    - stock.controller.js
    - dashboard.controller.js
    - pos.controller.js
    - posSales.controller.js
    - posRefunds.controller.js
    - posExchanges.controller.js
    - posSalesOptions.controller.js
    - public.controller.js
    - public.shopConfig.controller.js
    - ecomCheckout.controller.js
    - ecomPayments.controller.js
    - adminUsers.controller.js
    - admin.shopBranding.controller.js
    - admin.shopOrders.controller.js
    - admin.shopSettings.controller.js
    - admin.shopPayments.controller.js
  - loaders/
    - express.loader.js
    - sequelize.loader.js
    - sequelize.instance.js
  - middlewares/
    - auth.js                      -> requireAuth + normalización roles/branches + hydrate DB
    - rbac.middleware.js            -> attachAccessContext (roles/perms/branches)
    - branchContext.middleware.js   -> req.ctx (branchId + warehouseId) validando user_branches
    - cors.middleware.js
    - error.middleware.js
    - upload.middleware.js
  - models/
    - index.js                 -> asociaciones (fuente de verdad para includes)
    - User.js / Role.js / permission.js
    - user_role.js             -> pivot user_roles
    - role_permission.js       -> pivot role_permissions
    - UserBranch.js            -> pivot user_branches
    - Branch.js / Warehouse.js
    - Category.js / Subcategory.js
    - Product.js / ProductImage.js
    - StockBalance.js / StockMovement.js / StockMovementItem.js
    - sale.model.js / sale_item.model.js / payment.model.js
    - SaleRefund.js / SaleExchange.js
  - routes/
    - v1.routes.js             -> router principal (public + protected + admin)
    - auth.routes.js
    - products.routes.js
    - categories.routes.js
    - subcategories.routes.js
    - branches.routes.js
    - warehouses.routes.js
    - stock.routes.js
    - dashboard.routes.js
    - pos.routes.js
    - public.routes.js
    - public.shopConfig.routes.js
    - ecomCheckout.routes.js
    - ecomPayments.routes.js
    - adminUsers.routes.js
    - admin.shopBranding.routes.js
    - admin.shopOrders.routes.js
    - admin.shopSettings.routes.js
    - admin.shopPayments.routes.js
  - services/
    - auth.service.js
    - products.service.js
    - stock.service.js
    - warehouses.service.js
    - branches.service.js
    - public.service.js
    - mercadopago.service.js
    - s3Upload.service.js / s3.service.js
    - shopBranding.service.js / admin.shopBranding.service.js
  - utils/
    - jwt.js / password.js
    - asyncHandler.js / httpError.js
  - app.js / server.js

---

## 1) Lo que ya se alineó (CHECKLIST)

### Base de datos (OK)
- users.branch_id NOT NULL
- roles / permissions cargados
- pivots: user_roles, role_permissions, user_branches OK
- warehouses por branch OK
- stock_balances OK
- product_branches OK (tiene datos por branch)

### Backend (OK)
- Auth:
  - auth.service.js emite JWT con role/roles + branches + branch_id
  - middlewares/auth.js normaliza roles/branches y puede hidratar desde DB
- RBAC:
  - middlewares/rbac.middleware.js genera req.access {roles, permissions, branch_ids, is_super_admin}
- Branch Context:
  - middlewares/branchContext.middleware.js setea req.ctx {branchId, warehouseId} validando user_branches
  - override branch por x-branch-id solo si super_admin
- Router principal:
  - v1.routes.js: products protegido + branchContext (quirúrgico)
  - admin protegido + attachAccessContext (RBAC)

---

## 2) Estado por módulos (porcentaje)

A) Auth + Branch Scope: ~85%
- OK: JWT roles/branches, requireAuth hydrate, branchContext en products
- Falta: aplicar branchContext en stock/pos donde corresponda (sin romper prod)

B) RBAC (permisos): ~65%
- OK: DB y attachAccessContext
- Falta: “enforce” consistente por endpoints (users.*, ecom.orders.*, products.write, inventory.*)

C) Catálogo + Visibilidad por sucursal: ~55%
- Riesgo: catálogo hoy filtra por products.branch_id pero existe product_branches (parece fuente de verdad)
- Falta: usar product_branches para visibilidad (sin romper)

D) POS / Ventas / Refunds: ~60%
- OK: pos.routes unificado
- Falta: permisos pos.* + scope branch/warehouse consistente

E) Ecommerce: ~70%
- OK: checkout/payments + admin shop controllers
- Falta: gates RBAC finos por permisos (ecom.orders.read/update)

---

## 3) Próximo paso quirúrgico recomendado
1) Definir fuente de verdad del catálogo:
   - Opción B recomendada: Catálogo global + visibilidad por product_branches
2) Implementar filtro en products.controller.js:
   - para non-admin: exigir product_branches(branchId) activo
   - para admin: permitir owner_branch_id opcional, y branch_id para stock/visibilidad
3) Mantener compat:
   - NO romper create/update: al crear producto, insertar también en product_branches para la branch activa
   - si admin cambia branch_id del producto, agregar pivot (no borrar pivots previos)
