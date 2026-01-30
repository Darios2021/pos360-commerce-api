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
const ProductVideo = require("./ProductVideo")(sequelize, DataTypes); // ✅ NUEVO
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
// ✅ Ecommerce (OPCIONAL: no rompe si no existe)
// ==========================================
let EcomCustomer = null;
let EcomOrder = null;
let EcomOrderItem = null;
let EcomPayment = null;

try {
  EcomCustomer = require("./ecom_customer.model")(sequelize, DataTypes);
} catch (e) {}
try {
  EcomOrder = require("./ecom_order.model")(sequelize, DataTypes);
} catch (e) {}
try {
  EcomOrderItem = require("./ecom_order_item.model")(sequelize, DataTypes);
} catch (e) {}
try {
  EcomPayment = require("./ecom_payment.model")(sequelize, DataTypes);
} catch (e) {}

// ==========================================
// ASOCIACIONES
// ==========================================

// Auth: Users ↔ Roles
User.belongsToMany(Role, {
  through: { model: UserRole, timestamps: false },
  foreignKey: "user_id",
  otherKey: "role_id",
  as: "roles",
});
Role.belongsToMany(User, {
  through: { model: UserRole, timestamps: false },
  foreignKey: "role_id",
  otherKey: "user_id",
  as: "users",
});

// Roles ↔ Permissions (si existe tabla puente)
if (RolePermission) {
  Role.belongsToMany(Permission, {
    through: { model: RolePermission, timestamps: false },
    foreignKey: "role_id",
    otherKey: "permission_id",
    as: "permissions",
  });
  Permission.belongsToMany(Role, {
    through: { model: RolePermission, timestamps: false },
    foreignKey: "permission_id",
    otherKey: "role_id",
    as: "roles",
  });
}

// ✅ Users ↔ Branches (user_branches)
User.belongsToMany(Branch, {
  through: { model: UserBranch, timestamps: false },
  foreignKey: "user_id",
  otherKey: "branch_id",
  as: "branches",
});
Branch.belongsToMany(User, {
  through: { model: UserBranch, timestamps: false },
  foreignKey: "branch_id",
  otherKey: "user_id",
  as: "users",
});

// Categorías (recursivo)
Category.belongsTo(Category, { foreignKey: "parent_id", as: "parent" });
Category.hasMany(Category, { foreignKey: "parent_id", as: "children" });

// ==========================================
// ✅ Productos + Branch
// ==========================================

// Product ↔ Category
if (!Product.associations?.category) {
  Product.belongsTo(Category, { foreignKey: "category_id", as: "category" });
}
if (!Category.associations?.products) {
  Category.hasMany(Product, { foreignKey: "category_id", as: "products" });
}

// ✅ Product ↔ Branch
if (!Product.associations?.branch) {
  Product.belongsTo(Branch, { foreignKey: "branch_id", as: "branch" });
}
if (!Branch.associations?.products) {
  Branch.hasMany(Product, { foreignKey: "branch_id", as: "products" });
}

// ✅ Product ↔ Images
if (!Product.associations?.images) {
  Product.hasMany(ProductImage, { foreignKey: "product_id", as: "images" });
}
if (!ProductImage.associations?.product) {
  ProductImage.belongsTo(Product, { foreignKey: "product_id", as: "product" });
}

// ✅ Product ↔ Videos (NUEVO)
if (!Product.associations?.videos) {
  Product.hasMany(ProductVideo, { foreignKey: "product_id", as: "videos" });
}
if (!ProductVideo.associations?.product) {
  ProductVideo.belongsTo(Product, { foreignKey: "product_id", as: "product" });
}

// Branch/Warehouse
if (!Warehouse.associations?.branch) {
  Warehouse.belongsTo(Branch, { foreignKey: "branch_id", as: "branch" });
}
if (!Branch.associations?.warehouses) {
  Branch.hasMany(Warehouse, { foreignKey: "branch_id", as: "warehouses" });
}

