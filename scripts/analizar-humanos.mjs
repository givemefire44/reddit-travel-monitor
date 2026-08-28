// Mide como contesta la gente de verdad en los subs donde vamos a comentar.
//
// POR QUE
//
// Las reglas de redaccion que teniamos salieron de mi intuicion sobre que suena
// humano, y el 27 ago 2026 quedo claro que la intuicion apuntaba al lado
// contrario: todas empujaban a que el texto quedara mas LIMPIO, y la limpieza es
// el tell. Mario: "son muy prolijas perfectas, los humanos no respondemos asi".
//
// Los ocho comentarios del primer hilo que miramos ya lo mostraban: dos de dos
// palabras, la mediana en una a tres oraciones, uno que no contestaba la pregunta
// y otro que le respondia a otro comentarista. El nuestro era el mas largo y el
// mas ordenado de los ocho.
//
// Ocho comentarios no son una muestra. Esto junta cientos y saca el patron de
// los datos: cuanto miden, como abren, cuantos parrafos, cuantos contestan de
// verdad. Y lo corta por tipo de pregunta, porque una de "¿me estafaron?" no se
// contesta como una de "¿que ticket compro?".
//
// Uso:  node scripts/analizar-humanos.mjs [cantidad-de-hilos]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const H = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
// El orden importa y lo tuve al reves: primero se DESESCAPAN las entidades y
// despues se sacan los tags. Al reves, '&lt;div&gt;' sobrevive al strip y
// reaparece como '<div>' cuando se desescapa, asi que la muestra salia con HTML
// crudo adentro y las medidas de largo contaban etiquetas como palabras.
// Y los limites de parrafo se convierten en saltos ANTES de barrer los tags.
//
// Sin esto la medicion de parrafos era una farsa completa. El barrido generico
// de tags los reemplaza por espacios, asi que los </p> y los <br> desaparecian
// y NINGUNO de los 76 comentarios quedaba con un solo salto de linea guardado.
// El script contaba parrafos partiendo por \n\n sobre un texto que no tenia
// ninguno, y reportaba, invariablemente, "100% de un solo parrafo".
//
// Ese numero se publico como hallazgo, viajo al prompt del selector, al pie de
// cada candidato del reporte y a la skill como regla de redaccion. Mario lo
// frenó el 28 ago con el argumento correcto y sin ver el codigo: si te guias por
// los signos de puntuacion, la respuesta del bar necesita dos punto y aparte.
// Tenia razon. La medicion no decia lo contrario: no decia nada.
const limpiar = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
  .replace(/<\/p>|<br\s*\/?>/gi, '\n\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&[a-z#0-9]+;/g, ' ')
  .replace(/[ \t]+/g, ' ')
  .replace(/ *\n[ \n]*\n */g, '\n\n')
  .trim();

async function traer(url) {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url, { headers: H });
    if (r.status === 429) { await esperar(12000); continue; }
    if (!r.ok) return null;
    return r.text();
  }
  return null;
}

// Los subs donde de verdad vamos a comentar, segun lo que produjo la busqueda.
const SUBS = ['Flights', 'Bookingcom', 'travel', 'ItalyTravel', 'rome', 'hotels'];
const CUANTOS = Number(process.argv[2] || 6);

console.log('Bajando hilos y comentarios reales...\n');

// AutoModerator y los bots de reglas. El filtro faltaba: la primera medicion se
// publico diciendo "sacando los bots de AutoModerator" y no habia ni una linea
// que los sacara. Eran 11 de 87, todos de r/Flights y r/ItalyTravel, y son
// justo el peor contaminante posible para lo que se esta midiendo: largos,
// prolijos, de varios parrafos y con el mismo molde siempre. O sea, corrian la
// medida hacia el estilo que la medicion existe para desmentir.
const ES_BOT = /I am a bot|action was performed automatically|please contact the moderators|^Notice:|has been removed|^Your (post|comment)\b/i;

const comentarios = [];
let bots = 0;
for (const sub of SUBS) {
  const xml = await traer(`https://www.reddit.com/r/${sub}/new.rss?limit=${CUANTOS}`);
  if (!xml) { console.log(`  r/${sub}: no se pudo`); continue; }
  const urls = [...xml.matchAll(/<link href="([^"]+\/comments\/[^"]+)"/g)].map((m) => m[1]).slice(0, CUANTOS);
  let n = 0;
  for (const u of urls) {
    await esperar(3000);
    const t = await traer(`${u.replace(/\/$/, '')}/.rss?limit=50`);
    if (!t) continue;
    const en = [...t.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => m[1]).slice(1);
    for (const e of en) {
      const txt = limpiar((e.match(/<content[^>]*>([\s\S]*?)<\/content>/) || [])[1] || '');
      if (!txt || txt.length < 3) continue;
      if (ES_BOT.test(txt)) { bots += 1; continue; }
      comentarios.push({ sub, texto: txt });
      n += 1;
    }
  }
  console.log(`  r/${sub}: ${urls.length} hilos, ${n} comentarios`);
}

