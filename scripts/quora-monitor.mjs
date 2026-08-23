// PIEZA 4 - Monitor de Quora. Hermano del de Reddit (scripts/reddit-monitor.mjs),
// con la logica de frescura INVERTIDA y el formato de borrador al reves.
//
// Reddit: hilos de horas, 40-150 palabras, cero marca en warmup, sin firma.
// Quora:  preguntas viejas con vistas, 300-700 palabras, marca y firma desde el
//         primer borrador, links recien cuando la cuenta tenga historial.
//
// NUNCA postea nada: el output es un .md de borradores para revision humana.
//
// Uso:  node scripts/quora-monitor.mjs --candidates <archivo.json> [--label X]
//       node scripts/quora-monitor.mjs --url <url> --title "<pregunta>"
//
// PROCEDENCIA DEL CODIGO: los bloques marcados [REDDIT] son copia literal de
// reddit-monitor.mjs. Estan duplicados a proposito y no extraidos a una lib
// compartida: ese refactor toca un script que corre todos los dias, y se hace
// una sola vez, cuando el formato de Quora este validado y toque escalar a 8
// sitios. Copiar ahora y extraer despues, no al reves.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
loadEnv(path.join(ROOT, '.env'));

const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'quora-monitor.json'), 'utf8'));
const FACTS_BY_SITE = Object.fromEntries(
  CONFIG.sites.map((s) => [s.key, JSON.parse(fs.readFileSync(path.join(ROOT, s.factsFile), 'utf8'))])
);
const SITE_BY_KEY = Object.fromEntries(CONFIG.sites.map((s) => [s.key, s]));
const MODEL = 'claude-sonnet-5';
const LEDGER_PATH = path.join(ROOT, 'data', 'quora-ledger.json');

const args = process.argv.slice(2);
const argVal = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const LABEL = argVal('--label');
const QUESTIONS_FILE = argVal('--file') || argVal('--candidates');
const ONE_URL = argVal('--url');
const ONE_TITLE = argVal('--title');

// MODO ENTREGA. El script busca la pregunta y elige los facts, y ahi se detiene:
// la respuesta la escribe Mario con Claude, como ya hace con el triage de Reddit.
//
// El motivo no es tecnico. Toda la maquinaria de generacion funciona y sus guards
// estan puestos; lo que no funciona es el resultado — el texto se lee como escrito
// por una maquina, que en Quora es fatal porque la respuesta va firmada con nombre
// y apellido y se queda publicada durante años. Ninguna regla nueva de prompt
// arregla eso: cada una tapa un tell y el modelo encuentra otro. Y el volumen real
// (dos o tres respuestas por semana) no justifica automatizar justo la parte cara.
//
// Lo que se conserva es lo que si probo servir: el descubrimiento por Brave, el
// filtro por keyword propia, la seleccion de facts por topic dominante, el ledger
// y el chequeo de precio oficial. Lo unico que se saltea es la redaccion.
const SIN_BORRADOR = args.includes('--sin-borrador');
const PUBLICADA = argVal('--publicada');

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Falta ANTHROPIC_API_KEY.');
  process.exit(1);
}

