// src/models/index.js
// ✅ COPY-PASTE FINAL COMPLETO
// - Subcategory + Product->createdByUser + SaleRefund/SaleExchange
// - blindado anti-crash + ShopLink opcional
// - ✅ NUEVO: ProductVideo (opcional) + asociaciones Product ↔ ProductVideo
// - ✅ NUEVO: CashRegister + CashMovement (opcionales) + asociaciones con Branch/User/Sale

const { DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

// ===== MODELOS AUTH =====
const User = require("./User")(sequelize, DataTypes);
const Role = require("./Role")(sequelize, DataTypes);
const Permission = require("./permission")(sequelize, DataTypes);
const UserRole = require("./user_role")(sequelize, DataTypes);
const UserBranch = require("./UserBranch")(sequelize, DataTypes);

// role_permission.js (puede no existir)
let RolePermission = null;
try {
  RolePermission = require("./role_permission")(sequelize, DataTypes);
} catch (e) {
  // eslint-disable-next-line no-console
  console.log("⚠️ RolePermission no cargado");
}

// ===== INVENTORY =====
const Category = require("./Category")(sequelize, DataTypes);
const Subcategory = require("./Subcategory")(sequelize, DataTypes);
const Product = require("./Product")(sequelize, DataTypes);
const ProductImage = require("./ProductImage")(sequelize, DataTypes);
const Branch = require("./Branch")(sequelize, DataTypes);
const Warehouse = require("./Warehouse")(sequelize, DataTypes);
const StockBalance = require("./StockBalance")(sequelize, DataTypes);
const StockMovement = require("./StockMovement")(sequelize, DataTypes);
const StockMovementItem = require("./StockMovementItem")(sequelize, DataTypes);

// ✅ NUEVO: ProductVideo (puede no existir todavía)
let ProductVideo = null;
try {
  // opción A: models/ProductVideo.js
  ProductVideo = require("./ProductVideo")(sequelize, DataTypes);
} catch (e1) {
  try {
    // opción B: models/productVideo.model.js (por si lo nombraste así)
    ProductVideo = require("./productVideo.model")(sequelize, DataTypes);
  } catch (e2) {
    // eslint-disable-next-line no-console
    console.log("⚠️ ProductVideo no cargado (models/ProductVideo.js no encontrado o falló)");
    ProductVideo = null;
  }
}

// ===== POS =====
const Sale = require("./sale.model")(sequelize, DataTypes);
const SaleItem = require("./sale_item.model")(sequelize, DataTypes);
const Payment = require("./payment.model")(sequelize, DataTypes);

// ===== POS EXT =====
let SaleRefund = null;
let SaleExchange = null;

try {
  SaleRefund = require("./SaleRefund")(sequelize, DataTypes);
} catch (e) {
  // eslint-disable-next-line no-console
  console.log("⚠️ SaleRefund no cargado (models/SaleRefund.js no encontrado o falló)");
}

try {
  SaleExchange = require("./SaleExchange")(sequelize, DataTypes);
} catch (e) {
  // eslint-disable-next-line no-console
  console.log("⚠️ SaleExchange no cargado (models/SaleExchange.js no encontrado o falló)");
}

// ===== CAJA =====
let CashRegister = null;
let CashMovement = null;

try {
  CashRegister = require("./CashRegister")(sequelize, DataTypes);
} catch (e1) {
  try {
    CashRegister = require("./cashRegister.model")(sequelize, DataTypes);
  } catch (e2) {
    // eslint-disable-next-line no-console
    console.log("⚠️ CashRegister no cargado (models/CashRegister.js no encontrado o falló)");
    CashRegister = null;
  }
}

try {
  CashMovement = require("./CashMovement")(sequelize, DataTypes);
} catch (e1) {
  try {
    CashMovement = require("./cashMovement.model")(sequelize, DataTypes);
  } catch (e2) {
    // eslint-disable-next-line no-console
    console.log("⚠️ CashMovement no cargado (models/CashMovement.js no encontrado o falló)");
    CashMovement = null;
  }
}

// ✅ CAMINO B: ShopLink (puede no existir todavía)
let ShopLink = null;
try {
  ShopLink = require("./ShopLink")(sequelize, DataTypes);
} catch (e) {
  // eslint-disable-next-line no-console
  console.log("⚠️ ShopLink no cargado (models/ShopLink.js no encontrado o falló)");
}

// ==========================================
// Helpers anti-duplicado de asociaciones
// ==========================================
function hasAssoc(model, name) {
  return !!(model && model.associations && model.associations[name]);
}
function safeBelongsTo(model, target, opts) {
  if (!model || !target || !opts?.as) return;
  if (!hasAssoc(model, opts.as)) model.belongsTo(target, opts);
}
function safeHasMany(model, target, opts) {
  if (!model || !target || !opts?.as) return;
  if (!hasAssoc(model, opts.as)) model.hasMany(target, opts);
}
function safeBelongsToMany(model, target, opts) {
  if (!model || !target || !opts?.as) return;
  if (!hasAssoc(model, opts.as)) model.belongsToMany(target, opts);
}

// ==========================================
// ASOCIACIONES
// ==========================================

// Auth: Users ↔ Roles
safeBelongsToMany(User, Role, {
  through: { model: UserRole, timestamps: false },
  foreignKey: "user_id",
  otherKey: "role_id",
  as: "roles",
});
safeBelongsToMany(Role, User, {
  through: { model: UserRole, timestamps: false },
  foreignKey: "role_id",
  otherKey: "user_id",
  as: "users",
});

// Roles ↔ Permissions (si existe tabla puente)
if (RolePermission) {
  safeBelongsToMany(Role, Permission, {
    through: { model: RolePermission, timestamps: false },
    foreignKey: "role_id",
    otherKey: "permission_id",
    as: "permissions",
  });
  safeBelongsToMany(Permission, Role, {
    through: { model: RolePermission, timestamps: false },
    foreignKey: "permission_id",
    otherKey: "role_id",
    as: "roles",
  });
}

// Users ↔ Branches (user_branches)
safeBelongsToMany(User, Branch, {
  through: { model: UserBranch, timestamps: false },
  foreignKey: "user_id",
  otherKey: "branch_id",
  as: "branches",
});
safeBelongsToMany(Branch, User, {
  through: { model: UserBranch, timestamps: false },
  foreignKey: "branch_id",
  otherKey: "user_id",
  as: "users",
});

// Categorías (recursivo)
safeBelongsTo(Category, Category, { foreignKey: "parent_id", as: "parent" });
safeHasMany(Category, Category, { foreignKey: "parent_id", as: "children" });

// Subcategory ↔ Category
safeBelongsTo(Subcategory, Category, { foreignKey: "category_id", as: "category" });
safeHasMany(Category, Subcategory, { foreignKey: "category_id", as: "subcategories" });

// Product ↔ Branch
safeBelongsTo(Product, Branch, { foreignKey: "branch_id", as: "branch" });
safeHasMany(Branch, Product, { foreignKey: "branch_id", as: "products" });

// Product -> User (created_by)
safeBelongsTo(Product, User, { foreignKey: "created_by", as: "createdByUser" });
safeHasMany(User, Product, { foreignKey: "created_by", as: "products_created" });

// Product ↔ Category
safeBelongsTo(Product, Category, { foreignKey: "category_id", as: "category" });
safeHasMany(Category, Product, { foreignKey: "category_id", as: "products" });

// Product ↔ Subcategory
safeBelongsTo(Product, Subcategory, { foreignKey: "subcategory_id", as: "subcategory" });
safeHasMany(Subcategory, Product, { foreignKey: "subcategory_id", as: "products" });

// Product ↔ Images
safeHasMany(Product, ProductImage, { foreignKey: "product_id", as: "images" });
safeBelongsTo(ProductImage, Product, { foreignKey: "product_id", as: "product" });

// ✅ Product ↔ Videos (SOLO si existe el model)
if (ProductVideo) {
  safeHasMany(Product, ProductVideo, { foreignKey: "product_id", as: "videos" });
  safeBelongsTo(ProductVideo, Product, { foreignKey: "product_id", as: "product" });
}

// Warehouse ↔ Branch
safeBelongsTo(Warehouse, Branch, { foreignKey: "branch_id", as: "branch" });
safeHasMany(Branch, Warehouse, { foreignKey: "branch_id", as: "warehouses" });

// Stock
safeBelongsTo(StockBalance, Warehouse, { foreignKey: "warehouse_id", as: "warehouse" });
safeBelongsTo(StockBalance, Product, { foreignKey: "product_id", as: "product" });

safeHasMany(StockMovement, StockMovementItem, { foreignKey: "movement_id", as: "items" });
safeBelongsTo(StockMovementItem, StockMovement, { foreignKey: "movement_id", as: "movement" });

safeBelongsTo(StockMovement, Warehouse, { foreignKey: "warehouse_id", as: "warehouse" });
safeBelongsTo(StockMovement, User, { foreignKey: "created_by", as: "creator" });

// POS: Sale
safeBelongsTo(Sale, Branch, { foreignKey: "branch_id", as: "branch" });
safeBelongsTo(Sale, User, { foreignKey: "user_id", as: "user" });

safeHasMany(Sale, SaleItem, { foreignKey: "sale_id", as: "items" });
safeBelongsTo(SaleItem, Sale, { foreignKey: "sale_id", as: "sale" });

safeBelongsTo(SaleItem, Product, { foreignKey: "product_id", as: "product" });
safeBelongsTo(SaleItem, Warehouse, { foreignKey: "warehouse_id", as: "warehouse" });

safeHasMany(Sale, Payment, { foreignKey: "sale_id", as: "payments" });
safeBelongsTo(Payment, Sale, { foreignKey: "sale_id", as: "sale" });

// ✅ CAJA: CashRegister ↔ Branch/User
if (CashRegister) {
  safeBelongsTo(CashRegister, Branch, { foreignKey: "branch_id", as: "branch" });
  safeHasMany(Branch, CashRegister, { foreignKey: "branch_id", as: "cashRegisters" });

  safeBelongsTo(CashRegister, User, { foreignKey: "opened_by", as: "openedBy" });
  safeHasMany(User, CashRegister, { foreignKey: "opened_by", as: "openedCashRegisters" });

  safeBelongsTo(CashRegister, User, { foreignKey: "closed_by", as: "closedBy" });
  safeHasMany(User, CashRegister, { foreignKey: "closed_by", as: "closedCashRegisters" });
}

// ✅ CAJA: CashMovement ↔ CashRegister/User
if (CashMovement && CashRegister) {
  safeBelongsTo(CashMovement, CashRegister, { foreignKey: "cash_register_id", as: "cashRegister" });
  safeHasMany(CashRegister, CashMovement, { foreignKey: "cash_register_id", as: "movements" });
}
if (CashMovement) {
  safeBelongsTo(CashMovement, User, { foreignKey: "user_id", as: "user" });
  safeHasMany(User, CashMovement, { foreignKey: "user_id", as: "cashMovements" });
}

// ✅ VENTAS ↔ CAJA
if (CashRegister) {
  safeBelongsTo(Sale, CashRegister, { foreignKey: "cash_register_id", as: "cashRegister" });
  safeHasMany(CashRegister, Sale, { foreignKey: "cash_register_id", as: "sales" });
}

// POS EXT: Refunds (VIEW) + Exchanges (TABLE)
if (SaleRefund) {
  safeBelongsTo(SaleRefund, Sale, { foreignKey: "sale_id", as: "sale" });
  safeBelongsTo(SaleRefund, Branch, { foreignKey: "branch_id", as: "branch" });
  safeBelongsTo(SaleRefund, User, { foreignKey: "user_id", as: "user" });

  safeHasMany(Sale, SaleRefund, { foreignKey: "sale_id", as: "refunds" });
}

if (SaleExchange) {
  safeBelongsTo(SaleExchange, Sale, { foreignKey: "original_sale_id", as: "originalSale" });
  safeBelongsTo(SaleExchange, Sale, { foreignKey: "new_sale_id", as: "newSale" });
  safeBelongsTo(SaleExchange, User, { foreignKey: "created_by", as: "creator" });
}

module.exports = {
  sequelize,

  // Auth
  User,
  Role,
  Permission,
  UserRole,
  RolePermission,
  UserBranch,

  // Inventory
  Category,
  Subcategory,
  Product,
  ProductImage,
  ProductVideo,
  Branch,
  Warehouse,
  StockBalance,
  StockMovement,
  StockMovementItem,

  // POS
  Sale,
  SaleItem,
  Payment,

  // POS EXT
  SaleRefund,
  SaleExchange,

  // CAJA
  CashRegister,
  CashMovement,

  // Shop
  ShopLink,
};