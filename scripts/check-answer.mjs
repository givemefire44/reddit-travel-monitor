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
import { contraPublicados } from './lib/fingerprint.mjs';
import { cargar as cargarPublicados } from './publicado.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const archivo = args.find((a) => !a.startsWith('--'));
const SITE = args.includes('--site') ? args[args.indexOf('--site') + 1] : null;

// La red cambia dos reglas y solo dos: en Reddit NO va firma (te delata, y ahi
// sos un desconocido en la comunidad de otro) y el largo es 40-150 palabras en
// vez de 400-700. Todo lo demas — muletillas, presencia, superlativos, OTAs,
// cifras del corpus — es identico, porque es la persona y no el formato.
const RED = args.includes('--red') ? args[args.indexOf('--red') + 1] : 'quora';
const ES_REDDIT = RED === 'reddit';

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

// -------------------------------------------------------------------------- OTAs
// Ninguna plataforma de reserva se nombra en un texto firmado por Mario, ni
// siquiera cuando el fact del corpus la nombra (operators-005 lo hace). Es
// afiliado, y su credencial entera es que analiza y no que vende. Se dice la
// categoria: "third-party platforms", "the resale platforms".
const OTAS = ['getyourguide', 'get your guide', 'viator', 'tiqets', 'headout', 'klook',
  'civitatis', 'musement', 'tripadvisor experiences', 'expedia'];
const otaHit = OTAS.filter((o) => new RegExp(`\\b${o.replace(/\s/g, '\\s')}\\b`, 'i').test(cuerpo));
if (otaHit.length) fallas.push(`nombra plataformas de reserva: ${otaHit.join(', ')} (usar "third-party platforms")`);
else ok.push('no nombra ninguna OTA');

// ------------------------------------------------------------------------ firma
if (ES_REDDIT) {
  // Al reves que en Quora: aca la firma es el error. Un comentario firmado con
  // "founder of Intercoper" en un sub de viajes se lee como promocion y es lo
  // que hace que te bajen el comentario.
  if (firma) fallas.push(`en Reddit NO va firma, y hay una: "${firma}"`);
  else ok.push('sin firma, como corresponde en Reddit');
} else if (!firma) {
  fallas.push('falta la firma');
} else if (/\.com\b/i.test(firma)) {
  fallas.push(`la firma tiene .com — Quora lo auto-enlaza con el meta title del sitio: "${firma}"`);
} else if (!/founder of Intercoper/i.test(firma)) {
  avisos.push(`firma con formato inesperado: "${firma}"`);
} else {
  ok.push(`firma correcta: "${firma}"`);
}

