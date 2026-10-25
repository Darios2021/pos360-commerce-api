#!/usr/bin/env python3
# script/servtec/extraer-excel.py
#
# Lee el libro SERV_TEC.xlsm del servicio tecnico de San Juan Tecnologia y deja
# dos archivos JSON listos para importar: clientes.json y ordenes.json.
#
# No usa dependencias: un .xlsm es un zip de XML y se lee con la stdlib. La API
# no tiene libreria de xlsx y no vale la pena sumarla por una carga que se hace
# una sola vez.
#
# Uso:
#   python3 script/servtec/extraer-excel.py ~/Descargas/SERV_TEC.xlsm
#
# Lo que sale por pantalla es el informe de calidad: cuantas filas se leyeron,
# que se descarto y por que. Conviene mirarlo antes de correr el importador.

import json
import os
import re
import sys
import unicodedata
import zipfile
import xml.etree.ElementTree as ET
from collections import Counter, OrderedDict
from datetime import date, timedelta

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
RELS_NS = "{http://schemas.openxmlformats.org/package/2006/relationships}"
DOC_RELS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"

# La hoja Datos es una tabla de Excel (Tabla1) con rango fijo A2:AB647. Abajo de
# la 647 hay ~550 filas de plantilla vacias que solo tienen la formula de la
# columna TECNICO: si no se corta, se cuelan como ordenes fantasma.
FILA_PRIMERA = 3
FILA_ULTIMA = 647

# Telefonos de San Juan: 264 + 7 digitos. Menos de 9 digitos no es un telefono,
# es un resto de tipeo (hay 130 filas con 1, 3 o 5 digitos).
TEL_MIN_DIGITOS = 9

NOMBRES_GENERICOS = {
    "", "consumidor final", "consumidor", "publico general", "cliente",
    "s/n", "sin nombre", "n/c", "x", "-",
}


# ── Lectura del xlsm ────────────────────────────────────────────────────────

def abrir_libro(ruta):
    """Devuelve (hojas_por_nombre, cadenas_compartidas)."""
    z = zipfile.ZipFile(ruta)

    cadenas = []
    if "xl/sharedStrings.xml" in z.namelist():
        raiz = ET.fromstring(z.read("xl/sharedStrings.xml"))
        for si in raiz:
            cadenas.append("".join(t.text or "" for t in si.iter(NS + "t")))

    rels = {}
    for rel in ET.fromstring(z.read("xl/_rels/workbook.xml.rels")):
        rels[rel.get("Id")] = rel.get("Target")

    hojas = {}
    for hoja in ET.fromstring(z.read("xl/workbook.xml")).find(NS + "sheets"):
        destino = rels[hoja.get(DOC_RELS + "id")]
        hojas[hoja.get("name")] = "xl/" + destino.lstrip("/")

    return z, hojas, cadenas


def leer_filas(z, ruta_hoja, cadenas):
    """Genera (numero_de_fila, {columna: valor_crudo})."""
    raiz = ET.fromstring(z.read(ruta_hoja))
    for fila in raiz.iter(NS + "row"):
        celdas = {}
        for celda in fila:
            ref = celda.get("r") or ""
            col = re.match(r"[A-Z]+", ref)
            if not col:
                continue
            tipo = celda.get("t")
            v = celda.find(NS + "v")
            if tipo == "s" and v is not None:
                valor = cadenas[int(v.text)]
            elif tipo == "inlineStr":
                nodo = celda.find(NS + "is")
                valor = "".join(t.text or "" for t in nodo.iter(NS + "t")) if nodo is not None else ""
            elif v is not None:
                valor = v.text
            else:
                valor = ""
            if valor not in (None, ""):
                celdas[col.group()] = valor
        yield int(fila.get("r")), celdas


# ── Normalizadores ──────────────────────────────────────────────────────────

def texto(v):
    return re.sub(r"\s+", " ", str(v or "")).strip()


def sin_acentos(v):
    v = unicodedata.normalize("NFD", str(v or ""))
    return "".join(c for c in v if unicodedata.category(c) != "Mn")


