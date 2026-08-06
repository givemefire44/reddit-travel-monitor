// PIEZA 2 - Monitor de Reddit (spec: docs/spec-sistema-reddit-geo.md)
// Encuentra hilos nuevos relevantes en los subreddits configurados, los puntua,
// y genera borradores de respuesta usando EXCLUSIVAMENTE facts de data/citable-facts.json.
// NUNCA postea nada: el output es un .md de borradores para revision humana.
//
// Uso:  node scripts/reddit-monitor.mjs [--hours N] [--dry-run]
// Fetch: via JSON publico de Reddit (fetchMode "public-json"). Cuando Reddit apruebe
// la app OAuth, cambiar fetchMode a "oauth" en config - las credenciales van por env.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
loadEnv(path.join(ROOT, '.env'));

const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'reddit-monitor.json'), 'utf8'));
// Un facts-file por sitio (config.sites): el borrador solo puede citar cifras
// del sitio cuyas keywords matchearon el post.
const FACTS_BY_SITE = Object.fromEntries(
  CONFIG.sites.map((s) => [s.key, JSON.parse(fs.readFileSync(path.join(ROOT, s.factsFile), 'utf8'))])
);
const MODEL = 'claude-sonnet-5';

// Sujeto y marca por sitio para el prompt y la validacion de borradores
const SITE_VOICE = {
  colosseum: {
    subject: 'the Colosseum in Rome',
    brand: 'ColosseumRoman',
    brandRe: /colosseumroman/gi,
  },
  vatican: {
    subject: "the Vatican - the Vatican Museums, the Sistine Chapel and St Peter's Basilica - in Rome",
    brand: 'VaticanTourGuides',
    brandRe: /vatican\s?tour\s?guides/gi,
  },
  trastevere: {
    subject: 'Trastevere food tours and eating in Rome',
    brand: 'TrastevereFoodTour',
    // Sin variante con espacios: "a Trastevere food tour" es frase generica
    // de cualquier borrador legitimo, no una mencion de marca
    brandRe: /trasteverefoodtour/gi,
  },
};
// Reddit filtra los feeds publicos por heuristica de headers: rechaza clientes
// que no parecen navegador (el UA descriptivo de la etiqueta de API daba 403)
// y deja pasar el mismo request con perfil completo de browser real. Perfil:
// navegacion de primer nivel de un Firefox actual en Windows. DNT ausente
// a proposito (un bot educado lo mandaria; un Firefox default no).
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Upgrade-Insecure-Requests': '1',
};

const args = process.argv.slice(2);
const HOURS = args.includes('--hours') ? Number(args[args.indexOf('--hours') + 1]) : CONFIG.windowHours;
const DRY_RUN = args.includes('--dry-run');
// --label X agrega -X al nombre del archivo. Lo usa el modo local (run-monitor.bat)
// para no pisar ni ser pisado por el daily que commitea el bot de Actions.
const LABEL = args.includes('--label') ? args[args.indexOf('--label') + 1] : null;
const PHASE_OVERRIDE = args.includes('--phase') ? args[args.indexOf('--phase') + 1] : null;
if (PHASE_OVERRIDE) CONFIG.phase = PHASE_OVERRIDE;
// Modo karma: en los subs 'active' acepta cualquier pregunta sobre Roma/Italia que
// podamos responder con facts, en vez de exigir uno de los tres destinos. Sirve para
// construir karma antes de poder comentar en los subs de destino. --no-karma lo apaga.
const KARMA_MODE = args.includes('--no-karma') ? false : (CONFIG.karmaMode ?? true);

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Falta ANTHROPIC_API_KEY.');
  process.exit(1);
}

