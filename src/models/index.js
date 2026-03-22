// src/models/index.js
// ✅ COPY-PASTE FINAL COMPLETO

const { DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

// ===== MODELOS AUTH =====
const User = require("./User")(sequelize, DataTypes);
const Role = require("./Role")(sequelize, DataTypes);
const Permission = require("./permission")(sequelize, DataTypes);
const UserRole = require("./user_role")(sequelize, DataTypes);
const UserBranch = require("./UserBranch")(sequelize, DataTypes);

let RolePermission = null;
try {
  RolePermission = require("./role_permission")(sequelize, DataTypes);
} catch {
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

// ===== PRODUCT VIDEO (opcional)
let ProductVideo = null;
try {
  ProductVideo = require("./ProductVideo")(sequelize, DataTypes);
} catch {
  console.log("⚠️ ProductVideo no cargado");
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
} catch {
  console.log("⚠️ SaleRefund no cargado");
}

try {
  SaleExchange = require("./SaleExchange")(sequelize, DataTypes);
} catch {
  console.log("⚠️ SaleExchange no cargado");
}

// ===== 🧠 CAJA =====
let CashRegister = null;
let CashMovement = null;

try {
  CashRegister = require("./CashRegister")(sequelize, DataTypes);
} catch {
  console.log("⚠️ CashRegister no cargado");
}

try {
  CashMovement = require("./CashMovement")(sequelize, DataTypes);
} catch {
  console.log("⚠️ CashMovement no cargado");
}

// ===== SHOP =====
let ShopLink = null;
try {
  ShopLink = require("./ShopLink")(sequelize, DataTypes);
} catch {
  console.log("⚠️ ShopLink no cargado");
}

// =============================
// HELPERS (anti duplicado)
// =============================
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

// =============================
// RELACIONES
// =============================

// USERS ↔ ROLES
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

// ROLES ↔ PERMISSIONS
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

// USERS ↔ BRANCHES
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

// CATEGORY
safeBelongsTo(Category, Category, { foreignKey: "parent_id", as: "parent" });
safeHasMany(Category, Category, { foreignKey: "parent_id", as: "children" });

// SUBCATEGORY
safeBelongsTo(Subcategory, Category, { foreignKey: "category_id", as: "category" });
safeHasMany(Category, Subcategory, { foreignKey: "category_id", as: "subcategories" });

// PRODUCT
safeBelongsTo(Product, Branch, { foreignKey: "branch_id", as: "branch" });
safeHasMany(Branch, Product, { foreignKey: "branch_id", as: "products" });

safeBelongsTo(Product, Category, { foreignKey: "category_id", as: "category" });
safeHasMany(Category, Product, { foreignKey: "category_id", as: "products" });

safeBelongsTo(Product, Subcategory, { foreignKey: "subcategory_id", as: "subcategory" });
safeHasMany(Subcategory, Product, { foreignKey: "subcategory_id", as: "products" });

// IMAGES
safeHasMany(Product, ProductImage, { foreignKey: "product_id", as: "images" });
safeBelongsTo(ProductImage, Product, { foreignKey: "product_id", as: "product" });

// VIDEO
if (ProductVideo) {
  safeHasMany(Product, ProductVideo, { foreignKey: "product_id", as: "videos" });
  safeBelongsTo(ProductVideo, Product, { foreignKey: "product_id", as: "product" });
}

// STOCK
safeBelongsTo(StockBalance, Product, { foreignKey: "product_id", as: "product" });
safeBelongsTo(StockBalance, Warehouse, { foreignKey: "warehouse_id", as: "warehouse" });

safeHasMany(StockMovement, StockMovementItem, { foreignKey: "movement_id", as: "items" });
safeBelongsTo(StockMovementItem, StockMovement, { foreignKey: "movement_id", as: "movement" });

// SALES
safeBelongsTo(Sale, Branch, { foreignKey: "branch_id", as: "branch" });
safeBelongsTo(Sale, User, { foreignKey: "user_id", as: "user" });

safeHasMany(Sale, SaleItem, { foreignKey: "sale_id", as: "items" });
safeBelongsTo(SaleItem, Sale, { foreignKey: "sale_id", as: "sale" });

safeHasMany(Sale, Payment, { foreignKey: "sale_id", as: "payments" });
safeBelongsTo(Payment, Sale, { foreignKey: "sale_id", as: "sale" });

// =============================
// 🔥 CAJA (LO IMPORTANTE)
// =============================

if (CashRegister) {
  safeBelongsTo(CashRegister, Branch, { foreignKey: "branch_id", as: "branch" });
  safeHasMany(Branch, CashRegister, { foreignKey: "branch_id", as: "cashRegisters" });

  safeBelongsTo(CashRegister, User, { foreignKey: "opened_by", as: "openedBy" });
  safeBelongsTo(CashRegister, User, { foreignKey: "closed_by", as: "closedBy" });
}

if (CashMovement && CashRegister) {
  safeBelongsTo(CashMovement, CashRegister, { foreignKey: "cash_register_id", as: "cashRegister" });
  safeHasMany(CashRegister, CashMovement, { foreignKey: "cash_register_id", as: "movements" });
}

if (CashMovement) {
  safeBelongsTo(CashMovement, User, { foreignKey: "user_id", as: "user" });
}

if (CashRegister) {
  safeBelongsTo(Sale, CashRegister, { foreignKey: "cash_register_id", as: "cashRegister" });
  safeHasMany(CashRegister, Sale, { foreignKey: "cash_register_id", as: "sales" });
}

// =============================
// EXPORT
// =============================
module.exports = {
  sequelize,

  User,
  Role,
  Permission,
  UserRole,
  RolePermission,
  UserBranch,

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

  Sale,
  SaleItem,
  Payment,
  SaleRefund,
  SaleExchange,

  // 🔥 CAJA
  CashRegister,
  CashMovement,

  ShopLink,
};