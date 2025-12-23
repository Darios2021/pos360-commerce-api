// src/models/index.js
const { DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

// ===== MODELOS =====
const User = require("./User")(sequelize, DataTypes);
const Role = require("./Role")(sequelize, DataTypes);
const Permission = require("./permission")(sequelize, DataTypes);
const UserRole = require("./user_role")(sequelize, DataTypes);

// ✅ user_branches
const UserBranch = require("./UserBranch")(sequelize, DataTypes);

// role_permission.js (puede no existir)
let RolePermission = null;
try {
  RolePermission = require("./role_permission")(sequelize, DataTypes);
} catch (e) {
  console.log("⚠️ RolePermission no cargado");
}

// Inventory
const Category = require("./Category")(sequelize, DataTypes);
const Product = require("./Product")(sequelize, DataTypes);
const ProductImage = require("./ProductImage")(sequelize, DataTypes);
const Branch = require("./Branch")(sequelize, DataTypes);
const Warehouse = require("./Warehouse")(sequelize, DataTypes);
const StockBalance = require("./StockBalance")(sequelize, DataTypes);
const StockMovement = require("./StockMovement")(sequelize, DataTypes);
const StockMovementItem = require("./StockMovementItem")(sequelize, DataTypes);

// POS
const Sale = require("./sale.model")(sequelize, DataTypes);
const SaleItem = require("./sale_item.model")(sequelize, DataTypes);
const Payment = require("./payment.model")(sequelize, DataTypes);

// ==========================================
// Helpers anti-duplicado de asociaciones
// ==========================================
function hasAssoc(model, name) {
  return !!(model && model.associations && model.associations[name]);
}
function safeBelongsTo(model, target, opts) {
  if (!hasAssoc(model, opts.as)) model.belongsTo(target, opts);
}
function safeHasMany(model, target, opts) {
  if (!hasAssoc(model, opts.as)) model.hasMany(target, opts);
}
function safeBelongsToMany(model, target, opts) {
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

// ✅ Users ↔ Branches (user_branches)
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

// ✅ Product ↔ Branch  (ESTO TE FALTABA)
safeBelongsTo(Product, Branch, { foreignKey: "branch_id", as: "branch" });
safeHasMany(Branch, Product, { foreignKey: "branch_id", as: "products" });

// Productos ↔ Category
safeBelongsTo(Product, Category, { foreignKey: "category_id", as: "category" });
safeHasMany(Category, Product, { foreignKey: "category_id", as: "products" });

// ✅ Product ↔ Images (blindado para no duplicar alias "images")
safeHasMany(Product, ProductImage, { foreignKey: "product_id", as: "images" });
safeBelongsTo(ProductImage, Product, { foreignKey: "product_id", as: "product" });

// Branch/Warehouse
safeBelongsTo(Warehouse, Branch, { foreignKey: "branch_id", as: "branch" });
safeHasMany(Branch, Warehouse, { foreignKey: "branch_id", as: "warehouses" });

// Stock
safeBelongsTo(StockBalance, Warehouse, { foreignKey: "warehouse_id", as: "warehouse" });
safeBelongsTo(StockBalance, Product, { foreignKey: "product_id", as: "product" });

// POS: Sale
safeBelongsTo(Sale, Branch, { foreignKey: "branch_id", as: "branch" });
safeBelongsTo(Sale, User, { foreignKey: "user_id", as: "user" });

safeHasMany(Sale, SaleItem, { foreignKey: "sale_id", as: "items" });
safeBelongsTo(SaleItem, Sale, { foreignKey: "sale_id", as: "sale" });

safeBelongsTo(SaleItem, Product, { foreignKey: "product_id", as: "product" });

// ✅ warehouse_id NOT NULL + FK en BD
safeBelongsTo(SaleItem, Warehouse, { foreignKey: "warehouse_id", as: "warehouse" });

// ✅ Pagos (ALIAS CLAVE para dashboard)
safeHasMany(Sale, Payment, { foreignKey: "sale_id", as: "payments" });
safeBelongsTo(Payment, Sale, { foreignKey: "sale_id", as: "sale" });

// Movimientos
safeHasMany(StockMovement, StockMovementItem, { foreignKey: "movement_id", as: "items" });
safeBelongsTo(StockMovementItem, StockMovement, { foreignKey: "movement_id", as: "movement" });

// ✅ Auditoría
safeBelongsTo(StockMovement, Warehouse, { foreignKey: "warehouse_id", as: "warehouse" });
safeBelongsTo(StockMovement, User, { foreignKey: "created_by", as: "creator" });

module.exports = {
  sequelize,
  User,
  Role,
  Permission,
  UserRole,
  RolePermission,
  UserBranch,

  Category,
  Product,
  ProductImage,
  Branch,
  Warehouse,

  StockBalance,
  StockMovement,
  StockMovementItem,

  Sale,
  SaleItem,
  Payment,
};