// ============================================================================
// [REDDIT] Matcheo de keywords. Limite de palabra al inicio con tolerancia a
// sufijos cortos de inflexion. Sin esto, includes() a secas mete "euro" dentro
// de "Europe", "line" dentro de "online", "peak" dentro de "speaking" y "hot"
// dentro de "hotel"; y un \b...\b a secas rompe los plurales que SI queremos
// ("ticket" en "tickets", "st peter" en "st peters").
// ============================================================================
const KW_SUFFIX = '(?:s|es|ed|ing)?';
const kwCache = new Map();
function keywordRe(kw) {
  let re = kwCache.get(kw);
  if (!re) {
    const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    re = new RegExp(`(^|[^a-z0-9])${esc}${KW_SUFFIX}([^a-z0-9]|$)`, 'i');
    kwCache.set(kw, re);
  }
  return re;
}
function hasKeyword(text, kw) {
  return keywordRe(kw).test(text);
}
function normalizeTitle(t) {
  return t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// [REDDIT] Taxonomia de topics por sitio. Identica a la del monitor de Reddit,
// incluido el topic 'attic', que falto una vez y produjo un borrador afirmando
// que el atico "no es una categoria de ticket" (2026-08-06).
const TOPIC_KEYWORDS_BY_SITE = {
  colosseum: {
    tickets: ['ticket', 'entry', 'sold out', 'coopculture', 'book', 'reservation'],
    pricing: ['price', 'cost', 'cheap', 'expensive', 'worth it', 'how much', '€', 'euro'],
    crowds: ['crowd', 'busy', 'packed', 'queue', 'line', 'peak'],
    timing: ['what time', 'best time', 'morning', 'early', 'sunset', 'when to', 'how long', 'hours'],
    underground: ['underground', 'hypogeum'],
    'arena-floor': ['arena floor', 'arena access', 'the arena'],
    attic: ['attic', 'belvedere', 'upper tier', 'upper level', 'top level', 'fourth level', 'fifth level', 'panoramic lift'],
    'skip-the-line': ['skip the line', 'skip-the-line', 'fast track', 'priority entrance'],
    guides: ['guide', 'guided tour', 'tour guide'],
    operators: ['getyourguide', 'get your guide', 'viator', 'tour company', 'operator', 'walks of italy', 'tour guy'],
    logistics: ['meeting point', 'entrance', 'security', 'bag', 'luggage', 'metro', 'how to get'],
    'kids-families': ['kids', 'children', 'family', 'stroller', 'toddler', 'baby'],
    accessibility: ['wheelchair', 'accessible', 'accessibility', 'mobility', 'elevator'],
    weather: ['heat', 'rain', 'summer', 'august', 'july', 'weather', 'hot'],
    'night-tours': ['night tour', 'evening tour', 'at night', 'moonlight'],
    'forum-palatine': ['roman forum', 'palatine', 'forum'],
  },
  vatican: {
    tickets: ['ticket', 'entry', 'sold out', 'book', 'reservation'],
    pricing: ['price', 'cost', 'cheap', 'expensive', 'worth it', 'how much', '€', 'euro'],
    crowds: ['crowd', 'busy', 'packed', 'queue', 'line', 'peak'],
    timing: ['what time', 'best time', 'morning', 'early', 'when to', 'how long', 'hours'],
    'sistine-chapel': ['sistine'],
    'st-peters': ['st peter', 'st. peter', 'saint peter', 'basilica'],
    'dome-climb': ['dome', 'cupola'],
    'skip-the-line': ['skip the line', 'skip-the-line', 'fast track', 'priority entrance'],
    guides: ['guide', 'guided tour', 'tour guide'],
    operators: ['getyourguide', 'get your guide', 'viator', 'tour company', 'operator'],
    logistics: ['meeting point', 'entrance', 'security', 'bag', 'luggage', 'metro', 'how to get'],
    'kids-families': ['kids', 'children', 'family', 'stroller', 'toddler', 'baby'],
    accessibility: ['wheelchair', 'accessible', 'accessibility', 'mobility', 'elevator', 'lift'],
    weather: ['heat', 'rain', 'summer', 'august', 'july', 'weather', 'hot'],
    'dress-code': ['dress code', 'shorts', 'shoulders', 'knees', 'sleeveless', 'tank top', 'what to wear'],
    'free-sunday': ['free sunday', 'free entry', 'last sunday'],
    'museums-itinerary': ['itinerary', 'route', 'raphael', 'galleries', 'which rooms'],
  },
  trastevere: {
    pricing: ['price', 'cost', 'cheap', 'expensive', 'worth it', 'how much', '€', 'euro'],
    value: ['worth it', 'overrated', 'tourist trap', 'authentic'],
    timing: ['what time', 'best time', 'evening', 'night', 'sunset', 'twilight', 'lunch', 'dinner', 'when to'],
    booking: ['book', 'booking', 'reserve', 'reservation', 'sold out', 'cancel'],
    guides: ['guide', 'guided tour', 'tour guide'],
    operators: ['getyourguide', 'get your guide', 'viator', 'airbnb experience', 'tour company', 'operator'],
    language: ['english', 'in spanish', 'language'],
    dietary: ['vegetarian', 'vegan', 'gluten', 'celiac', 'coeliac', 'allerg', 'kosher', 'dietary'],
    dishes: ['suppli', 'trapizzino', 'carbonara', 'cacio e pepe', 'amatriciana', 'gricia', 'porchetta', 'pizza al taglio', 'gelato', 'maritozzo', 'artichoke', 'pasta'],
    'street-food': ['street food', 'snack', 'al taglio', 'quick bite'],
    markets: ['market', 'mercato', 'testaccio market'],
    'wine-drinks': ['wine', 'aperitivo', 'drinks', 'cocktail'],
    neighborhoods: ['trastevere', 'jewish ghetto', 'campo de', 'testaccio', 'monti', 'neighborhood', 'which area'],
    'kids-families': ['kids', 'children', 'family', 'stroller', 'toddler', 'baby', 'picky eater'],
    'group-size': ['group size', 'small group', 'private', 'how many people'],
    'format-duration': ['how long', 'duration', 'hours', 'how many stops', 'walking'],
    logistics: ['meeting point', 'where does it start', 'metro', 'how to get', 'accessib', 'wheelchair'],
  },
};

function matchTopics(text, siteKey) {
  const t = text.toLowerCase();
  const matched = [];
  for (const [topic, kws] of Object.entries(TOPIC_KEYWORDS_BY_SITE[siteKey])) {
    if (kws.some((kw) => hasKeyword(t, kw))) matched.push(topic);
  }
  return matched;
}

// [REDDIT] EL GUARD QUE IMPORTA, sin cambios: el corpus de un sitio solo se usa
// si la pregunta habla de ESE destino. La taxonomia esta hecha de palabras
// corrientes de viaje (markets, wine, basilica, family, tickets), asi que por si
// sola mete preguntas ajenas en el sitio equivocado. Con 8 sitios en el horizonte
// el riesgo se multiplica, no se diluye.
//
// Unico ajuste para Quora: los umbrales salen de config.selection, porque el
// haystack aca es una pregunta corta y no titulo + cuerpo de un post.
function bestSiteByFacts(text) {
  const hay = text.toLowerCase();
  let best = null;
  for (const s of CONFIG.sites) {
    if (!s.keywords.some((kw) => hasKeyword(hay, kw))) continue;
    const topics = matchTopics(text, s.key);
    if (topics.length < CONFIG.selection.minTopics) continue;
    const facts = pickFacts(topics, s.key, CONFIG.draft.maxFacts, text);
    if (facts.length < CONFIG.selection.minFacts) continue;
    const strength = facts.length + topics.length;
    if (!best || strength > best.strength) best = { key: s.key, topics, strength, facts };
  }
  return best;
}

// [REDDIT] Seleccion de facts: overlap por topic + match por texto para terminos
// raros (los facts del atico viven bajo logistics/tickets/pricing y no los
// alcanzaba el overlap), con tope de 2 facts por articulo fuente.
function pickFacts(topics, siteKey, max, postText = '') {
  const postTerms = postText
    ? [...new Set(postText.toLowerCase().match(/[a-z][a-z'-]{4,}/g) || [])]
    : [];
  const RARE = new Set(['attic', 'belvedere', 'hypogeum', 'scavi', 'necropolis', 'gardens',
    'carriage', 'pinacoteca', 'etruscan', 'grottoes', 'dome', 'cupola', 'ferragosto', 'jubilee']);
  const rareInPost = postTerms.filter((t) => RARE.has(t));

  // MATCH POR TOPIC DOMINANTE (f.topics[0]), no por cualquiera de sus topics.
  //
  // Verificado el 2026-08-21: en los tres corpus, topics[0] es el tema principal
  // del fact (coincide con el prefijo del id en 1.194 de 1.194 casos).
  //
  // Matchear por cualquier topic dejaba entrar facts cuyo tema real no venia al
  // caso, con solo compartir una etiqueta comun. Caso medido: accessibility-002
  // del corpus del Vaticano esta etiquetado ["accessibility","tickets","pricing"],
  // y como tickets y pricing aparecen en casi toda consulta de entradas, se colaba
  // en preguntas que no tenian nada que ver y el modelo escribia un parrafo sobre
  // el umbral de invalidez del 67%. Paso en 2 de 5 borradores, y tambien en Reddit.
  //
  // Efecto medido sobre combos reales: la disponibilidad baja a la mitad (de 82 a
  // 35, de 693 a 283) y sigue muy por encima del minimo de 5. Se estrecha lo que
  // sobraba, no lo que hacia falta.
  //
  // EXCEPCION, el rescate por termino raro: los facts del atico viven bajo
  // logistics/tickets/pricing y no bajo 'attic', asi que exigirles topic dominante
  // reabriria el bug del 2026-08-06 (un borrador afirmando que el atico no es una
  // categoria de ticket). Si el fact menciona literalmente un termino raro que la
  // pregunta usa, entra igual.
  const scored = FACTS_BY_SITE[siteKey].facts
    .map((f) => {
      const dominante = topics.includes(f.topics[0]);
      const textHit = rareInPost.some((t) => f.fact.toLowerCase().includes(t)) ? 2 : 0;
      if (!dominante && !textHit) return { f, overlap: 0 };
      // El overlap completo sigue ordenando: un fact cuyo tema principal coincide
      // Y ademas comparte topics secundarios es mas pertinente que uno que solo
      // coincide en el principal.
      const overlap = f.topics.filter((t) => topics.includes(t)).length;
      return { f, overlap: overlap + textHit };
    })
    .filter((x) => x.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap);
  // Dedup POR CONTENIDO, no solo por articulo de origen.
  //
  // El tope de 2 por sourceSlug (que sigue abajo) no alcanza: en el reporte del
  // 2026-08-20 entraron TRES facts, de tres articulos distintos, diciendo todos
  // "reserva de 12:00 = entrada 1:45", y la respuesta machaco el mismo dato tres
  // veces. Repartir por fuente no reparte por informacion: el mismo hallazgo esta
  // publicado en varios articulos, que es justo lo que uno quiere en el sitio y
  // justo lo que no quiere dentro de una sola respuesta.
  //
  // Dos facts son el mismo dato si comparten la mayoria de sus palabras de
  // contenido, o si afirman exactamente las mismas cifras.
  const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'for',
    'with', 'is', 'are', 'was', 'were', 'be', 'been', 'that', 'this', 'it', 'its', 'you', 'your',
    'from', 'by', 'as', 'not', 'no', 'can', 'will', 'if', 'than', 'then', 'which', 'what', 'more']);
  const contentWords = (s) => new Set(
    (s.toLowerCase().match(/[a-z][a-z'-]{2,}/g) || []).filter((w) => !STOP.has(w))
  );
  const figureSet = (s) => new Set(s.match(/\d+(?:[.,:]\d+)?/g) || []);
  const shared = (a, b) => [...a].filter((x) => b.has(x)).length;
  const jaccard = (a, b) => {
    const i = shared(a, b);
    return i / (a.size + b.size - i || 1);
  };
  // Umbrales medidos sobre los 10 facts del corpus que repiten el dato
  // "reserva 12:00 -> entrada 1:45", cada uno en un articulo distinto:
  //   compartidas>=2 y jaccard>=0.25  ->  3/9 duplicados,  0 falsos positivos
  //   compartidas>=2 y jaccard>=0.15  ->  8/9 duplicados,  0 falsos positivos  <-
  // (falsos positivos medidos sobre 599 pares al azar del corpus)
  //
  // La señal fuerte son las CIFRAS compartidas, no las palabras: el mismo hallazgo
  // reescrito para otro articulo cambia casi toda la prosa y conserva los numeros.
  // El jaccard bajo queda solo como confirmacion, para que dos facts que comparten
  // "18" y "24" por casualidad no se tomen por el mismo dato.
  const MIN_SHARED_FIGURES = 2;
  const MIN_JACCARD = 0.15;
  const NEAR_IDENTICAL = 0.45;

  const bySlug = {};
  const picked = [];
  const meta = [];
  for (const { f } of scored) {
    bySlug[f.sourceSlug] = (bySlug[f.sourceSlug] || 0) + 1;
    if (bySlug[f.sourceSlug] > 2) continue;
    const w = contentWords(f.fact);
    const g = figureSet(f.fact);
    const dupe = meta.some((m) => {
      const j = jaccard(w, m.w);
      return j >= NEAR_IDENTICAL || (shared(g, m.g) >= MIN_SHARED_FIGURES && j >= MIN_JACCARD);
    });
    if (dupe) continue;
    picked.push(f);
    meta.push({ w, g });
    if (picked.length >= max) break;
  }
  return picked;
}

// [REDDIT] Fuga de corpus. Red ancha a proposito: cualquier referencia al material
// recibido, en cualquier redaccion, mata el borrador. Tres rondas de fugas, cada
// una con palabras nuevas para lo mismo. En Quora el dano es peor que en Reddit:
// la respuesta va firmada con nombre y apellido.
const CORPUS_LEAK_RE = new RegExp(
  [
    /\b(my|our)\s+facts?\b/,
    /\bfacts?\s+(set|list)\b/,
    /\bfacts?\s+(I|we)['’ ]/,
    /\b(answer|respond|speak|help)\w*\s+(this\s+|that\s+|it\s+)?with\s+facts?\b/,
    /\bnot\s+sourced\b/,
    /\bthe\s+(facts?|data|info|information)\s+(I|we)\s+(have|got|was|were)\b/,
    /\b(my|our)\s+(info|information|data)\s+(is|are|covers?)\b/,
    /\bcorpus\b/,
  ].map((r) => r.source).join('|'),
  'i'
);

// [REDDIT] Negativa de apertura. Se mira SOLO el arranque a proposito: un borrador
// que contesta bien y de paso admite no saber un detalle lateral es legitimo.
const OPENING_DECLINE_RE = new RegExp(
  [
    /(is|are)\s?n['’]?t\s+(really\s+|quite\s+|exactly\s+|entirely\s+)?(my|our)\s+(wheelhouse|area|thing|expertise|strong suit)/,
    /(outside|beyond|not)\s+(really\s+)?(my|our)\s+(wheelhouse|area|expertise|knowledge)/,
    /not\s+(really\s+)?something\s+I\s+can\s+(speak|help|answer|comment)/,
    /(outside|beyond)\s+what\s+I\s+can\s+(speak|say|answer|help|comment)/,
    /(none|nothing)\s+of\s+(my|the)\s+(facts|info)/,
    /I\s+(do\s?n['’]?t|do not)\s+have\s+(solid|good|any|much|reliable|real)\s+(info|information|data|numbers)/,
    /I\s+ca\s?n['’]?t\s+(really\s+)?(speak|help)\s+(to|with)\s+(that|this|your|the)/,
  ].map((r) => r.source).join('|'),
  'i'
);
const OPENING_CHARS = 220;

function declineReason(text) {
  if (!text) return null;
  if (CORPUS_LEAK_RE.test(text)) return 'el borrador habla de "sus facts" (delata el sistema)';
  if (OPENING_DECLINE_RE.test(text.slice(0, OPENING_CHARS))) return 'el borrador abre diciendo que no tiene con que responder';
  return null;
}

// ============================================================================
// LEDGER - la unica pieza sin equivalente en Reddit.
//
// Reddit resuelve "ya contestado" leyendo el RSS de comentarios de la cuenta, y
// resuelve "no repetir registro" pasandole al modelo el borrador ANTERIOR DEL
// BATCH. Las dos cosas se caen en Quora: no hay RSS de perfil que podamos leer,
// y previousDraft se pierde entre corridas, asi que a los dos meses se repiten
// parrafos entre respuestas de dias distintos y nadie se entera.
//
// Un solo archivo persistido cubre los tres guards que Quora exige:
//   1. no contestar dos veces la misma pregunta
//   2. no repetir texto entre respuestas (norma explicita de Quora)
//   3. no linkear dos veces el mismo articulo
// ============================================================================
function loadLedger() {
  if (!fs.existsSync(LEDGER_PATH)) return { answered: [] };
  return JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf8'));
}

// Se registra TODO LO GENERADO, no lo publicado. Y no es una limitacion asumida a
// regañadientes: es lo correcto.
//
// El sistema no puede saber que publico Mario — el copia y pega en Quora y aca no
// se entra. Cualquier registro de "publicado" dependeria de que el lo anote a
// mano, y un guard que depende de que alguien se acuerde de anotar no es un guard.
//
// Registrar lo generado ademas es MEJOR para los dos guards activos:
//   - "no contestar dos veces": si una pregunta ya salio en un reporte y Mario no
//     la publico, volver a ofrecersela mañana tampoco sirve. Ya la vio y la paso.
//   - "no repetir texto": comparar contra todo lo generado es mas seguro que
//     comparar contra lo publicado, porque puede publicar mas adelante uno de los
//     que hoy dejo pasar.
//
// El campo `estado` queda para poder distinguir generado de publicado el dia que
// haga falta. Hoy los guards funcionan igual con "generado".
function saveLedger(ledger, entries) {
  ledger.answered.push(...entries);
  fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
  fs.writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2) + '\n', 'utf8');
  return ledger.answered.length;
}

// Shingles de 8 palabras: la unidad mas chica que detecta "mismo parrafo
// reescrito a medias" sin disparar con frases corrientes de viaje ("the best
// time to visit is early in the morning" son 9 palabras y es legitima en dos
// respuestas distintas). Se guardan hasheadas: el ledger no necesita el texto.
const SHINGLE_N = 8;
function shingles(text, n = SHINGLE_N) {
  const words = text.toLowerCase().replace(/[^a-z0-9\s]+/g, ' ').split(/\s+/).filter(Boolean);
  const out = new Set();
  for (let i = 0; i + n <= words.length; i++) {
    out.add(crypto.createHash('md5').update(words.slice(i, i + n).join(' ')).digest('hex').slice(0, 12));
  }
  return out;
}

// ---------- repeticion DENTRO del lote del dia ----------
// El contraste con el borrador anterior compara REGISTRO (apertura, ritmo, cierre)
// y eso no impide que se repita una frase puntual. Medido en el lote del
// 2026-08-20: "I analyse Colosseum reviews at scale" salio identica en dos
// borradores, y el gancho de "skip-the-line doesn't skip security" se repitio casi
// textual entre otros dos.
//
// Mismo mecanismo que el ledger, con la ventana mas corta: el ledger usa 8
// palabras porque compara contra meses de historial y una coincidencia larga es
// mas significativa; adentro del lote alcanza con 6, que es donde una frase deja
// de ser casual y pasa a ser la misma frase.
const BATCH_NGRAM = 6;

// La FIRMA se saca antes de comparar. Es identica y obligatoria en todos los
// borradores, asi que sin esto todo lote reporta "mario dalo founder of
// intercoper colosseumroman" como frase repetida y dispara una regeneracion que
// no puede arreglar nada: el modelo no puede no escribir la firma.
const SIGNATURE_RE = /Mario Dalo,\s*founder of Intercoper\s*[—-]\s*\S+/gi;

// LA FIRMA, EN UN SOLO LUGAR.
//
// Hallazgo del 2026-08-21, verificado con captura de una respuesta publicada:
// Quora AUTO-ENLAZA los dominios escritos en texto plano. La firma terminada en
// "vaticantourguides.com" salio publicada como link azul, y el ancla que Quora le
// pone es el meta title del sitio — "Vatican Tours, Reviewed & Selected |
// VaticanTourGuides". O sea que la fase no-links nunca existio: cada respuesta
// publicaba un link, y encima con un ancla que se lee como publicidad.
//
// "Sin linkear" no alcanza como intencion cuando la plataforma linkea sola. En
// fase no-links la firma lleva la MARCA, sin punto com: sin dominio no hay nada
// que auto-enlazar. El dominio vuelve cuando se habiliten los links, y ahi si con
// el ancla decidida por nosotros.
//
// Estaba duplicada como literal en cinco lugares del archivo. Un cambio de fase
// que hay que acordarse de replicar cinco veces es un cambio que va a quedar a
// medias, que es exactamente como nacio este bug.
function signatureFor(siteKey, allowLink) {
  const site = SITE_BY_KEY[siteKey];
  return `Mario Dalo, founder of Intercoper — ${allowLink ? site.domain : site.brand}`;
}

function repeatedPhrases(text, previousTexts) {
  const wordsOf = (s) => s.replace(SIGNATURE_RE, ' ').toLowerCase().replace(/[^a-z0-9\s]+/g, ' ').split(/\s+/).filter(Boolean);
  const mine = wordsOf(text);
  const hits = new Set();
  for (const prev of previousTexts) {
    const prevGrams = shingles(prev, BATCH_NGRAM);
    for (let i = 0; i + BATCH_NGRAM <= mine.length; i++) {
      const gram = mine.slice(i, i + BATCH_NGRAM).join(' ');
      const h = crypto.createHash('md5').update(gram).digest('hex').slice(0, 12);
      if (prevGrams.has(h)) hits.add(gram);
    }
  }
  return [...hits];
}

const MAX_SHARED_SHINGLES = 2;
function repetitionAgainstLedger(text, ledger) {
  const mine = shingles(text);
  const hits = [];
  for (const entry of ledger.answered) {
    const shared = (entry.shingles || []).filter((s) => mine.has(s));
    if (shared.length > MAX_SHARED_SHINGLES) {
      hits.push({ title: entry.questionTitle, shared: shared.length });
    }
  }
  return hits;
}

// Una entrega CADUCA; una publicacion no.
//
// El razonamiento original del ledger (ver saveLedger) era correcto mientras el
// script redactaba: si un borrador salio en el reporte y Mario no lo publico, era
// porque lo descarto, y volver a ofrecerselo no servia de nada.
//
// En modo entrega eso deja de ser cierto. Ahora una corrida entrega 5 preguntas y
// Mario contesta una, no porque las otras cuatro sean malas sino porque escribir
// una respuesta buena lleva tiempo. Si las cuatro restantes quedan bloqueadas para
// siempre, el sistema va tirando a la basura preguntas buenas a razon de cuatro por
// corrida, y encima en silencio.
//
// Asi que la entrega bloquea 21 dias (suficiente para que no vuelva a aparecer en
// las corridas de las proximas semanas) y despues vuelve al pozo. Lo que si es
// permanente es lo publicado, que se marca a mano con --publicada <url>: ahi el
// dato existe de verdad y no depende de que nadie se acuerde de nada, porque si
// no se marca el peor caso es que la pregunta reaparezca, no que se pierda.
const ENTREGA_TTL_DIAS = 21;

function diasDesde(fecha) {
  if (!fecha) return Infinity;
  const t = Date.parse(fecha);
  if (Number.isNaN(t)) return Infinity;
  return Math.floor((Date.now() - t) / 86400000);
}

function alreadyAnswered(url, title, ledger) {
  const nt = normalizeTitle(title);
  return ledger.answered.some((e) => {
    const misma = e.questionUrl === url || normalizeTitle(e.questionTitle) === nt;
    if (!misma) return false;
    if (e.estado === 'publicada') return true;
    // 'generado' es el estado viejo, de cuando el script redactaba: ahi el
    // descarte SI era una decision de Mario, asi que sigue bloqueando siempre.
    if (e.estado === 'generado') return true;
    return diasDesde(e.generatedAt) < ENTREGA_TTL_DIAS;
  });
}

// Marca una pregunta como publicada de verdad: bloqueo permanente.
//   node scripts/quora-monitor.mjs --publicada https://www.quora.com/...
function marcarPublicada(url) {
  const ledger = loadLedger();

  // Quora da DOS URLs para lo mismo, y la que uno copia naturalmente es la
  // equivocada. El boton de compartir de tu propia respuesta devuelve la de la
  // respuesta, que es la de la pregunta mas un sufijo:
  //   .../Do-you-need-a-reservation-to-visit-the-Colosseum
  //   .../Do-you-need-a-reservation-to-visit-the-Colosseum/answer/Mario-Dalo
  // El ledger guarda la primera. Exigir coincidencia exacta hacia fallar el
  // comando justo en el caso normal, asi que se acepta que la URL pegada
  // EMPIECE con la del ledger. Tambien se limpian querystrings (?ch=... viene
  // pegado en los links de compartir) y la barra final.
  const limpia = (u) => u.split(/[?#]/)[0].replace(/\/+$/, '');
  const objetivo = limpia(url);
  const hit = ledger.answered.filter((e) => {
    const q = limpia(e.questionUrl);
    return objetivo === q || objetivo.startsWith(q + '/');
  });
  if (!hit.length) {
    console.error(`No hay ninguna entrada en el ledger con esa URL:\n  ${url}`);
    console.error('\nURLs entregadas recientemente:');
    for (const e of ledger.answered.slice(-8)) console.error(`  [${e.estado}] ${e.questionUrl}`);
    process.exit(1);
  }
  for (const e of hit) e.estado = 'publicada';
  fs.writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2) + '\n', 'utf8');
  console.log(`Marcada como publicada (bloqueo permanente): "${hit[0].questionTitle}"`);
}

// ============================================================================
// PROMPT - el opuesto del de Reddit en formato, identico en sustancia.
// ============================================================================
function quoraSystemPrompt(siteKey, allowLink) {
  const site = SITE_BY_KEY[siteKey];
  const signature = signatureFor(siteKey, allowLink);
  return `You draft Quora answers to travelers' questions about visiting ${site.subject}.

You are drafting for Mario Dalo, who signs each answer himself. His real authority is that he ANALYSES REVIEWS of this site at scale - not that he has been there. Write from that position.

OPENING - the single most important line:
The FIRST SENTENCE answers the question. Not a thesis, not a framing statement, not an introduction. Many readers read that line and nothing else.
  BAD:  "Booking Roman attractions well is mostly about understanding the ticket structure, not finding secret deals."
  GOOD: "Yes, but 'walking in' means different things depending on where you're headed."

NEVER open by restating the question. Do not echo the title, do not put it on its own line as a heading, do not paraphrase it back before answering. The reader just read the question - they are looking at it. Starting with "How to book a Vatican Museum guided tour" as a standalone opening line wastes the one line that matters and reads like a blog post, not an answer.

THE HOOK - immediately after answering:
Lead with the counter-intuitive figure from the facts: the one that contradicts what people assume. That is what makes an answer memorable and upvoted. A flat, already-known fact does not rank on Quora. If one of the provided facts overturns a common assumption, that is your second beat.

CREDENTIAL - once, in the first or second paragraph, naturally:
Establish it in the body, not only in the signature. The credential is review analysis, never a visit.
  e.g. "I run a site that analyses ${site.subject} reviews, and the most common complaint from people who paid a premium is..."
NEVER simulate a lived visit ("when I went", "I visited last year", "on my last trip").

FORMAT:
- NO EM DASHES (—) anywhere in the body. Not one. Use a comma, a full stop, or a simple hyphen instead. A run of em dashes is one of the most recognisable tells of machine-written text, and a published answer with six of them reads as AI at a glance. The signature line at the foot is the only exception, and it is already written for you.
- UNEVEN RHYTHM, deliberately. Do not write six paragraphs of the same size, each carrying one idea, each flowing smoothly into the next. That evenness is itself a tell: people do not write like that. At least one paragraph must be one or two lines - a short beat that lands and stops - sitting between longer ones. Let some paragraphs run long and others be almost abrupt.
- Prose by default. Bullets ONLY when the content is genuinely an enumeration (a checklist, a list of discrete options). Never as structure.
- Maximum TWO bold spans in the whole answer, and never as subheadings every eighty words. Under 400 words, zero subheadings.
- Five bold subheadings in 500 words is the clearest signature of mass-produced content, and it is what makes Quora collapse answers.
- Length 350-550 words. Under 300 reads thin, over 600 loses readers.
- Tone: expert but close. Knowledgeable without lecturing. First person is fine.

CLOSING - decide this BEFORE you start writing:
Pick the single most specific, most useful thing you have to say, and put it LAST. Build the answer so it arrives there. That is the whole rule: the closing is a placement decision, not a paragraph you add at the end.

Concretely, the last sentence should be one of these:
  - the sharpest number and what to do about it ("Book the 8:30 slot - the 15 to 30 minute security wait lands before the groups arrive, not during.")
  - the specific trade-off the reader now has to make ("The upgrade is worth it for the Arena, not for the extra 24 hours.")
  - the one thing that will actually go wrong if they ignore this ("If you book midday, the Forum is where you will spend the gap, and there is no shade in it.")

It must NOT be:
  - a summary or recap of what you already said, in any form. If the sentence could be deleted without losing information, it is a recap.
  - a softener ("everyone's trip is different", "do what works for you", "hope this helps")
  - a hedge that walks back the advice you just gave
  - an engagement question ("has anyone else had this happen?") - repeated across answers it becomes a recognisable skeleton
  - a restatement of your credential

If the answer leaves something genuinely open, leave it open. Never manufacture closure.

End with exactly this signature on its own final line, character for character:
${signature}

DATA RULES (inviolable):
- You may ONLY use figures that appear in the facts provided. Copy each figure EXACTLY as written. Never invent, round differently, or extrapolate a number.
- Use the facts that genuinely answer the question. Do not dump all of them to look thorough.
- General non-numeric advice from common knowledge is fine, but every NUMBER must come from the facts.
- NEVER refer to the facts as something you possess or were handed, in any wording: "my facts", "the fact set", "what I can answer with facts", "my info covers". The reader must never learn that material was supplied to you. Just answer.
- NEVER assert that something does not exist, is not offered, or is not a real option just because it is absent from the facts you were given. The facts are a partial extract, not a catalogue. A draft once claimed the Colosseum Attic "isn't a ticket category" simply because no Attic fact had been selected - it is one, and the claim was wrong and checkable in seconds. If the question asks about something the facts do not cover, say you are not certain about that part and answer what you can.
- Never simulate a specific lived visit ("when I went last month"). You know this subject through study, not through an anecdote you invent.
- FACTS THAT PULL IN OPPOSITE DIRECTIONS: when two of the facts point to different conclusions, say the trade-off out loud. Do not pick the one you prefer and build an argument on top of it as if the other were not there. The reader is deciding something, and the honest answer is what they gain and what they give up, not a recommendation with the inconvenient half deleted.
  Worked example of getting this WRONG: one fact says 70 of 72 documented cancellations were the seller cancelling on the traveller. Another says the official site is the only seller that cannot fail to secure entry. A draft used the first to recommend third-party platforms because they offer free cancellation. That reasoning inverts itself: if the risk is the SELLER cancelling on YOU, a policy that lets YOU cancel does not protect you from it, and the second fact points the other way entirely.
  The honest version names both sides: the official site cannot fail on you but sells out, third-party platforms have inventory when it does but are where the documented cancellations came from. Then the reader chooses.
  Before you recommend anything, check whether another provided fact argues against it. If one does, the trade-off IS the answer.
- CHAINED DENOMINATORS: when a fact walks through several populations to reach its point, quote only the ratio that carries the point. Chaining them all is unreadable, and the reader loses the finding.
    Fact:  "of 112 accounts describing a cancellation or a refund that failed, 72 involve an actual cancellation - and 70 of those are the operator or the site cancelling on the traveller, against 2 the other way"
    BAD:   "Of 112 accounts describing a cancellation or a failed refund, 72 involve an actual cancellation, and 70 of those are the operator cancelling on the traveller, against only 2 the other way."
    GOOD:  "Of the documented cancellations, 70 of 72 were the seller cancelling on the traveller, not the other way around."
  NEVER round the ratio you keep. "70 of 72" is 97 percent - writing "9 out of 10" understates it and throws away the precision that makes it worth citing.

BRAND: the signature carries the site. Inside the body you may reference ${site.brand}'s own analysis ONCE, and ONLY attached to a figure that is genuinely OUR OWN MEASUREMENT.
  GOOD: "Based on our review analysis, the median stated wait among visitors who booked in advance is 50 minutes, versus 45 on the day"
  BAD:  "our own review analysis found guide quality at 4.94 out of 581 items"
        (that 4.94 belongs to GetYourGuide, not to us - never claim another platform's data as ours. And "4.94 out of 581" is meaningless: 4.94 is the rating, 581 is the count. Never fuse a rating and a sample size into one figure.)
Never attach the brand to public information - prices, opening hours, ticket types - that anyone could state. If none of the provided facts is a proper measurement of ours, write the body without any brand reference. The signature still goes at the foot.

${allowLink
    ? 'LINK: exactly one plain URL to the source article, at the END of the answer, never mid-text. Every outbound link on Quora is nofollow: this is not link building, it is referral traffic and presence in AI answers. It has to earn its place by being genuinely worth clicking.'
    : 'LINKS: absolutely none, and that includes bare domains. Never write any domain name anywhere - not in the body, not in the signature, not even without "http". Quora turns any plain-text domain into a live link automatically, with an anchor it chooses, so writing one publishes a link whether you meant to or not. The signature carries the brand name only. Linking from an account without history is the single fastest way to get flagged as spam here.'}

RELEVANCE: answer the question that was actually asked. If the facts only let you answer a fraction of it, answer that fraction well and say plainly what you are not certain about, LATER in the answer - never as the opening move.

If the facts genuinely do not let you answer this question usefully at all, output exactly:
SKIP
and nothing else. Never write an answer whose opening announces what you cannot provide ("I can't hand you a list of specific trattorias"). A dropped draft costs nothing. An answer that opens by refusing costs credibility, and it is signed with a real name.

ORIGINALITY: this answer must be written from scratch. Never reuse phrasing, structure or opening moves from other answers. Quora penalizes repeated text across answers, and it is checked automatically.

ABSOLUTELY FORBIDDEN:
1. Inventing what other people answered. You do NOT know what anyone else wrote - you were given the question, nothing else. A line like "the person answering ahead of you already has the essential point right" is an invention, and it reads visibly wrong when there is nobody ahead. Never reference, agree with, correct or build on another answer.
2. Any figure not present in the provided facts or in the question text itself.
3. Referring to the material you were given: "my facts", "the data I have", "not sourced", "what I can answer with".
4. Claiming third-party data as your own measurement.

Also forbidden: emojis, marketing language, press-release cadence, recommending specific tour operators by commercial name, asking a question back instead of answering.

Output ONLY the answer text, ending with the signature line. Nothing else.`;
}

// ============================================================================
// VALIDACION - mismo espiritu que validateDraft de Reddit, reglas invertidas.
// El rango pasa de 35-160 a 300-700, los bullets pasan de prohibidos a pedidos,
// la marca pasa de prohibida a obligatoria en la firma, y el link pasa de
// prohibido siempre a prohibido MIENTRAS la cuenta no tenga historial.
// ============================================================================
function validateQuoraDraft(text, siteKey, allowLink) {
  const site = SITE_BY_KEY[siteKey];
  const signature = signatureFor(siteKey, allowLink);
  const issues = [];

  if (!text.trimEnd().endsWith(signature)) issues.push('no termina con la firma exacta');

  const body = text.replace(signature, '');
  if (/https?:\/\//i.test(body)) issues.push(allowLink ? 'URL fuera del formato permitido' : 'contiene URL (fase no-links)');
  if (/\[[^\]]+\]\([^)]+\)/.test(body)) issues.push('contiene link markdown');

  // En fase no-links NO hay excepcion para la firma. La version anterior validaba
  // el cuerpo SIN ella y daba la firma por segura — y era justo ahi donde estaba
  // el link, porque Quora auto-enlaza cualquier dominio escrito en texto plano.
  // Un dominio escrito es un link publicado, aparezca donde aparezca.
  if (!allowLink) {
    if (/\w\.(com|it|org|net)\b/i.test(text)) {
      issues.push('contiene un dominio en fase no-links — Quora lo auto-enlaza, también en la firma');
    }
  } else if (/\w\.(com|it|org|net)\b/i.test(body)) {
    issues.push('contiene dominio fuera de la firma');
  }

  // Raya larga en el CUERPO. La firma la lleva por formato ("Intercoper — Marca")
  // y por eso se valida sobre el cuerpo sin ella: prohibirla a secas rompia la
  // firma. En Reddit esta prohibida desde el arranque por ser un tell; en Quora la
  // regla nunca se agrego, y una respuesta publicada salio con seis en seis
  // parrafos (2026-08-21).
  const rayas = (body.match(/—/g) || []).length;
  if (rayas) issues.push(`${rayas} raya(s) larga(s) (—) en el cuerpo — es un tell de texto de IA, va coma o guion simple`);

  if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{2604}\u{2607}-\u{27BF}]/u.test(text)) issues.push('contiene emoji');
  // "when i went" NO puede exigir solo esas tres palabras: la credencial correcta
  // usa la misma forma para hablar de las reseñas, no del lugar. Caso real del
  // 2026-08-20: "something that surprised me when I went THROUGH THE REVIEW
  // PATTERNS" salto como experiencia vivida, siendo exactamente la voz pedida.
  if (/\b(i did this|when i went(?!\s+through\b)|i was there|last month i|i visited\s+(the|it|rome|st|the vatican))\b/i.test(text)) {
    issues.push('simula experiencia personal vivida');
  }

  const words = body.split(/\s+/).filter(Boolean).length;
  const { minWords, maxWords } = CONFIG.draft;
  if (words < minWords || words > maxWords) issues.push(`largo fuera de rango (${words} palabras, se pide ${minWords}-${maxWords})`);

  const brandMentions = (body.match(new RegExp(site.brand, 'gi')) || []).length;
  if (brandMentions > 1) issues.push(`menciones de marca en el cuerpo: ${brandMentions} (maximo 1)`);

  // Maximo dos negritas. Cinco subtitulos en negrita en 500 palabras es la marca
  // mas clara de contenido producido en serie, y es lo que hace que Quora colapse
  // respuestas. Los cinco borradores del 2026-08-20 tenian entre 4 y 6.
  const bolds = (body.match(/\*\*[^*\n]+\*\*/g) || []).length;
  if (bolds > 2) issues.push(`${bolds} negritas (maximo 2 — a partir de ahi se lee producido en serie)`);
  if (words < 400 && bolds > 0) issues.push(`negritas en una respuesta de ${words} palabras (bajo 400, cero subtitulos)`);

  // Inventar respuestas previas. El sistema no sabe que contesto nadie: el reporte
  // muestra "Respuestas existentes: n/d". El borrador del Vaticano del 2026-08-20
  // abrio con "The person answering ahead of you already has the essential point
  // right" — no habia nadie adelante, y eso se ve.
  const INVENTED_PRIOR = /\b(the (person|answer)|other answers?|previous answer|answers? (above|ahead|before)|as (others|someone) (said|noted|mentioned)|adding to what|the top answer)\b/i;
  if (INVENTED_PRIOR.test(body)) issues.push('se refiere a otra respuesta que no vio (invento)');

  return { issues, words, brandMentions };
}

// [REDDIT] Cifras sin respaldo: toda cifra del borrador tiene que estar en algun
// fact provisto o haberla escrito el que pregunta. Es la verificacion mecanica de
// la regla inviolable #1, y en Quora pesa mas porque el texto es cuatro veces mas
// largo y por lo tanto tiene cuatro veces mas lugares donde colar un numero.
function unbackedFigures(text, facts, questionText, signature) {
  const allowed = new Set();
  for (const f of facts) {
    for (const fig of f.figures) for (const n of String(fig).match(/\d+/g) || []) allowed.add(n);
    for (const n of f.fact.match(/\d+/g) || []) allowed.add(n);
  }
  for (const n of questionText.match(/\d+/g) || []) allowed.add(n);
  const body = text.replace(signature, '');
  return [...new Set(body.match(/\d+/g) || [])].filter((n) => !allowed.has(n));
}

// CONTRADICCIONES DENTRO DE LA SELECCION DE FACTS.
//
// Sin equivalente en Reddit, y no por olvido: alla no puede pasar. Un borrador de
// Reddit usa 1-3 facts en 40-150 palabras, asi que dos cifras en conflicto casi
// nunca caen en el mismo texto. Aca pickFacts trae 8 para llenar 300-700 palabras
// y las contradicciones del corpus salen a la superficie.
//
// Medido en la primera corrida real (2026-08-19, 5 borradores): TRES de los cinco
// dijeron €16 y €18 en el mismo texto para el mismo ticket oficial. El corpus
// tiene 26 facts que dicen €16 y 80 que dicen €18 sobre el mismo producto, todos
// verificados contra su articulo — la contradiccion esta publicada en el sitio,
// no la invento el extractor.
//
// El validador de cifras NO lo agarra, y no puede: las dos cifras estan
// respaldadas por un fact. Es una contradiccion, no una invencion. Por eso hace
// falta este chequeo aparte, que mira la SELECCION y no el texto.
//
// Cada patron define una afirmacion canonica: si dos facts seleccionados hablan
// de lo mismo con cifras distintas, el borrador va a salir hedgeando ("~€16-18"),
// que firmado con nombre y apellido es peor que no contestar.
// Se chequea el BORRADOR y no los facts. La primera version miraba los facts y
// buscaba la afirmacion por patron ("official ... ticket"), y fallo de la unica
// forma que importa: dejo pasar un borrador que decia las dos cifras. El fact
// culpable era pricing-081, "the €18 official price" — sin la palabra "ticket",
// asi que no entraba en el patron. Emparchar el regex es perseguir redacciones,
// que es exactamente el whack-a-mole que en Reddit costo tres rondas con
// OPENING_DECLINE_RE. El texto publicado es lo que el lector ve: se mira ahi.
//
// Cada entrada son valores que conviven en el corpus para una misma cosa.
//
// AJUSTE 2026-08-19, medido sobre el corpus completo: NO es que una cifra este
// desactualizada. €16 aparece en 10 articulos y €18 en 38, y CERO articulos citan
// las dos — cada uno eligio una convencion y se quedo ahi. Comparar tickets-006
// ("costs €16 ... for 24 hours") con tickets-001 ("The standard 24-hour ticket
// (€18)"): mismo producto, uno con el cargo de gestion adentro y otro sin el.
//
// Las dos cifras pueden ser CIERTAS. Por eso el criterio ya no es "aparecen dos
// valores distintos" sino "aparecen los dos SIN decir que incluye cada uno". Un
// borrador que explique la diferencia es correcto y tiene que pasar.
//
// El agravante: hoy ningun borrador PUEDE explicarla. El unico fact que roza la
// relacion es pricing-017, "usually around €16–18 (plus booking fee)", que trata
// €16-18 como rango del precio base con el fee APARTE — o sea contradice que €18
// sea €16 con el fee adentro. Y ningun fact publica el monto del cargo. Como la
// regla #1 prohibe cifras no publicadas, el modelo no tiene con que aclarar.
//
// De ahi que esto sea canario y no arreglo: va a sonar siempre hasta que el sitio
// establezca y publique cual es la relacion real. Unificar los 10 articulos en
// una cifra sin publicar la relacion apaga el canario sin arreglar el dato.
// AJUSTE 2026-08-19 (segunda pasada, regla de Mario): el unico valor que tiene
// que estar impecable es el PRECIO OFICIAL. Lo que cobra cada operador corre por
// cuenta del operador y lo que dice una reseña corre por cuenta de quien la
// escribio: ninguno de los dos es una afirmacion nuestra y ninguno se vigila.
//
// Por eso se cayo la entrada de los multiplicadores de markup, que la version
// anterior marcaba. En el sitio conviven 2–3×, 3–10×, 3–5× y 2–4×, y esa variacion
// es legitima: son productos y operadores distintos, no una cifra nuestra mal dada.
//
// Y cambia la forma del chequeo. Buscar "dos cifras rivales en el mismo borrador"
// era la pregunta equivocada: si el precio oficial es uno solo, lo que hay que
// verificar es que sea ESE, no que no aparezcan dos. Un borrador que dijera €16
// una sola vez pasaba el chequeo viejo y era igual de incorrecto.
//
// Se mira la SELECCION DE FACTS y no el texto, a proposito: el modelo solo puede
// citar cifras de los facts, asi que un precio oficial equivocado en el borrador
// significa que el corpus quedo viejo respecto del sitio. Este canario detecta
// justo eso — desfasaje entre corpus y sitio — que es como empezo todo este lio.
const OFFICIAL_PRICE = {
  colosseum: {
    name: 'ticket estandar oficial',
    canonical: '€18',
    // Afirma el precio del estandar/oficial...
    claimRe: /(official|standard)[^.]{0,45}(ticket|price|entry|combined)|(ticket|entry)[^.]{0,30}(official|standard)/i,
    // ...pero NO si habla de otro producto, que tiene su propio precio oficial.
    otherProductRe: /full experience|attic|belvedere|underground|arena floor|night|super sites?/i,
    figureRe: /€\s?\d+/g,
  },
  vatican: null,
  trastevere: null,
};

function officialPriceDrift(facts, siteKey) {
  const rule = OFFICIAL_PRICE[siteKey];
  if (!rule) return [];
  const bad = new Map(); // cifra -> [ids]
  for (const f of facts) {
    if (!rule.claimRe.test(f.fact)) continue;
    if (rule.otherProductRe.test(f.fact)) continue;
    const own = [...new Set((f.fact.match(rule.figureRe) || []).map((v) => v.replace(/\s/g, '')))];
    // Un fact con dos cifras esta contrastando un rango, no afirmando el precio
    // ("No ticket - official or third-party, €18 or €170 - solves..."). No cuenta.
    if (own.length !== 1) continue;
    if (own[0] === rule.canonical) continue;
    if (!bad.has(own[0])) bad.set(own[0], []);
    bad.get(own[0]).push(f.id);
  }
  return [...bad.entries()].map(([v, ids]) =>
    `${rule.name}: el corpus dice ${v} y el precio oficial es ${rule.canonical} (${ids.join(', ')}). El corpus quedó viejo respecto del sitio — re-extraer antes de publicar.`
  );
}

// ============================================================================
// DESCUBRIMIENTO - capa intercambiable a proposito.
//
// Que via alimenta esto (indice de busqueda vs Apify) es una decision abierta, y
// el resto del pipeline no depende de ella: entra una lista de preguntas con esta
// forma y sale un reporte. Por eso el motor se construye primero.
//
//   { url, title, askedAt?, answers?, followers? }
//
// Adapta tambien el shape del scraper de Apify ya usado (fatihtahta/quora-scraper),
// que anida las metricas bajo `metrics`.
// ============================================================================
// DOS CAMPOS DISTINTOS, Y LA DIFERENCIA ES CRITICA:
//
//   detail  = lo que escribio QUIEN PREGUNTA. Solo puede venir del .txt manual,
//             donde Mario lo copia. Va al prompt: es contexto legitimo del caso.
//   snippet = lo que devuelve Brave en `description`, que NO es el detalle de la
//             pregunta sino UNA RESPUESTA YA PUBLICADA. Viene prefijada literal
//             "Answer (1 of 2):". NUNCA va al prompt.
//
// La primera version las mezclo y le paso el snippet al modelo rotulado como
// "Detail the asker wrote". Eso puso una respuesta ajena adentro del prompt: el
// modelo podia repetirla, parafrasearla o apoyarse en ella, y en el borrador del
// 2026-08-20 salio a la superficie como "a detail the asker's own description
// misses". La regla es que el sistema no ve lo que contesto nadie; pasarle el
// snippet la rompia por una via peor que inventarla.
//
// El snippet igual sirve, pero para Mario y no para el modelo: le muestra lo que
// dice la respuesta que hoy esta arriba, que es justo el criterio con el que
// elige ("respuestas existentes flojas"). Va al reporte, rotulado como lo que es.
function normalizeCandidate(raw) {
  return {
    url: raw.url,
    title: (raw.title || '').replace(/\s*[-–|]\s*Quora\s*$/i, '').trim(),
    detail: (raw.detail || '').trim(),
    snippet: (raw.snippet || '').trim(),
    askedAt: raw.askedAt || null,
    answers: raw.answers ?? null,
  };
}

// ---------- fuente por defecto: indice de Brave ----------
// NO se entra a Quora. Su robots.txt es `Disallow: /` para todo bot no nombrado
// (y nombra a ClaudeBot para bloquearlo), asi que cualquier acceso automatico a
// quora.com esta descartado por diseño, no por bloqueo circunstancial. Lo que se
// consulta es el INDICE de Brave, que ya tiene esas paginas.
//
// Una consulta por GRUPO de keywords, nunca una por keyword: el plan gratuito son
// ~1.000 consultas al mes y los 8 grupos configurados dan ~240 corriendo a diario.
async function braveSearch(query) {
  const url = `${CONFIG.search.endpoint}?q=${encodeURIComponent(query)}&count=${CONFIG.search.count}`;
  const res = await fetch(url, {
    headers: {
      'X-Subscription-Token': process.env.BRAVE_API_KEY,
      Accept: 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Brave ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const data = await res.json();
  return (data.web?.results || []).map((r) => {
    // OJO: `description` es una RESPUESTA ya publicada, no el detalle de la
    // pregunta. Va a `snippet`, que jamas entra al prompt. Ver normalizeCandidate.
    const raw = (r.description || '').replace(/<[^>]+>/g, '');
    return {
      url: r.url,
      title: r.title || '',
      // La CANTIDAD DE RESPUESTAS sale del propio prefijo del snippet, que es el
      // unico lugar donde Brave la expone. Medido sobre 40 resultados reales:
      //   29 traen "Answer (X of N)"  -> N respuestas
      //    7 traen "Answer:"          -> 1 respuesta
      //    4 no traen nada            -> null (bonus neutro)
      // 90% de cobertura. Sin esto competitionBonus devolvia 1 siempre y el
      // criterio de "pocas respuestas existentes" no se aplicaba nunca.
      answers: answersFromSnippet(raw),
      snippet: raw.replace(/^\s*Answer\s*(\(\s*\d+\s+of\s+\d+\s*\))?\s*:\s*/i, '').trim(),
    };
  });
}

function answersFromSnippet(raw) {
  const m = raw.match(/Answer\s*\(\s*\d+\s+of\s+(\d+)\s*\)/i);
  if (m) return Number(m[1]);
  if (/^\s*Answer\s*:/i.test(raw)) return 1;
  return null;
}

async function fetchFromSearch() {
  const out = [];
  const rows = [];
  for (const site of CONFIG.sites) {
    for (const q of site.searchQueries || []) {
      try {
        const hits = await braveSearch(q);
        out.push(...hits);
        rows.push({ q, ok: true, n: hits.length });
        console.log(`  [${site.key}] "${q}" -> ${hits.length} resultados`);
      } catch (err) {
        // Una consulta que falla no puede tumbar la corrida ni confundirse con
        // "no habia nada": se registra como ERROR, igual que el embudo de Reddit.
        rows.push({ q, ok: false, error: err.message });
        console.error(`  [${site.key}] "${q}" -> ERROR ${err.message}`);
      }
    }
  }
  return { candidates: out.map(normalizeCandidate), rows };
}

// ---------- fuente alternativa: el .txt que arma Mario a mano ----------
// Bloques separados por una linea de tres guiones. Linea 1 la URL, linea 2 el
// titulo, el resto el detalle que escribio quien pregunto.
function parseQuestionsFile(text) {
  const out = [];
  for (const block of text.split(/^---\s*$/m)) {
    const lines = block.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    if (!lines.length) continue;
    const url = lines.find((l) => /^https?:\/\//i.test(l));
    if (!url) continue;
    const rest = lines.slice(lines.indexOf(url) + 1);
    if (!rest.length) continue;
    out.push(normalizeCandidate({ url, title: rest[0], detail: rest.slice(1).join('\n') }));
  }
  return out;
}

// El equivalente de isGenuineQuestion de Reddit, que la primera version omitio
// por dar por sentado que en Quora todo es una pregunta. No lo es, y el descarte
// no es teorico: en la corrida del 2026-08-19 el candidato mejor puntuado de 67
// fue "Unveiling Russia's Treasures: Beyond the Itinerary Takhatana...", un post
// de un Quora Space con el ARTICULO ENTERO volcado en el campo titulo. Gano
// porque era largo: 200 palabras de prosa matchean mas topics que una pregunta
// de doce, y el score suma topics. Es el mismo bug que en Reddit se anoto como
// "filtros que cuentan etiquetas en vez de relevancia", en una superficie nueva.
//
// Tres cortes, del mas barato al mas caro:
const MAX_TITLE_WORDS = 40;  // la pregunta mas larga del set real tiene 24 palabras
const MIN_TITLE_WORDS = 3;

function questionRejectReason(c) {
  // 1. Los Spaces viven en <space>.quora.com; las preguntas, en www.quora.com.
  //    Un Space es un blog: no tiene pregunta que contestar.
  let host;
  try { host = new URL(c.url).hostname.toLowerCase(); } catch { return 'URL invalida'; }
  if (!/^(www\.)?quora\.com$/.test(host)) return `no es una pregunta, es un Quora Space (${host})`;

  // 2. Largo del titulo. Un titulo de 200 palabras es un cuerpo mal volcado.
  const words = c.title.trim().split(/\s+/).filter(Boolean).length;
  if (words > MAX_TITLE_WORDS) return `titulo de ${words} palabras (es un cuerpo volcado, no un titulo)`;
  if (words < MIN_TITLE_WORDS) return `titulo de ${words} palabra(s)`;

  // 3. Que de verdad pregunte algo. Mismo criterio que isGenuineQuestion.
  if (c.title.includes('?')) return null;
  if (/\b(how|what|where|which|when|why|who|should|is|are|do|does|can|would|any|anyone|best|worth)\b/i.test(c.title)) return null;
  return 'el titulo no formula una pregunta';
}

async function loadCandidates() {
  if (ONE_URL) return { candidates: [normalizeCandidate({ url: ONE_URL, title: ONE_TITLE || '' })], rows: [] };
  if (QUESTIONS_FILE) {
    const p = path.resolve(QUESTIONS_FILE);
    console.log(`Fuente: archivo manual ${path.relative(ROOT, p)}`);
    return { candidates: parseQuestionsFile(fs.readFileSync(p, 'utf8')), rows: [] };
  }
  if (!process.env.BRAVE_API_KEY) {
    console.error('Falta BRAVE_API_KEY en .env (o usa --file data/quora-preguntas.txt).');
    process.exit(1);
  }
  console.log('Fuente: busqueda de Brave (no se entra a Quora)');
  return fetchFromSearch();
}

// Puntaje INVERTIDO respecto de Reddit. Alla freshnessBonus premia las 3 horas y
// castiga las 18. Aca la antiguedad es el activo: Quora ordena las respuestas por
// votos y no por fecha, asi que una pregunta de 2022 que sigue juntando vistas es
// mejor blanco que una de ayer, que todavia no demostro nada y puede no demostrar
// nunca. Y pocas respuestas existentes = mas lugar arriba.
// INERTE HOY, Y HAY QUE DECIRLO: ninguna fuente disponible da la fecha de la
// pregunta. Brave devuelve title, url, description, profile, language, meta_url,
// thumbnail y extra_snippets — ningun campo con fecha, verificado el 2026-08-20.
// El .txt manual tampoco la pide.
//
// Estuvo sumando al score sin sumar nunca nada: askedAt era siempre null, asi que
// devolvia 0 en todos los candidatos y la "frescura invertida" que el reporte
// anunciaba no se aplicaba jamas. Queda FUERA del score hasta que exista una
// fuente que traiga la fecha; se conserva la funcion porque el criterio sigue
// siendo el correcto (una pregunta de 2022 con trafico vale mas que una de ayer),
// no porque este haciendo algo.
function ageBonus(askedAt) {
  if (!askedAt) return 0;
  const years = (Date.now() - Date.parse(askedAt)) / (365.25 * 24 * 3600 * 1000);
  if (years >= 4) return 5;
  if (years >= 2) return 4;
  if (years >= 1) return 3;
  if (years >= 0.5) return 1;
  return 0;
}
function competitionBonus(answers) {
  if (answers == null) return 1;      // desconocido: bonus neutro, igual que el num_comments null de Reddit
  if (answers === 0) return 4;
  if (answers <= 2) return 3;
  if (answers <= 5) return 2;
  if (answers <= 10) return 1;
  return 0;
}

// ============================================================================
// AUTOREVISION
//
// Los validadores mecanicos de arriba chequean lo que es patron: largo, firma,
// links, negritas, cifras sin respaldo. Hay reglas que NO son patron y que un
// regex no puede juzgar sin romper cosas — lo intente tres veces el 2026-08-20 y
// las tres genere falsos positivos ("when I went through the review patterns"
// marcado como experiencia vivida, la firma contada como frase repetida).
//
// Esta capa es una segunda llamada al modelo con el borrador, la pregunta y las
// reglas: que liste que viola, o que diga NINGUNA. Si lista algo, se regenera una
// vez pasandole la lista. Juzgar criterio con criterio, no con regex.
//
// Los IDs de regla son fijos a proposito: se agregan por dia en el reporte. Si
// todos los dias falla la misma, se arregla el prompt en vez de parchear el
// resultado, que es el unico arreglo que escala.
const REVIEW_RULES = [
  ['APERTURA', 'The first sentence must ANSWER the question. If it is a thesis, a framing statement or an introduction, that is a violation. Many readers read that line and nothing else.'],
  ['MULTIPARTE', 'If the question asks several things (typically joined by "and"), every part must be answered. Answering the first and quietly skipping the second is a violation. Example that failed: "what is the best way to get tickets AND when is the best time of day" - the draft covered tickets and dodged timing.'],
  ['CREDENCIAL', 'A genuine credential must appear in the first two paragraphs, once, naturally: that the author ANALYSES REVIEWS at scale. Absent, or buried past the second paragraph, or phrased as having visited the place, are all violations.'],
  ['GANCHO', 'Right after answering, the draft must lead with the counter-intuitive point from the facts - the one that contradicts what people assume. Opening the body with a flat, already-known fact is a violation.'],
  ['CIERRE', 'The answer must end on its strongest, most specific point. A closing paragraph that hedges, summarises, softens, or adds a formulaic engagement question is a violation.'],
  ['MARCA', 'Any brand or "our analysis" reference must be attached to OUR OWN measurement, never to public information (prices, opening hours) or to another platform\'s data.'],
  ['AJENA', 'The draft must never reference, agree with, correct or build on another answer. It was not shown any. Any such reference is invented.'],
  ['DENSIDAD', 'A fact that chains several populations must be rendered as the single ratio that carries the point, never as the full chain. "Of 112 accounts, 72 involve X, and 70 of those are Y" is a violation; "70 of 72 were Y" is correct. The kept ratio must never be rounded.'],
  ['TRADEOFF', 'If two of the supplied facts point to opposite conclusions and the draft picks one to build a recommendation on while ignoring the other, that is a violation. Check especially that the recommendation is not defeated by its own evidence: recommending a seller for its cancellation policy, when the cited data says the SELLER is the one who cancels, is an argument that inverts itself. The honest form names both sides and lets the reader choose.'],
  ['RITMO', 'Paragraph lengths must be uneven. If every paragraph is roughly the same size, carries one idea, and transitions smoothly into the next, that is a violation - people do not write that evenly, and a published answer with six same-sized paragraphs reads as machine-written at a glance. At least one paragraph should be one or two lines, sitting among longer ones.'],
  ['NIEGA', 'The answer must not open by declining, or by announcing what it cannot provide. "I can\'t hand you a list of specific trattorias" is a violation: the reader asked for something and the first thing they read is that they will not get it. Answering a narrower question well is fine - saying up front that you will not answer is not. Admitting uncertainty about a side detail, later on, is not a violation.'],
];

// NIEGA es la unica regla de estilo con descarte duro. Las otras se corrigen y, si
// sobreviven, se muestran con la advertencia para que Mario decida. Un borrador
// que abre negandose no es mejorable: si no hay con que contestar, la respuesta no
// existe. Mismo criterio que en Reddit, donde el error no era del modelo (que hacia
// lo correcto al no inventar) sino del pipeline, que presentaba esa negativa como
// el borrador del dia — 3 de 4 candidatos el 2026-08-07.
const REGLAS_DESCARTE = new Set(['NIEGA']);

async function reviewDraft(text, candidate) {
  const rulesBlock = REVIEW_RULES.map(([id, desc]) => `${id}: ${desc}`).join('\n\n');
  // VEREDICTO POR REGLA, no listado libre. Medido el 2026-08-21 sobre el mismo
  // borrador: pidiendo "listá lo que viola" el revisor contesto NINGUNA en un
  // borrador que no tenia credencial en ningun lado; obligandolo a pronunciarse
  // regla por regla, la marco (y encontro tambien un cierre flojo). Un listado
  // libre deja pasar la omision: no hay texto que señalar, y el revisor la saltea.
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: `You are reviewing a draft Quora answer against a fixed style standard. You are not rewriting it and not praising it.

RULES:

${rulesBlock}

Go through EVERY rule in order. For each one output exactly one line:

RULE_ID | PASS
or
RULE_ID | FAIL | one short sentence naming the specific problem

Output one line per rule, all ${REVIEW_RULES.length} of them, including the ones that pass. Do not skip any, do not reorder, and add no commentary before or after. Keep each FAIL explanation to a single short sentence.

Mark FAIL only when you can point at specific text, or - for rules about something that must be PRESENT, like the credential - when it is genuinely absent. If a rule does not apply to this draft, mark it PASS.`,
    messages: [{
      role: 'user',
      content: `Question asked:\n${candidate.title}${candidate.detail ? `\n\nDetail the asker wrote:\n${candidate.detail}` : ''}\n\nDraft to review:\n"""\n${text}\n"""`,
    }],
  });
  const out = response.content.find((b) => b.type === 'text')?.text.trim() ?? '';
  const valid = new Set(REVIEW_RULES.map(([id]) => id));
  const fails = [];
  for (const line of out.split('\n')) {
    const parts = line.split('|').map((p) => p.trim());
    if (parts.length < 2) continue;
    const rule = parts[0].toUpperCase();
    if (!valid.has(rule)) continue;
    if (!/^FAIL\b/i.test(parts[1])) continue;
    fails.push({ rule, why: parts.slice(2).join(' | ').trim() || 'sin detalle' });
  }
  return fails;
}

// ============================================================================
const client = new Anthropic();

// [REDDIT] Contraste anti-plantilla: cada generacion ve el borrador anterior del
// batch y tiene que salir con otro registro. Repetir el esqueleto entre respuestas
// es lo que gatilla el filtro de autopromocion de Quora.
//
// Ojo: esto cubre el batch del dia. Entre dias lo cubre el ledger, con los
// shingles de lo ya publicado. Son dos redes distintas y hacen falta las dos.
async function generateDraft(candidate, facts, siteKey, allowLink, previousDraft, repeated, reviewNotes) {
  const factsBlock = facts
    .map((f, i) => `${i + 1}. [${f.id}] ${f.fact} (figures: ${f.figures.join(', ')})`)
    .join('\n');
  const varietyBlock = previousDraft
    ? `\n\nRegister check: below is the previous answer written in this batch. Yours must NOT look written from the same template. Different opening move, different structure, different rhythm, different closing move. If the previous one opened with a direct yes/no, open differently. If it used bold spans, consider using none.\n<previous_answer>\n${previousDraft}\n</previous_answer>`
    : '';
  const reviewBlock = reviewNotes?.length
    ? `\n\nREWRITE REQUIRED. A review of your previous attempt found these violations. Fix every one. Do not fix them by adding a sentence that announces the fix - rework the answer so the problem is gone.\n${reviewNotes.map((v) => `  - [${v.rule}] ${v.why}`).join('\n')}`
    : '';
  const repeatBlock = repeated?.length
    ? `\n\nREWRITE REQUIRED. Your previous attempt reused these exact word sequences from another answer in this same batch:\n${repeated.map((p) => `  - "${p}"`).join('\n')}\nEvery one of these must be gone. Do not paraphrase them into near-synonyms of the same shape - make the point differently, or make a different point. Two answers published by the same person that share a sentence read as boilerplate, and that is what triggers Quora's self-promotion filter.`
    : '';
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 3000,
    system: quoraSystemPrompt(siteKey, allowLink),
    messages: [{
      role: 'user',
      content: `Quora question: ${candidate.title}${candidate.detail ? `\n\nDetail the asker wrote:\n"""\n${candidate.detail}\n"""` : ''}\n\nAvailable facts:\n${factsBlock}${varietyBlock}${repeatBlock}${reviewBlock}`,
    }],
  });
  if (response.stop_reason === 'refusal') return { text: null, issues: ['refusal del modelo'] };
  const out = response.content.find((b) => b.type === 'text')?.text.trim() ?? '';
  if (/^SKIP\b/i.test(out)) return { text: null, skipped: true };
  return { text: out };
}

// CORRECCION, no regeneracion.
//
// La primera version reintentaba llamando de nuevo al generador con la lista de
// violaciones adjunta. Eso no corrige: produce un borrador NUEVO, que puede
// arreglar lo señalado y romper otra cosa, o repetir el mismo error por otro lado.
// Medido el 2026-08-21: 4 de 5 borradores se regeneraron y las 5 violaciones
// seguian en pie despues.
//
// Esta llamada es distinta: recibe el TEXTO ORIGINAL y arregla solo lo listado,
// dejando el resto palabra por palabra. Es mucho mas facil de cumplir que
// "escribi otro que no tenga estos problemas".
async function reviseDraft(text, instructions, candidate, facts, siteKey, allowLink) {
  const site = SITE_BY_KEY[siteKey];
  const signature = signatureFor(siteKey, allowLink);
  const factsBlock = facts
    .map((f, i) => `${i + 1}. [${f.id}] ${f.fact} (figures: ${f.figures.join(', ')})`)
    .join('\n');
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 3000,
    system: `You are correcting a specific set of problems in an existing Quora answer. You are NOT rewriting it.

Rules for this correction:
- Fix ONLY the problems listed. Everything else stays word for word as it is.
- Do not restructure, do not reorder, do not "improve" anything that was not flagged.
- Do not add a sentence that announces the fix. Rework the text so the problem is simply gone.
- Every figure must still come from the facts below or from the question itself. Adding a number that is in neither is worse than the problem you were asked to fix.
- The answer must still end with exactly this signature on its own final line:
${signature}
${allowLink ? '' : '- No URLs and no bare domain names anywhere, signature included. Quora auto-links any plain-text domain.'}
- DO NOT SHORTEN. The corrected answer must be at least as long as the one you were given, and never under ${CONFIG.draft.minWords} words. Fixing a problem by deleting the paragraph that contained it is not fixing it: rework that paragraph in place. If a weak closing has to go, replace it with a stronger one, do not simply cut it. Losing a concrete documented figure in the process is the worst outcome available, worse than the problem you were asked to fix.
- The author's authority is that he ANALYSES REVIEWS at scale, never that he visited the place.

Output ONLY the corrected answer, ending with the signature. Nothing else.`,
    messages: [{
      role: 'user',
      content: `Question asked:\n${candidate.title}${candidate.detail ? `\n\nDetail the asker wrote:\n${candidate.detail}` : ''}

Facts available (the only source of figures):
${factsBlock}

Current answer:
"""
${text}
"""

Problems to fix, and nothing else:
${instructions.map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
    }],
  });
  if (response.stop_reason === 'refusal') return { text: null };
  let out = response.content.find((b) => b.type === 'text')?.text.trim() ?? '';
  // El texto a corregir va entre """ y el modelo a veces devuelve el delimitador
  // junto con la respuesta. Paso el 2026-08-21: el borrador termino en """ en vez
  // de la firma y el validador lo marco como "no termina con la firma exacta".
  out = out.replace(/^"""\s*/, '').replace(/\s*"""$/, '').trim();
  if (!out) return { text: null };
  // Una correccion que rompe una regla DURA se descarta entera, aunque haya
  // arreglado lo que se le pidio. Arreglar el cierre y perder la firma, o meter
  // un link, deja el borrador peor que antes.
  const rota = [];
  if (!out.endsWith(signature)) rota.push('perdio la firma');
  if (!allowLink && /https?:\/\//i.test(out.replace(signature, ''))) rota.push('metio un link');

  // EL RECORTE. La instruccion de largo estaba en el prompt y no alcanzaba: las
  // correcciones arreglaban lo señalado borrando el parrafo que lo contenia. El
  // 2026-08-22 tres borradores terminaron bajo el piso (276, 335 y 336 palabras)
  // y el de "Do you need a reservation" perdio en el camino el caso documentado
  // del hueco de 1h45m, que era su mejor dato. Ahora se rechaza y queda el
  // original: un borrador con un cierre flojo pero completo vale mas que uno
  // pulido al que le falta la evidencia.
  const palabras = (t) => t.replace(signature, '').split(/\s+/).filter(Boolean).length;
  const antes = palabras(text);
  const despues = palabras(out);
  if (despues < CONFIG.draft.minWords && despues < antes) {
    rota.push(`recorto de ${antes} a ${despues} palabras, bajo el piso de ${CONFIG.draft.minWords}`);
  }

  if (rota.length) return { text: null, broke: rota };
  return { text: out };
}

function renderCandidate(c, facts, siteKey, draft, checks) {
  const lines = [];
  lines.push(`### ${c.title}`);
  lines.push('');
  lines.push(`- **Pregunta:** ${c.url}`);
  lines.push(`- **Sitio:** ${siteKey} · **Respuestas existentes:** ${c.answers ?? 'n/d'} · **Preguntada:** ${c.askedAt ? c.askedAt.slice(0, 10) : 'n/d'} · **Score:** ${c.score}`);
  lines.push(`- **Topics:** ${c.topics.join(', ')}${c.topicDominante ? ` · **dominante:** ${c.topicDominante}` : ''}`);
  if (c.detail) {
    lines.push(`- **Detalle de quien pregunta:** ${c.detail.replace(/\n+/g, ' ').slice(0, 300)}`);
  }
  if (c.snippet) {
    // Esto NO lo vio el modelo. Se muestra solo para que Mario juzgue si la
    // respuesta que hoy esta arriba es floja, que es su criterio de seleccion.
    lines.push(`- **Respuesta que hoy rankea** (el generador NO la vio): _${c.snippet.slice(0, 260)}_`);
  }
  lines.push('');

  if (!draft) {
    // Modo entrega: no hay borrador que mostrar. Los facts pasan a ser lo
    // principal del bloque, no el anexo de verificacion.
    lines.push('**Material disponible para contestarla:**');
    lines.push('');
    for (const f of facts) lines.push(`- \`${f.id}\` "${f.fact}" — ${f.sourceUrl}`);
    lines.push('');
    lines.push(`**Firma:** ${signatureFor(siteKey, CONFIG.links.enabled)}`);
    if (checks.extra.length) {
      lines.push('');
      lines.push(`> ⚠️ ${checks.extra.join('; ')}`);
    }
    lines.push('');
    return lines.join('\n');
  }

  lines.push('**Borrador:**');
  lines.push('');
  lines.push('```');
  lines.push(draft.text ?? '(no generado)');
  lines.push('```');
  lines.push('');
  const all = [...checks.issues, ...checks.extra];
  lines.push(all.length
    ? `> ⚠️ **Validación:** ${all.join('; ')}`
    : `> ✅ **Validación:** ${checks.words} palabras · firma correcta · sin links · cifras respaldadas · sin repetición contra el historial`);
  lines.push('');
  lines.push('**Facts usados (verificar en un click):**');
  for (const f of facts) lines.push(`- \`${f.id}\` "${f.fact}" — ${f.sourceUrl}`);
  lines.push('');
  return lines.join('\n');
}

async function main() {
  const dateLabel = new Date().toISOString().slice(0, 10);
  const ledger = loadLedger();
  const allowLink = CONFIG.links.enabled;

  console.log(`Fase: ${CONFIG.phase} · links ${allowLink ? 'HABILITADOS' : 'deshabilitados'} · ledger: ${ledger.answered.length} respuestas publicadas`);

  const { candidates: raw, rows: searchRows } = await loadCandidates();
  console.log(`Candidatos de entrada: ${raw.length}`);

  const scored = [];
  const rejected = [];
  for (const c of raw) {
    const notQuestion = questionRejectReason(c);
    if (notQuestion) { rejected.push({ c, why: notQuestion }); continue; }
    if (alreadyAnswered(c.url, c.title, ledger)) { rejected.push({ c, why: 'ya respondida (ledger)' }); continue; }
    const best = bestSiteByFacts(`${c.title} ${c.detail || ''}`);
    if (!best) { rejected.push({ c, why: 'ningun sitio con keyword propia + material suficiente' }); continue; }
    scored.push({
      ...c,
      site: best.key,
      topics: best.topics,
      facts: best.facts,
      // ageBonus queda FUERA a proposito: no hay fuente con la fecha, ver su comentario.
      score: best.facts.length + best.topics.length + competitionBonus(c.answers),
    });
  }
  scored.sort((a, b) => b.score - a.score);

  // [REDDIT] Dedup por titulo normalizado, quedandose con el de mayor score. En
  // Reddit son crossposts: la misma pregunta en dos subs son hilos distintos con
  // IDs distintos. Aca es la misma pregunta alcanzada por dos keywords de busqueda
  // distintas, con la misma URL o con una variante. El efecto es identico y peor:
  // 12 de los 67 candidatos reales estaban duplicados, y sin este corte se
  // generaban dos borradores del mismo trabajo (y se gastaban dos de los 5 cupos).
  const seenTitle = new Map();
  const duplicates = [];
  for (const c of scored) {
    const key = normalizeTitle(c.title);
    if (seenTitle.has(key)) { duplicates.push(c); continue; }
    seenTitle.set(key, c);
  }
  const deduped = [...seenTitle.values()];

  // DIVERSIDAD: como maximo un candidato por topic dominante.
  //
  // El dedup de arriba compara titulos y el chequeo de n-gramas compara frases;
  // ninguno de los dos ve que tres preguntas DISTINTAS esten preguntando lo mismo.
  // Paso el 2026-08-21: salieron tres preguntas de dress code, con redaccion
  // completamente distinta, dos de ellas limpias. Publicar las tres el mismo dia
  // es el patron de plantilla aunque cada texto sea original.
  //
  // El topic dominante es el MAS RARO del candidato dentro del pool del dia, no el
  // primero de su lista. Los topics genericos (tickets, pricing, timing, crowds)
  // aparecen en casi todo y no distinguen nada; el raro es de lo que la pregunta
  // trata de verdad. Tres preguntas de dress code comparten 'dress-code' con
  // frecuencia 3 mientras 'tickets' aparece quince veces: el raro las agrupa bien.
  const frecuencia = {};
  for (const c of deduped) for (const t of c.topics) frecuencia[t] = (frecuencia[t] || 0) + 1;
  const topicDominante = (c) =>
    [...c.topics].sort((a, b) => frecuencia[a] - frecuencia[b] || a.localeCompare(b))[0] || '—';

  const chosen = [];
  const porDiversidad = [];
  const topicsTomados = new Set();
  for (const c of deduped) {
    if (chosen.length >= CONFIG.maxCandidatesPerDay) break;
    const dom = topicDominante(c);
    if (topicsTomados.has(dom)) { porDiversidad.push({ c, dom }); continue; }
    topicsTomados.add(dom);
    c.topicDominante = dom;
    chosen.push(c);
  }
  console.log(`Entrada ${raw.length} → no-preguntas ${rejected.filter((r) => /Space|titulo|pregunta/.test(r.why)).length} → duplicados ${duplicates.length} → pasan ${deduped.length} → se generan ${chosen.length}`);

  const sections = [];
  const declined = [];
  let previousDraft = null;
  const batchTexts = [];
  const regenerated = [];
  const reviewStats = [];
  const nuevasEntradas = [];
  for (const c of chosen) {
    // MODO ENTREGA: se corta antes de redactar. El chequeo de precio oficial se
    // mantiene igual, porque mira los FACTS y no el borrador: si el corpus
    // contradice el precio vigente, el aviso tiene que llegar aunque escriba
    // Mario — de hecho sobre todo si escribe Mario, que es quien lo va a firmar.
    if (SIN_BORRADOR) {
      const contras = officialPriceDrift(c.facts, c.site);
      sections.push(renderCandidate(c, c.facts, c.site, null, {
        issues: [],
        extra: contras.map((x) => `⛔ PRECIO OFICIAL — ${x}`),
        words: 0,
      }));
      nuevasEntradas.push({
        questionUrl: c.url,
        questionTitle: c.title,
        titleNormalized: normalizeTitle(c.title),
        site: c.site,
        sourceSlugs: [...new Set(c.facts.map((f) => f.sourceSlug))],
        // Sin borrador no hay shingles. El ledger igual cumple su trabajo
        // principal, que es no volver a proponer una pregunta ya entregada:
        // eso se resuelve por URL y por titulo normalizado, no por n-gramas.
        shingles: [],
        generatedAt: dateLabel,
        estado: 'entregado',
      });
      console.log(`  entregada: "${c.title.slice(0, 60)}" (${c.facts.length} facts)`);
      continue;
    }

    console.log(`  generando: "${c.title.slice(0, 60)}"...`);
    const site = SITE_BY_KEY[c.site];
    const signature = signatureFor(c.site, allowLink);
    // Genera, y si repite una secuencia de 6+ palabras con otro borrador del
    // mismo lote, REGENERA pasandole las frases exactas que tiene que eliminar.
    // Un solo reintento: si vuelve a repetir, se muestra con la advertencia y
    // decide Mario. Regenerar en loop gasta tokens sin converger.
    let draft = await generateDraft(c, c.facts, c.site, allowLink, previousDraft, null);
    if (draft.skipped) {
      console.log('    SKIP: el modelo no tiene con qué contestar esta pregunta');
      declined.push({ c, reason: 'los facts no alcanzan para contestarla — el generador devolvió SKIP' });
      continue;
    }
    let repeated = draft.text ? repeatedPhrases(draft.text, batchTexts) : [];
    if (repeated.length) {
      console.log(`    repite ${repeated.length} frase(s) del lote, corrigiendo...`);
      const fix = await reviseDraft(draft.text, [
        `These exact word sequences also appear in another answer written today. Reword the sentences containing them so none survives, and change the point rather than reaching for a synonym of the same shape: ${repeated.map((p) => `"${p}"`).join(', ')}`,
      ], c, c.facts, c.site, allowLink);
      const still = fix.text ? repeatedPhrases(fix.text, batchTexts) : repeated;
      if (fix.text && still.length < repeated.length) { draft = fix; repeated = still; }
      regenerated.push({ c, phrases: repeated });
    }
    // AUTOREVISION. Va despues de la regeneracion por n-gramas y antes de los
    // validadores mecanicos: lo que se valida abajo es el texto ya revisado.
    let review = [];
    if (draft.text) {
      review = await reviewDraft(draft.text, c);
      if (review.length) {
        console.log(`    autorevisión: ${review.map((v) => v.rule).join(', ')} — corrigiendo...`);
        const fixed = await reviseDraft(
          draft.text,
          review.map((v) => `[${v.rule}] ${v.why}`),
          c, c.facts, c.site, allowLink
        );
        // El registro va SIEMPRE, gane o pierda la correccion. La primera version
        // solo registraba cuando volvia texto, asi que las correcciones que
        // fallaban del todo desaparecian del agregado — y son justo las que hay
        // que ver: el 2026-08-21 una violacion de MARCA no figuro en la tabla
        // porque la correccion volvio vacia.
        if (!fixed.text) {
          console.log(`    la corrección no sirvió${fixed.broke ? ` (${fixed.broke.join(', ')})` : ''}, queda el original`);
          reviewStats.push({ c, fixed: [], remaining: review });
        } else {
          const after = await reviewDraft(fixed.text, c);
          // Se acepta solo si de verdad mejora. Una que arregla una regla y rompe
          // dos es peor que el original.
          if (after.length < review.length) {
            reviewStats.push({ c, fixed: review.filter((v) => !after.some((a) => a.rule === v.rule)), remaining: after });
            draft = fixed;
            review = after;
          } else {
            reviewStats.push({ c, fixed: [], remaining: review });
          }
        }
      }
    }
    if (draft.text) { previousDraft = draft.text; batchTexts.push(draft.text); }

    const reason = declineReason(draft.text);
    if (reason) { declined.push({ c, reason }); continue; }

    // Una negativa que sobrevive a la correccion tira el borrador. No se muestra
    // con advertencia como las demas: "lo que aparece, se pega" es la regla de
    // lectura, y una negativa no se pega nunca.
    const niega = review.filter((v) => REGLAS_DESCARTE.has(v.rule));
    if (niega.length) {
      console.log(`    DESCARTADO: ${niega.map((v) => v.rule).join(', ')} tras corregir`);
      declined.push({ c, reason: `el borrador se niega a contestar (${niega[0].why}) — no se muestra` });
      continue;
    }

    // CIFRAS SIN RESPALDO: regla dura, no de estilo. Es la regla inviolable #1 del
    // spec — toda cifra tiene que existir en los facts o en la pregunta. Se intenta
    // corregir una vez; si sobrevive, el borrador NO SE MUESTRA. Un borrador con
    // una cifra inventada, firmado con nombre y apellido, no es un borrador
    // mejorable: es uno que no puede publicarse, y mostrarlo invita a pegarlo.
    let unbacked = unbackedFigures(draft.text, c.facts, `${c.title} ${c.detail || ''}`, signature);
    if (unbacked.length) {
      console.log(`    cifras sin respaldo (${unbacked.join(', ')}), corrigiendo...`);
      const fix = await reviseDraft(draft.text, [
        `These numbers appear in the answer but exist in neither the facts nor the question: ${unbacked.join(', ')}. Remove them, or replace each with a figure that is actually in the facts. If the point cannot be made without an unsupported number, drop the point.`,
      ], c, c.facts, c.site, allowLink);
      if (fix.text) {
        const after = unbackedFigures(fix.text, c.facts, `${c.title} ${c.detail || ''}`, signature);
        if (after.length < unbacked.length) { draft = fix; unbacked = after; }
      }
    }
    if (unbacked.length) {
      console.log(`    DESCARTADO: cifras sin respaldo tras corregir (${unbacked.join(', ')})`);
      declined.push({ c, reason: `cifras sin respaldo en los facts (${unbacked.join(', ')}) — regla dura, no se muestra` });
      continue;
    }

    const checks = validateQuoraDraft(draft.text, c.site, allowLink);
    const extra = [];

    // Abrir repitiendo el titulo. Esto SI es patron y no criterio: se compara la
    // primera linea contra el titulo normalizado. El #5 del 2026-08-21 arrancaba
    // con "How to book a Vatican Museum guided tour" como linea suelta — el lector
    // acaba de leer la pregunta, tenerla de vuelta desperdicia la unica linea que
    // muchos leen.
    const primeraLinea = normalizeTitle(draft.text.split('\n').find((l) => l.trim()) || '');
    const tituloNorm = normalizeTitle(c.title);
    if (primeraLinea && (primeraLinea === tituloNorm || (primeraLinea.length > 15 && tituloNorm.startsWith(primeraLinea)))) {
      extra.push('abre repitiendo el título de la pregunta');
    }
    const reps = repetitionAgainstLedger(draft.text, ledger);
    if (reps.length) extra.push(`repite texto con ${reps.length} respuesta(s) ya publicada(s): ${reps.map((r) => `"${r.title.slice(0, 40)}" (${r.shared} shingles)`).join(', ')}`);
    if (repeated.length) extra.push(`sigue repitiendo frases de otro borrador del lote pese al reintento: ${repeated.map((p) => `"${p}"`).join(', ')}`);
    for (const v of review) extra.push(`autorevisión [${v.rule}]: ${v.why}`);
    for (const contra of officialPriceDrift(c.facts, c.site)) {
      extra.push(`⛔ PRECIO OFICIAL — ${contra}`);
    }

    sections.push(renderCandidate(c, c.facts, c.site, draft, { ...checks, extra }));
    nuevasEntradas.push({
      questionUrl: c.url,
      questionTitle: c.title,
      titleNormalized: normalizeTitle(c.title),
      site: c.site,
      // Alimenta el guard de "no linkear dos veces el mismo articulo". Hoy esta
      // dormido porque los links estan apagados; cuando se enciendan, el dato ya
      // va a estar acumulado desde el primer dia en vez de arrancar vacio.
      sourceSlugs: [...new Set(c.facts.map((f) => f.sourceSlug))],
      shingles: [...shingles(draft.text)],
      generatedAt: dateLabel,
      estado: 'generado',
    });
  }

  const md = [
    `# Quora monitor — ${dateLabel}`,
    '',
    `**Perfil:** ${CONFIG.quoraProfile} (${CONFIG.quoraAccount}) · **Fase:** ${CONFIG.phase} · **Links:** ${allowLink ? 'habilitados' : 'deshabilitados'}`,
    `**Facts:** ${CONFIG.sites.map((s) => `${s.key} ${FACTS_BY_SITE[s.key].facts.length}`).join(' · ')} · **Ledger:** ${ledger.answered.length} publicadas`,
    '',
    '---',
    '',
    '## Embudo (diagnóstico)',
    '',
    '| Etapa | Quedan |',
    '|---|---|',
    `| Candidatos de entrada | ${raw.length} |`,
    `| Son una pregunta real (no Space, título de largo sano) | ${raw.length - rejected.filter((r) => /Space|título|titulo|pregunta|URL/.test(r.why)).length} |`,
    `| Con keyword del propio sitio + material suficiente | ${scored.length} |`,
    `| Tras dedup por título | ${deduped.length} |`,
    `| Generados (cupo ${CONFIG.maxCandidatesPerDay}/día, máx. 1 por topic dominante) | ${chosen.length}${porDiversidad.length ? ` — ${porDiversidad.length} salteado(s) por diversidad` : ''} |`,
    '',
    `_El score suma **facts + topics + poca competencia**. La competencia sale de la cantidad de respuestas que ya tiene la pregunta: 0 respuestas suma 4, hasta 2 suma 3, hasta 5 suma 2, hasta 10 suma 1, más de 10 no suma. Pocas respuestas arriba = más lugar para quedar primero, que en Quora se ordena por votos y no por fecha._`,
    '',
    `_**La antigüedad NO entra en el score**, aunque el criterio sea el correcto: ninguna fuente disponible da la fecha de la pregunta. Brave devuelve title, url, description, profile, language, meta_url, thumbnail y extra_snippets, sin ningún campo de fecha (verificado el 20/08). Queda inerte hasta que haya de dónde sacarla — antes de este reporte figuraba en la fórmula sumando 0 en todos los candidatos._`,
    '',
    '---',
    '',
    ...(() => {
      // Agregado por regla. El punto no es el borrador de hoy: es ver si todos
      // los dias falla la misma regla. Si falla siempre la misma, el arreglo va
      // en el prompt, no en el reintento — parchear el resultado no escala.
      const porRegla = {};
      for (const r of reviewStats) {
        for (const v of [...r.fixed, ...r.remaining]) porRegla[v.rule] = (porRegla[v.rule] || 0) + 1;
      }
      const ordenadas = Object.entries(porRegla).sort((a, b) => b[1] - a[1]);
      const quedan = reviewStats.reduce((n, r) => n + r.remaining.length, 0);
      return [
        '## Autorevisión',
        '',
        `**${reviewStats.length} de ${chosen.length} borradores** necesitaron regeneración por estilo.` +
          (quedan ? ` **${quedan} violación(es) siguen en pie** tras el reintento — están marcadas en cada candidato.` : ' Todas las violaciones quedaron resueltas.'),
        '',
        ...(ordenadas.length
          ? ['| Regla | Veces | Resueltas |', '|---|---|---|',
            ...ordenadas.map(([regla, n]) => {
              const res = reviewStats.reduce((k, r) => k + r.fixed.filter((v) => v.rule === regla).length, 0);
              return `| ${regla} | ${n} | ${res} |`;
            }),
            '',
            '_Si una regla aparece acá todos los días, el arreglo va en el prompt del generador, no en el reintento._']
          : ['_Ningún borrador violó una regla de estilo._']),
        '',
        '---',
        '',
      ];
    })(),
    `## Candidatos (${sections.length})`,
    '',
    sections.length ? sections.join('\n---\n\n') : '_Sin candidatos hoy._',
    '',
    ...(duplicates.length ? ['---', '', `_Duplicados descartados (misma pregunta alcanzada por dos keywords de búsqueda): ${duplicates.length} — ${duplicates.map((d) => `"${d.title.slice(0, 45)}"`).join(' · ')}._`, ''] : []),
    ...(porDiversidad.length
      ? ['---', '', `_**Guardados para otro día por diversidad** (ya había un candidato de ese tema entre los elegidos; publicar dos preguntas del mismo asunto el mismo día es patrón de plantilla aunque los textos sean distintos): ${porDiversidad.map((d) => `"${d.c.title.slice(0, 45)}" (${d.dom})`).join(' · ')}. No se descartan: vuelven mañana, porque el ledger solo registra lo que se generó._`, '']
      : []),
    ...(rejected.length ? ['---', '', `_Descartados en el filtro: ${rejected.map((r) => `"${r.c.title.slice(0, 50)}" — ${r.why}`).join(' · ')}._`, ''] : []),
    ...(declined.length ? ['', `_Borradores descartados por no contestar: ${declined.map((d) => `"${d.c.title.slice(0, 50)}" — ${d.reason}`).join(' · ')}._`, ''] : []),
    '---',
    '',
    '## Rutina',
    '',
    '1. Elegir 0-2 borradores. No hay obligación diaria.',
    '2. Leer el borrador contra la pregunta real. Ajustar libremente — la voz final es tuya.',
    `3. Publicar con ${CONFIG.quoraProfile} (${CONFIG.quoraAccount}). Solo respuestas, nunca preguntas.`,
    '',
    `_No hay nada que anotar después. El ledger se escribe solo al final de cada corrida, con los ${nuevasEntradas.length} borradores de hoy: ninguna de estas preguntas va a volver a aparecer, y ningún borrador futuro va a repetir párrafos de estos._`,
    '',
  ].join('\n');

  // output/quora/ es la carpeta que mira Mario y solo lleva SUS reportes:
  // daily-FECHA-local.md, que es lo que deja run-quora.bat, igual que en Reddit.
  // Cualquier otra etiqueta es una corrida de prueba y va a _pruebas/, para que
  // nunca haya que adivinar cual de diez archivos es el que sirve.
  const esPrueba = LABEL && LABEL !== 'local';
  const outDir = esPrueba
    ? path.join(ROOT, 'output', 'quora', '_pruebas')
    : path.join(ROOT, 'output', 'quora');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `daily-${dateLabel}${LABEL ? `-${LABEL}` : ''}.md`);
  fs.writeFileSync(outPath, md, 'utf8');
  console.log(`Output -> ${path.relative(ROOT, outPath)}`);

  // El ledger se escribe DESPUES del reporte, a proposito: si algo falla al
  // renderizar, no queda un ledger que dice que estos borradores existen cuando
  // Mario no los tiene. Al reves es recuperable — se vuelve a correr.
  if (nuevasEntradas.length) {
    const total = saveLedger(ledger, nuevasEntradas);
    console.log(`Ledger -> +${nuevasEntradas.length} entradas (${total} en total) en ${path.relative(ROOT, LEDGER_PATH)}`);
  }
}

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
  }
}

// --publicada no corre el monitor: solo toca el ledger y sale. Va antes de main()
// para no gastar consultas de Brave ni tokens en marcar una linea.
if (PUBLICADA) {
  marcarPublicada(PUBLICADA);
} else {
  main().catch((err) => { console.error(err); process.exit(1); });
}
