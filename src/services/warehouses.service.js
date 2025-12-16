// src/app/services/warehouses.service.js
import http from "../api/http";

export const WarehousesService = {
  async list(params = {}) {
    const { data } = await http.get("/warehouses", { params });
    return data;
  },

  async create(payload) {
    const { data } = await http.post("/warehouses", payload);
    return data;
  },
};
