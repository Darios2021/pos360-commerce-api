// src/models/MessageLog.js
//
// Historial de cada mensaje enviado (o intentado enviar). Sirve para:
//   - mostrar timeline en el detalle del cliente
//   - debug de fallos (ver `error_message`)
//   - auditoría de quién envió qué y cuándo
//   - evitar duplicados / spam (consultar última fecha por cliente+canal)

module.exports = (sequelize, DataTypes) => {
  const MessageLog = sequelize.define(
    "MessageLog",
    {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
      },

      customer_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: true,
      },

      channel: {
        type: DataTypes.ENUM("email", "whatsapp"),
        allowNull: false,
      },

      // Plantilla usada (opcional — los envíos one-off no tienen).
      template_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: true,
      },

      // A quién se mandó (snapshot del momento, por si el customer cambia).
      to_address: { type: DataTypes.STRING(200), allowNull: false }, // email o phone
      to_name:    { type: DataTypes.STRING(200), allowNull: true },

      // Contenido enviado (snapshot ya renderizado con variables).
      subject: { type: DataTypes.STRING(255), allowNull: true },
      body:    { type: DataTypes.TEXT("medium"), allowNull: false },

      // Estado del envío.
      status: {
        type: DataTypes.ENUM("queued", "sent", "failed", "manual_link"),
        allowNull: false,
        defaultValue: "queued",
      },

      // Detalles para debug.
      provider:        { type: DataTypes.STRING(40), allowNull: true },  // smtp, whatsapp_cloud, wa_me
      provider_msg_id: { type: DataTypes.STRING(120), allowNull: true },
      error_message:   { type: DataTypes.TEXT, allowNull: true },

      // Quién disparó el envío (admin que clickeó).
      sent_by: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },

      sent_at:    { type: DataTypes.DATE, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    {
      tableName: "message_logs",
      underscored: true,
      timestamps: true,
      paranoid: false,
      createdAt: "created_at",
      updatedAt: "updated_at",
      indexes: [
        { fields: ["customer_id"] },
        { fields: ["channel"] },
        { fields: ["status"] },
        { fields: ["sent_at"] },
      ],
    }
  );

  return MessageLog;
};
