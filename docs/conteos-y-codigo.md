# Conteos de stock y consulta por código

Contrato de la API para el teléfono como cargador y consultor (maqueta
`docs/diseno-cargador/maqueta.html` del front, pantallas `resultado`, `conteo`
y `conteo-revisar`). Todas las rutas van bajo `/api/v1`, con
`Authorization: Bearer <token>` y, opcional, `X-Branch-Id` (sucursal activa,
como en el resto de la API).

Errores: siempre `{ ok: false, code, message }` con el estado HTTP que
corresponda (400 validación, 403 permiso o ámbito, 404 no existe, 422 estado
que no permite la acción).

---

## 1. Producto por código exacto

`GET /products/by-code/:code`

- Busca coincidencia **exacta** (sin LIKE) en `barcode`, `sku` o `code`.
  Incluye productos inactivos. El código se toma tal cual (se recortan
  espacios; los ceros a la izquierda se respetan). Si el código lleva `/` o
  espacios, va codificado con `encodeURIComponent`.
- Si hay más de un producto con ese código, gana en este orden: `barcode`,
  después `sku`, después `code`; a igualdad, el de `id` más bajo.
- Respuesta: **la misma de `GET /products/:id`** (`{ ok: true, data: {...} }`,
  con `stock_qty` de la sucursal, imágenes, rubro, etc.).
- `404 { code: "NOT_FOUND" }` si ningún producto tiene ese código.
- Ámbito: igual que `GET /products/:id`. Un usuario que no es administrador
  recibe `403 { code: "FORBIDDEN_SCOPE" }` si el producto no está habilitado
  en su sucursal.

---

## 2. Conteos de stock

Un conteo es de **un depósito**. Se guarda en el servidor: se puede retomar en
otro teléfono y lo pueden cargar dos personas a la vez.

### Estados

| Estado | Qué significa | Quién lo deja así |
|---|---|---|
| `draft` | Abierto, se está contando | Al crearlo |
| `pending` | Enviado para aprobar | Cualquiera con acceso al depósito (`submit`) |
| `applied` | Aplicado al stock | Sólo administrador (`apply`) |
| `cancelled` | Descartado | Quien lo creó o un administrador (`cancel`) |

Transiciones: `draft -> pending -> applied`, `draft -> applied` (el
administrador aplica directo, sin enviar), `draft|pending -> cancelled`.
`applied` y `cancelled` son finales.

### Roles

- **Administrador** = los mismos que hoy pueden `POST /stock/init`:
  `super_admin` (cualquier sucursal) y `admin` (sus sucursales habilitadas).
- **Cajero** (cualquier otro rol): crea, carga, envía y cancela los suyos.
  **No aplica** (`403 { code: "FORBIDDEN" }`).
- Ámbito: el depósito tiene que ser de una sucursal habilitada del usuario
  (`super_admin` ve todas). Fuera de ámbito: `403 { code: "FORBIDDEN_BRANCH" }`.
  Dentro de la sucursal, todos ven todos los conteos (para contar entre dos).

### Objeto conteo

```json
{
  "id": 12,
  "number": "CON-2026-000012",
  "warehouse_id": 3,
  "branch_id": 2,
  "status": "draft",
  "motivo": "Conteo de góndola",
  "created_by": 7,  "created_at": "2026-10-12T14:02:11.000Z",
  "submitted_by": null, "submitted_at": null,
  "applied_by": null,   "applied_at": null,
  "cancelled_by": null, "cancelled_at": null,
  "updated_at": "2026-10-12T14:05:40.000Z",
  "warehouse": { "id": 3, "name": "Depósito principal", "branch": { "id": 2, "name": "Centro" } },
  "creator":   { "id": 7, "first_name": "Lucía", "last_name": "Gómez" },
  "submitter": null, "applier": null,
  "items": [
    {
      "id": 40,
      "product_id": 15,
      "counted_qty": "8.000",
      "system_qty": "10.000",
      "diff_qty": "-2.000",
      "updated_by": 7,
      "updated_at": "2026-10-12T14:05:40.000Z",
      "product": { "id": 15, "name": "Cargador 20 W USB-C", "sku": "CAR-020", "barcode": "7790000000155", "code": "P00015", "is_active": true, "images": [{ "url": "...", "sort_order": 0 }] }
    }
  ],
  "summary": { "items": 1, "with_diff": 1, "equal": 0 }
}
```

- `counted_qty`, `system_qty` y `diff_qty` vienen como texto decimal con 3
  decimales (así devuelve Sequelize los `DECIMAL`).
- Mientras el conteo está abierto (`draft` o `pending`), `system_qty` es el
  stock **actual** del depósito y `diff_qty = counted_qty - system_qty`: sirve
  para la pantalla de diferencias. Al aplicar se congela el stock que había en
  ese momento y ya no cambia.
- La lista (`GET /stock/counts`) no trae `items`: trae `items_count`.
- `product.images` trae a lo sumo una imagen (la de menor `sort_order`).
- Los renglones vienen ordenados por última carga (el más reciente primero).

### `POST /stock/counts`

Crea un conteo en `draft`.

```json
{
  "warehouse_id": 3,
  "motivo": "Conteo de góndola",
  "items": [{ "product_id": 15, "counted_qty": 8 }, { "product_id": 16, "counted_qty": 0 }]
}
```

- `warehouse_id` opcional: si no viene, se usa el depósito de la sucursal
  activa.
- `motivo` opcional al crear (texto, hasta 255). `items` opcional (puede
  arrancar vacío).
- `counted_qty`: número `>= 0` (acepta coma decimal). Un producto repetido en
  el mismo cuerpo se suma.
