// Busca preguntas de Reddit que Mario pueda contestar, en vez de esperar a que
// aparezcan.
//
// EL ERROR DE DISENO QUE ESTO CORRIGE
//
// El monitor original era pasivo: bajaba los ultimos 100 posts de 9 subreddits
// escritos a mano y se quedaba con los de las ultimas 24 horas. Dos fallas
// encima de la otra:
//
//   1. Esperaba. Si ese dia nadie preguntaba lo nuestro, no habia nada. Tres
//      dias seguidos devolvio cero candidatos con material.
//   2. Esperaba en el lugar equivocado. Los 9 subs los elegi yo adivinando.
//      Una busqueda de treinta segundos el 26 ago 2026 encontro las preguntas
//      en r/loveholidays, r/LegalAdviceUK, r/RomeTravel y r/ItalyTravelAdvice
//      — ninguno estaba en la lista.
//
// El sistema de Quora ya funcionaba bien asi desde el principio: le pregunta al
// buscador. Reddit se quedo mirando por la ventana durante un mes.
//
// COMO BUSCA
//
// Las consultas se derivan de la descripcion de cada dominio, no de una lista de
// keywords a mano. Esa leccion ya la pagamos: cualquier lista que uno escriba
// queda corta contra la forma en que la gente escribe de verdad.
//
// Uso:  node scripts/buscar-reddit.mjs              (todos los dominios)
//       node scripts/buscar-reddit.mjs booking      (uno solo)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluarLote } from './lib/relevancia.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
for (const l of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1');
}

const SITIOS = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'sitios-relevancia.json'), 'utf8'));
const BRAVE = process.env.BRAVE_API_KEY;
if (!BRAVE) { console.error('Falta BRAVE_API_KEY en .env'); process.exit(1); }

// Las consultas. Una por dominio, redactadas como escribe alguien con el
// problema, no como lo describiriamos nosotros. Cada una es una busqueda: con
// ~10 alcanza de sobra para el cupo gratuito de Brave.
const CONSULTAS = {
  booking: [
    'package holiday hotel changed on arrival what can I do',
    'tour operator cancelled refund refused what are my rights',
    'booked tour never showed up no refund',
  ],
  colosseum: [
    'colosseum tickets sold out how to get in',
    'colosseum underground arena floor worth it',
  ],
  vatican: [
    'vatican museums tickets skip the line worth it',
    'sistine chapel st peters basilica how long',
  ],
  pompeii: ['pompeii tickets guide how long from naples'],
  milan: ['last supper milan tickets sold out how to book'],
  trastevere: ['where to eat rome avoid tourist traps trastevere'],
};

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function buscar(q) {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(
      `https://api.search.brave.com/res/v1/web/search?count=15&q=${encodeURIComponent(`site:reddit.com ${q}`)}`,
      { headers: { 'X-Subscription-Token': BRAVE, Accept: 'application/json' } },
    );
    if (r.status === 429) { await esperar(3000); continue; }
    if (!r.ok) { console.error(`  brave HTTP ${r.status} en "${q}"`); return []; }
    const j = await r.json();
    return (j.web?.results || []).map((x) => ({
      titulo: (x.title || '').replace(/^r\/\S+ on Reddit:\s*/i, '').trim(),
      sub: (x.title || '').match(/^r\/(\S+) on Reddit/i)?.[1] || (x.url.match(/reddit\.com\/r\/([^/]+)/) || [])[1] || '?',
      url: x.url,
      cuerpo: (x.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      edad: x.page_age || x.age || null,
    }));
  }
  return [];
}

// Se filtran las banderas: sin esto, 'node buscar-reddit.mjs --rehacer' tomaba
// '--rehacer' como nombre de dominio y no corria ninguna consulta.
const soloDominio = process.argv.slice(2).find((a) => !a.startsWith('--'));
const dominios = soloDominio ? [soloDominio] : Object.keys(CONSULTAS);

// El ledger de Reddit, para no volver a ofrecer lo ya entregado.
const LEDGER = path.join(ROOT, 'data', 'reddit-buscados.json');
// --rehacer ignora el ledger para esta corrida, sin borrarlo. Hace falta cuando
// cambian los dominios o las consultas: lo que ayer no servia puede servir hoy,
// y sin esto un hilo ya evaluado queda enterrado para siempre.
const REHACER = process.argv.includes('--rehacer');
const guardados = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, 'utf8')) : [];
const yaVistos = new Set(REHACER ? [] : guardados);
const historico = new Set(guardados);

console.log(`Buscando en Reddit via Brave · dominios: ${dominios.join(', ')}\n`);

