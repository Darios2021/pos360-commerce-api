// src/models/UserSignature.js
//
// Firma personal del usuario logueado para envíos de email del CRM.
// Cada usuario tiene una sola firma (UNIQUE user_id). Cuando el usuario
// envía un correo desde Send Message Dialog y activa "incluir firma", el
// layout inserta este bloque al final del cuerpo (sobre el footer global).
//
// Si el usuario no tiene firma cargada, el toggle "incluir firma" no
// muestra nada (no hay fallback a otra firma).

module.exports = (sequelize, DataTypes) => {
  const UserSignature = sequelize.define(
    "UserSignature",
    {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
      },
      user_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: false,
        unique: true,
      },
      display_name: { type: DataTypes.STRING(120), allowNull: true },
      role_title:   { type: DataTypes.STRING(120), allowNull: true },
      email:        { type: DataTypes.STRING(180), allowNull: true },
      phone:        { type: DataTypes.STRING(60),  allowNull: true },
      whatsapp:     { type: DataTypes.STRING(60),  allowNull: true },
      photo_url:    { type: DataTypes.STRING(512), allowNull: true },
      tagline:      { type: DataTypes.STRING(255), allowNull: true },
      include_by_default: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      created_at:   { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at:   { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    {
      tableName: "user_signatures",
      underscored: true,
      timestamps: true,
      paranoid: false,
      createdAt: "created_at",
      updatedAt: "updated_at",
      indexes: [{ unique: true, fields: ["user_id"] }],
    }
  );

  return UserSignature;
};
