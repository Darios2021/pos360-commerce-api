// =====================
// Associations - INVENTORY
// =====================

// Category hierarchy
Category.belongsTo(Category, { foreignKey: "parent_id", as: "parent" });
Category.hasMany(Category, { foreignKey: "parent_id", as: "children" });

// Product -> Category (Rubro)
Product.belongsTo(Category, { foreignKey: "category_id", as: "category" });
Category.hasMany(Product, { foreignKey: "category_id", as: "products" });

// ✅ Product -> SubCategory (también es Category)
Product.belongsTo(Category, { foreignKey: "subcategory_id", as: "subcategory" });

// Branch -> Warehouses
Warehouse.belongsTo(Branch, { foreignKey: "branch_id", as: "branch" });
Branch.hasMany(Warehouse, { foreignKey: "branch_id", as: "warehouses" });

// Stock balance
StockBalance.belongsTo(Warehouse, { foreignKey: "warehouse_id", as: "warehouse" });
StockBalance.belongsTo(Product, { foreignKey: "product_id", as: "product" });

// Movement header/items
StockMovement.hasMany(StockMovementItem, { foreignKey: "movement_id", as: "items" });
StockMovementItem.belongsTo(StockMovement, { foreignKey: "movement_id", as: "movement" });
StockMovementItem.belongsTo(Product, { foreignKey: "product_id", as: "product" });
