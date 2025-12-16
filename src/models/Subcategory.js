"use strict";

module.exports = (sequelize, DataTypes) => {
  const Subcategory = sequelize.define(
    "Subcategory",
    {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      category_id: { type: DataTypes.INTEGER, allowNull: false },
      name: { type: DataTypes.STRING(120), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      is_active: { type: DataTypes.TINYINT, allowNull: false, defaultValue: 1 },
    },
    {
      tableName: "subcategories",
      underscored: true,
      timestamps: true,
    }
  );

  Subcategory.associate = (models) => {
    Subcategory.belongsTo(models.Category, { as: "category", foreignKey: "category_id" });
    Subcategory.hasMany(models.Product, { as: "products", foreignKey: "subcategory_id" });
  };

  return Subcategory;
};
