const fs = require("fs");
const path = require("path");
const { FiscalConfig, FiscalCertificate, Branch } = require("../../models");

function onlyDigits(v) {
  return String(v || "").replace(/\D+/g, "");
}

function isValidCuit(v) {
  const s = onlyDigits(v);
  return s.length === 11;
}

async function requireBranch(branchId) {
  const branch = await Branch.findByPk(branchId);
  if (!branch) {
    const err = new Error("Sucursal no encontrada.");
    err.status = 404;
    throw err;
  }
  return branch;
}

async function getConfigByBranch(branchId) {
  return FiscalConfig.findOne({
    where: { branch_id: branchId },
    include: [
      { model: Branch, as: "branch" },
      { model: FiscalCertificate, as: "activeCertificate", required: false },
    ],
  });
}

async function getActiveCertificate(branchId) {
  return FiscalCertificate.findOne({
    where: { branch_id: branchId, active: 1 },
    order: [["id", "DESC"]],
  });
}

function validateCertificatePaths(certPath, keyPath) {
  if (!certPath || !keyPath) {
    return {
      ok: false,
      message: "Faltan cert_path o key_path.",
    };
  }

  const certAbs = path.resolve(certPath);
  const keyAbs = path.resolve(keyPath);

  if (!fs.existsSync(certAbs)) {
    return { ok: false, message: `No existe cert_path: ${certAbs}` };
  }

  if (!fs.existsSync(keyAbs)) {
    return { ok: false, message: `No existe key_path: ${keyAbs}` };
  }

  return {
    ok: true,
    cert_path: certAbs,
    key_path: keyAbs,
  };
}

module.exports = {
  onlyDigits,
  isValidCuit,
  requireBranch,
  getConfigByBranch,
  getActiveCertificate,
  validateCertificatePaths,
};