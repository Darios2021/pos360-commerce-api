module.exports = (sequelize, DataTypes) => {
  const SaleItem = sequelize.define("SaleItem", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    quantity: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    unit_price: { type: DataTypes.DECIMAL(15, 2), allowNull: false },
    subtotal: { type: DataTypes.DECIMAL(15, 2), allowNull: false },
    sale_id: { type: DataTypes.INTEGER },
    product_id: { type: DataTypes.INTEGER }
  }, {
    tableName: 'sale_items',
    underscored: true,
    timestamps: true,
    paranoid: true
  });

  return SaleItem;
};