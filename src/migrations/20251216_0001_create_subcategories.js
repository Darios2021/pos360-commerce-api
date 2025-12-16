"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("subcategories", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },

      category_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "categories", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
      },

      name: { type: Sequelize.STRING(120), allowNull: false },
      description: { type: Sequelize.TEXT, allowNull: true },
      is_active: { type: Sequelize.TINYINT, allowNull: false, defaultValue: 1 },

      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    });

    await queryInterface.addIndex("subcategories", ["category_id"]);
    await queryInterface.addIndex("subcategories", ["name"]);
  },

  async down(queryInterface) {
    await queryInterface.dropTable("subcategories");
  },
};
