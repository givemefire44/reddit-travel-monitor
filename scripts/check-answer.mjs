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
import { leerEnFrio } from './lib/lectura-ciega.mjs';
import { verificarAfuera } from './lib/verificar-afuera.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// El .env hace falta desde que existe la lectura ciega, que llama al modelo.
for (const l of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1');
}

const args = process.argv.slice(2);
const archivo = args.find((a) => !a.startsWith('--'));
const SITE = args.includes('--site') ? args[args.indexOf('--site') + 1] : null;

// La red cambia dos reglas y solo dos: en Reddit NO va firma (te delata, y ahi
// sos un desconocido en la comunidad de otro) y el largo es 40-150 palabras en
// vez de 400-700. Todo lo demas — muletillas, presencia, superlativos, OTAs,
// cifras del corpus — es identico, porque es la persona y no el formato.
const RED = args.includes('--red') ? args[args.indexOf('--red') + 1] : 'quora';
// --pregunta dispara la lectura ciega: un pase que lee el borrador sin saber lo
// que quiso decir quien lo escribio. Es lo unico que caza las fallas de juicio.
const PREGUNTA = args.includes('--pregunta') ? args[args.indexOf('--pregunta') + 1] : null;
const ES_REDDIT = RED === 'reddit';
// El chequeo contra la web corre SOLO, y --sin-red lo apaga. Va asi y no como
// un flag que haya que acordarse porque el caso que lo origino es justamente
// uno donde nadie sospecho que hiciera falta: el borrador se veia bien, no tenia
// una sola cifra, y afirmaba una regla sobre los bares italianos que no existe.
// Un verificador que hay que invocar a proposito no corre el dia que importa.
const SIN_RED = args.includes('--sin-red');
// Se llena en el chequeo del corpus y lo consume el chequeo contra la web.
let FACTS_RESPALDO = [];

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
// SOLO los socios comerciales. La regla existe porque Mario es afiliado de estas
// y nombrarlas en un texto firmado se lee como promocion encubierta.
//
// La primera version metia en la misma bolsa a Expedia, Booking, trip.com y
// cualquier plataforma, y eso estaba mal: el 27 ago 2026 rechazo un comentario
// sobre un paquete de Expedia, en un hilo sobre Expedia, donde no nombrarla
// habria sido absurdo. No hay conflicto de interes con una plataforma de la que
// no cobra nada, y menos cuando es el tema de la pregunta.
const SOCIOS = ['getyourguide', 'get your guide', 'viator'];
const otaHit = SOCIOS.filter((o) => new RegExp(`\\b${o.replace(/\s/g, '\\s')}\\b`, 'i').test(cuerpo));
if (otaHit.length) fallas.push(`nombra un socio comercial: ${otaHit.join(', ')} — usar "third-party platforms"`);
else ok.push('no nombra socios comerciales');

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
// Rangos de Reddit MEDIDOS sobre comentarios humanos reales de r/Flights,
// r/Bookingcom, r/travel, r/ItalyTravel, r/rome y r/hotels, 28 ago 2026:
//   n=126 · p25 12 · MEDIANA 24 palabras · p75 48 · p90 100 · maximo 183
//   24% tienen 10 palabras o menos · 83% tienen 60 o menos
//   71% son de un solo parrafo · 35% de una sola oracion
//   pero de los 21 que pasan de 60 palabras, 17 (el 81%) usan MAS de uno
//
// El rango original (40-150) lo habia inventado yo y estaba al doble de lo real.
// Las dos correcciones que siguieron tampoco eran de fiar:
//
//   - "mediana 30, p75 58" salio de una muestra sin filtrar. El commit decia
//     "sacando los bots de AutoModerator" y el script no tenia filtro ninguno.
//   - "100% de un solo parrafo" nunca midio nada. El limpiador de HTML barria
//     los tags reemplazandolos por espacios, asi que los </p> desaparecian y
//     ninguno de los comentarios guardados tenia un solo salto de linea: contaba
//     parrafos sobre un texto sin parrafos. Lo peor es que el diagnostico ya
//     estaba escrito treinta lineas mas abajo en este mismo archivo, y aun asi
//     el numero siguio viajando a la skill y al prompt del selector.
//
// Las dos veces el error empujo en la misma direccion — hacia el texto mas
// corto y mas prolijo — y las dos veces el numero se dio por bueno porque venia
// de una herramienta propia. Con los saltos de parrafo ya preservados, el dato
// dice lo contrario de lo que se venia usando como regla.
const [min, max] = ES_REDDIT ? [8, 70] : [150, 900];
if (palabras < min) avisos.push(`${palabras} palabras: corto para ${RED}`);
else if (palabras > max) avisos.push(`${palabras} palabras: ${RED === 'reddit' ? `arriba del p75 real (48) — la mediana humana es 24` : 'largo, revisar si hay relleno'}`);
else ok.push(`${palabras} palabras`);

