// Registra un texto YA PUBLICADO y su huella de estilo.
//
// El almacen es COMPARTIDO entre Quora y Reddit a proposito. La muletilla no
// respeta la plataforma: si una construccion se gasto en una respuesta de Quora,
// usarla la semana que viene en un comentario de Reddit sigue siendo la misma
// huella, bajo el mismo nombre y en el mismo rubro. Guardar por separado seria
// dejar el agujero abierto justo donde importa.
//
// Uso:
//   node scripts/publicado.mjs --texto respuesta.txt --url "https://..." [--red quora|reddit]
//   node scripts/publicado.mjs --listar

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { huella } from './lib/fingerprint.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const STORE = path.join(ROOT, 'data', 'publicados.json');

const args = process.argv.slice(2);
const val = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : null);

export function cargar() {
  if (!fs.existsSync(STORE)) return [];
  return JSON.parse(fs.readFileSync(STORE, 'utf8'));
}

function guardar(lista) {
  fs.mkdirSync(path.dirname(STORE), { recursive: true });
  fs.writeFileSync(STORE, JSON.stringify(lista, null, 2) + '\n', 'utf8');
}

// La misma URL no siempre es el mismo texto. Re-registrar un comentario editado
// tiene que reemplazar su huella, pero contestarle a alguien dentro de un hilo
// donde ya comentamos es un texto NUEVO con la URL del hilo. Hasta el 28 oct
// 2026 los dos casos reemplazaban: las respuestas en los hilos de Copa y del
// Coliseo pisaron las huellas de los comentarios originales, y el verificador
// dejo de ver esas muletillas. Lo que los distingue es cuanto texto comparten.
const MISMO_TEXTO = 0.4;

function solapamiento(a, b) {
  const sa = new Set(a);
  const comunes = b.filter((s) => sa.has(s)).length;
  return comunes / Math.max(1, Math.min(a.length, b.length));
}

export function registrar({ texto, url, red = 'quora', titulo, fecha }) {
  const lista = cargar();
  const hu = huella(texto);
  const base = url.split('#')[0];
  const delHilo = lista
    .map((x, i) => ({ i, s: solapamiento(x.shingles || [], hu.shingles) }))
    .filter(({ i }) => lista[i].url.split('#')[0] === base);
  const editado = [...delHilo].sort((a, b) => b.s - a.s).find((x) => x.s >= MISMO_TEXTO);
  const existente = editado ? editado.i : -1;
  // Editar una respuesta conserva su URL marcada: si no, volvia a la del hilo.
  if (existente >= 0) url = lista[existente].url;
  else if (delHilo.length) {
    const dia = new Date().toISOString().slice(0, 10);
    let n = 1;
    url = `${base}#respuesta-${dia}`;
    while (lista.some((x) => x.url === url)) url = `${base}#respuesta-${dia}-${++n}`;
  }
  const entrada = {
    url,
    red,
    // El .replace del final NO es cosmetico: las URL de Reddit terminan en '/',
    // asi que split('/').pop() devolvia cadena vacia y el texto quedaba guardado
    // con titulo "". Paso el 26 sep 2026 con el comentario de r/vegas: aparecia
    // en el listado como una linea sin nombre, y el verificador lo nombra asi
    // cuando reporta una muletilla, o sea que la pista no servia para nada.
    titulo: titulo || base.replace(/\/+$/, '').split('/').pop().replace(/-/g, ' ').slice(0, 70),
    // Al re-registrar un texto editado se conserva la fecha original: el orden
    // y la fecha son los que usa el chequeo de jugadas contra las ultimas tres.
    fecha: fecha || (existente >= 0 ? lista[existente].fecha : null) || new Date().toISOString().slice(0, 10),
    palabras: texto.trim().split(/\s+/).length,
    ...hu,
  };
  if (existente >= 0) lista[existente] = entrada;
  else lista.push(entrada);
  guardar(lista);
  return { ...entrada, accion: existente >= 0 ? 'reemplazado' : delHilo.length ? 'respuesta nueva en un hilo ya registrado' : 'nuevo' };
}

// ------------------------------------------------------------------------ CLI
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1].endsWith('publicado.mjs')) {
  if (args.includes('--listar')) {
    const l = cargar();
    console.log(`${l.length} texto(s) publicado(s) con huella guardada:\n`);
    for (const x of l) console.log(`  [${x.red}] ${x.fecha}  ${x.palabras}p  ${x.titulo}`);
    process.exit(0);
  }

  const archivo = val('--texto');
  const url = val('--url');
  if (!archivo || !url) {
    console.error('Uso: node scripts/publicado.mjs --texto <archivo> --url "<url>" [--red quora|reddit]');
    console.error('     node scripts/publicado.mjs --listar');
    process.exit(1);
  }
  const texto = fs.readFileSync(path.resolve(archivo), 'utf8');
  const e = registrar({ texto, url, red: val('--red') || 'quora', titulo: val('--titulo') });
  console.log(`Guardado [${e.red}] "${e.titulo}" (${e.accion})`);
  console.log(`  ${e.shingles.length} huellas de texto · ${e.aperturas.length} aperturas de frase`);
  console.log(`\nTotal en el almacen: ${cargar().length}`);
}
