module.exports = (sequelize, DataTypes) => {
  return sequelize.define(
    "Category",
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING(120), allowNull: false },
      parent_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      is_active: { type: DataTypes.TINYINT, allowNull: false, defaultValue: 1 },
    },
    {
      tableName: "categories",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );
};