- Producto inexistente: `404 { code: "PRODUCT_NOT_FOUND", product_id }`.
  Producto sin control de stock (`track_stock = 0`):
  `422 { code: "PRODUCT_NO_STOCK_TRACK", product_id }`.
- Respuesta `201 { ok: true, count }` (con `items`).

### `GET /stock/counts?status=&warehouse_id=&page=&limit=`

```json
{
  "ok": true,
  "counts": [ { "id": 12, "number": "CON-2026-000012", "status": "draft", "items_count": 4, "...": "..." } ],
  "total": 1,
  "total_all": 5,
  "count_by_status": { "draft": 1, "pending": 2, "applied": 2 },
  "page": 1,
  "limit": 20
}
```

- `status` admite uno (`pending`) o varios separados por coma (`draft,pending`).
- `count_by_status` y `total_all` cuentan dentro del ámbito, sin el filtro de
  estado (para los chips). `limit` máximo 50.

### `GET /stock/counts/:id`

`{ ok: true, count }` con `items`.

### `PUT /stock/counts/:id`

Carga cantidades mientras el conteo está abierto.

```json
{
  "mode": "sumar",
  "items": [{ "product_id": 15, "counted_qty": 1 }],
  "remove_product_ids": [16],
  "motivo": "Conteo de góndola"
}
```

- `mode`:
  - `"reemplazar"` (por defecto): fija `counted_qty` de cada producto enviado.
    Los demás renglones no se tocan. Es idempotente (un reintento no duplica).
  - `"sumar"`: suma `counted_qty` al renglón (lo crea si no existe). Es lo que
    usa el lector continuo: cada lectura manda `+1`. Dos teléfonos pueden
    sumar a la vez sin pisarse.
  - `"reemplazar_todo"`: la lista enviada pasa a ser el conteo entero; los
    productos que no vienen se quitan.
- `remove_product_ids`: quita esos renglones.
- `motivo`: si viene, lo actualiza.
- En `"sumar"` el resultado no puede quedar negativo (un `-1` sobre `0` da
  `400 { code: "QTY_INVALID" }`).
- Estado: en `draft` lo edita cualquiera con acceso; en `pending` sólo un
  administrador (para corregir antes de aplicar). En otro estado:
  `422 { code: "COUNT_NOT_OPEN" }`; cajero sobre `pending`:
  `403 { code: "FORBIDDEN" }`.
- Respuesta `{ ok: true, count }`.

### `POST /stock/counts/:id/submit`

Cuerpo opcional `{ "motivo": "..." }`. `draft -> pending`. Exige al menos un
renglón (`422 { code: "COUNT_EMPTY" }`) y motivo (el que ya tenga o el que venga
en el cuerpo; si falta, `400 { code: "MOTIVO_REQUIRED" }`). Respuesta
`{ ok: true, count }`.

### `POST /stock/counts/:id/apply`

Sólo administrador. Cuerpo opcional `{ "motivo": "..." }`. Desde `draft` o
`pending`. Exige renglones y motivo, como `submit`.

En **una transacción**:

1. Bloquea el conteo y, por cada renglón, la fila de `stock_balances`
   (`FOR UPDATE`).
2. Guarda en el renglón `system_qty` = stock que había y `diff_qty`.
3. Fija el stock del depósito en `counted_qty` (valor absoluto, como
   `/stock/init`).
4. Por cada renglón con diferencia registra un movimiento `adjustment` en
   `stock_movements` (`ref_type: "stock_count"`, `ref_id: <id del conteo>`,
   `created_by`: quien aplica, `note`: `"<número> · <motivo> · <sistema> -> <contado> (<±dif>)"`)
   con un ítem en `stock_movement_items` (`qty` = diferencia **en valor
   absoluto**; el signo queda en `diff_qty` del renglón y en la nota). Los
   renglones sin diferencia no generan movimiento.
5. Si el producto contado con cantidad mayor a 0 no estaba habilitado en la
   sucursal, lo habilita (`product_branches`), como la recepción de
   derivaciones.
6. Pasa el conteo a `applied`.

Respuesta:

```json
{ "ok": true, "count": { "...": "...", "status": "applied" }, "movements": [101, 102], "summary": { "items": 4, "with_diff": 2, "equal": 2 } }
```

Errores: `403 { code: "FORBIDDEN" }` (no es administrador),
`422 { code: "COUNT_NOT_OPEN" }` (ya aplicado o cancelado),
`422 { code: "COUNT_EMPTY" }`, `400 { code: "MOTIVO_REQUIRED" }`.

### `POST /stock/counts/:id/cancel`

`draft|pending -> cancelled`. Quien lo creó o un administrador; otro cajero:
`403 { code: "FORBIDDEN" }`. Ya aplicado o cancelado:
`422 { code: "COUNT_NOT_OPEN" }`. Respuesta `{ ok: true, count }`.

---

## 3. Tablas

Las crea el runner de arranque (`src/migrations/runner.js`, `tableSteps`) con
`CREATE TABLE IF NOT EXISTS`: `stock_counts` y `stock_count_items`. El SQL está
en el runner. Al desplegar, el runner las crea solo en el primer arranque;
para crearlas antes a mano, correr ese mismo SQL.

## 4. Prueba

`script/probar-conteos.js` recorre todo por HTTP contra una MySQL descartable
en docker (el encabezado del script tiene el comando). Se niega a correr si la
base no es local o su nombre no contiene `prueba`. Cubre: código exacto
(barcode, SKU, code, inactivo, parcial, fuera de ámbito), crear, sumar entre
dos usuarios a la vez, reemplazar, quitar, validaciones, ámbito por sucursal,
enviar, cajero que no puede aplicar, aplicar (stock fijado, `system_qty`
congelado contra el stock del momento, movimientos `adjustment` con autor,
motivo y signo), aplicar directo desde borrador y cancelar.
