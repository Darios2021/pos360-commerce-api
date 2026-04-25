// src/models/BrandingAsset.js
//
// Assets de branding por tipo. Sirve para íconos custom de redes sociales
// y cualquier otro asset reutilizable que el admin quiera subir desde el
// panel (logos secundarios, sellos, banners, etc.).
//
// Cada fila es un asset único por `kind`. Si el admin sube un nuevo PNG
// para "instagram", reemplaza el anterior (la app borra del S3 el anterior
// para no acumular archivos huérfanos — eso lo hace el controller).
//
// Tipos esperados: instagram, facebook, whatsapp, twitter, x, tiktok,
// youtube, linkedin, telegram, website, email. La columna no es ENUM para
// permitir tipos custom en el futuro.

module.exports = (sequelize, DataTypes) => {
  const BrandingAsset = sequelize.define(
    "BrandingAsset",
    {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
      },
      kind: {
        type: DataTypes.STRING(40),
        allowNull: false,
        unique: true,
      },
      url: {
        type: DataTypes.STRING(512),
        allowNull: false,
      },
      // Color de fondo opcional para mostrar el asset en un círculo cuando
      // el ícono que sube el admin sea monocromo y necesite contraste.
      bg_color: {
        type: DataTypes.STRING(20),
        allowNull: true,
      },
      label: {
        type: DataTypes.STRING(80),
        allowNull: true,
      },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    {
      tableName: "branding_assets",
      underscored: true,
      timestamps: true,
      paranoid: false,
      createdAt: "created_at",
      updatedAt: "updated_at",
      indexes: [
        { unique: true, fields: ["kind"] },
      ],
    }
  );

  return BrandingAsset;
};
