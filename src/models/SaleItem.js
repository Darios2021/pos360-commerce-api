module.exports = (sequelize, DataTypes) => {
  const SaleItem = sequelize.define("SaleItem", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    sale_id: { type: DataTypes.INTEGER },
    product_id: { type: DataTypes.INTEGER },
    
    quantity: { type: DataTypes.DECIMAL(12, 3), allowNull: false },
    unit_price: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    
    // CORRECCIÓN: En tu DB es 'line_total'
    line_total: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    
    product_name_snapshot: { type: DataTypes.STRING }
  }, {
    tableName: 'sale_items',
    underscored: true,
    timestamps: true,
    paranoid: false
  });

  return SaleItem;
};