// src/models/MessageTemplate.js
//
// Plantillas reutilizables para emails y WhatsApp.
// Soportan variables que el motor de render reemplaza con datos del cliente:
//   {{first_name}}, {{last_name}}, {{display_name}}, {{phone}}, {{email}},
//   {{doc_number}}, {{total_compras}}, {{ultima_compra}}, {{ticket_promedio}}.
//
// El campo `body` puede ser HTML para email o texto plano para WhatsApp.
// `subject` solo aplica a email; en WhatsApp se ignora.

module.exports = (sequelize, DataTypes) => {
  const MessageTemplate = sequelize.define(
    "MessageTemplate",
    {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
      },

      name: {
        type: DataTypes.STRING(120),
        allowNull: false,
      },

      // Canal al que aplica. Una plantilla puede ser solo email, solo whatsapp
      // o "both" si el body sirve para los dos (texto plano).
      channel: {
        type: DataTypes.ENUM("email", "whatsapp", "both"),
        allowNull: false,
        defaultValue: "email",
      },

      subject: {
        type: DataTypes.STRING(200),
        allowNull: true,
      },

      body: {
        type: DataTypes.TEXT("medium"),
        allowNull: false,
      },

      description: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },

      // Categoría libre para agrupar (promo, bienvenida, recordatorio, etc.).
      category: {
        type: DataTypes.STRING(60),
        allowNull: true,
      },

      is_active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },

      created_by: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    {
      tableName: "message_templates",
      underscored: true,
      timestamps: true,
      paranoid: false,
      createdAt: "created_at",
      updatedAt: "updated_at",
      indexes: [
        { fields: ["channel"] },
        { fields: ["is_active"] },
        { fields: ["category"] },
      ],
    }
  );

  return MessageTemplate;
};
