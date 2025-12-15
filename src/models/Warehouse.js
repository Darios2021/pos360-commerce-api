module.exports = (sequelize, DataTypes) => {
  return sequelize.define(
    "Warehouse",
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      branch_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      code: { type: DataTypes.STRING(30), allowNull: false },
      name: { type: DataTypes.STRING(120), allowNull: false },
      is_active: { type: DataTypes.TINYINT, allowNull: false, defaultValue: 1 },
    },
    {
      tableName: "warehouses",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );
};