console.log(`\n${comentarios.length} comentarios humanos (${bots} de bots descartados)\n`);
if (!comentarios.length) process.exit(1);

// ------------------------------------------------------------------ medidas
const palabras = (t) => t.split(/\s+/).filter(Boolean).length;
const oraciones = (t) => t.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 2).length;
const parrafos = (t) => t.split(/\n\s*\n/).filter((p) => p.trim()).length;

const largos = comentarios.map((c) => palabras(c.texto)).sort((a, b) => a - b);
const pct = (p) => largos[Math.floor(largos.length * p)];

console.log('LARGO EN PALABRAS');
console.log(`  minimo ${largos[0]} · p25 ${pct(0.25)} · MEDIANA ${pct(0.5)} · p75 ${pct(0.75)} · p90 ${pct(0.9)} · maximo ${largos[largos.length - 1]}`);
const bandas = [[0, 10], [11, 25], [26, 60], [61, 120], [121, 250], [251, 1e9]];
console.log('\n  reparto:');
for (const [a, b] of bandas) {
  const n = largos.filter((x) => x >= a && x <= b).length;
  const pctn = Math.round((n / largos.length) * 100);
  console.log(`    ${String(a).padStart(3)}-${b > 1000 ? '+' : String(b).padEnd(3)} palabras  ${String(n).padStart(4)}  ${'█'.repeat(Math.round(pctn / 2))} ${pctn}%`);
}

console.log('\nESTRUCTURA');
const unParrafo = comentarios.filter((c) => parrafos(c.texto) === 1).length;
const unaOracion = comentarios.filter((c) => oraciones(c.texto) <= 1).length;
console.log(`  de un solo parrafo:  ${Math.round((unParrafo / comentarios.length) * 100)}%`);
console.log(`  de una sola oracion: ${Math.round((unaOracion / comentarios.length) * 100)}%`);
// El porcentaje global de "un solo parrafo" no dice lo que parece: la mediana
// son 28 palabras, y un comentario de 28 palabras no tiene por que partirse.
// La pregunta util es que hace la gente CUANDO el texto da para partirlo.
const conCuerpo = comentarios.filter((c) => palabras(c.texto) > 60);
if (conCuerpo.length) {
  const partidos = conCuerpo.filter((c) => parrafos(c.texto) > 1).length;
  console.log(`\n  de los ${conCuerpo.length} de mas de 60 palabras, ${partidos} usan mas de un parrafo (${Math.round((partidos / conCuerpo.length) * 100)}%)`);
  const reparto = {};
  for (const c of conCuerpo) { const n = Math.min(parrafos(c.texto), 4); reparto[n] = (reparto[n] || 0) + 1; }
  console.log('  reparto de parrafos entre los largos: ' + Object.entries(reparto).map(([n, k]) => `${n}${n === '4' ? '+' : ''}: ${k}`).join(' · '));
}

console.log('\nCOMO ABREN (primeras 2 palabras, las mas repetidas)');
const aperturas = {};
for (const c of comentarios) {
  const dos = c.texto.toLowerCase().split(/\s+/).slice(0, 2).join(' ').replace(/[^a-z' ]/g, '');
  if (dos.length > 2) aperturas[dos] = (aperturas[dos] || 0) + 1;
}
for (const [a, n] of Object.entries(aperturas).sort((x, y) => y[1] - x[1]).slice(0, 12)) {
  console.log(`  ${String(n).padStart(3)}  "${a}"`);
}

console.log('\nMUESTRA DE LOS CORTOS (10 palabras o menos)');
for (const c of comentarios.filter((x) => palabras(x.texto) <= 10).slice(0, 12)) {
  console.log(`  [r/${c.sub}] ${c.texto.slice(0, 80)}`);
}

console.log('\nMUESTRA DE LOS LARGOS (mas de 120 palabras)');
for (const c of comentarios.filter((x) => palabras(x.texto) > 120).slice(0, 4)) {
  console.log(`  [r/${c.sub}] ${c.texto.slice(0, 220)}...`);
}

const OUT = path.join(ROOT, 'data', 'muestra-humanos.json');
fs.writeFileSync(OUT, JSON.stringify(comentarios, null, 1));
console.log(`\nmuestra guardada -> ${path.relative(ROOT, OUT)}`);