const candidatos = [];
const vistosAhora = new Set();
for (const d of dominios) {
  for (const q of (CONSULTAS[d] || [])) {
    const res = await buscar(q);
    let nuevos = 0;
    for (const x of res) {
      // Solo hilos, no perfiles ni subs
      if (!/\/comments\//.test(x.url)) continue;
      const clave = x.url.split('?')[0];
      if (yaVistos.has(clave) || vistosAhora.has(clave)) continue;
      vistosAhora.add(clave);
      candidatos.push(x);
      nuevos += 1;
    }
    console.log(`  [${d}] "${q.slice(0, 52)}" -> ${res.length} resultados, ${nuevos} nuevos`);
    await esperar(1200);
  }
}

console.log(`\n${candidatos.length} hilos nuevos. Evaluando cuales se pueden contestar...\n`);
const juicios = await evaluarLote(candidatos, SITIOS, 8);

const sirven = [];
for (let i = 0; i < candidatos.length; i++) {
  if (juicios[i].contestable) sirven.push({ ...candidatos[i], ...juicios[i] });
}

// ---------------------------------------------------------------- FRESCURA
//
// La busqueda trae hilos de cualquier fecha, y la fecha cambia PARA QUE SIRVE el
// comentario. No es un detalle de orden: son dos objetivos distintos.
//
//   - Un hilo fresco todavia lo lee gente. Ahi el comentario junta votos, y el
//     karma es lo que abre los subs cerrados.
//   - Un hilo viejo ya no lo lee nadie, pero sigue indexado y sigue apareciendo
//     en Google y en las respuestas de los motores de IA. Ahi el comentario no
//     da karma pero si citabilidad, que es el objetivo GEO.
//
// OJO con los viejos: comentar un hilo de hace dos años es necroposting, y varios
// subs lo prohiben o lo mal miran. Antes de contestar uno de esos hay que mirar
// las reglas de ese sub. Por eso van separados y con la advertencia, en vez de
// mezclados en una sola lista.
const dias = (iso) => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : Math.floor((Date.now() - t) / 86400000);
};
for (const c of sirven) c.dias = dias(c.edad);

const frescos = sirven.filter((c) => c.dias != null && c.dias <= 7);
const recientes = sirven.filter((c) => c.dias != null && c.dias > 7 && c.dias <= 90);
const viejos = sirven.filter((c) => c.dias == null || c.dias > 90);

const porSub = {};
for (const c of sirven) porSub[c.sub] = (porSub[c.sub] || 0) + 1;

const linea = (c) => [
  `  [${c.sitio}] r/${c.sub}${c.dias != null ? ` · hace ${c.dias} dias` : ' · sin fecha'}`,
  `     ${c.titulo.slice(0, 92)}`,
  `     preguntan: ${c.pregunta}`,
  `     ${c.url}`,
  '',
].join('\n');

console.log(`CONTESTABLES: ${sirven.length} de ${candidatos.length}\n`);
console.log(`FRESCOS (7 dias o menos) — para karma: ${frescos.length}\n`);
for (const c of frescos) console.log(linea(c));
console.log(`RECIENTES (8 a 90 dias) — algo de traccion todavia: ${recientes.length}\n`);
for (const c of recientes.slice(0, 15)) console.log(linea(c));
if (recientes.length > 15) console.log(`  ... y ${recientes.length - 15} mas\n`);
console.log(`VIEJOS (mas de 90 dias) — solo indexacion, y ojo con el necroposting: ${viejos.length}`);
console.log('');
console.log(`por subreddit: ${Object.entries(porSub).sort((a, b) => b[1] - a[1]).map(([k, v]) => `r/${k} ${v}`).join(' · ') || '(ninguno)'}`);

// ------------------------------------------------------------------ REPORTE
const hoy = new Date().toISOString().slice(0, 10);
const OUT = path.join(ROOT, 'output', 'reddit', `busqueda-${hoy}.md`);
const bloque = (c) => [
  `### ${c.titulo}`,
  '',
  `- **Hilo:** ${c.url}`,
  `- **Sub:** r/${c.sub} · **Dominio:** ${c.sitio} · **Antigüedad:** ${c.dias != null ? `${c.dias} días` : 'sin fecha'}`,
  `- **Preguntan:** ${c.pregunta}`,
  `- **Por qué sirve:** ${c.porque}`,
  c.cuerpo ? `- **Extracto:** _${c.cuerpo.slice(0, 400)}_` : '',
  '',
].filter(Boolean).join('\n');

const md = [
  `# Búsqueda en Reddit — ${hoy}`,
  '',
  `**${sirven.length} contestables** de ${candidatos.length} hilos evaluados · ${Object.keys(porSub).length} subreddits`,
  '',
  '_Esto busca, no espera. Las consultas van a Brave con `site:reddit.com`, así que trae_',
  '_preguntas de cualquier fecha y de cualquier sub, no solo de los que estén configurados._',
  '',
  '---',
  '',
  `## Frescos — 7 días o menos (${frescos.length})`,
  '',
  '_Son los que dan karma: todavía los lee gente._',
  '',
  frescos.length ? frescos.map(bloque).join('\n---\n\n') : '_Ninguno hoy._',
  '',
  '---',
  '',
  `## Recientes — 8 a 90 días (${recientes.length})`,
  '',
  '_Algo de tracción todavía. Menos votos, pero siguen apareciendo en búsquedas._',
  '',
  recientes.length ? recientes.map(bloque).join('\n---\n\n') : '_Ninguno._',
  '',
  '---',
  '',
  `## Viejos — más de 90 días (${viejos.length})`,
  '',
  '_No dan karma: nadie los lee ya. Sirven para que el comentario quede indexado y',
  'los motores de IA lo citen. **Antes de contestar uno, mirar las reglas del sub:**',
  'varios prohíben o mal miran comentar hilos viejos._',
  '',
  viejos.length ? viejos.map(bloque).join('\n---\n\n') : '_Ninguno._',
  '',
  '---',
  '',
  '## Rutina',
  '',
  '1. Pegar este reporte en el chat.',
  '2. Claude tría cuáles valen y escribe las que sirven.',
  '3. Pegar en Reddit y avisar.',
  '',
].join('\n');

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, md, 'utf8');
console.log(`\nReporte -> ${path.relative(ROOT, OUT)}`);

// Se registra lo BUSCADO, no lo contestado: si ya se evaluo y se descarto, no
// tiene sentido volver a pagar la evaluacion mañana.
fs.writeFileSync(LEDGER, JSON.stringify([...historico, ...vistosAhora], null, 0));
console.log(`ledger: ${new Set([...historico, ...vistosAhora]).size} hilos ya evaluados`);
