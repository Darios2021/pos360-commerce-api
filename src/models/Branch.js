// src/models/Branch.js
module.exports = (sequelize, DataTypes) => {
  return sequelize.define(
    "Branch",
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      code: { type: DataTypes.STRING(30), allowNull: false },
      name: { type: DataTypes.STRING(120), allowNull: false },

      address: { type: DataTypes.STRING(255), allowNull: true },
      city: { type: DataTypes.STRING(120), allowNull: true },
      province: { type: DataTypes.STRING(120), allowNull: true },

      // Geo: para mostrar en mapa Leaflet del checkout / shop público
      latitude: { type: DataTypes.DECIMAL(10, 7), allowNull: true },
      longitude: { type: DataTypes.DECIMAL(10, 7), allowNull: true },

      phone: { type: DataTypes.STRING(50), allowNull: true },
      hours: { type: DataTypes.STRING(255), allowNull: true },
      maps_url: { type: DataTypes.STRING(500), allowNull: true },

      is_active: { type: DataTypes.TINYINT, allowNull: false, defaultValue: 1 },
    },
    {
      tableName: "branches",
      timestamps: true,
      underscored: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );
};
