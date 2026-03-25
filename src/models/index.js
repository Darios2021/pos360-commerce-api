// src/models/index.js
// ✅ COPY-PASTE FINAL COMPLETO
// - Subcategory + Product->createdByUser + SaleRefund/SaleExchange
// - blindado anti-crash + ShopLink opcional
// - ✅ ProductVideo (opcional) + asociaciones Product ↔ ProductVideo
// - ✅ CashRegister + CashMovement (opcionales) + asociaciones con Branch/User/Sale
// - ✅ POS fiscal preparado con models nuevos: Sale / SaleItem / Payment / SaleDocument*
// - ✅ FiscalConfig + FiscalCertificate (opcionales)
// - ✅ FIX: sin ejecutar associate(models) al final para evitar aliases duplicados

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

// ===== ProductVideo (opcional) =====
let ProductVideo = null;
try {
  ProductVideo = require("./ProductVideo")(sequelize, DataTypes);
} catch (e1) {
  try {
    ProductVideo = require("./productVideo.model")(sequelize, DataTypes);
  } catch (e2) {
    console.log("⚠️ ProductVideo no cargado (models/ProductVideo.js no encontrado o falló)");
    ProductVideo = null;
  }
}

// ===== POS CORE =====
const Sale = require("./Sale")(sequelize, DataTypes);
const SaleItem = require("./SaleItem")(sequelize, DataTypes);
const Payment = require("./Payment")(sequelize, DataTypes);

// ===== POS FISCAL =====
let SaleDocument = null;
let SaleDocumentVatLine = null;
let SaleDocumentTaxLine = null;
let SaleDocumentRelation = null;

try {
  SaleDocument = require("./SaleDocument")(sequelize, DataTypes);
} catch (e) {
  console.log("⚠️ SaleDocument no cargado");
}

try {
  SaleDocumentVatLine = require("./SaleDocumentVatLine")(sequelize, DataTypes);
} catch (e) {
  console.log("⚠️ SaleDocumentVatLine no cargado");
}

try {
  SaleDocumentTaxLine = require("./SaleDocumentTaxLine")(sequelize, DataTypes);
} catch (e) {
  console.log("⚠️ SaleDocumentTaxLine no cargado");
}

try {
  SaleDocumentRelation = require("./SaleDocumentRelation")(sequelize, DataTypes);
} catch (e) {
  console.log("⚠️ SaleDocumentRelation no cargado");
}

// ===== POS EXT =====
let SaleRefund = null;
let SaleExchange = null;

try {
  SaleRefund = require("./SaleRefund")(sequelize, DataTypes);
} catch (e) {
  console.log("⚠️ SaleRefund no cargado (models/SaleRefund.js no encontrado o falló)");
}

try {
  SaleExchange = require("./SaleExchange")(sequelize, DataTypes);
} catch (e) {
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
    console.log("⚠️ CashMovement no cargado (models/CashMovement.js no encontrado o falló)");
    CashMovement = null;
  }
}

// ===== ShopLink (opcional) =====
let ShopLink = null;
try {
  ShopLink = require("./ShopLink")(sequelize, DataTypes);
} catch (e) {
  console.log("⚠️ ShopLink no cargado (models/ShopLink.js no encontrado o falló)");
}

// ===== EcomCustomer (opcional) =====
let EcomCustomer = null;
try {
  EcomCustomer = require("./EcomCustomer")(sequelize, DataTypes);
} catch (e1) {
  try {
    EcomCustomer = require("./ecom_customer")(sequelize, DataTypes);
  } catch (e2) {
    console.log("⚠️ EcomCustomer no cargado");
    EcomCustomer = null;
  }
}

// ===== FISCAL ADMIN (opcionales) =====
let FiscalConfig = null;
let FiscalCertificate = null;

try {
  FiscalConfig = require("./FiscalConfig")(sequelize, DataTypes);
} catch (e) {
  console.log("⚠️ FiscalConfig no cargado");
}

