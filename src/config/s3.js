// src/config/s3.js
const {
  S3Client,
} = require("@aws-sdk/client-s3");

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

const s3Config = {
  provider: process.env.S3_PROVIDER || "minio",
  endpoint: required("S3_ENDPOINT"), // e.g. https://minio-coc-api.cingulado.org
  region: process.env.S3_REGION || "us-east-1",
  bucket: required("S3_BUCKET"),
  accessKeyId: required("S3_ACCESS_KEY"),
  secretAccessKey: required("S3_SECRET_KEY"),
  forcePathStyle: String(process.env.S3_FORCE_PATH_STYLE || "true") === "true",
  ssl: String(process.env.S3_SSL || "true") === "true",
};

const s3 = new S3Client({
  region: s3Config.region,
  endpoint: s3Config.endpoint,
  forcePathStyle: s3Config.forcePathStyle,
  credentials: {
    accessKeyId: s3Config.accessKeyId,
    secretAccessKey: s3Config.secretAccessKey,
  },
});

module.exports = { s3, s3Config };