def clave_nombre(v):
    """Nombre normalizado para deduplicar: sin acentos, minusculas, sin dobles espacios."""
    return re.sub(r"\s+", " ", sin_acentos(v)).strip().lower()


def tokens_nombre(v):
    """Palabras significativas del nombre, para decidir si dos filas son la misma persona."""
    return {t for t in re.split(r"[^a-z]+", clave_nombre(v)) if len(t) >= 4}


def mismo_titular(nombre_a, nombre_b):
    """¿Dos filas con el mismo telefono son la misma persona?

    En el Excel un telefono se repite por dos motivos distintos: el cliente
    volvio (y el nombre se tipeo de otra forma: 'Molina Milagros' / 'Milagros
    Molina'), o es un telefono de familia que usaron dos personas ('Cristian
    Orrego' / 'Yesica Zarate'). Fusionar el segundo caso arma una ficha con dos
    titulares, que es peor que tener dos fichas con el mismo telefono.

    Criterio: alcanza con que compartan una palabra de 4 letras o mas (nombre o
    apellido, en cualquier orden). Si una de las dos filas vino sin nombre, se
    fusiona igual.
    """
    ta, tb = tokens_nombre(nombre_a), tokens_nombre(nombre_b)
    if not ta or not tb:
        return True
    return bool(ta & tb)


def nombre_propio(v):
    """El Excel mezcla MAYUSCULAS, minusculas y Titulo. Unifica a Titulo."""
    v = texto(v)
    if not v:
        return ""
    partes = []
    for p in v.split(" "):
        # DNI, SA, SRL y demas siglas cortas se dejan como estan.
        partes.append(p if (len(p) <= 3 and p.isupper()) else p.capitalize())
    return " ".join(partes)


def telefono(v):
    """Devuelve el telefono en digitos, o '' si no es usable.

    Hay dos numeros pegados en algunas filas (20 digitos): se toma el primero.
    """
    d = re.sub(r"\D", "", str(v or ""))
    if len(d) >= 19:            # dos telefonos concatenados
        d = d[:10]
    if len(d) < TEL_MIN_DIGITOS:
        return ""
    if len(d) > 13:             # basura larga que no es un telefono
        return ""
    return d


def fecha(v):
    """El Excel guarda fechas como texto dd/mm/aaaa o como serial. Devuelve ISO."""
    s = texto(v)
    if not s:
        return None
    if "/" in s:
        m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{2,4})$", s)
        if not m:
            return None
        d, mes, a = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if a < 100:
            a += 2000
        try:
            return date(a, mes, d).isoformat()
        except ValueError:
            return None
    if re.fullmatch(r"[\d.]+", s):
        try:
            serial = float(s)
        except ValueError:
            return None
        # Serial de Excel: dia 1 = 1900-01-01, con el bug del 1900 bisiesto.
        if serial < 1 or serial > 60000:
            return None
        return (date(1899, 12, 30) + timedelta(days=int(serial))).isoformat()
    return None


def numero(v):
    s = str(v or "").strip().replace(",", ".")
    if not s:
        return 0.0
    try:
        return round(float(s), 2)
    except ValueError:
        return 0.0


def booleano(v):
    s = texto(v).upper()
    return s in ("1", "VERDADERO", "TRUE", "SI", "SÍ", "X", "ENTREGADO")


# ── Estado de la orden ──────────────────────────────────────────────────────

def estado(fila):
    """Mapea las banderas sueltas del Excel al ENUM del modulo.

    El Excel no tiene un campo de estado: tiene REPARADO y ENTREGADO como
    casilleros 1/0, y el diagnostico en texto libre. El orden de la cadena
    importa: entregado gana sobre reparado, y reparado sobre todo lo demas.
    """
    reporte = sin_acentos(texto(fila.get("K", ""))).upper()
    if booleano(fila.get("N")):
        return "entregado"
    if booleano(fila.get("M")):
        return "reparado"
    if "SIN SOLUCION" in reporte or reporte in ("S-S", "S/S"):
        return "sin_solucion"
    if reporte:
        return "en_reparacion"
    if numero(fila.get("O")) > 0:
        return "presupuestado"
    return "recibido"


# ── Extraccion ──────────────────────────────────────────────────────────────

