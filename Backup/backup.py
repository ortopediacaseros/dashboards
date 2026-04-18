#!/usr/bin/env python3
"""
backup.py — Ortopedia Caseros
Genera un dump SQL restaurable (INSERT statements) de todas las tablas.

Uso:
    python3 backup.py

Requiere: Python 3.7+ (solo stdlib, sin dependencias externas)

Restauración:
    1. Ir al SQL Editor de Supabase
    2. Pegar el contenido del archivo .sql y ejecutar
    3. Las tablas se limpian y reinsertan en orden correcto (FK safe)
"""

import json
import urllib.request
import urllib.error
from datetime import datetime
from pathlib import Path

# ── Configuración ────────────────────────────────────────────────────
SB_URL       = "https://bxcnsykkzwzrbevzquee.supabase.co"
SB_KEY       = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ4Y25zeWtrend6cmJldnpxdWVlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDg3MzI4MCwiZXhwIjoyMDkwNDQ5MjgwfQ.S_CHV_OyJZX9lXSSzmg_pAHRySUf1S4XYHX9TmCsvEQ"
PROJECT_NAME = "Ortopedia Caseros"
PROJECT_REF  = "bxcnsykkzwzrbevzquee"

# Orden INSERT: padres antes que hijos (respeta foreign keys)
TABLES_INSERT_ORDER = [
    "productos",
    "cajas",
    "perfiles_proveedores",
    "pedidos_plantillas",
    "calendario",
    "ventas",
    "items_venta",
    "alquileres",
    "historial_precios",
    "facturas",
]

# Orden DELETE: hijos primero (evita FK violations)
TABLES_DELETE_ORDER = list(reversed(TABLES_INSERT_ORDER))

BATCH_SIZE = 1000


# ── REST API (PostgREST) ─────────────────────────────────────────────
def rest_get(table: str, limit: int, offset: int) -> list:
    url = (
        f"{SB_URL}/rest/v1/{table}"
        f"?select=*&limit={limit}&offset={offset}&order=id.asc.nullslast"
    )
    req = urllib.request.Request(
        url,
        headers={
            "apikey":        SB_KEY,
            "Authorization": f"Bearer {SB_KEY}",
            "Accept":        "application/json",
        }
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError:
        # Fallback sin ORDER BY si la tabla no tiene columna id
        url2 = f"{SB_URL}/rest/v1/{table}?select=*&limit={limit}&offset={offset}"
        req2 = urllib.request.Request(url2, headers={
            "apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}", "Accept": "application/json"
        })
        with urllib.request.urlopen(req2, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))


def rest_count(table: str) -> int:
    """Retorna el total de filas usando el header Content-Range."""
    url = f"{SB_URL}/rest/v1/{table}?select=*&limit=1&offset=0"
    req = urllib.request.Request(
        url,
        headers={
            "apikey":        SB_KEY,
            "Authorization": f"Bearer {SB_KEY}",
            "Prefer":        "count=exact",
            "Accept":        "application/json",
        }
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        cr = resp.headers.get("Content-Range", "")  # e.g. "0-0/1234"
        if "/" in cr:
            return int(cr.split("/")[1])
        return 0


# ── Formateo de valores SQL ──────────────────────────────────────────
def sql_literal(value) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, (int, float)):
        return repr(value)
    if isinstance(value, (dict, list)):
        s = json.dumps(value, ensure_ascii=False, default=str)
        return "'" + s.replace("'", "''") + "'"
    return "'" + str(value).replace("'", "''") + "'"


# ── Dump de una tabla ────────────────────────────────────────────────
def dump_table(table: str) -> tuple:
    lines = []
    sep   = "─" * 52

    total = rest_count(table)

    lines.append(f"\n-- {sep}")
    lines.append(f"-- Tabla: {table}  ({total:,} filas)")
    lines.append(f"-- {sep}")

    if total == 0:
        lines.append("-- (sin datos)")
        return "\n".join(lines), 0

    inserted = 0
    offset   = 0
    cols     = None
    cols_sql = None

    while True:
        rows = rest_get(table, BATCH_SIZE, offset)
        if not rows:
            break

        # Columnas desde la primera fila (mantener orden consistente)
        if cols is None:
            cols     = list(rows[0].keys())
            cols_sql = ", ".join(f'"{c}"' for c in cols)

        for row in rows:
            vals = ", ".join(sql_literal(row.get(c)) for c in cols)
            lines.append(f'INSERT INTO "{table}" ({cols_sql}) VALUES ({vals});')
            inserted += 1

        offset += BATCH_SIZE
        if len(rows) < BATCH_SIZE:
            break

    return "\n".join(lines), inserted


# ── Main ─────────────────────────────────────────────────────────────
def main():
    now = datetime.now()

    # Carpetas: Backup/YYYY-MM/YYYY-MM-DD.sql
    script_dir = Path(__file__).parent
    month_dir  = script_dir / now.strftime("%Y-%m")
    month_dir.mkdir(parents=True, exist_ok=True)
    out_file   = month_dir / f"{now.strftime('%Y-%m-%d')}.sql"

    print(f"\n{'═'*54}")
    print(f"  🦴  Backup SQL — {PROJECT_NAME}")
    print(f"  📅  {now.strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"  📁  {out_file}")
    print(f"{'═'*54}\n")

    if out_file.exists():
        print("  ⚠  Ya existe backup para hoy. Sobreescribiendo...\n")

    # ── Cabecera SQL ──
    header = f"""\
-- ╔══════════════════════════════════════════════════════════╗
-- ║  BACKUP SQL — {PROJECT_NAME:<44}║
-- ║  Proyecto  : {PROJECT_REF:<45}║
-- ║  Generado  : {now.strftime('%Y-%m-%d %H:%M:%S'):<45}║
-- ╚══════════════════════════════════════════════════════════╝
--
-- RESTAURACIÓN:
--   1. Abrir Supabase → SQL Editor del proyecto de destino
--   2. Pegar TODO el contenido de este archivo
--   3. Ejecutar — limpia y recarga los datos en orden FK-safe
--
-- TABLAS: {', '.join(TABLES_INSERT_ORDER)}
--

BEGIN;

-- ── Limpieza (hijos antes que padres) ─────────────────────────────
"""
    delete_block = "\n".join(f'DELETE FROM "{t}";' for t in TABLES_DELETE_ORDER) + "\n"

    # ── Dumps ──
    table_blocks = []
    total_rows   = 0

    for table in TABLES_INSERT_ORDER:
        print(f"  📋  {table:<28}", end="", flush=True)
        try:
            block, count = dump_table(table)
            table_blocks.append(block)
            total_rows  += count
            print(f"  {count:>7,} filas  ✓")
        except Exception as exc:
            print(f"  ERROR → {exc}")
            table_blocks.append(f'\n-- ⚠ ERROR en "{table}": {exc}')

    footer = f"""

COMMIT;

-- ── Fin del backup ────────────────────────────────────────────────
-- Total filas : {total_rows:,}
-- Frecuencia  : diaria (datos sensibles del negocio)
"""

    full_sql = header + delete_block + "\n".join(table_blocks) + footer
    out_file.write_text(full_sql, encoding="utf-8")

    size_kb = out_file.stat().st_size / 1024
    print(f"\n{'═'*54}")
    print(f"  ✅  Backup completado")
    print(f"  📄  {out_file.name}")
    print(f"  💾  {size_kb:.1f} KB  —  {total_rows:,} filas")
    print(f"{'═'*54}\n")


if __name__ == "__main__":
    main()
