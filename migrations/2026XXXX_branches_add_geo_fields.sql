-- ============================================================================
-- Migration: agregar campos geo + contacto a branches
-- Fecha: 2026-04-30
-- Notas:
--   - Las columnas se agregan como NULL para no romper registros existentes.
--   - Después de aplicar, podés cargar lat/lng desde el backoffice
--     (módulo /admin/branches con map picker Leaflet).
-- ============================================================================

ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS city       VARCHAR(120)   NULL AFTER address,
  ADD COLUMN IF NOT EXISTS province   VARCHAR(120)   NULL AFTER city,
  ADD COLUMN IF NOT EXISTS latitude   DECIMAL(10,7)  NULL AFTER province,
  ADD COLUMN IF NOT EXISTS longitude  DECIMAL(10,7)  NULL AFTER latitude,
  ADD COLUMN IF NOT EXISTS hours      VARCHAR(255)   NULL AFTER phone,
  ADD COLUMN IF NOT EXISTS maps_url   VARCHAR(500)   NULL AFTER hours;

-- Índice opcional para queries por bbox (si el día de mañana querés
-- "sucursales cerca de…").  Si no, podés omitirlo.
CREATE INDEX IF NOT EXISTS idx_branches_lat_lng ON branches (latitude, longitude);

-- ============================================================================
-- Compatibilidad: MySQL < 8.0 NO soporta IF NOT EXISTS en ADD COLUMN.
-- Si tu versión es < 8.0.29, usá esta variante manual:
-- ============================================================================
-- ALTER TABLE branches
--   ADD COLUMN city       VARCHAR(120)   NULL AFTER address,
--   ADD COLUMN province   VARCHAR(120)   NULL AFTER city,
--   ADD COLUMN latitude   DECIMAL(10,7)  NULL AFTER province,
--   ADD COLUMN longitude  DECIMAL(10,7)  NULL AFTER latitude,
--   ADD COLUMN hours      VARCHAR(255)   NULL AFTER phone,
--   ADD COLUMN maps_url   VARCHAR(500)   NULL AFTER hours;
--
-- CREATE INDEX idx_branches_lat_lng ON branches (latitude, longitude);
