// Prueba si el matcher encuentra material para una pregunta dada.
//
// Existe porque el 25 ago 2026 el monitor devolvio tres dias seguidos sin un
// solo candidato con corpus, y no habia forma de distinguir dos causas muy
// distintas: que la maquina se hubiera roto, o que simplemente nadie estuviera
// preguntando por nuestros temas. Con esto se prueba en un segundo, con
// preguntas de control que sabemos que deberian matchear.
//
// Uso:  node scripts/probar-match.mjs                      (bateria de control)
//       node scripts/probar-match.mjs "tu pregunta aca"

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'reddit-monitor.json'), 'utf8'));

const FACTS = {};
for (const s of CONFIG.sites) {
  FACTS[s.key] = JSON.parse(fs.readFileSync(path.join(ROOT, s.factsFile), 'utf8')).facts || [];
}

// Los mismos umbrales que usa bestSiteByFacts en reddit-monitor.mjs.
const MIN_TOPICS = 2;
const MIN_FACTS = 3;

const tieneKeyword = (hay, k) => new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(hay);

const STOP = new Set(['about', 'there', 'their', 'which', 'would', 'could', 'these', 'those',
  'other', 'where', 'while', 'after', 'before', 'through', 'visit', 'visitors', 'people']);

function evaluar(texto) {
  const hay = texto.toLowerCase();
  const filas = [];
  for (const s of CONFIG.sites) {
    const kws = s.keywords.filter((k) => tieneKeyword(hay, k));
    if (!kws.length) continue;
    const topics = new Set();
    for (const f of FACTS[s.key]) {
      const palabras = (f.fact || '').toLowerCase().match(/[a-z]{5,}/g) || [];
      if (palabras.some((w) => !STOP.has(w) && hay.includes(w))) f.topics.forEach((t) => topics.add(t));
    }
    const facts = FACTS[s.key].filter((f) => f.topics.some((t) => topics.has(t)));
    filas.push({
      sitio: s.key, kw: kws[0], topics: topics.size, facts: facts.length,
      pasa: topics.size >= MIN_TOPICS && facts.length >= MIN_FACTS,
    });
  }
  return filas;
}

const CONTROL = [
  'Is the Colosseum underground tour worth it?',
  'How early should I book Vatican museum tickets?',
  'Whats the best food tour in Trastevere?',
  'How do I get to Pompeii from Naples for the day?',
  'Do I need to book the Last Supper in Milan in advance?',
  'Vinyl shops in Rome',
  'From Rome to Fiumicino airport',
];

const propia = process.argv.slice(2).join(' ').trim();
const preguntas = propia ? [propia] : CONTROL;

console.log(`Corpus: ${CONFIG.sites.map((s) => `${s.key} ${FACTS[s.key].length}`).join(' · ')}`);
console.log(`Umbrales: ${MIN_TOPICS}+ topics y ${MIN_FACTS}+ facts\n`);

for (const p of preguntas) {
  const filas = evaluar(p);
  const gana = filas.find((f) => f.pasa);
  console.log(`${gana ? 'MATCH ' : '  --  '} ${p}`);
  if (!filas.length) console.log('         ninguna keyword de ningun sitio');
  for (const f of filas) {
    console.log(`         ${f.pasa ? 'si' : 'no'}  ${f.sitio} (kw "${f.kw}"): ${f.topics} topics, ${f.facts} facts`);
  }
  console.log('');
}
