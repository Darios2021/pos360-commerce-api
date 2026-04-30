"use strict";

/**
 * Migración: tablas product_questions + product_reviews
 *
 * - product_questions: preguntas públicas del comprador con respuesta opcional del vendedor.
 * - product_reviews:   calificación 1-5 + comentario. Una review por (product, customer).
 *
 * Soft moderation:
 *   - is_public / is_visible permiten ocultar sin borrar.
 *
 * Verified purchase:
 *   - is_verified_purchase se setea cuando el customer tuvo al menos un pedido entregado
 *     del producto. Se calcula al crear la review en el controller.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    // ============= product_questions =============
    await queryInterface.createTable("product_questions", {
      id: {
        type: Sequelize.BIGINT.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
      },
      product_id: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: false,
        references: { model: "products", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      customer_id: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: false,
        references: { model: "ecom_customers", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      text: { type: Sequelize.TEXT, allowNull: false },
      is_public: { type: Sequelize.TINYINT, allowNull: false, defaultValue: 1 },

      // respuesta del vendedor (admin)
      answer: { type: Sequelize.TEXT, allowNull: true },
      answered_by_user_id: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: true,
        references: { model: "users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      answered_at: { type: Sequelize.DATE, allowNull: true },

      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    });
    await queryInterface.addIndex("product_questions", ["product_id"]);
    await queryInterface.addIndex("product_questions", ["customer_id"]);
    await queryInterface.addIndex("product_questions", ["is_public"]);
    await queryInterface.addIndex("product_questions", ["created_at"]);

    // ============= product_reviews =============
    await queryInterface.createTable("product_reviews", {
      id: {
        type: Sequelize.BIGINT.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
      },
      product_id: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: false,
        references: { model: "products", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      customer_id: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: false,
        references: { model: "ecom_customers", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      rating: { type: Sequelize.TINYINT.UNSIGNED, allowNull: false }, // 1..5
      comment: { type: Sequelize.TEXT, allowNull: true },

      is_verified_purchase: { type: Sequelize.TINYINT, allowNull: false, defaultValue: 0 },
      is_visible: { type: Sequelize.TINYINT, allowNull: false, defaultValue: 1 },

      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    });
    // Una review por usuario por producto
    await queryInterface.addIndex("product_reviews", {
      fields: ["product_id", "customer_id"],
      unique: true,
      name: "uq_product_reviews_product_customer",
    });
    await queryInterface.addIndex("product_reviews", ["product_id"]);
    await queryInterface.addIndex("product_reviews", ["rating"]);
    await queryInterface.addIndex("product_reviews", ["is_visible"]);
    await queryInterface.addIndex("product_reviews", ["created_at"]);
  },

  async down(queryInterface) {
    await queryInterface.dropTable("product_reviews");
    await queryInterface.dropTable("product_questions");
  },
};