def extraer(ruta_xlsm):
    z, hojas, cadenas = abrir_libro(ruta_xlsm)

    if "Datos" not in hojas:
        raise SystemExit("El libro no tiene la hoja 'Datos'. ¿Es el SERV_TEC correcto?")

    crudas = [
        (r, d) for r, d in leer_filas(z, hojas["Datos"], cadenas)
        if FILA_PRIMERA <= r <= FILA_ULTIMA
    ]

    descartes = Counter()
    ordenes = []
    clientes = OrderedDict()   # clave de dedup -> ficha
    por_telefono = {}          # telefono -> [claves] (un tel puede tener 2 titulares)

    for nfila, f in crudas:
        nombre_crudo = texto(f.get("D", ""))
        tel = telefono(f.get("G", ""))
        clave_n = clave_nombre(nombre_crudo)

        if f.get("G") and not tel:
            descartes["telefono_invalido"] += 1

        # Identidad del cliente: telefono primero (es lo unico realmente unico
        # en este libro, no hay ni un DNI cargado), nombre despues. Un mismo
        # telefono puede pertenecer a dos titulares: ver mismo_titular().
        if tel:
            clave = None
            for candidata in por_telefono.get(tel, []):
                if mismo_titular(clientes[candidata]["display_name"], nombre_crudo):
                    clave = candidata
                    break
            if clave is None:
                sufijo = len(por_telefono.get(tel, []))
                clave = "tel:" + tel + (f"#{sufijo + 1}" if sufijo else "")
                por_telefono.setdefault(tel, []).append(clave)
                descartes["telefono_compartido"] += 1 if sufijo else 0
        elif clave_n and clave_n not in NOMBRES_GENERICOS:
            clave = "nom:" + clave_n
        else:
            clave = None
            descartes["sin_identificador"] += 1

        cliente_id_local = None
        if clave:
            cliente_id_local = clave
            ficha = clientes.get(clave)
            if not ficha:
                ficha = {
                    "clave": clave,
                    "display_name": nombre_propio(nombre_crudo) or ("Cliente Tel " + tel),
                    "phone": tel,
                    "ordenes": 0,
                    "primera_visita": None,
                    "ultima_visita": None,
                    "variantes_nombre": [],
                }
                clientes[clave] = ficha
            # Si la ficha se creo desde una fila sin nombre y esta lo trae, mejora.
            if nombre_crudo and ficha["display_name"].startswith("Cliente Tel "):
                ficha["display_name"] = nombre_propio(nombre_crudo)
            if not ficha["phone"] and tel:
                ficha["phone"] = tel
            if nombre_crudo and nombre_propio(nombre_crudo) not in ficha["variantes_nombre"]:
                ficha["variantes_nombre"].append(nombre_propio(nombre_crudo))
            ficha["ordenes"] += 1

            fing = fecha(f.get("B"))
            if fing:
                if not ficha["primera_visita"] or fing < ficha["primera_visita"]:
                    ficha["primera_visita"] = fing
                if not ficha["ultima_visita"] or fing > ficha["ultima_visita"]:
                    ficha["ultima_visita"] = fing

        num = texto(f.get("A", ""))
        num = int(float(num)) if re.fullmatch(r"[\d.]+", num) else None
        if num is None:
            descartes["sin_numero_de_orden"] += 1

        ordenes.append({
            "fila_excel": nfila,
            "legacy_number": num,
            "fecha_ingreso": fecha(f.get("B")),
            "recibido_por": nombre_propio(f.get("C", "")),
            "cliente_clave": cliente_id_local,
            "cliente_nombre": nombre_propio(nombre_crudo),
            "cliente_telefono": tel,
            "equipo": texto(f.get("H", "")).upper(),
            "estado_ingreso": texto(f.get("I", "")),
            "falla_informada": texto(f.get("J", "")),
            "reporte_tecnico": texto(f.get("K", "")),
            "tecnico": nombre_propio(f.get("L", "")),
            "status": estado(f),
            "presupuesto": numero(f.get("O")),
            "senia": numero(f.get("P")),
            "saldo": numero(f.get("Q")),
            "fecha_prob_retiro": fecha(f.get("R")),
            "entregado_por": nombre_propio(f.get("S", "")),
            "fecha_entrega": fecha(f.get("T")),
            "total_cobro": numero(f.get("U")),
            "costo_repuesto": numero(f.get("V")),
            "sugerencias": texto(f.get("W", "")),
            "comision_tecnico": numero(f.get("X")),
            "comision_vendedor": numero(f.get("AA")),
            "comision_local": numero(f.get("AB")),
        })

    # Numeros de orden repetidos: el importador necesita saberlo para no
    # asumir que legacy_number es unico.
    repetidos = [n for n, c in Counter(
        o["legacy_number"] for o in ordenes if o["legacy_number"]
    ).items() if c > 1]

    # ── Lista de precios (hoja MODULOS) ──
    precios = []
    if "MODULOS" in hojas:
        for r, f in leer_filas(z, hojas["MODULOS"], cadenas):
            if r < 2:
                continue
            modelo = texto(f.get("A", ""))
            # Filas sueltas de la planilla ('/', separadores) que no son modelos.
            if not modelo or numero(f.get("F")) <= 0:
                continue
            precios.append({
                "modelo": modelo.upper(),
                "costo_repuesto": numero(f.get("B")),
                "costo_tecnico": numero(f.get("C")),
                "ganancia_local": numero(f.get("D")),
                "comision_vendedor": numero(f.get("E")),
                "precio_total": numero(f.get("F")),
                "cuota_3": numero(f.get("G")),
                "cuota_6": numero(f.get("H")),
            })

    return list(clientes.values()), ordenes, precios, descartes, repetidos