// El formato lo decide la PREGUNTA, no una regla fija.
//
// Aca hubo dos errores seguidos, y el segundo fue mio corrigiendo el primero. La
// regla vieja empujaba a tres o cuatro parrafos siempre. La cambie por "un solo
// parrafo obligatorio" el 27 ago 2026, apoyandome en una medicion que ademas
// estaba rota: al limpiar el HTML de los comentarios convertia los </p><p> en
// espacios, o sea que destrui los saltos de parrafo y despues medi lo que quedo.
//
// Mario: "hay preguntas que necesitan varios parrafos para ser respondidas con
// claridad, pero para eso tenes que leer toda la pregunta y entenderla, para
// luego evaluar que formato es el mejor para cada caso".
//
// Cambiar una uniformidad por otra no arregla nada: lo que delata es que todas
// las respuestas tengan la misma forma, no cual sea esa forma. Por eso aca no hay
// numero obligatorio — el control de que no se repita la arquitectura lo hace la
// silueta, contra el historial de lo publicado.
// Con los saltos ya medidos de verdad, el aviso mira las DOS direcciones y las
// dos contra el largo, que es lo unico que hace comparable un comentario con
// otro. Un bloque de 100 palabras es raro entre humanos (81% de los largos
// parten); cuatro bloques para 30 palabras es picado de mas. El molde delator es
// que todas las respuestas tengan la misma forma, no cual sea esa forma.
if (ES_REDDIT) {
  const bloques = cuerpo.split(/\n\s*\n/).filter((p) => p.trim()).length;
  if (palabras > 60 && bloques === 1) {
    avisos.push(`${palabras} palabras en un solo bloque: de los comentarios humanos que pasan de 60 palabras, el 81% usa mas de un parrafo`);
  } else if (palabras <= 60 && bloques > 2) {
    avisos.push(`${bloques} parrafos para ${palabras} palabras: partido de mas`);
  } else if (bloques > 4) {
    avisos.push(`${bloques} parrafos: revisar si la pregunta los pide`);
  } else {
    ok.push(`${bloques} parrafo(s) para ${palabras} palabras`);
  }
}

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
    const listaFacts = archivos.flatMap((a) => JSON.parse(fs.readFileSync(a.f, 'utf8')).facts || []);
    const facts = listaFacts.map((x) => x.fact || '').join(' ');
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
    // Los facts que de verdad sostienen este borrador: los que contienen alguna
    // de las cifras que el texto cita. Van al chequeo contra la web para que NO
    // salga a buscar lo que el corpus ya respalda — que es todo el sentido de
    // "chequear lo que el corpus no cubre" y no "chequear todo".
    const enElTexto = (f) => cifras.some((c) => {
      const n = c.replace(/[€\s%]/g, '').replace('.', '[.,]');
      return new RegExp(`(?<![\\d.,])${n}(?![\\d.,])`).test(f.fact || '');
    });
    FACTS_RESPALDO = listaFacts.filter(enElTexto).map((f) => f.fact).slice(0, 12);
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
  const { verbatim, muletillas, formas } = contraPublicados(cuerpo, publicados);
  if (formas.length) {
    avisos.push(`misma arquitectura que ${formas.length} publicada(s) (${formas[0]}): cambiar la forma, no solo las palabras`);
  }
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
if (!PREGUNTA) {
  console.log('Falta lo que no se cuenta: si contesta lo que preguntaron y si las cifras');
  console.log('se entienden. Para eso, agregar --pregunta "<la pregunta del post>".');
}

