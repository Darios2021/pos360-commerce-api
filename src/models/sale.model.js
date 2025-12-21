module.exports = (sequelize, DataTypes) => {
  const Sale = sequelize.define("Sale", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    sale_date: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    total_amount: { type: DataTypes.DECIMAL(15, 2), defaultValue: 0 },
    status: { type: DataTypes.STRING, defaultValue: 'completed' }, // pending, completed, cancelled
    branch_id: { type: DataTypes.INTEGER },
    user_id: { type: DataTypes.INTEGER }
  }, {
    tableName: 'sales',
    underscored: true,
    timestamps: true,
    paranoid: true
  });

  return Sale;
};