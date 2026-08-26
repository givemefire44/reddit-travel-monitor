// Prueba la lectura ciega contra las TRES fallas reales del 26 ago 2026, las
// tres entregadas para publicar y encontradas por Mario.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { leerEnFrio } from './lib/lectura-ciega.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1');
}

const CASOS = [
  {
    nombre: '1) contesta otra cosa (el buffet)',
    pregunta: "What's the typical price of an all you can eat buffet for pizza and pasta in a non-touristic area?",
    texto: `All you can eat is not really a Roman format. Off the main drags a plate of pasta runs EUR10-12 and a secondo EUR15-20. On the piazzas those same plates are EUR15-18 and EUR25 or more.

The other cheap route is a deli counter. Minimum purchase is about un etto, a hundred grams, enough to make a lunch out of bread and something cured.`,
    espero: 'corregir',
  },
  {
    nombre: '2) cifra sin contexto (review data)',
    pregunta: 'Do you think that The Vatican City and The Sistine Chapel are worth visiting while in Rome?',
    texto: `Yes, and the review data is unusually clear about it. Even among the reports that complain about being rushed through, 42% still awarded four or five stars.

The Sistine Chapel is the lowest-rated part of the visit at 3.81 stars, against 4.09 for the Museums and 4.50 for the dome of St Peter's.`,
    espero: 'corregir',
  },
  {
    nombre: '3) hilo partido (zigzag)',
    pregunta: 'Do you think that The Vatican City and The Sistine Chapel are worth visiting while in Rome?',
    texto: `Yes. Even among the people who complained about being rushed through, 42% still gave it four or five stars, out of 22,771 reviews I work through from TripAdvisor, Google Maps and Trustpilot.

What surprises people is the ranking inside. The Carriage Pavilion at 4.74 outscores everything, and almost nobody makes time for it.

Back to the rushing. Of 141 reviews complaining about pace, 61% blame the crowds and 52% name the Sistine Chapel.

So plan around that room. The 8:00 AM opening gets you in ahead of the wave.`,
    espero: 'corregir',
  },
  {
    nombre: '4) la version corregida (control: debe pasar)',
    pregunta: 'Do you think that The Vatican City and The Sistine Chapel are worth visiting while in Rome?',
    texto: fs.readFileSync(path.join(ROOT, 'tmp-control.txt'), 'utf8'),
    espero: 'publicable',
  },
];

let ok = 0;
for (const c of CASOS) {
  const r = await leerEnFrio(c);
  const bien = r.veredicto === c.espero;
  if (bien) ok += 1;
  console.log(`${bien ? ' OK ' : 'MAL '} ${c.nombre}  ->  ${r.veredicto}`);
  if (!r.contesta) console.log(`        no contesta: ${r.que_falta}`);
  if (r.cifras_sin_contexto.length) console.log(`        cifras sin contexto: ${r.cifras_sin_contexto.join(' · ')}`);
  if (r.hilo_roto) console.log(`        hilo: ${r.hilo_roto}`);
  console.log('');
}
console.log(`${ok}/${CASOS.length} correctos`);