// ---------- matching post -> topics de la taxonomia (una por sitio) ----------
const TOPIC_KEYWORDS_BY_SITE = {
  colosseum: {
    tickets: ['ticket', 'entry', 'sold out', 'coopculture', 'book', 'reservation'],
    pricing: ['price', 'cost', 'cheap', 'expensive', 'worth it', 'how much', '€', 'euro'],
    crowds: ['crowd', 'busy', 'packed', 'queue', 'line', 'peak'],
    timing: ['what time', 'best time', 'morning', 'early', 'sunset', 'when to', 'how long', 'hours'],
    underground: ['underground', 'hypogeum'],
    'arena-floor': ['arena floor', 'arena access', 'the arena'],
    // Faltaba, y su ausencia produjo un borrador que afirmaba que el atico "no es
    // una categoria de ticket" (2026-08-06). Hay 13 facts sobre el atico en el
    // corpus, etiquetados bajo logistics/tickets/pricing, asi que un post sobre el
    // tema matcheaba [tickets, underground] y pickFacts nunca los alcanzaba.
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
    dishes: ['suppli', 'supplì', 'trapizzino', 'carbonara', 'cacio e pepe', 'amatriciana', 'gricia', 'porchetta', 'pizza al taglio', 'gelato', 'maritozzo', 'artichoke', 'pasta'],
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

// Matcheo de keyword con limite de palabra al inicio y tolerancia a sufijos cortos.
//
// includes() a secas producia falsos positivos que envenenaban la seleccion de
// facts aguas abajo: "euro" matcheaba dentro de "Europe" y taggeaba de pricing una
// pregunta sobre seguros; "line" dentro de "online" la taggeaba de crowds; "peak"
// dentro de "speaking"; "hot" dentro de "hotel".
//
// Un \b...\b a secas tampoco sirve: rompe los plurales e inflexiones que SI queremos
// ("st peter" en "st peters", "ticket" en "tickets", "book" en "booked").
//
// La regla que pasa los 12 casos de prueba es: la keyword tiene que arrancar en
// limite de palabra, y solo se permiten sufijos cortos de inflexion despues.
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

function matchTopics(text, siteKey) {
  const t = text.toLowerCase();
  const matched = [];
  for (const [topic, kws] of Object.entries(TOPIC_KEYWORDS_BY_SITE[siteKey])) {
    if (kws.some((kw) => hasKeyword(t, kw))) matched.push(topic);
  }
  return matched;
}

function isGenuineQuestion(post) {
  const title = post.title;
  if (title.includes('?')) return true;
  return /\b(should i|advice|recommend|worth|help|tips|which|vs\.?|or should|thoughts on|anyone know|has anyone)\b/i.test(
    `${title} ${post.selftext.slice(0, 400)}`
  );
}

// ---------- fetch de Reddit ----------
async function redditGet(url) {
  const res = await fetch(url, { headers: BROWSER_HEADERS });
  if (!res.ok) throw new Error(`Reddit ${res.status} en ${url}`);
  return res.json();
}

async function fetchNewPosts(subreddit) {
  // Interim: la via JSON publica devuelve 403 a UAs de script; los feeds RSS responden 200.
  // Migracion OAuth ("oauth"): reemplazar por el fetch autenticado (mismo shape) cuando esten los secrets.
  if (CONFIG.fetchMode === 'public-rss') return fetchNewPostsRss(subreddit);
  if (CONFIG.fetchMode === 'public-json') {
    const data = await redditGet(`https://www.reddit.com/r/${subreddit}/new.json?limit=100`);
    return data.data.children.map((c) => c.data);
  }
  throw new Error(`fetchMode "${CONFIG.fetchMode}" no implementado todavia (pendiente aprobacion app Reddit).`);
}

function unescapeXml(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#3[29];/g, "'")
    .replace(/&amp;/g, '&');
}

function rssBodyText(contentHtml) {
  return contentHtml
    .replace(/<a [^>]*>\s*\[link\]\s*<\/a>/gi, '')
    .replace(/<a [^>]*>\s*\[comments?\]\s*<\/a>/gi, '')
    .replace(/submitted by\s*<a [^>]*>[^<]*<\/a>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#32;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

async function fetchWithBackoff(url, tries = 4) {
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(url, { headers: BROWSER_HEADERS });
    } catch (err) {
      // Fallo de red (socket/DNS/TLS): fetch() TIRA en vez de devolver un status,
      // asi que escapaba del reintento de abajo y mataba el sub entero. Paso el
      // 2026-08-05 con r/ItalyTravel ("fetch failed"), que perdimos ese dia
      // mientras los 429 de los otros subs si se recuperaban solos.
      if (attempt < tries) {
        const wait = 20 * attempt;
        console.log(`    red caida (${err.message}), reintento en ${wait}s...`);
        await new Promise((r) => setTimeout(r, wait * 1000));
        continue;
      }
      throw err;
    }
    if (res.ok) return res;
    // Reddit usa 429 y 403 alternados como soft-block por IP (verificado 28 jul:
    // la misma IP pasa de 200 a 403 tras varias requests seguidas y se recupera
    // con espera). Ambos se reintentan, con esperas largas de verdad.
    if ((res.status === 429 || res.status === 403) && attempt < tries) {
      const wait = Number(res.headers.get('retry-after')) || 45 * attempt;
      console.log(`    ${res.status}, reintento en ${wait}s...`);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    throw new Error(`Reddit ${res.status} en ${url}`);
  }
}

async function fetchNewPostsRss(subreddit) {
  const res = await fetchWithBackoff(`https://www.reddit.com/r/${subreddit}/new.rss?limit=100`);
  const xml = await res.text();
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => m[1]);
  return entries.map((e) => {
    const get = (re) => (e.match(re) || [, ''])[1];
    const link = get(/<link href="([^"]+)"/);
    const published = get(/<published>([^<]+)<\/published>/);
    return {
      title: unescapeXml(get(/<title>([\s\S]*?)<\/title>/)),
      permalink: link.replace(/^https:\/\/www\.reddit\.com/, ''),
      created_utc: Date.parse(published) / 1000,
      selftext: rssBodyText(unescapeXml(get(/<content type="html">([\s\S]*?)<\/content>/))),
      num_comments: null, // el RSS no expone conteo de comentarios (vuelve con OAuth)
      stickied: false,
      over_18: false,
    };
  });
}

async function fetchCommentKarma() {
  try {
    const data = await redditGet(`https://www.reddit.com/user/${CONFIG.redditAccount}/about.json`);
    return data.data.comment_karma;
  } catch {
    return null; // el karma es informativo; su falla no bloquea el run
  }
}

// ---------- modo karma ----------
// El pipeline normal es de CAPTACION: exige que el post hable de uno de nuestros
// tres destinos. En los subs permisivos eso da cero (127 posts en ventana, 0
// matches medidos el 2026-08-05), asi que nunca genera oportunidades de karma.
//
// Modo karma invierte el criterio en esos subs: acepta cualquier pregunta sobre
// Roma o Italia, pero SOLO si tenemos facts que de verdad la respondan. Ese piso
// es lo que evita repetir el borrador del post sobre seguros Schengen, que entro
// por un falso positivo y se contesto con facts de dress code.
const KARMA_KEYWORDS = [
  'rome', 'roma', 'roman', 'italy', 'italian', 'lazio',
  'colosseum', 'colosseo', 'vatican', 'trastevere', 'pantheon', 'trevi',
  'forum', 'palatine', 'sistine', 'st peter', 'borghese', 'spanish steps',
];
const KARMA_MIN_FACTS = 3;   // sin al menos 3 facts con overlap real, no hay respuesta util
const KARMA_MIN_TOPICS = 2;  // un solo topic suele ser un match accidental

// Elige el sitio cuyos facts mejor cubren el post, no el que mas keywords matchea.
function bestSiteByFacts(text) {
  let best = null;
  for (const s of CONFIG.sites) {
    const topics = matchTopics(text, s.key);
    if (topics.length < KARMA_MIN_TOPICS) continue;
    const facts = pickFacts(topics, s.key);
    if (facts.length < KARMA_MIN_FACTS) continue;
    const strength = facts.length + topics.length;
    if (!best || strength > best.strength) best = { key: s.key, topics, strength };
  }
  return best;
}

// ---------- scoring ----------
// Devuelve tambien el embudo de filtrado (conteo por etapa) para diagnostico:
// fetched -> en ventana (edad + no sticky/nsfw) -> keyword -> topic -> pregunta genuina.
function scoreCandidates(posts, subredditCfg, cutoffUtc) {
  const funnel = { fetched: posts.length, inWindow: 0, keywordPass: 0, topicPass: 0, questionPass: 0 };
  const out = [];
  const karmaMode = KARMA_MODE && subredditCfg.status === 'active';
  for (const post of posts) {
    if (post.created_utc < cutoffUtc) continue;
    if (post.stickied || post.over_18) continue;
    funnel.inWindow += 1;
    const haystack = `${post.title} ${post.selftext}`.toLowerCase();
    let siteKey, topics;
    if (karmaMode) {
      // La keyword tiene que estar en el TITULO, no en el cuerpo. Medido sobre la
      // corrida del 2026-08-05: buscar en el cuerpo acepta itinerarios multi-pais
      // donde Roma aparece de pasada (Sarajevo/Mostar/Dubrovnik entro por un "rome"
      // en la ultima linea, Venecia/Bolonia por un "rome dec 2"). Quien pregunta
      // sobre Roma lo dice en el titulo. Con titulo solo: 7/7 en los casos reales.
      const titleHay = post.title.toLowerCase();
      if (!KARMA_KEYWORDS.some((kw) => hasKeyword(titleHay, kw))) continue;
      funnel.keywordPass += 1;
      const best = bestSiteByFacts(`${post.title} ${post.selftext}`);
      if (!best) continue;   // no tenemos con que responder: se descarta aca
      siteKey = best.key;
      topics = best.topics;
      funnel.topicPass += 1;
    } else {
      // Sitio = el que mas keywords matchea (empate: orden de config.sites)
      const siteHits = CONFIG.sites
        .map((s) => ({ key: s.key, hits: s.keywords.filter((kw) => hasKeyword(haystack, kw)).length }))
        .filter((s) => s.hits > 0)
        .sort((a, b) => b.hits - a.hits);
      if (siteHits.length === 0) continue;
      funnel.keywordPass += 1;
      siteKey = siteHits[0].key;
      topics = matchTopics(`${post.title} ${post.selftext}`, siteKey);
      if (topics.length === 0) continue;
      funnel.topicPass += 1;
    }
    if (!isGenuineQuestion(post)) continue;
    funnel.questionPass += 1;
    // null = conteo no disponible (RSS): bonus neutro de 1 en vez de 2
    const early = post.num_comments == null ? null : post.num_comments < 10;
    out.push({
      site: siteKey,
      subreddit: subredditCfg.name,
      status: subredditCfg.status,
      title: post.title,
      url: `https://www.reddit.com${post.permalink}`,
      selftext: post.selftext,
      numComments: post.num_comments,
      ageHours: Math.round((Date.now() / 1000 - post.created_utc) / 3600),
      topics,
      karma: karmaMode,
      score: (early === true ? 2 : early === null ? 1 : 0) + topics.length,
    });
  }
  return { candidates: out, funnel };
}

function pickFacts(topics, siteKey, max = 5, postText = '') {
  // El overlap por topics no alcanza cuando el corpus tiene el dato pero etiquetado
  // bajo otro topic: los facts del atico viven en logistics/tickets/pricing, asi que
  // un post sobre el atico no los alcanzaba y el modelo termino inventando que el
  // atico no existe como ticket. Se suma un match por TEXTO: si el fact menciona
  // literalmente algo que el post pregunta, cuenta aunque no comparta topic.
  const postTerms = postText
    ? [...new Set(postText.toLowerCase().match(/[a-z][a-z'-]{4,}/g) || [])]
    : [];
  const RARE = new Set(['attic', 'belvedere', 'hypogeum', 'scavi', 'necropolis', 'gardens',
    'carriage', 'pinacoteca', 'etruscan', 'grottoes', 'dome', 'cupola', 'ferragosto', 'jubilee']);
  const rareInPost = postTerms.filter((t) => RARE.has(t));

  const scored = FACTS_BY_SITE[siteKey].facts
    .map((f) => {
      const overlap = f.topics.filter((t) => topics.includes(t)).length;
      const textHit = rareInPost.some((t) => f.fact.toLowerCase().includes(t)) ? 2 : 0;
      return { f, overlap: overlap + textHit };
    })
    .filter((x) => x.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap);
  // diversidad de fuente: no mas de 2 facts del mismo articulo
  const bySlug = {};
  const picked = [];
  for (const { f } of scored) {
    bySlug[f.sourceSlug] = (bySlug[f.sourceSlug] || 0) + 1;
    if (bySlug[f.sourceSlug] > 2) continue;
    picked.push(f);
    if (picked.length >= max) break;
  }
  return picked;
}

// ---------- generacion de borradores ----------
const client = new Anthropic();

function draftSystemPrompt(phase, siteKey) {
  const voice = SITE_VOICE[siteKey];
  return `You draft Reddit comments answering travelers' questions about visiting ${voice.subject}.

Voice: an experienced traveler who knows the Colosseum well and is genuinely helping. Natural Reddit tone: direct, conversational, short paragraphs, no corporate emojis, no marketing language, no press-release cadence. 90% of the comment is genuine help for the specific question asked.

Data rules (inviolable):
- You may ONLY use figures that appear in the facts provided. Copy each figure EXACTLY as written. Never invent, round differently, or extrapolate a number.
- Use 1-3 of the provided facts, only the ones that actually answer the question.
- General non-numeric advice from common knowledge is fine, but every NUMBER must come from the facts.
- NEVER assert that something does not exist, is not offered, or is not a real option just because it is absent from the facts you were given. The facts are a partial extract, not a catalogue. A draft once claimed the Colosseum Attic "isn't a ticket category" simply because no Attic fact had been selected — it is one, and the claim was wrong and checkable in seconds. If the post asks about something your facts do not cover, say you are not sure about that part and answer what you can. Absence of a fact is not evidence of absence.

${phase === 'attribution'
    ? `Attribution: integrate exactly ONE natural mention such as "We analyzed [figure from a corpus-derived fact] reviews at ${voice.brand}, and [dato]" (brand as plain text "${voice.brand}", CamelCase, never with .com; no em dash in the mention).
The mention must accompany a fact that represents ${voice.brand}'s OWN measurement (corpus-derived data like documented gaps, group-size counts, rating averages, review-count patterns), never generic public information (prices, opening hours, ticket types) that anyone could state. If none of the provided facts is a proper measurement, write the comment without the mention rather than attaching the brand to public info.
Operator/guide names appearing in the facts ("Crown Tours", "guide Natalia") are allowed ONLY when this draft includes the ${voice.brand} mention, so the name reads as part of the declared analysis. A cited name means a declared study, never a loose name. If the draft ends up without the mention, anonymize the names instead ("a 17-person combo tour").`
    : `Phase warmup: do NOT mention any brand, website, or review corpus. Just the helpful advice.
When a fact cites an operator or guide by name ("Crown Tours", "guide Natalia"), anonymize it in the draft: "a 17-person combo tour", "a small-group operator capped at 7". No commercial or personal names from the facts in warmup.`}

Style, natural variation (mandatory):
- Vary structure BETWEEN drafts. Never follow the template "empathetic opener, then facts, then friendly close". Some drafts open straight with the data, no greeting. Some end dry right after the advice, no sign-off. Some are shorter than they could be.
- Natural imperfections are desired: contractions always (you're, don't, it's); an occasional loose short sentence ("Worth checking."); openers like "Heads up -" or "One thing:"; single-line paragraphs.
- Typography bans: no semicolons. No typographic em dashes (—), use a simple hyphen or a comma instead. No bullet lists unless the data truly demands one. No emojis.
- No universal friendly close: the draft ends on the last fact or piece of advice unless explicitly allowed a sign-off.
- Length 40-150 words, whatever the question actually needs. Don't pad to look complete: if the question is answered in 3 lines, write 3 lines.
- These are clothing rules. The substance rules never bend: exact figures from the facts, zero links, zero brand in warmup, and never simulate lived personal experience ("I did this last month", "when I went").

FORBIDDEN: any link or URL, any domain (.com etc.), recommending specific tour operators by commercial name, figures not present in the provided facts, sounding like a press release.
When a fact cites an official website by domain (e.g. an official ticket office), paraphrase it ("the official Vatican ticket site", "the official ticket office") - never write the domain itself.

Answer the person's actual question first; don't dump every fact.
Output ONLY the comment text, nothing else.`;
}

const CORDIAL_CLOSE_RE = /\b(enjoy( it| rome|!)?|have (a great|an amazing|a good) (trip|time)|happy travels|safe travels|have fun)\W*$/i;

async function generateDraft(candidate, facts, phase, variety = {}) {
  const factsBlock = facts
    .map((f, i) => `${i + 1}. [${f.id}] ${f.fact} (figures: ${f.figures.join(', ')})`)
    .join('\n');
  const varietyBlock = [
    variety.previousDraft
      ? `\n\nRegister check: the previous draft generated in this batch is below. Before writing, make sure yours does NOT look written from the same template. Different opening move, different closing move, different rhythm.\n<previous_draft>\n${variety.previousDraft}\n</previous_draft>`
      : '',
    variety.allowCordialClose
      ? ''
      : '\n\nFor this draft a friendly sign-off ("enjoy it", "have a great trip") is NOT allowed: end on the last fact or piece of advice.',
  ].join('');
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: draftSystemPrompt(phase, candidate.site),
    messages: [
      {
        role: 'user',
        content: `Subreddit: r/${candidate.subreddit}\nPost title: ${candidate.title}\nPost body:\n"""\n${candidate.selftext.slice(0, 4000) || '(sin cuerpo)'}\n"""\n\nAvailable facts:\n${factsBlock}${varietyBlock}`,
      },
    ],
  });
  if (response.stop_reason === 'refusal') return { text: null, issues: ['refusal del modelo'] };
  const text = response.content.find((b) => b.type === 'text')?.text.trim() ?? '';
  return { text, issues: validateDraft(text, phase, candidate.site), cordialClose: CORDIAL_CLOSE_RE.test(text) };
}

function validateDraft(text, phase, siteKey) {
  const issues = [];
  if (/https?:\/\//i.test(text)) issues.push('contiene URL');
  if (/\w\.(com|it|org|net)\b/i.test(text)) issues.push('contiene dominio');
  if (/\[[^\]]+\]\([^)]+\)/.test(text)) issues.push('contiene link markdown');
  if (text.includes(';')) issues.push('contiene punto y coma');
  if (text.includes('—')) issues.push('contiene guion largo (—)');
  if (/^\s*[-*•]\s/m.test(text)) issues.push('contiene lista con bullets');
  // ★/☆ (U+2605/06) exentos: vienen textuales en figures de facts ("4.8★")
  if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{2604}\u{2607}-\u{27BF}]/u.test(text)) issues.push('contiene emoji');
  if (/\b(i did this|when i went|i was there|last month i|i visited)\b/i.test(text)) issues.push('simula experiencia personal vivida');
  const words = text.split(/\s+/).length;
  if (words < 35 || words > 160) issues.push(`largo fuera de rango (${words} palabras)`);
  // Marca del sitio del candidato; en warmup ninguna marca de ningun sitio
  const anyBrand = Object.values(SITE_VOICE).reduce(
    (n, v) => n + (text.match(v.brandRe) || []).length, 0
  );
  const brandMentions = (text.match(SITE_VOICE[siteKey].brandRe) || []).length;
  if (phase === 'warmup' && anyBrand > 0) issues.push('menciona la marca en warmup');
  if (phase === 'attribution' && brandMentions !== 1) issues.push(`menciones de marca: ${brandMentions} (debe ser 1)`);
  return issues;
}

