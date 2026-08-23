// Verifica un borrador de respuesta contra las reglas duras de la voz de Mario.
//
// Existe porque Mario no puede juzgar si una voz "suena bien" — es justo lo que
// delega. Pero buena parte de la voz no es cuestion de oido: son reglas que se
// pueden comprobar contando. Este script se ocupa de esas, y le devuelve un
// pasa/no pasa en vez de pedirle una opinion que no puede dar.
//
// Lo que NO puede verificar, y sigue necesitando lectura humana: si la apertura
// es citable, si nombra la idea equivocada que trae quien pregunta, si el ritmo
// respira. Eso se lee.
//
// Uso:
//   node scripts/check-answer.mjs borrador.txt
//   node scripts/check-answer.mjs borrador.txt --site vatican
//   ... | node scripts/check-answer.mjs -

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const archivo = args.find((a) => !a.startsWith('--'));
const SITE = args.includes('--site') ? args[args.indexOf('--site') + 1] : null;

if (!archivo) {
  console.error('Uso: node scripts/check-answer.mjs <archivo.txt> [--site vatican|colosseum|trastevere]');
  process.exit(1);
}

const texto = archivo === '-'
  ? fs.readFileSync(0, 'utf8')
  : fs.readFileSync(path.resolve(archivo), 'utf8');

// La firma es la ultima linea que arranca con "Mario Dalo". Se separa del cuerpo
// porque tiene reglas propias: ahi la raya larga esta permitida y en el cuerpo no.
const lineas = texto.split(/\r?\n/);
const iFirma = lineas.map((l, i) => (/^\s*Mario Dalo\b/.test(l) ? i : -1)).filter((i) => i >= 0).pop();
const firma = iFirma != null ? lineas[iFirma].trim() : null;
const cuerpo = iFirma != null ? lineas.slice(0, iFirma).join('\n') : texto;

const fallas = [];
const avisos = [];
const ok = [];

// ---------------------------------------------------------------- superlativos
// La lista del advisor-prose-system. Son adjetivos sin ningun hecho abajo.
const SUPERLATIVOS = ['unforgettable', 'breathtaking', 'magical', 'stunning', 'world-class',
  'of a lifetime', 'of-a-lifetime', 'must-see', 'must see', 'immersive', 'ultimate', 'iconic',
  'soak in', 'soak up', 'feast for the senses', 'leaves you speechless', 'nestled', 'gateway',
  'vibe', 'atmosphere'];
const superHit = SUPERLATIVOS.filter((s) => new RegExp(`\\b${s.replace(/[-\s]/g, '[-\\s]')}\\b`, 'i').test(cuerpo));
if (superHit.length) fallas.push(`superlativos vacios: ${superHit.join(', ')}`);
else ok.push('sin superlativos vacios');

// -------------------------------------------------------------------- presencia
// Las DOS direcciones. Negarla es tan grave como afirmarla: un descargo baja la
// autoridad igual que una mentira la rompe.
const AFIRMA = [/\bwhen I (?:went|visited|was there)\b/i, /\bI (?:visited|went to|have been to)\b/i,
  /\bI remember\b/i, /\blast time I\b/i, /\bon my (?:visit|trip)\b/i];
