// Corre el juez de relevancia sobre los posts REALES de un subreddit, sin
// filtro previo de ningun tipo. Es la prueba que importa: los 17 casos del otro
// script los elegi yo, y elegir los casos de prueba es la forma mas facil de
// probar lo que uno ya cree.
//
// Uso:  node scripts/probar-relevancia-real.mjs [subreddit] [limite]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluarLote } from './lib/relevancia.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1');
}

const SITIOS = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'sitios-relevancia.json'), 'utf8'));

const SUB = process.argv[2] || 'rome';
const LIMITE = Number(process.argv[3] || 100);

const H = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
};
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function traer(sub) {
  for (let i = 0; i < 5; i++) {
    const r = await fetch(`https://www.reddit.com/r/${sub}/new.rss?limit=100`, { headers: H });
    if (r.status === 429) { await esperar(6000); continue; }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.text();
  }
  throw new Error('429 tras 5 intentos');
}

const xml = await traer(SUB);
const entradas = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => m[1]);
const limpiar = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
const posts = entradas.map((e) => ({
  titulo: limpiar((e.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || ''),
  cuerpo: limpiar((e.match(/<content[^>]*>([\s\S]*?)<\/content>/) || [])[1] || '').slice(0, 1200),
  fecha: ((e.match(/<updated>([^<]*)<\/updated>/) || [])[1] || '').slice(0, 10),
})).slice(0, LIMITE);

console.log(`r/${SUB}: ${posts.length} posts, desde ${posts[posts.length - 1]?.fecha} hasta ${posts[0]?.fecha}\n`);

const res = await evaluarLote(posts, SITIOS, 8);

const si = [];
for (let i = 0; i < posts.length; i++) if (res[i].contestable) si.push({ p: posts[i], r: res[i] });

console.log(`CONTESTABLES: ${si.length} de ${posts.length}\n`);
for (const { p, r } of si) {
  console.log(`  [${p.fecha}] ${r.sitio.padEnd(11)} ${p.titulo.slice(0, 74)}`);
  console.log(`             ${r.porque.slice(0, 150)}`);
}

const porSitio = {};
for (const x of si) porSitio[x.r.sitio] = (porSitio[x.r.sitio] || 0) + 1;
console.log(`\npor sitio: ${Object.entries(porSitio).map(([k, v]) => `${k} ${v}`).join(' · ') || '(ninguno)'}`);
const errores = res.filter((r) => /^error:/.test(r.porque || '')).length;
if (errores) console.log(`errores de API: ${errores}`);
