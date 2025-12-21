const { DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

// ===== IMPORTACIÓN DE MODELOS =====
// Nota: Asegúrate de que los nombres de los archivos coincidan exactamente (Mayúsculas/Minúsculas)
const User = require("./User")(sequelize, DataTypes);
const Role = require("./Role")(sequelize, DataTypes);
const Permission = require("./permission")(sequelize, DataTypes); 
const UserRole = require("./user_role")(sequelize, DataTypes);

let RolePermission = null;
try {
  RolePermission = require("./role_permission")(sequelize, DataTypes);
} catch (_) {
  console.log("⚠️ RolePermission no definido");
}

const Category = require("./Category")(sequelize, DataTypes);
const Product = require("./Product")(sequelize, DataTypes);
const ProductImage = require("./ProductImage")(sequelize, DataTypes);
const Branch = require("./Branch")(sequelize, DataTypes);
const Warehouse = require("./Warehouse")(sequelize, DataTypes);
const StockBalance = require("./StockBalance")(sequelize, DataTypes);
const StockMovement = require("./StockMovement")(sequelize, DataTypes);
const StockMovementItem = require("./StockMovementItem")(sequelize, DataTypes);

const Sale = require("./Sale")(sequelize, DataTypes);
const SaleItem = require("./SaleItem")(sequelize, DataTypes);
const Payment = require("./Payment")(sequelize, DataTypes);

// ==========================================
// ASOCIACIONES (Corregidas y Completas)
// ==========================================

// --- AUTH ---
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

// --- INVENTORY (Recursividad de Category arreglada) ---
Category.belongsTo(Category, { foreignKey: "parent_id", as: "parent" });
Category.hasMany(Category, { foreignKey: "parent_id", as: "children" });

Product.belongsTo(Category, { foreignKey: "category_id", as: "category" });
Category.hasMany(Product, { foreignKey: "category_id", as: "products" });

Product.hasMany(ProductImage, { foreignKey: "product_id", as: "images" });
ProductImage.belongsTo(Product, { foreignKey: "product_id", as: "product" });

Warehouse.belongsTo(Branch, { foreignKey: "branch_id", as: "branch" });
Branch.hasMany(Warehouse, { foreignKey: "branch_id", as: "warehouses" });

StockBalance.belongsTo(Warehouse, { foreignKey: "warehouse_id", as: "warehouse" });
StockBalance.belongsTo(Product, { foreignKey: "product_id", as: "product" });

// --- POS & SALES ---
Sale.belongsTo(Branch, { foreignKey: "branch_id", as: "branch" });
Sale.belongsTo(User, { foreignKey: "user_id", as: "user" });
Sale.hasMany(SaleItem, { foreignKey: "sale_id", as: "items" });
SaleItem.belongsTo(Sale, { foreignKey: "sale_id" });
SaleItem.belongsTo(Product, { foreignKey: "product_id", as: "product" });

Sale.hasMany(Payment, { foreignKey: "sale_id", as: "payments" });
Payment.belongsTo(Sale, { foreignKey: "sale_id" });

// --- MOVEMENTS ---
StockMovement.hasMany(StockMovementItem, { foreignKey: "movement_id", as: "items" });
StockMovementItem.belongsTo(StockMovement, { foreignKey: "movement_id", as: "movement" });

// ==========================================
// EXPORTACIÓN
// ==========================================
module.exports = {
  sequelize,
  User, Role, Permission, UserRole, RolePermission,
  Category, Product, ProductImage, Branch, Warehouse,
  StockBalance, StockMovement, StockMovementItem,
  Sale, SaleItem, Payment
};