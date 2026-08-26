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

const soloDominio = process.argv[2];
const dominios = soloDominio ? [soloDominio] : Object.keys(CONSULTAS);

// El ledger de Reddit, para no volver a ofrecer lo ya entregado.
const LEDGER = path.join(ROOT, 'data', 'reddit-buscados.json');
const yaVistos = new Set(fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, 'utf8')) : []);

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

const porSub = {};
for (const c of sirven) porSub[c.sub] = (porSub[c.sub] || 0) + 1;

console.log(`CONTESTABLES: ${sirven.length} de ${candidatos.length}\n`);
for (const c of sirven) {
  console.log(`  [${c.sitio}] r/${c.sub}${c.edad ? ` · ${c.edad}` : ''}`);
  console.log(`     ${c.titulo.slice(0, 92)}`);
  console.log(`     preguntan: ${c.pregunta}`);
  console.log(`     ${c.url}`);
  console.log('');
}
console.log(`por subreddit: ${Object.entries(porSub).sort((a, b) => b[1] - a[1]).map(([k, v]) => `r/${k} ${v}`).join(' · ') || '(ninguno)'}`);

// Se registra lo BUSCADO, no lo contestado: si ya se evaluo y se descarto, no
// tiene sentido volver a pagar la evaluacion mañana.
fs.writeFileSync(LEDGER, JSON.stringify([...yaVistos, ...vistosAhora], null, 0));
console.log(`\nledger: ${yaVistos.size + vistosAhora.size} hilos ya evaluados`);
