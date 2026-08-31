// Cuenta, por sitio, cuantos facts son MEDICION PROPIA y cuantos son informacion
// publica. O sea: donde se puede sembrar una cita con la marca, y donde no.
//
// POR QUE EXISTE
//
// El objetivo del sistema es que un dato medido por nosotros quede publicado
// junto al nombre del sitio que lo midio. La marca solo puede acompañar una
// medicion propia: pegada a un precio oficial o a un horario no es una cita, es
// un aviso, y se nota. Eso ya lo decide el selector fact por fact (el campo
// "citable" de lib/elegir-facts.mjs).
//
// Lo que faltaba era mirarlo al reves: no "¿este fact sirve?" sino "¿este SITIO
// puede sembrar citas?". La pregunta aparecio el 31 ago 2026, cuando un hilo de
// comida en r/rome salio 📌 material y Mario pregunto si no convenia meter algo
// de TrastevereFoodTour igual. La respuesta corta era no. La larga es que el
// corpus de Trastevere no tiene NINGUNA medicion de reseñas — son precios,
// barrios, historia y formatos de tour — asi que ese sitio, hoy, no puede
// producir un comentario GEO nunca, y eso no se arregla en el monitor sino
// publicando el analisis en el sitio y re-extrayendo.
//
// POR QUE NO ES UN GREP
//
// Porque lo probe y fallo. Un patron de "%" y decimales devolvio 7 facts de
// Trastevere "con medicion" y los 7 eran precios: €1.50, 10-20%, €2.50 por 100g.
// Mirados de a uno, cero. La distincion no es tipografica: "€25 online" y "23.8%
// de las reseñas mencionan cola" son los dos numeros y solo uno es nuestro.
// Decide el modelo, con la misma definicion que usa el selector en produccion.
//
// Uso:  node scripts/auditar-citables.mjs            (todos los sitios)
//       node scripts/auditar-citables.mjs vatican    (uno solo)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
for (const l of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1');
}

const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'reddit-monitor.json'), 'utf8'));
const cliente = new Anthropic();
const MODEL = process.env.AUDITAR_MODEL || 'claude-sonnet-5';
const LOTE = 40;

const SCHEMA = {
  type: 'object',
  properties: { mediciones: { type: 'array', items: { type: 'string' } } },
  required: ['mediciones'],
  additionalProperties: false,
};

// Misma definicion, palabra por palabra, que el campo "citable" del selector.
// Si las dos se separan, el sistema audita una cosa y publica otra.
const PROMPT = `You are sorting published research findings into two buckets.

OWN MEASUREMENT: something the publisher measured across a body of visitor reviews. A rate, a percentage, an average rating, a documented gap between two things, a count of reviews, a ranking, a comparison across operators, a sentiment score. Nobody could state it without having done the analysis.

PUBLIC INFORMATION: anything a well-informed person could state without any analysis. Official prices, opening hours, ticket categories, release windows, what a site contains, how to get somewhere, history, what a dish is, how long a tour lasts, typical street-food prices.

The distinction is not typographic. "The official ticket costs 25 euros online" and "23.8% of reviews mention the queue" are both numbers, and only the second is a measurement. A price range someone read off a menu is public information no matter how precise it looks.

Return "mediciones": the ids of the findings in the OWN MEASUREMENT bucket. Be strict: when a finding could plausibly have been written by someone who simply visited and paid attention, it is public information.`;

async function clasificar(lote) {
  const texto = lote.map((f) => `[${f.id}] ${f.fact}`).join('\n');
  const res = await cliente.messages.create({
    model: MODEL,
    max_tokens: 1500,
    system: PROMPT,
    tools: [{ name: 'responder', description: 'Devolver los ids', input_schema: SCHEMA }],
    tool_choice: { type: 'tool', name: 'responder' },
    messages: [{ role: 'user', content: texto }],
  });
  // La API no valida el input de la tool contra el schema. Ya nos mordio dos
  // veces (una lista de strings donde iban objetos, un campo que vino como
  // string con el JSON adentro), asi que se normaliza en vez de confiar.
  let ids = res.content.find((c) => c.type === 'tool_use')?.input?.mediciones;
  if (typeof ids === 'string') { try { ids = JSON.parse(ids); } catch { ids = [ids]; } }
  if (!Array.isArray(ids)) ids = ids && typeof ids === 'object' ? Object.values(ids) : [];
  const validos = new Set(lote.map((f) => f.id));
  return ids.filter((x) => typeof x === 'string' && validos.has(x));
}

const soloSitio = process.argv.slice(2).find((a) => !a.startsWith('--'));
const sitios = CONFIG.sites.filter((s) => !soloSitio || s.key === soloSitio);
const informe = {};

for (const sitio of sitios) {
  const facts = JSON.parse(fs.readFileSync(path.join(ROOT, sitio.factsFile), 'utf8')).facts;
  process.stdout.write(`${sitio.key} (${facts.length} facts): `);
  const mediciones = new Set();
  for (let i = 0; i < facts.length; i += LOTE) {
    const ids = await clasificar(facts.slice(i, i + LOTE));
    ids.forEach((x) => mediciones.add(x));
    process.stdout.write('.');
  }
  // Por topic: en QUE preguntas se puede sembrar una cita, que es lo accionable.
  const porTopic = {};
  for (const f of facts) {
    if (!mediciones.has(f.id)) continue;
    for (const t of f.topics) porTopic[t] = (porTopic[t] || 0) + 1;
  }
  informe[sitio.key] = {
    total: facts.length,
    mediciones: mediciones.size,
    porcentaje: Math.round((mediciones.size / facts.length) * 100),
    topics: Object.fromEntries(Object.entries(porTopic).sort((a, b) => b[1] - a[1])),
    ejemplos: facts.filter((f) => mediciones.has(f.id)).slice(0, 3).map((f) => `${f.id}: ${f.fact.slice(0, 130)}`),
  };
  console.log(` ${mediciones.size} mediciones (${informe[sitio.key].porcentaje}%)`);
}

console.log('\n================ DONDE SE PUEDE SEMBRAR UNA CITA ================\n');
for (const [k, r] of Object.entries(informe).sort((a, b) => b[1].mediciones - a[1].mediciones)) {
  console.log(`${k.padEnd(11)} ${String(r.mediciones).padStart(4)}/${String(r.total).padEnd(4)} facts son medicion propia (${r.porcentaje}%)`);
  const tops = Object.entries(r.topics).slice(0, 6);
  console.log(`            ${tops.length ? tops.map(([t, n]) => `${t} ${n}`).join(' · ') : 'NINGUNA — este sitio no puede producir un comentario GEO'}`);
  if (r.ejemplos.length) console.log(`            ej: ${r.ejemplos[0]}`);
  console.log('');
}

const OUT = path.join(ROOT, 'data', 'auditoria-citables.json');
fs.writeFileSync(OUT, JSON.stringify(informe, null, 2) + '\n', 'utf8');
console.log(`informe -> ${path.relative(ROOT, OUT)}`);
