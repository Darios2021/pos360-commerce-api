// src/services/media.service.js
// ✅ COPY-PASTE FINAL COMPLETO

import api from "@/services/api";

export async function listMediaImages(params = {}) {
  const { data } = await api.get("/v1/admin/media/images", { params });
  return data;
}

export async function deleteMediaImage(id) {
  const { data } = await api.delete(`/v1/admin/media/images/${id}`);
  return data;
}
