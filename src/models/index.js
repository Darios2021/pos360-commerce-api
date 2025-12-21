// src/models/index.js
const { DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

// ===== AUTH =====
const User = require("./User")(sequelize, DataTypes);
const Role = require("./Role")(sequelize, DataTypes);
const Permission = require("./permission")(sequelize, DataTypes);
const UserRole = require("./user_role")(sequelize, DataTypes);

let RolePermission = null;
try {
  RolePermission = require("./role_permission")(sequelize, DataTypes);
} catch (_) {}

// ===== INVENTORY =====
const Category = require("./Category")(sequelize, DataTypes);
const Product = require("./Product")(sequelize, DataTypes);
const ProductImage = require("./ProductImage")(sequelize, DataTypes); // ✅ NEW
const Branch = require("./Branch")(sequelize, DataTypes);
const Warehouse = require("./Warehouse")(sequelize, DataTypes);
const StockBalance = require("./StockBalance")(sequelize, DataTypes);
const StockMovement = require("./StockMovement")(sequelize, DataTypes);
const StockMovementItem = require("./StockMovementItem")(sequelize, DataTypes);

// =====================
// AUTH Associations
// =====================
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

// =====================
// INVENTORY Associations
// =====================

// Category jerárquica
Category.belongsTo(Category, {
  foreignKey: "parent_id",
  as: "parent",
});
Category.hasMany(Category, {
  foreignKey: "parent_id",
  as: "children",
});

// Product → Category (HOJA: subrubro)
Product.belongsTo(Category, {
  foreignKey: "category_id",
  as: "category",
});
Category.hasMany(Product, {
  foreignKey: "category_id",
  as: "products",
});

// ✅ Product ↔ Images
Product.hasMany(ProductImage, {
  foreignKey: "product_id",
  as: "images",
});
ProductImage.belongsTo(Product, {
  foreignKey: "product_id",
  as: "product",
});

// Branch → Warehouses
Warehouse.belongsTo(Branch, {
  foreignKey: "branch_id",
  as: "branch",
});
Branch.hasMany(Warehouse, {
  foreignKey: "branch_id",
  as: "warehouses",
});

// Stock balance
StockBalance.belongsTo(Warehouse, {
  foreignKey: "warehouse_id",
  as: "warehouse",
});
StockBalance.belongsTo(Product, {
  foreignKey: "product_id",
  as: "product",
});

// Movimientos de stock
StockMovement.hasMany(StockMovementItem, {
  foreignKey: "movement_id",
  as: "items",
});
StockMovementItem.belongsTo(StockMovement, {
  foreignKey: "movement_id",
  as: "movement",
});
StockMovementItem.belongsTo(Product, {
  foreignKey: "product_id",
  as: "product",
});

module.exports = {
  sequelize,

  // auth
  User,
  Role,
  Permission,
  UserRole,
  RolePermission,

  // inventory
  Category,
  Product,
  ProductImage, // ✅ NEW
  Branch,
  Warehouse,
  StockBalance,
  StockMovement,
  StockMovementItem,
};