try {
  FiscalCertificate = require("./FiscalCertificate")(sequelize, DataTypes);
} catch (e) {
  console.log("⚠️ FiscalCertificate no cargado");
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

// Roles ↔ Permissions
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

// Users ↔ Branches
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

// Product ↔ Videos
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

if (CashRegister) {
  safeBelongsTo(Sale, CashRegister, {
    foreignKey: "cash_register_id",
    as: "cashRegister",
  });
  safeHasMany(CashRegister, Sale, {
    foreignKey: "cash_register_id",
    as: "sales",
  });
}

if (EcomCustomer) {
  safeBelongsTo(Sale, EcomCustomer, {
    foreignKey: "customer_id",
    as: "customer",
  });
}

safeHasMany(Sale, SaleItem, { foreignKey: "sale_id", as: "items" });
safeBelongsTo(SaleItem, Sale, { foreignKey: "sale_id", as: "sale" });

safeBelongsTo(SaleItem, Product, { foreignKey: "product_id", as: "product" });
safeBelongsTo(SaleItem, Warehouse, { foreignKey: "warehouse_id", as: "warehouse" });

safeHasMany(Sale, Payment, { foreignKey: "sale_id", as: "payments" });
safeBelongsTo(Payment, Sale, { foreignKey: "sale_id", as: "sale" });

// CAJA: CashRegister ↔ Branch/User
if (CashRegister) {
  safeBelongsTo(CashRegister, Branch, { foreignKey: "branch_id", as: "branch" });
  safeHasMany(Branch, CashRegister, { foreignKey: "branch_id", as: "cashRegisters" });

  safeBelongsTo(CashRegister, User, { foreignKey: "opened_by", as: "openedBy" });
  safeHasMany(User, CashRegister, { foreignKey: "opened_by", as: "openedCashRegisters" });

  safeBelongsTo(CashRegister, User, { foreignKey: "closed_by", as: "closedBy" });
  safeHasMany(User, CashRegister, { foreignKey: "closed_by", as: "closedCashRegisters" });
}

// CAJA: CashMovement ↔ CashRegister/User
if (CashMovement && CashRegister) {
  safeBelongsTo(CashMovement, CashRegister, { foreignKey: "cash_register_id", as: "cashRegister" });
  safeHasMany(CashRegister, CashMovement, { foreignKey: "cash_register_id", as: "movements" });
}
if (CashMovement) {
  safeBelongsTo(CashMovement, User, { foreignKey: "user_id", as: "user" });
  safeHasMany(User, CashMovement, { foreignKey: "user_id", as: "cashMovements" });
}

// POS EXT: Refunds + Exchanges
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

// ===== POS FISCAL =====
if (SaleDocument) {
  safeBelongsTo(SaleDocument, Sale, { foreignKey: "sale_id", as: "sale" });
  safeHasMany(Sale, SaleDocument, { foreignKey: "sale_id", as: "documents" });

  safeBelongsTo(Sale, SaleDocument, {
    foreignKey: "fiscal_document_id",
    as: "fiscalDocument",
  });

  safeBelongsTo(SaleDocument, Branch, {
    foreignKey: "branch_id",
    as: "branch",
  });

  if (CashRegister) {
    safeBelongsTo(SaleDocument, CashRegister, {
      foreignKey: "cash_register_id",
      as: "cashRegister",
    });
  }

  safeBelongsTo(SaleDocument, User, {
    foreignKey: "issued_by",
    as: "issuedBy",
  });

  if (EcomCustomer) {
    safeBelongsTo(SaleDocument, EcomCustomer, {
      foreignKey: "customer_id",
      as: "customer",
    });
  }
}

if (SaleDocument && SaleDocumentVatLine) {
  safeHasMany(SaleDocument, SaleDocumentVatLine, {
    foreignKey: "sale_document_id",
    as: "vatLines",
  });
  safeBelongsTo(SaleDocumentVatLine, SaleDocument, {
    foreignKey: "sale_document_id",
    as: "document",
  });
}

if (SaleDocument && SaleDocumentTaxLine) {
  safeHasMany(SaleDocument, SaleDocumentTaxLine, {
    foreignKey: "sale_document_id",
    as: "taxLines",
  });
  safeBelongsTo(SaleDocumentTaxLine, SaleDocument, {
    foreignKey: "sale_document_id",
    as: "document",
  });
}

if (SaleDocument && SaleDocumentRelation) {
  safeHasMany(SaleDocument, SaleDocumentRelation, {
    foreignKey: "sale_document_id",
    as: "relations",
  });

  safeHasMany(SaleDocument, SaleDocumentRelation, {
    foreignKey: "related_sale_document_id",
    as: "relatedToMe",
  });

  safeBelongsTo(SaleDocumentRelation, SaleDocument, {
    foreignKey: "sale_document_id",
    as: "document",
  });

  safeBelongsTo(SaleDocumentRelation, SaleDocument, {
    foreignKey: "related_sale_document_id",
    as: "relatedDocument",
  });
}

// ===== FISCAL ADMIN =====
if (FiscalConfig) {
  safeBelongsTo(FiscalConfig, Branch, {
    foreignKey: "branch_id",
    as: "branch",
  });
  safeHasMany(Branch, FiscalConfig, {
    foreignKey: "branch_id",
    as: "fiscalConfigs",
  });
}

if (FiscalCertificate) {
  safeBelongsTo(FiscalCertificate, Branch, {
    foreignKey: "branch_id",
    as: "branch",
  });
  safeHasMany(Branch, FiscalCertificate, {
    foreignKey: "branch_id",
    as: "fiscalCertificates",
  });
}

if (FiscalConfig && FiscalCertificate) {
  safeBelongsTo(FiscalConfig, FiscalCertificate, {
    foreignKey: "cert_active_id",
    as: "activeCertificate",
  });
}

const models = {
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

  // POS fiscal
  SaleDocument,
  SaleDocumentVatLine,
  SaleDocumentTaxLine,
  SaleDocumentRelation,

  // POS EXT
  SaleRefund,
  SaleExchange,

  // CAJA
  CashRegister,
  CashMovement,

  // Shop / Customer
  ShopLink,
  EcomCustomer,

  // Fiscal admin
  FiscalConfig,
  FiscalCertificate,
};

module.exports = models;