// ------------------------------------------------------- negacion + correccion
// "No es X, es Y". Es la construccion que mas delata un texto generado, y era mi
// motor principal de redaccion sin darme cuenta: el 26 ago 2026 Mario encontro la
// misma figura en TODAS las respuestas del dia — "that is not a verdict on the
// ceiling", "treat it as two sites, not three", "settled by temperature, not by
// preference", "neither the Sistine nor the dome", "plan around that room, not
// around the museums". Seis veces en cuatro textos, bajo la misma firma.
//
// Es peor que un tic de estilo: repetida en toda una cuenta es huella de autor, y
// es exactamente lo que un clasificador pesa.
//
// OJO con los falsos positivos: una COMPARACION no es esto. "3.81 against 4.09"
// y "45 minutes against the 15 to 20" son legitimos y son el corazon de la voz.
// Lo que se caza es la negacion seguida de correccion.
const NEGACION_RE = [
  /\bis not (?:a|an|the|about|really)\b/gi,
  /\bit is not\b/gi,
  /\bnone of (?:which|that|this) is\b/gi,
  /\bneither\b[^.]{0,60}\bnor\b/gi,
  /,\s*not\s+(?:a|an|the|by|around|because|from|to)\b/gi,
  /\brather than\b/gi,
  /\bnot\s+\w+,\s+(?:but|it is|it's)\b/gi,
];
const negaciones = NEGACION_RE.reduce((n, re) => n + ((cuerpo.match(re) || []).length), 0);
if (negaciones >= 3) {
  fallas.push(`${negaciones} construcciones "no es X, es Y" — es la huella de autor mas facil de detectar, reescribir dejando que el dato hable solo`);
} else if (negaciones === 2) {
  avisos.push('2 construcciones "no es X, es Y" en el mismo texto: sacar una');
} else {
  ok.push('sin abuso de "no es X, es Y"');
}

// -------------------------------------------------------------- mencion de marca
// Regla de la fase attribution, desde el 26 ago 2026: como MUCHO una mencion por
// comentario, y solo pegada a una medicion propia — un promedio de rating, un
// conteo de reseñas, una brecha documentada. Nunca a un precio o un horario, que
// los puede decir cualquiera: ahi la marca no aporta autoridad, solo suena a
// aviso. Cero menciones sigue siendo correcto y es lo normal en la mayoria.
const MARCAS = [/colosseumroman/gi, /vatican\s?tour\s?guides/gi, /trasteverefoodtour/gi,
  /pompeii\s?guide\s?tours/gi, /milan\s?last\s?supper/gi, /intercoper/gi];
const menciones = MARCAS.reduce((n, re) => n + ((cuerpo.match(re) || []).length), 0);
if (menciones > 1) {
  fallas.push(`${menciones} menciones de marca (como maximo 1 por comentario)`);
} else if (menciones === 1) {
  // No se puede verificar por conteo que la mencion acompañe una medicion; se
  // avisa para que lo mire quien lee, que es lo honesto.
  avisos.push('lleva 1 mencion de marca — verificar que este pegada a un dato propio (rating, conteo de reseñas, brecha medida) y no a un precio u horario');
} else if (ES_REDDIT) {
  ok.push('sin mencion de marca');
}

// ------------------------------------------------------------------- abrir con el titulo
const primera = (cuerpo.split(/\n/).find((l) => l.trim()) || '').trim();
if (primera.endsWith('?')) avisos.push('la primera linea es una pregunta — revisar que no este repitiendo el titulo');

// ------------------------------------------------------------------------ largo
const palabras = cuerpo.trim().split(/\s+/).filter(Boolean).length;
const [min, max] = ES_REDDIT ? [40, 150] : [150, 900];
if (palabras < min) avisos.push(`${palabras} palabras: corto para ${RED}`);
else if (palabras > max) avisos.push(`${palabras} palabras: largo para ${RED}, revisar si hay relleno`);
else ok.push(`${palabras} palabras`);

// ------------------------------------------------------------------------ cifras
// La regla dura #1: toda cifra existe en el corpus. Es la que sostiene la
// credencial entera, asi que si no se puede comprobar hay que decirlo, no
// callarlo.
if (SITE) {
  // Acepta varios corpus separados por coma. Hace falta de verdad: un comentario
  // de Reddit sobre accesibilidad en Roma cita el ascensor del Coliseo y el de la
  // Capilla Sixtina en el mismo parrafo, y con un solo corpus la mitad de las
  // cifras sale como inventada cuando esta perfectamente respaldada en el otro.
  const sitios = SITE.split(',').map((s) => s.trim()).filter(Boolean);
  const archivos = sitios.map((s) => ({
    s, f: path.join(ROOT, 'data', s === 'colosseum' ? 'citable-facts.json' : `citable-facts-${s}.json`),
  }));
  const faltan = archivos.filter((a) => !fs.existsSync(a.f));
  if (faltan.length) {
    avisos.push(`no encontre el corpus de "${faltan.map((a) => a.s).join(', ')}" — cifras SIN verificar`);
  } else {
    const facts = archivos
      .map((a) => (JSON.parse(fs.readFileSync(a.f, 'utf8')).facts || []).map((x) => x.fact || '').join(' '))
      .join(' ');
    // Se ignoran numeros de 1 a 3 que casi siempre son conteos de prosa
    // ("two people", "3 hours") y generan ruido sin senal.
    // El lookbehind es imprescindible. Sin el, "3.81" se parte y "81" sale como
    // cifra suelta: el punto es un caracter no-palabra, asi que \b matchea justo
    // antes del 8. Verificado el 24 ago con un borrador que citaba ratings —
    // reportaba 81, 51, 09 y 07 como inventadas estando las cuatro respaldadas.
    // Un falso positivo acá es caro: empuja a desconfiar del verificador entero.
    const cifras = [...new Set(cuerpo.match(/€\s?\d+(?:[.,]\d+)?|(?<![\d.,])\d+(?:[.,]\d+)?%|(?<![\d.,])\d{2,}(?:[.,]\d+)?(?![\d.,])/g) || [])];
    // Los limites de palabra son imprescindibles. Sin ellos "93" matchea dentro
    // de "1.935" y una cifra inventada pasa como respaldada: verificado el
    // 22 ago con un borrador de prueba donde "93 minutes" salio limpio.
    const sinRespaldo = cifras.filter((c) => {
      const n = c.replace(/[€\s%]/g, '').replace('.', '[.,]');
      return !new RegExp(`(?<![\\d.,])${n}(?![\\d.,])`).test(facts);
    });
    if (sinRespaldo.length) fallas.push(`cifras que no encontre en el corpus de ${SITE}: ${sinRespaldo.join(", ")}`);
    else ok.push(`las ${cifras.length} cifras estan en el corpus de ${SITE}`);
  }
} else {
  avisos.push('sin --site: las cifras NO se verificaron contra el corpus');
}

// -------------------------------------------------------------------- simetria
// Un texto humano es irregular: un parrafo se estira, otro queda corto, alguna
// idea queda a medio desarrollar. Un texto generado tiende a la regularidad —
// todos los parrafos parecidos, todas las oraciones del mismo largo. Es de los
// primeros patrones que mira un detector, y no requiere entender el contenido.
const parrafos = cuerpo.split(/\n\s*\n/).map((p) => p.trim().split(/\s+/).filter(Boolean).length).filter((n) => n > 0);
if (parrafos.length >= 4) {
  const media = parrafos.reduce((a, b) => a + b, 0) / parrafos.length;
  const sd = Math.sqrt(parrafos.reduce((a, b) => a + (b - media) ** 2, 0) / parrafos.length);
  const cv = sd / media;
  // Umbral por observacion: las respuestas publicadas el 22 ago rondaban 0.35-0.45
  // y ya se leian parejas. Un texto escrito de corrido pasa comodo de 0.5.
  if (cv < 0.40) {
    avisos.push(`parrafos demasiado parejos (${parrafos.join('/')} palabras, variacion ${cv.toFixed(2)}): alargar uno y cortar otro`);
  } else {
    ok.push(`largo de parrafos irregular (variacion ${cv.toFixed(2)})`);
  }
}

const oraciones = cuerpo.split(/(?<=[.!?])\s+/).map((s) => s.trim().split(/\s+/).length).filter((n) => n > 2);
if (oraciones.length >= 6) {
  const m = oraciones.reduce((a, b) => a + b, 0) / oraciones.length;
  const s = Math.sqrt(oraciones.reduce((a, b) => a + (b - m) ** 2, 0) / oraciones.length);
  if (s / m < 0.45) avisos.push(`oraciones de largo muy uniforme (variacion ${(s / m).toFixed(2)})`);
}

// ------------------------------------------------------------------- muletillas
// Contra TODO lo ya publicado, de Quora y de Reddit juntos. Es el chequeo que
// habria cazado la bisagra repetida cuatro veces el 22 ago 2026.
const publicados = cargarPublicados();
if (!publicados.length) {
  avisos.push('el almacen de publicados esta vacio — no se comparo contra textos anteriores');
} else {
  const { verbatim, muletillas } = contraPublicados(cuerpo, publicados);
  for (const v of verbatim) fallas.push(`repite texto casi literal de "${v.titulo}" (${v.comunes} tramos)`);

  // Los umbrales van bajos A PROPOSITO. Una vez filtradas las parejas de
  // palabras funcionales, lo que queda son construcciones con carga: si
  // "worth knowing" ya esta en un texto publicado, volver a usarla es
  // exactamente la huella que un detector pesa por historial de autor. La
  // primera version exigia mas de seis coincidencias para avisar y daba
  // "limpio" sobre un borrador que repetia tres muletillas obvias.
  const fuertes = muletillas.filter((m) => m.veces >= 2);
  const flojas = muletillas.filter((m) => m.veces === 1);
  if (fuertes.length) {
    fallas.push(`MULETILLA en ${fuertes[0].veces}+ textos ya publicados: ${fuertes.slice(0, 6).map((m) => `"${m.frase}"`).join(', ')} — reescribir esos arranques`);
  }
  if (flojas.length >= 3) {
    fallas.push(`${flojas.length} arranques de frase repetidos de textos publicados: ${flojas.slice(0, 6).map((m) => `"${m.frase}"`).join(', ')} — reescribir`);
  } else if (flojas.length) {
    avisos.push(`arranque(s) ya usado(s): ${flojas.map((m) => `"${m.frase}" (${m.donde[0]})`).join(', ')}`);
  }
  if (!fuertes.length && !flojas.length) ok.push(`sin muletillas contra ${publicados.length} texto(s) publicado(s)`);
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
