// Compara el juez de relevancia contra lo que hicieron las listas de keywords,
// sobre los posts REALES de los reportes del 23, 24 y 25 de agosto de 2026.
//
// El "esperado" de cada caso lo puso Mario a mano leyendo los reportes: es el
// veredicto correcto, no el que dio el sistema. Varios de estos el sistema los
// marco "sin corpus" teniendo material de sobra.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluarLote } from './lib/relevancia.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1');
}

const SITIOS = [
  { key: 'colosseum', descripcion: 'Visiting the Colosseum, Roman Forum and Palatine Hill: which ticket to buy, prices, release windows, queues, the Arena Floor and the Underground (hypogeum), the Attic, guided tours, best time of day and year, accessibility, and how the sites fit together in a day.' },
  { key: 'vatican', descripcion: "Visiting the Vatican Museums, the Sistine Chapel and St Peter's Basilica: tickets and prices, booking, queues and security, dress code, the dome climb, guided vs audio guide, after-hours and early-entry tours, accessibility, and how to sequence the three." },
  { key: 'trastevere', descripcion: 'Eating in Rome and Rome food tours: where to eat and what things cost, tourist-trap versus neighbourhood pricing, Roman dishes, Trastevere, Testaccio, the Jewish Ghetto, food tour formats and value.' },
  { key: 'pompeii', descripcion: 'Visiting Pompeii and Herculaneum: tickets, opening times, guided tours, how long it takes, what to see, getting there from Naples or Sorrento, heat and shade, accessibility.' },
  { key: 'milan', descripcion: "Seeing Leonardo's Last Supper in Milan: booking windows and how far ahead tickets release, prices, the 15-minute slots, and visiting Milan's centre (Duomo, Sforza Castle)." },
];

// title, body resumido, y el veredicto correcto segun lectura humana
const CASOS = [
  ['From Rome to Fiumicino airport', 'Flight at 6am, how do I get to FCO that early?', false],
  ['Vinyl shops in Rome', 'Looking for secondhand record shops', false],
  ['Rome visit recommandations', 'Staying near the Vatican in October with a small kid for a week. Any food recommendations or places to eat? Should we visit another city?', true],
  ['Early morning trip to FCO', 'Staying in Palocco, need to reach the airport very early', false],
  ['7-8 weeks pregnant in Rome and from Australia - private scan?', 'Where can I get a private ultrasound', false],
  ['Where can I buy a EuroMillions ticket in Rome?', 'Looking for a lottery terminal', false],
  ['Is Rome wheelchair accessible with all those cobblestones?', 'Travelling with a wheelchair user, worried about the cobblestones and the main sights', true],
  ['Solo traveler visiting Oct 7-12 to stay in Piazza Navona or Trastevere?', 'Solo guy, want nightlife and meeting people, which neighbourhood', true],
  ['Portugal or more of Italy?', 'Deciding between Lisbon/Porto and Verona/Bologna/Venice', false],
  ['How is bus travel from Lyon to Turin?', 'Is the coach comfortable, luggage safe?', false],
  ['Rome Colosseum Tickets - how to pair with Forum Romanum?', 'Do I need separate tickets for the Forum?', true],
  ['Can you book an Attic and Underground ticket for the Colosseum on the Same Day?', 'Want both upgrades in one visit', true],
  ['Pompeii Ticketing', 'How do I buy tickets for Pompeii, is there a queue', true],
  ['Pompeii on All Saints Day?', 'Will it be open on Nov 1 and how crowded', true],
  ['How to purchase advance Pantheon tickets?', 'Pantheon now charges, how to book', false],
  ['Aggravated robbery in Trastevere', 'Warning about a mugging last night', false],
  ['Best coffee Trastevere', 'Where to get good espresso in Trastevere', true],
];

const posts = CASOS.map(([t, b]) => ({ titulo: t, cuerpo: b }));
const res = await evaluarLote(posts, SITIOS);

let ok = 0;
const fallos = [];
console.log('');
for (let i = 0; i < CASOS.length; i++) {
  const [titulo, , esperado] = CASOS[i];
  const r = res[i];
  const bien = r.contestable === esperado;
  if (bien) ok += 1; else fallos.push({ titulo, esperado, dio: r });
  console.log(`${bien ? ' OK ' : 'MAL '} ${r.contestable ? 'SI ' : 'no '} ${(r.sitio || '-').padEnd(11)} ${titulo.slice(0, 62)}`);
  console.log(`        ${r.porque}`);
}
console.log('');
console.log(`${ok}/${CASOS.length} correctos`);
if (fallos.length) {
  console.log('');
  console.log('fallos:');
  for (const f of fallos) console.log(`  esperado ${f.esperado ? 'SI' : 'no'} · dio ${f.dio.contestable ? 'SI' : 'no'} · ${f.titulo}`);
}