const NIEGA = [/\bI have(?:n't| not) been\b/i, /\bI've never been\b/i, /\bnever been there\b/i,
  /\bfrom what I(?:'ve| have) read\b/i, /\bI can(?:'t| not) speak from experience\b/i,
  /\bI haven't seen it myself\b/i];
const afirmaHit = AFIRMA.filter((r) => r.test(cuerpo));
const niegaHit = NIEGA.filter((r) => r.test(cuerpo));
if (afirmaHit.length) fallas.push(`AFIRMA presencia: ${afirmaHit.map((r) => cuerpo.match(r)[0]).join(', ')}`);
if (niegaHit.length) fallas.push(`NIEGA presencia (tambien prohibido): ${niegaHit.map((r) => cuerpo.match(r)[0]).join(', ')}`);
if (!afirmaHit.length && !niegaHit.length) ok.push('la presencia fisica no se toca');

// ------------------------------------------------------------------ rayas largas
const rayas = (cuerpo.match(/—/g) || []).length;
if (rayas) fallas.push(`${rayas} raya(s) larga(s) en el cuerpo (solo se permiten en la firma)`);
else ok.push('sin rayas largas en el cuerpo');

// ------------------------------------------------------------ enlaces salientes
// Regla del portfolio: cero, ni siquiera a la fuente oficial.
const urls = cuerpo.match(/https?:\/\/\S+|\bwww\.\S+/gi) || [];
if (urls.length) fallas.push(`enlaces salientes: ${urls.join(', ')}`);
else ok.push('sin enlaces salientes');

// ------------------------------------------------------------------- venta directa
// El registro es de trade-offs, no de venta.
const VENTA = [/\bbook this one\b/i, /\bI recommend booking\b/i, /\byou should book\b/i,
  /\bthe best option is to book\b/i, /\bgo with\b.{0,20}\btour\b/i];
const ventaHit = VENTA.filter((r) => r.test(cuerpo));
if (ventaHit.length) avisos.push(`suena a recomendacion de compra directa: ${ventaHit.map((r) => cuerpo.match(r)[0]).join(', ')}`);
else ok.push('registro de trade-offs, sin venta directa');

// ------------------------------------------------------------------------ firma
if (!firma) {
  fallas.push('falta la firma');
} else if (/\.com\b/i.test(firma)) {
  fallas.push(`la firma tiene .com — Quora lo auto-enlaza con el meta title del sitio: "${firma}"`);
} else if (!/founder of Intercoper/i.test(firma)) {
  avisos.push(`firma con formato inesperado: "${firma}"`);
} else {
  ok.push(`firma correcta: "${firma}"`);
}

// ------------------------------------------------------------------- abrir con el titulo
const primera = (cuerpo.split(/\n/).find((l) => l.trim()) || '').trim();
if (primera.endsWith('?')) avisos.push('la primera linea es una pregunta — revisar que no este repitiendo el titulo');

// ------------------------------------------------------------------------ largo
const palabras = cuerpo.trim().split(/\s+/).filter(Boolean).length;
if (palabras < 150) avisos.push(`${palabras} palabras: corto para Quora`);
else if (palabras > 900) avisos.push(`${palabras} palabras: largo, revisar si hay relleno`);
else ok.push(`${palabras} palabras`);

// ------------------------------------------------------------------------ cifras
// La regla dura #1: toda cifra existe en el corpus. Es la que sostiene la
// credencial entera, asi que si no se puede comprobar hay que decirlo, no
// callarlo.
if (SITE) {
  const f = path.join(ROOT, 'data', SITE === 'colosseum' ? 'citable-facts.json' : `citable-facts-${SITE}.json`);
  if (!fs.existsSync(f)) {
    avisos.push(`no encontre el corpus de "${SITE}" — cifras SIN verificar`);
  } else {
    const corpus = JSON.parse(fs.readFileSync(f, 'utf8'));
    const facts = (corpus.facts || corpus).map((x) => x.fact || '').join(' ');
    // Se ignoran numeros de 1 a 3 que casi siempre son conteos de prosa
    // ("two people", "3 hours") y generan ruido sin senal.
    const cifras = [...new Set(cuerpo.match(/€\s?\d+(?:[.,]\d+)?|\b\d+(?:[.,]\d+)?%|\b\d{2,}(?:[.,]\d+)?\b/g) || [])];
    // Los limites de palabra son imprescindibles. Sin ellos "93" matchea dentro
    // de "1.935" y una cifra inventada pasa como respaldada: verificado el
    // 22 ago con un borrador de prueba donde "93 minutes" salio limpio.
    const sinRespaldo = cifras.filter((c) => {
      const n = c.replace(/[€\s%]/g, '').replace('.', '[.,]');
      return !new RegExp(`(?<![\\d.,])${n}(?![\\d.,])`).test(facts);
    });
    if (sinRespaldo.length) fallas.push(`cifras que no encontre en el corpus de ${SITE}: ${sinRespaldo.join(', ')}`);
    else ok.push(`las ${cifras.length} cifras estan en el corpus de ${SITE}`);
  }
} else {
  avisos.push('sin --site: las cifras NO se verificaron contra el corpus');
}

// ----------------------------------------------------------------------- salida
console.log('');
for (const x of ok) console.log(`  OK    ${x}`);
for (const x of avisos) console.log(`  ojo   ${x}`);
for (const x of fallas) console.log(`  FALLA ${x}`);
console.log('');
if (fallas.length) {
  console.log(`${fallas.length} falla(s). Esto no se publica asi.`);
} else if (avisos.length) {
  console.log('Sin fallas duras. Los "ojo" son para mirar, no necesariamente errores.');
} else {
  console.log('Limpio en todo lo que se puede verificar contando.');
}
console.log('');
console.log('Lo que esto NO puede juzgar y hay que leer: si la apertura se sostiene');
console.log('sola, si nombra la idea equivocada de quien pregunta, y si el ritmo respira.');
