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

export function registrar({ texto, url, red = 'quora', titulo, fecha }) {
  const lista = cargar();
  const hu = huella(texto);
  const existente = lista.findIndex((x) => x.url === url);
  const entrada = {
    url,
    red,
    titulo: titulo || url.split('/').pop().replace(/-/g, ' ').slice(0, 70),
    fecha: fecha || new Date().toISOString().slice(0, 10),
    palabras: texto.trim().split(/\s+/).length,
    ...hu,
  };
  if (existente >= 0) lista[existente] = entrada;
  else lista.push(entrada);
  guardar(lista);
  return entrada;
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
  console.log(`Guardado [${e.red}] "${e.titulo}"`);
  console.log(`  ${e.shingles.length} huellas de texto · ${e.aperturas.length} aperturas de frase`);
  console.log(`\nTotal en el almacen: ${cargar().length}`);
}