// ======================================================================
// CONTRA LA WEB
//
// Cubre el hueco que deja la regla del corpus. "Toda cifra sale de un fact"
// protege los numeros; no protege el resto de la oracion, y en carril karma el
// comentario entero es el resto de la oracion.
//
// Ver lib/verificar-afuera.mjs para el caso que lo origino (el derecho de mesa
// que no existe, publicado el 28 ago 2026). Lo importante: no era una cifra
// inventada. Era una regla limpia sobre algo que en realidad depende del local.
// ======================================================================
if (!SIN_RED) {
  console.log('Chequeando contra la web lo que no respalda el corpus...\n');
  try {
    const { ok, error, items } = await verificarAfuera(cuerpo, FACTS_RESPALDO);
    if (!ok) {
      console.log(`  (no se pudo: ${error})`);
    } else if (!items.length) {
      console.log('  OK    el texto no hace ninguna afirmacion chequeable');
    } else {
      for (const it of items) {
        // Defensivo a proposito: un tool_use que vuelve incompleto dejaba un
        // item sin `texto` y el reporte entero moria en el .slice, tapando los
        // dos hallazgos que si habian salido bien. Un verificador no puede
        // perder sus propios resultados por como los imprime.
        const afirmacion = String(it.texto || it.consulta || '(afirmacion sin texto)');
        const fuentes = it.fuentes || [];
        const etiqueta = {
          respaldada: '  OK   ',
          depende: '  FALLA',
          contradicha: '  FALLA',
          'sin-evidencia': it.absoluta ? '  FALLA' : '  ojo  ',
        }[it.veredicto] || '  ojo  ';
        const cola = it.veredicto === 'respaldada'
          ? (fuentes[0] ? ` (${fuentes[0]})` : '')
          : ` -> ${it.motivo || 'sin motivo'}${fuentes.length ? ` [${fuentes.join(', ')}]` : ''}`;
        console.log(`${etiqueta} ${it.veredicto}${it.absoluta ? ' · ABSOLUTA' : ''}: "${afirmacion.slice(0, 90)}"${cola}`);
      }
      // "Depende" es falla y no aviso, y esa es la decision de diseño de todo
      // esto: la frase que se equivoco no era falsa por poco, era cierta a
      // medias escrita como regla. Una absoluta sin nada abajo es lo mismo.
      console.log('\n  _"depende" y "contradicha" se arreglan antes de pegar. Una ABSOLUTA sin evidencia, tambien._');
    }
  } catch (e) {
    console.log(`  (el chequeo web fallo: ${e.message.slice(0, 90)})`);
  }
  console.log('');
}

// ======================================================================
// LECTURA CIEGA
//
// Todo lo de arriba se comprueba contando. Esto no: si el texto contesta lo que
// preguntaron, si las cifras se entienden sin conocer al autor, y si el hilo va
// derecho. Son las tres fallas del 26 ago 2026, las tres entregadas para
// publicar, las tres encontradas por Mario y no por el verificador.
//
// Va al final y solo con --pregunta, porque cuesta una llamada al modelo.
// ======================================================================
if (PREGUNTA) {
  console.log('Leyendo en frio, sin contexto del autor...\n');
  try {
    const r = await leerEnFrio({ pregunta: PREGUNTA, texto: cuerpo });
    if (!r.contesta) console.log(`  FALLA no contesta lo que preguntaron: ${r.que_falta}`);
    else console.log('  OK    contesta lo que preguntaron');
    if (r.cifras_sin_contexto.length) console.log(`  FALLA cifras que el lector no puede interpretar: ${r.cifras_sin_contexto.join(' · ')}`);
    else console.log('  OK    las cifras se entienden sin conocer al autor');
    if (r.hilo_roto) console.log(`  ojo   el hilo se corta: ${r.hilo_roto}`);
    else console.log('  OK    el argumento va derecho');
    console.log('');
    console.log(r.veredicto === 'publicable' ? 'Un lector sin contexto lo sigue: PUBLICABLE.' : 'Un lector sin contexto se pierde: CORREGIR.');
  } catch (e) {
    console.log(`  (la lectura ciega fallo: ${e.message.slice(0, 90)})`);
  }
}