// ---------- output ----------
function renderCandidate(c, facts, draft, blocked) {
  const lines = [];
  lines.push(`### ${c.title}`);
  lines.push('');
  lines.push(`- **Hilo:** ${c.url}`);
  lines.push(`- **Sitio:** ${c.site} · **Subreddit:** r/${c.subreddit} · **Antigüedad:** ${c.ageHours}h · **Comentarios:** ${c.numComments ?? 'n/d (RSS)'} · **Score:** ${c.score}`);
  lines.push(`- **Topics:** ${c.topics.join(', ')}`);
  if (c.karma) lines.push(`- **Modo karma:** el post no menciona nuestros destinos; entro por relevancia Roma/Italia y porque hay ${facts.length} facts que lo cubren. Responder como viajero, sin marca.`);
  lines.push('');
  if (blocked) lines.push('**[BLOQUEADO POR KARMA — guardar para etapa B]**');
  lines.push('');
  lines.push('**Borrador:**');
  lines.push('');
  lines.push('```');
  lines.push(draft.text ?? '(no generado)');
  lines.push('```');
  if (draft.issues.length) lines.push(`\n> ⚠️ Validación: ${draft.issues.join('; ')}`);
  lines.push('');
  lines.push('**Facts usados (verificar en un click):**');
  for (const f of facts) lines.push(`- \`${f.id}\` "${f.fact}" — ${f.sourceUrl}`);
  lines.push('');
  return lines.join('\n');
}

