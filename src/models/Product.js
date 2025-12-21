module.exports = (sequelize, DataTypes) => {
  const Product = sequelize.define("Product", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING, allowNull: false },
    sku: { type: DataTypes.STRING, unique: true },
    price: { type: DataTypes.DECIMAL(15, 2), defaultValue: 0 },
    // ... el resto de tus campos (barcode, etc)
  }, {
    tableName: 'products',
    underscored: true,
    timestamps: true, // 👈 IMPORTANTE: Esto debe estar en TRUE
    paranoid: true    // 👈 El blindaje que pediste
  });

  return Product;
};