def informe(clientes, ordenes, precios, descartes, repetidos):
    print("=" * 62)
    print("  EXTRACCION SERV_TEC")
    print("=" * 62)
    print(f"  Ordenes leidas .............. {len(ordenes)}")
    print(f"  Clientes unicos ............. {len(clientes)}")
    print(f"    identificados por telefono  {sum(1 for c in clientes if c['clave'].startswith('tel:'))}")
    print(f"    identificados por nombre    {sum(1 for c in clientes if c['clave'].startswith('nom:'))}")
    print(f"    con mas de una orden ...... {sum(1 for c in clientes if c['ordenes'] > 1)}")
    print(f"    con nombre en varias formas {sum(1 for c in clientes if len(c['variantes_nombre']) > 1)}")
    print(f"  Modelos en lista de precios . {len(precios)}")
    print()
    print("  Descartes:")
    if not descartes:
        print("    (ninguno)")
    for k, v in descartes.most_common():
        print(f"    {k:24} {v}")
    if repetidos:
        print(f"  Numeros de orden repetidos .. {sorted(repetidos)}")
    print()
    print("  Estados:")
    for k, v in Counter(o["status"] for o in ordenes).most_common():
        print(f"    {k:24} {v}")
    print()
    sin_fecha = sum(1 for o in ordenes if not o["fecha_ingreso"])
    print(f"  Ordenes sin fecha de ingreso  {sin_fecha}")
    print(f"  Ordenes sin cliente ......... {sum(1 for o in ordenes if not o['cliente_clave'])}")
    print("=" * 62)


def main():
    if len(sys.argv) < 2:
        raise SystemExit("Uso: python3 script/servtec/extraer-excel.py <ruta al SERV_TEC.xlsm>")
    ruta = os.path.expanduser(sys.argv[1])
    if not os.path.exists(ruta):
        raise SystemExit(f"No existe el archivo: {ruta}")

    clientes, ordenes, precios, descartes, repetidos = extraer(ruta)

    salida = os.path.join(os.path.dirname(os.path.abspath(__file__)), "datos")
    os.makedirs(salida, exist_ok=True)
    for nombre, dato in (
        ("clientes.json", clientes),
        ("ordenes.json", ordenes),
        ("precios-reparacion.json", precios),
    ):
        with open(os.path.join(salida, nombre), "w", encoding="utf-8") as fh:
            json.dump(dato, fh, ensure_ascii=False, indent=2)

    informe(clientes, ordenes, precios, descartes, repetidos)
    print(f"  Escrito en {salida}/")


if __name__ == "__main__":
    main()
