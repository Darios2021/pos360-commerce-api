module.exports = (sequelize, DataTypes) => {
  const Category = sequelize.define(
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

  Category.associate = (models) => {
    Category.belongsTo(models.Category, { foreignKey: "parent_id", as: "parent" });
    Category.hasMany(models.Category, { foreignKey: "parent_id", as: "children" });
  };

  return Category;
};