// Stock
if (!StockBalance.associations?.warehouse) {
  StockBalance.belongsTo(Warehouse, { foreignKey: "warehouse_id", as: "warehouse" });
}
if (!StockBalance.associations?.product) {
  StockBalance.belongsTo(Product, { foreignKey: "product_id", as: "product" });
}

// POS: Sale
if (!Sale.associations?.branch) {
  Sale.belongsTo(Branch, { foreignKey: "branch_id", as: "branch" });
}
if (!Sale.associations?.user) {
  Sale.belongsTo(User, { foreignKey: "user_id", as: "user" });
}

if (!Sale.associations?.items) {
  Sale.hasMany(SaleItem, { foreignKey: "sale_id", as: "items" });
}
if (!SaleItem.associations?.sale) {
  SaleItem.belongsTo(Sale, { foreignKey: "sale_id", as: "sale" });
}
if (!SaleItem.associations?.product) {
  SaleItem.belongsTo(Product, { foreignKey: "product_id", as: "product" });
}
if (!SaleItem.associations?.warehouse) {
  SaleItem.belongsTo(Warehouse, { foreignKey: "warehouse_id", as: "warehouse" });
}

// ✅ Pagos
if (!Sale.associations?.payments) {
  Sale.hasMany(Payment, { foreignKey: "sale_id", as: "payments" });
}
if (!Payment.associations?.sale) {
  Payment.belongsTo(Sale, { foreignKey: "sale_id", as: "sale" });
}

// Movimientos
if (!StockMovement.associations?.items) {
  StockMovement.hasMany(StockMovementItem, { foreignKey: "movement_id", as: "items" });
}
if (!StockMovementItem.associations?.movement) {
  StockMovementItem.belongsTo(StockMovement, { foreignKey: "movement_id", as: "movement" });
}

// ✅ Auditoría
if (!StockMovement.associations?.warehouse) {
  StockMovement.belongsTo(Warehouse, { foreignKey: "warehouse_id", as: "warehouse" });
}
if (!StockMovement.associations?.creator) {
  StockMovement.belongsTo(User, { foreignKey: "created_by", as: "creator" });
}

// ==========================================
// ✅ Ecommerce associations (si los modelos existen)
// ==========================================
if (EcomOrder && EcomCustomer && !EcomOrder.associations?.customer) {
  EcomOrder.belongsTo(EcomCustomer, { foreignKey: "customer_id", as: "customer" });
}
if (EcomCustomer && EcomOrder && !EcomCustomer.associations?.orders) {
  EcomCustomer.hasMany(EcomOrder, { foreignKey: "customer_id", as: "orders" });
}

if (EcomOrder && EcomOrderItem && !EcomOrder.associations?.items) {
  EcomOrder.hasMany(EcomOrderItem, { foreignKey: "order_id", as: "items" });
}
if (EcomOrderItem && EcomOrder && !EcomOrderItem.associations?.order) {
  EcomOrderItem.belongsTo(EcomOrder, { foreignKey: "order_id", as: "order" });
}

if (EcomOrderItem && Product && !EcomOrderItem.associations?.product) {
  EcomOrderItem.belongsTo(Product, { foreignKey: "product_id", as: "product" });
}

if (EcomPayment && EcomOrder && !EcomPayment.associations?.order) {
  EcomPayment.belongsTo(EcomOrder, { foreignKey: "order_id", as: "order" });
}
if (EcomOrder && EcomPayment && !EcomOrder.associations?.payments) {
  EcomOrder.hasMany(EcomPayment, { foreignKey: "order_id", as: "payments" });
}

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
  ProductVideo, // ✅ NUEVO
  Branch,
  Warehouse,

  StockBalance,
  StockMovement,
  StockMovementItem,

  Sale,
  SaleItem,
  Payment,

  // ✅ Ecommerce (si existen)
  EcomCustomer,
  EcomOrder,
  EcomOrderItem,
  EcomPayment,
};