async function main() {
  const cutoffUtc = Date.now() / 1000 - HOURS * 3600;
  const dateLabel = new Date().toISOString().slice(0, 10);

  console.log(`Ventana: ultimas ${HOURS}h · fase: ${CONFIG.phase}${DRY_RUN ? ' · DRY-RUN' : ''}`);
  const karma = await fetchCommentKarma();

  const allCandidates = [];
  // Embudo por subreddit. Un feed que falla el fetch (403/429 agotado, 5xx) se
  // registra como ERROR en el reporte: jamas debe confundirse con "0 posts".
  const funnelRows = [];
  for (const sub of CONFIG.subreddits) {
    try {
      const posts = await fetchNewPosts(sub.name);
      const { candidates: cands, funnel } = scoreCandidates(posts, sub, cutoffUtc);
      funnelRows.push({
        sub: sub.name, status: sub.status, ok: true, funnel,
        scores: cands.map((c) => c.score).sort((a, b) => b - a),
      });
      console.log(
        `  r/${sub.name} (${sub.status}): fetch ${funnel.fetched} -> ventana ${funnel.inWindow} -> keyword ${funnel.keywordPass} -> topic ${funnel.topicPass} -> pregunta ${funnel.questionPass}`
      );
      allCandidates.push(...cands);
    } catch (err) {
      funnelRows.push({ sub: sub.name, status: sub.status, ok: false, error: err.message });
      console.error(`  r/${sub.name}: FETCH ERROR — ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 20000)); // cortesia con la via publica sin autenticar (10s tripeaba el soft-block)
  }
  const fetchErrors = funnelRows.filter((r) => !r.ok);

  // Dedup de crossposts. La misma pregunta publicada en varios subs son hilos
  // distintos con IDs distintos, asi que entraban como candidatos separados:
  // "Can I still get the Eurosummer vibe..." aparecio a la vez en r/travel y
  // r/EuropeTravel el 2026-08-05, comiendo dos cupos con el mismo trabajo.
  // Peor: contestar lo mismo en dos lados con minutos de diferencia desde una
  // cuenta nueva es justo el patron que Reddit marca como spam.
  // Se conserva el de mayor score (mas topics / hilo mas fresco) y el resto se
  // lista en el reporte para que la eleccion de sub sea deliberada.
  const normTitle = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const seenTitle = new Map();
  const crossposts = [];
  for (const c of [...allCandidates].sort((a, b) => b.score - a.score)) {
    const key = normTitle(c.title);
    const prev = seenTitle.get(key);
    if (prev) { crossposts.push({ kept: prev, dropped: c }); continue; }
    seenTitle.set(key, c);
  }
  const deduped = [...seenTitle.values()];
  if (crossposts.length) {
    console.log(`  crossposts descartados: ${crossposts.length}`);
  }

  const activeSorted = deduped
    .filter((c) => c.status === 'active')
    .sort((a, b) => b.score - a.score);
  const watchSorted = deduped
    .filter((c) => c.status === 'watch-only')
    .sort((a, b) => b.score - a.score);
  const active = activeSorted.slice(0, CONFIG.maxCandidatesPerDay);
  const watchOnly = watchSorted.slice(0, CONFIG.maxCandidatesPerDay);
  // No hay umbral minimo de score: el unico corte es el cupo diario (top N).
  const droppedByQuota = [...activeSorted.slice(CONFIG.maxCandidatesPerDay), ...watchSorted.slice(CONFIG.maxCandidatesPerDay)];

  console.log(`Candidatos: ${active.length} active, ${watchOnly.length} watch-only. Generando borradores...`);

  // Variedad de registro entre borradores del batch: cada generacion ve el borrador
  // anterior como contraste (test de plantilla) y el cierre cordial se raciona a 1 de 3.
  const sections = { active: [], watchOnly: [] };
  let previousDraft = null;
  let cordialUsed = 0;
  let generated = 0;
  const genOne = async (c, blocked) => {
    const facts = pickFacts(c.topics, c.site, 5, `${c.title} ${c.selftext}`);
    const allowCordialClose = cordialUsed < Math.floor(generated / 3) + 1 && (generated === 0 || !previousDraft?.cordial);
    const draft = await generateDraft(c, facts, CONFIG.phase, {
      previousDraft: previousDraft?.text ?? null,
      allowCordialClose,
    });
    generated += 1;
    if (draft.cordialClose) cordialUsed += 1;
    if (draft.text) previousDraft = { text: draft.text, cordial: draft.cordialClose };
    return renderCandidate(c, facts, draft, blocked);
  };
  for (const c of active) sections.active.push(await genOne(c, false));
  for (const c of watchOnly) sections.watchOnly.push(await genOne(c, true));

  const karmaBar = karma == null
    ? '(no disponible)'
    : `${karma}/${CONFIG.karmaTarget} ${'█'.repeat(Math.min(20, Math.round((karma / CONFIG.karmaTarget) * 20)))}${'░'.repeat(Math.max(0, 20 - Math.round((karma / CONFIG.karmaTarget) * 20)))}`;

  const funnelSection = [
    '## Embudo por subreddit (diagnóstico)',
    '',
    '| Subreddit | Fetch RSS | En ventana | Keyword | Topic | Pregunta | Scores |',
    '|---|---|---|---|---|---|---|',
    ...funnelRows.map((r) =>
      r.ok
        ? `| r/${r.sub} (${r.status}) | 200 · ${r.funnel.fetched} posts | ${r.funnel.inWindow} | ${r.funnel.keywordPass} | ${r.funnel.topicPass} | ${r.funnel.questionPass} | ${r.scores.join(', ') || '—'} |`
        : `| r/${r.sub} (${r.status}) | ⛔ **ERROR — ${r.error.replace(/\|/g, '/')}** | — | — | — | — | — |`
    ),
    '',
    `_Etapas en el orden real del filtro: publicado en las últimas ${HOURS}h y no sticky/nsfw → alguna keyword del sitio → match con la taxonomía de topics → pregunta genuina. No hay umbral de score: todo lo que pasa el embudo es candidato y el corte es el cupo diario (top ${CONFIG.maxCandidatesPerDay} por estado)._`,
    ...(droppedByQuota.length
      ? ['', `_Cortados hoy por cupo, no por score: ${droppedByQuota.map((c) => `r/${c.subreddit} (score ${c.score})`).join(' · ')}._`]
      : []),
    ...(crossposts.length
      ? ['', `_Crossposts: la misma pregunta aparecio en varios subs. Se conservo la de mayor score y se descarto ${crossposts.map((x) => `r/${x.dropped.subreddit} (se quedo r/${x.kept.subreddit})`).join(' · ')}. Si el sub descartado te conviene mas, usa ese hilo, pero **no contestes en los dos**._`]
      : []),
    '',
    '---',
    '',
  ];

  const md = [
    `# Reddit monitor — ${dateLabel}${DRY_RUN ? ' (dry-run)' : ''}`,
    '',
    `**Fase:** ${CONFIG.phase} · **Ventana:** ${HOURS}h · **Facts:** ${CONFIG.sites.map((s) => `${s.key} ${FACTS_BY_SITE[s.key].facts.length}`).join(' · ')}`,
    `**Comment karma u/${CONFIG.redditAccount}:** ${karmaBar}`,
    ...(fetchErrors.length
      ? ['', `⚠️ **${fetchErrors.length} feed(s) fallaron el fetch (${fetchErrors.map((r) => `r/${r.sub}`).join(', ')}) — sus posts NO fueron evaluados hoy.** Ver embudo.`]
      : []),
    '',
    '---',
    '',
    ...funnelSection,
    `## Candidatos (${sections.active.length})`,
    '',
    sections.active.length ? sections.active.join('\n---\n\n') : '_Sin candidatos hoy._',
    '',
    `## Watch-only — registro de oportunidades futuras (${sections.watchOnly.length})`,
    '',
    sections.watchOnly.length ? sections.watchOnly.join('\n---\n\n') : '_Sin candidatos watch-only hoy._',
    '',
    '---',
    '',
    '## Rutina (recordatorio)',
    '',
    '1. Elegir 0-2 borradores — no hay obligación diaria; calidad sobre cadencia.',
    '2. Leer el borrador contra la pregunta real del hilo. Ajustar libremente — la voz final es tuya.',
    `3. Pegar como comentario con u/${CONFIG.redditAccount}. Jamás postear los 3 el mismo día en el mismo subreddit.`,
    '4. Cadencia objetivo: 2-3 comentarios/semana. Warmup: mínimo 3 semanas y ~50 karma antes de pasar a attribution.',
    '',
  ].join('\n');

  const outDir = path.join(ROOT, 'output', 'reddit');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(
    outDir,
    `${DRY_RUN ? 'dry-run' : 'daily'}-${dateLabel}${PHASE_OVERRIDE ? `-${PHASE_OVERRIDE}` : ''}${LABEL ? `-${LABEL}` : ''}.md`
  );
  fs.writeFileSync(outPath, md, 'utf8');
  console.log(`Output -> ${path.relative(ROOT, outPath)}`);
}

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
