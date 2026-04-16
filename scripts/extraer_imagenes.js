/**
 * extraer_imagenes.js
 * Extrae imágenes de los Excel de proveedores y las sube a Supabase Storage.
 * Luego actualiza la tabla productos con la URL de la imagen.
 *
 * Uso: node scripts/extraer_imagenes.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const XLSX = require('xlsx');
const { execSync } = require('child_process');

// ── Config ────────────────────────────────────────────────────────
const SUPABASE_URL  = 'https://bxcnsykkzwzrbevzquee.supabase.co';
const SUPABASE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ4Y25zeWtrend6cmJldnpxdWVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4NzMyODAsImV4cCI6MjA5MDQ0OTI4MH0.oZzblqWjjLWDqJ_CAWxXUqzsdtFMcrNFwdQ4aMCpHdE';
const SERVICE_KEY   = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ4Y25zeWtrend6cmJldnpxdWVlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDg3MzI4MCwiZXhwIjoyMDkwNDQ5MjgwfQ.S_CHV_OyJZX9lXSSzmg_pAHRySUf1S4XYHX9TmCsvEQ';
const BUCKET        = 'productos';
const LISTADOS_DIR  = path.join(__dirname, '..', 'Listados');
const TEMP_DIR      = path.join(__dirname, '..', 'temp_imgs');

// Archivos a procesar: { archivo, hoja, colNombre (0-based), colCodigo }
const ARCHIVOS = [
  {
    archivo:   'Lista Base v26.01 (1).xlsx',
    hoja:      'Lista Base',
    headerRow: 2,      // fila 0-based con encabezados
    colNombre: 5,      // columna "Descripción"
    colCodigo: 3,      // columna "Producto" (código)
    proveedor: 'Lista Base',
  },
  {
    archivo:   'Lista de Precios Septiembre 2025 - Care-Quip.xlsx',
    hoja:      'Lista de Precios Sep 2025',
    headerRow: null,   // no tiene header clásico, detectamos por contenido
    colNombre: 2,      // columna C
    colCodigo: 1,      // columna B
    proveedor: 'Care-Quip',
  },
];

// ── Helpers ───────────────────────────────────────────────────────
function sanitizeFilename(name) {
  return name
    .normalize('NFD')                          // descomponer letras + tildes
    .replace(/[\u0300-\u036f]/g, '')           // quitar marcas diacríticas
    .replace(/[ñÑ]/g, 'n')                     // ñ → n (no se descompone con NFD)
    .replace(/[^a-zA-Z0-9\s\-_]/g, '')        // solo ASCII seguro
    .replace(/\s+/g, '_')
    .toLowerCase()
    .slice(0, 80);
}

function fetchSupabase(method, endpoint, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(SUPABASE_URL + endpoint);
    const options = {
      method,
      hostname: url.hostname,
      path: url.pathname + url.search,
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        ...extraHeaders,
      },
    };
    if (body && typeof body === 'string') {
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(body);
    }
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) {
      if (Buffer.isBuffer(body)) req.write(body);
      else req.write(body);
    }
    req.end();
  });
}

function uploadImage(imgBuffer, filename, contentType) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${filename}`);
    const options = {
      method: 'POST',
      hostname: url.hostname,
      path: url.pathname,
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': contentType,
        'Content-Length': imgBuffer.length,
        'x-upsert': 'true',
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.write(imgBuffer);
    req.end();
  });
}

// Parsea drawing XML y devuelve array de { row, rId }
function parseDrawing(xml) {
  const anchors = [];
  const anchorRe = /<xdr:twoCellAnchor[^>]*>([\s\S]*?)<\/xdr:twoCellAnchor>/g;
  let match;
  while ((match = anchorRe.exec(xml)) !== null) {
    const block = match[1];
    const rowMatch = /<xdr:from>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>/.exec(block);
    const rIdMatch = /r:embed="(rId\d+)"/.exec(block);
    if (rowMatch && rIdMatch) {
      anchors.push({ row: parseInt(rowMatch[1]), rId: rIdMatch[1] });
    }
  }
  return anchors;
}

// Parsea rels XML y devuelve { rId: filename }
function parseRels(xml) {
  const map = {};
  const re = /Id="(rId\d+)"[^>]*Target="([^"]+)"/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const target = m[2];
    if (target.includes('media/')) {
      map[m[1]] = path.basename(target);
    }
  }
  return map;
}

// Extrae archivos del xlsx (es un zip)
function extractFromXlsx(xlsxPath, entryName) {
  const result = execSync(
    `powershell -Command "Add-Type -Assembly System.IO.Compression.FileSystem; ` +
    `$zip = [System.IO.Compression.ZipFile]::OpenRead('${xlsxPath.replace(/'/g, "''")}'); ` +
    `$entry = $zip.Entries | Where-Object { $_.FullName -eq '${entryName}' }; ` +
    `if($entry){ $ms = New-Object System.IO.MemoryStream; $entry.Open().CopyTo($ms); ` +
    `[Convert]::ToBase64String($ms.ToArray()) } else { '' }; $zip.Dispose()"`
  ).toString().trim();
  if (!result) return null;
  return Buffer.from(result, 'base64');
}

function getContentType(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.gif') return 'image/gif';
  return 'image/jpeg';
}

// ── Main ──────────────────────────────────────────────────────────
async function procesarArchivo(config) {
  const xlsxPath = path.join(LISTADOS_DIR, config.archivo);
  console.log(`\n━━━ Procesando: ${config.archivo} ━━━`);

  // 1. Leer datos del sheet
  const wb = XLSX.readFile(xlsxPath);
  const ws = wb.Sheets[config.hoja];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  // 2. Leer drawing XML
  const drawingBuf = extractFromXlsx(xlsxPath, 'xl/drawings/drawing1.xml');
  if (!drawingBuf) { console.log('  Sin drawing XML, saltando'); return []; }
  const drawingXml = drawingBuf.toString('utf8');

  // 3. Leer rels
  const relsBuf = extractFromXlsx(xlsxPath, 'xl/drawings/_rels/drawing1.xml.rels');
  if (!relsBuf) { console.log('  Sin rels, saltando'); return []; }
  const relsXml = relsBuf.toString('utf8');

  const anchors = parseDrawing(drawingXml);
  const relsMap = parseRels(relsXml);

  console.log(`  ${anchors.length} imágenes ancladas encontradas`);
  console.log(`  ${Object.keys(relsMap).length} relaciones de imagen`);

  const resultados = [];

  for (const anchor of anchors) {
    const { row, rId } = anchor;
    const imgFilename = relsMap[rId];
    if (!imgFilename) continue;

    // Fila en el array (row es 0-based en el XML)
    const rowData = rows[row];
    if (!rowData) continue;

    const nombre = String(rowData[config.colNombre] || '').trim();
    const codigo = String(rowData[config.colCodigo] || '').trim();

    if (!nombre || nombre.length < 3) continue;
    // Saltar filas de encabezado o secciones
    if (nombre.toLowerCase().includes('sección') || nombre.toLowerCase().includes('descripción')) continue;

    // Extraer imagen
    const imgBuf = extractFromXlsx(xlsxPath, `xl/media/${imgFilename}`);
    if (!imgBuf || imgBuf.length < 500) continue; // skip tiny/corrupt images

    const ext = path.extname(imgFilename).toLowerCase().replace('.', '');
    const storageFilename = `${sanitizeFilename(nombre)}.${ext}`;
    const contentType = getContentType(imgFilename);

    process.stdout.write(`  [${row}] ${nombre.slice(0, 50).padEnd(50)} → `);

    // Subir a Supabase Storage
    const { status, body: uploadBody } = await uploadImage(imgBuf, storageFilename, contentType);
    if (status === 200 || status === 201) {
      const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${storageFilename}`;
      console.log(`✅ subido`);
      resultados.push({ nombre, codigo, storageFilename, publicUrl });
    } else {
      const msg = typeof uploadBody === 'object' ? uploadBody.error || uploadBody.message || JSON.stringify(uploadBody) : uploadBody;
      console.log(`❌ error ${status}: ${msg}`);
    }

    // Pequeña pausa para no saturar
    await new Promise(r => setTimeout(r, 50));
  }

  return resultados;
}

async function actualizarProductos(resultados) {
  console.log(`\n━━━ Actualizando productos en Supabase (${resultados.length} imágenes) ━━━`);

  // Primero asegurarnos que la columna existe
  // (ya debería existir si corriste el DDL, sino agregar: ALTER TABLE productos ADD COLUMN imagen_url text)

  let ok = 0, noEncontrado = 0;
  for (const r of resultados) {
    // Buscar por nombre exacto o similar
    const encoded = encodeURIComponent(`nombre.ilike.${r.nombre}`);
    const { body } = await fetchSupabase(
      'GET',
      `/rest/v1/productos?nombre=ilike.*${encodeURIComponent(r.nombre)}*&select=id,nombre&limit=1`,
      null,
      { 'Prefer': 'return=representation' }
    );

    if (!Array.isArray(body) || body.length === 0) {
      // Intentar con el código
      if (r.codigo) {
        const { body: b2 } = await fetchSupabase(
          'GET',
          `/rest/v1/productos?or=(nombre.ilike.*${encodeURIComponent(r.nombre.slice(0,20))}*,ean.eq.${encodeURIComponent(r.codigo)})&select=id,nombre&limit=1`,
          null
        );
        if (Array.isArray(b2) && b2.length > 0) {
          await fetchSupabase('PATCH', `/rest/v1/productos?id=eq.${b2[0].id}`,
            JSON.stringify({ imagen_url: r.publicUrl }),
            { 'Prefer': 'return=minimal' });
          ok++;
          continue;
        }
      }
      noEncontrado++;
      continue;
    }

    await fetchSupabase('PATCH', `/rest/v1/productos?id=eq.${body[0].id}`,
      JSON.stringify({ imagen_url: r.publicUrl }),
      { 'Prefer': 'return=minimal' });
    ok++;
  }

  console.log(`  ✅ Actualizados: ${ok}`);
  console.log(`  ⚠️  No encontrados en BD: ${noEncontrado}`);
}

async function main() {
  console.log('🖼️  Extractor de imágenes desde listados de proveedores\n');

  // Verificar que el bucket existe (crear si no) — requiere service_role
  console.log('Verificando bucket en Supabase Storage...');
  const { status: bStatus } = await fetchSupabase('GET', `/storage/v1/bucket/${BUCKET}`, null);
  if (bStatus === 400 || bStatus === 404) {
    console.log('Creando bucket...');
    await fetchSupabase('POST', '/storage/v1/bucket', JSON.stringify({
      id: BUCKET, name: BUCKET, public: true
    }));
  }

  let todosResultados = [];

  for (const config of ARCHIVOS) {
    const xlsxPath = path.join(LISTADOS_DIR, config.archivo);
    if (!fs.existsSync(xlsxPath)) {
      console.log(`\nArchivo no encontrado: ${config.archivo}`);
      continue;
    }
    try {
      const resultados = await procesarArchivo(config);
      todosResultados = todosResultados.concat(resultados);
    } catch (e) {
      console.log(`Error procesando ${config.archivo}:`, e.message);
    }
  }

  console.log(`\n━━━ Total: ${todosResultados.length} imágenes extraídas y subidas ━━━`);

  if (todosResultados.length > 0) {
    await actualizarProductos(todosResultados);
  }

  console.log('\n✅ Proceso completado.');
}

main().catch(console.error);
