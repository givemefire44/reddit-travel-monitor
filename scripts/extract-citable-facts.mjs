// PIEZA 1 - Extractor de facts citables (spec: docs/spec-sistema-reddit-geo.md)
// Lee los articulos editoriales publicados del sitio desde Sanity, extrae
// afirmaciones con cifra dura via Claude (Sonnet) y produce el facts-file del sitio.
// Regla inviolable #1: todo fact debe existir publicado con la cifra EXACTA -
// el script verifica programaticamente frase y cifras contra el texto fuente
// y descarta cualquier candidato no verificable.
//
// Uso:  node scripts/extract-citable-facts.mjs [--site colosseum|vatican] [--limit N] [--slug <slug>]
// Sin --site corre colosseum (compatibilidad con el uso historico).
// Re-ejecucion manual cuando se publiquen articulos nuevos, o via extract-facts.yml.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// ---------- sitios ----------
// Cada sitio del portfolio con extractor activo. Mismas reglas para todos;
// cambia el sujeto, la taxonomia de topics y el Sanity de origen.
const SITES = {
  colosseum: {
    projectId: 'ptigxfcf',
    siteUrl: 'https://colosseumroman.com',
    corpusSize: '12,774', // reviews analizadas - claim fijo del sitio (spec, schema del JSON)
    outFile: 'citable-facts.json',
    subjectName: 'the Colosseum (Rome)',
    subjectRule:
      "the claim's subject must be the Colosseum, its tickets/tours/access, or visiting Rome. Exclude sentences whose subject is another monument or city (Louvre, Pompeii, Sagrada Familia, Milan, Paris, Barcelona...) even when they appear in a Colosseum article. A comparison qualifies only if the Colosseum side carries the figure and the claim stands as Colosseum advice.",
    internalVoiceRe: /\b(the corpus|our corpus|our analysis|we analyzed|our data|colosseumroman)\b/i,
    topics: [
      'tickets', 'pricing', 'crowds', 'timing', 'underground', 'arena-floor',
      'skip-the-line', 'guides', 'operators', 'logistics', 'kids-families',
      'accessibility', 'weather', 'night-tours', 'forum-palatine',
    ],
    excludedSlugs: [
      'about-us', 'contact-us', 'terms-conditions', 'cookies-privacy-policy',
      'methodology', // fuente de contexto, pero sus numeros de proceso no son facts de viaje
    ],
  },
  vatican: {
    projectId: 'rep4o78g',
    siteUrl: 'https://vaticantourguides.com',
    corpusSize: null, // el sitio no publica un numero fijo de reviews analizadas
    outFile: 'citable-facts-vatican.json',
    subjectName: 'the Vatican (Vatican Museums, Sistine Chapel, St Peter\'s Basilica) in Rome',
    subjectRule:
      "the claim's subject must be the Vatican - the Vatican Museums, the Sistine Chapel, St Peter's Basilica or its dome, Vatican tickets/tours/access - or visiting Rome as it relates to the Vatican. Exclude sentences whose subject is another monument or city (Colosseum, Louvre, Pompeii...) even when they appear in a Vatican article. A comparison qualifies only if the Vatican side carries the figure and the claim stands as Vatican advice.",
    internalVoiceRe: /\b(the corpus|our corpus|our analysis|we analyzed|our data|vaticantourguides|vatican tour guides)\b/i,
    topics: [
      'tickets', 'pricing', 'crowds', 'timing', 'sistine-chapel', 'st-peters',
      'dome-climb', 'skip-the-line', 'guides', 'operators', 'logistics',
      'kids-families', 'accessibility', 'weather', 'dress-code', 'free-sunday',
      'museums-itinerary',
    ],
    excludedSlugs: ['about-us', 'contact', 'contact-us', 'terms-conditions', 'cookies-privacy-policy', 'methodology'],
  },
  trastevere: {
    projectId: '3xsreznf',
    siteUrl: 'https://trasteverefoodtour.com',
    corpusSize: null, // el sitio no publica un numero fijo de reviews analizadas
    outFile: 'citable-facts-trastevere.json',
    subjectName: 'Trastevere food tours and eating in Rome',
    subjectRule:
      "the claim's subject must be Trastevere, Rome food tours, or eating/food in Rome (dishes, markets, food neighborhoods, dietary options on tours). Exclude sentences whose subject is another monument or city (Colosseum, Vatican, Florence, Paris...) even when they appear in a Trastevere article. A comparison qualifies only if the Trastevere/food side carries the figure and the claim stands as Rome food advice.",
    internalVoiceRe: /\b(the corpus|our corpus|our analysis|we analyzed|our data|trasteverefoodtour)\b/i,
    topics: [
      'pricing', 'value', 'timing', 'booking', 'guides', 'operators',
      'language', 'dietary', 'dishes', 'street-food', 'markets',
      'wine-drinks', 'neighborhoods', 'kids-families', 'group-size',
      'format-duration', 'logistics',
    ],
    excludedSlugs: ['about', 'about-us', 'contact', 'contact-us', 'terms-conditions', 'cookies-privacy-policy', 'methodology'],
  },
  // Pompeya y Milan, agregados el 24 ago 2026. El motivo: el monitor cubria 3
  // sitios de un portfolio de once, y el embudo de Reddit venia devolviendo dias
  // enteros sin un solo candidato con corpus — no porque las keywords fueran
  // estrechas sino porque nadie pregunta por el Coliseo todos los dias. Los dos
  // son Italia, asi que entran por los subs que ya estan configurados.
  pompeii: {
    projectId: '34ibxssl',
    siteUrl: 'https://pompeiiguidetours.com',
    corpusSize: null,
    outFile: 'citable-facts-pompeii.json',
    subjectName: 'Pompeii and Herculaneum (the archaeological sites near Naples)',
    subjectRule:
      "the claim's subject must be Pompeii, Herculaneum, their tickets/tours/access, or getting there from Naples, Sorrento or Rome. Exclude sentences whose subject is another monument or city (Colosseum, Vatican, Louvre, Sagrada Familia...) even when they appear in a Pompeii article. A comparison qualifies only if the Pompeii side carries the figure and the claim stands as Pompeii advice.",
    internalVoiceRe: /\b(the corpus|our corpus|our analysis|we analyzed|our data|pompeiiguidetours)\b/i,
    topics: [
      'tickets', 'pricing', 'crowds', 'timing', 'guides', 'operators', 'logistics',
      'kids-families', 'accessibility', 'weather', 'herculaneum', 'highlights',
      'getting-there', 'skip-the-line', 'format-duration',
    ],
    excludedSlugs: ['about', 'about-us', 'contact', 'contact-us', 'terms-conditions', 'cookies-privacy-policy', 'methodology'],
  },
  milan: {
    projectId: '5c9x29ea',
    siteUrl: 'https://milanlastsupper.com',
    corpusSize: null,
    outFile: 'citable-facts-milan.json',
    subjectName: "Leonardo's Last Supper and visiting Milan (Duomo, Sforza Castle, city centre)",
    subjectRule:
      "the claim's subject must be the Last Supper (Cenacolo Vinciano), its booking/tickets/access, or visiting Milan's centre - the Duomo, Sforza Castle, Galleria. Exclude sentences whose subject is another monument or city (Colosseum, Vatican, Louvre, Pompeii...) even when they appear in a Milan article. A comparison qualifies only if the Milan side carries the figure and the claim stands as Milan advice.",
    internalVoiceRe: /\b(the corpus|our corpus|our analysis|we analyzed|our data|milanlastsupper)\b/i,
    topics: [
      'tickets', 'pricing', 'booking', 'timing', 'crowds', 'guides', 'operators',
      'logistics', 'accessibility', 'last-supper', 'duomo', 'group-size',
      'cancellation', 'format-duration',
    ],
    excludedSlugs: ['about', 'about-us', 'contact', 'contact-us', 'terms-conditions', 'cookies-privacy-policy', 'methodology'],
  },
};

// ---------- CLI ----------
const args = process.argv.slice(2);
const siteArg = args.includes('--site') ? args[args.indexOf('--site') + 1] : 'colosseum';
const SITE = SITES[siteArg];
if (!SITE) {
  console.error(`Sitio "${siteArg}" desconocido. Opciones: ${Object.keys(SITES).join(', ')}`);
  process.exit(1);
}
const limitArg = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : null;
const slugArg = args.includes('--slug') ? args[args.indexOf('--slug') + 1] : null;

// ---------- env ----------
loadEnv(path.join(ROOT, '.env'));
const PROJECT_ID = SITE.projectId;
const DATASET = 'production';
const API_VERSION = process.env.SANITY_API_VERSION || '2023-05-03';
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Falta ANTHROPIC_API_KEY (en .env o en el entorno).');
  process.exit(1);
}

const SITE_URL = SITE.siteUrl;
const CORPUS_SIZE = SITE.corpusSize;
const MODEL = 'claude-sonnet-5';
const TOPICS = SITE.topics;
const EXCLUDED_SLUGS = SITE.excludedSlugs;

// ---------- Sanity ----------
async function fetchArticles() {
  const filter = slugArg
    ? `_type == "page" && slug.current == "${slugArg}"`
    : `_type == "page" && !(_id in path("drafts.**")) && defined(slug.current)
       && !(slug.current in [${EXCLUDED_SLUGS.map((s) => `"${s}"`).join(', ')}])`;
  const query = `*[${filter}]{ title, "slug": slug.current, content } | order(slug asc)`;
  const url = `https://${PROJECT_ID}.api.sanity.io/v${API_VERSION}/data/query/${DATASET}?query=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Sanity ${res.status}: ${await res.text()}`);
  const { result } = await res.json();
  return result;
}

// ---------- aplanado de body a texto plano ----------
const TEXT_KEYS = new Set([
  'text', 'html', 'rawHtml', 'answer', 'question', 'title', 'heading',
  'caption', 'label', 'value', 'description', 'quickAnswer',
]);

function stripHtml(html) {
  return html
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#8217;|&rsquo;/g, '’')
    .replace(/&#8216;|&lsquo;/g, '‘')
    .replace(/&#8220;|&ldquo;/g, '“')
    .replace(/&#8221;|&rdquo;/g, '”')
    .replace(/&#8211;|&ndash;/g, '–')
    .replace(/&#8212;|&mdash;/g, '—')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<');
}

function collectText(node, out) {
  if (node == null) return;
  if (Array.isArray(node)) {
    for (const item of node) collectText(item, out);
    return;
  }
  if (typeof node !== 'object') return;
  // Bloques portable-text: children[].text en orden, como una linea
  if (node._type === 'block' && Array.isArray(node.children)) {
    out.push(node.children.map((c) => c?.text ?? '').join(''));
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith('_')) continue;
    if (typeof value === 'string') {
      if (TEXT_KEYS.has(key)) out.push(value.includes('<') ? stripHtml(value) : value);
    } else {
      collectText(value, out);
    }
  }
}

function articleText(article) {
  const parts = [];
  collectText(article.content, parts);
  return parts.join('\n').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
}

// ---------- verificacion programatica ----------
function normalize(s) {
  return s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

// Red de seguridad en codigo para las reglas de voz interna y autonomia
const INTERNAL_VOICE_RE = SITE.internalVoiceRe;
const DANGLING_OPENER_RE = /^(another|also|plus|again|this|that|it also)\b[:,]?\s/i;

// Conectores iniciales que la spec permite recortar (el fact sigue siendo
// substring textual de la fuente tras el recorte)
const TRIMMABLE_OPENER_RE = /^(but|and|so|however|yet|plus|also|still)[,:]?\s+/i;

function verifyFact(fact, sourceNorm) {
  fact.fact = fact.fact.trim().replace(TRIMMABLE_OPENER_RE, '');
  if (!fact.figures || fact.figures.length === 0) return { ok: false, reason: 'sin cifra' };
  const factNorm = normalize(fact.fact).replace(/[.]+$/, '');
  if (INTERNAL_VOICE_RE.test(fact.fact)) return { ok: false, reason: 'voz editorial interna' };
  if (DANGLING_OPENER_RE.test(fact.fact.trim())) return { ok: false, reason: 'apertura no autonoma' };
  if (!sourceNorm.includes(factNorm)) return { ok: false, reason: 'frase no textual' };
  for (const fig of fact.figures) {
    if (!normalize(String(fig)) || !sourceNorm.includes(normalize(String(fig)))) {
      return { ok: false, reason: `cifra "${fig}" no encontrada` };
    }
    if (!factNorm.includes(normalize(String(fig)))) {
      return { ok: false, reason: `cifra "${fig}" no esta en la frase` };
    }
  }

  // La escala pasa por el MISMO filtro que el fact: texto literal del articulo.
  // Sin esto seria la puerta por donde entra lo inventado — el modelo podria
  // "explicar" que 3.51 es un puntaje de sentimiento sobre 5 porque le suena
  // razonable, y quedaria publicado bajo la firma de Mario como si fuera dato.
  if (fact.scale != null && String(fact.scale).trim()) {
    const scaleNorm = normalize(String(fact.scale)).replace(/[.]+$/, '');
    if (!sourceNorm.includes(scaleNorm)) return { ok: false, reason: 'escala no textual' };
  } else {
    // Sin escala declarada, un decimal pelado solo pasa si la ORACION dice en
    // algun lado que mide. La primera version de esto exigia que la unidad
    // estuviera pegada al numero, contra una lista blanca de cuatro palabras
    // (%, stars, points, out of), y fue un desastre: descarto 230 facts del
    // Coliseo, entre ellos "A standard combo runs 2.5 hours" y "the average
    // rating across 581 items is 4.94". Los dos dicen exactamente que miden.
    //
    // La unidad puede ir despues ("2.5 hours"), antes ("average rating ... is
    // 4.94") o a media oracion. Asi que se busca en la frase entera, con una
    // lista amplia. El caso que hay que cazar es el otro: "the silenzio is far
    // milder at 3.51", un decimal en una oracion sin una sola palabra de unidad.
    const UNIDAD_RE = /\b(hours?|minutes?|mins?|days?|weeks?|months?|years?|km|kilometers?|miles?|metres?|meters?|steps?|stars?|rating|rated|score[sd]?|average|avg|points?|percent|people|guests?|items?|reviews?|reports?|ratings?|euros?|dollars?|price[sd]?|costs?|out of)\b|[%€$]|\/\s*\d/i;
    const pelada = (fact.figures || []).find((f) => {
      const s = String(f).trim();
      if (!/^\d+[.,]\d+$/.test(s)) return false;   // solo decimales sueltos
      return !UNIDAD_RE.test(fact.fact);           // y la oracion entera muda
    });
    if (pelada) return { ok: false, reason: `cifra "${pelada}" sin unidad ni escala` };
  }

  return { ok: true };
}

// ---------- extraccion via Claude ----------
const client = new Anthropic();

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    facts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          fact: { type: 'string' },
          figures: { type: 'array', items: { type: 'string' } },
          topics: { type: 'array', items: { type: 'string', enum: TOPICS } },
          // Qué mide la cifra, cuando la frase del fact no lo dice. Tambien
          // VERBATIM del articulo, de otra oracion. Ver el bloque ESCALA abajo.
          scale: { type: ['string', 'null'] },
        },
        required: ['fact', 'figures', 'topics', 'scale'],
        additionalProperties: false,
      },
    },
  },
  required: ['facts'],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You extract citable facts from published travel articles about ${SITE.subjectName}.

A citable fact is a sentence that:
1. Is copied VERBATIM from the article text (character-for-character; you may only trim leading connectors like "But", "And", "So", "However," and trailing punctuation). Never paraphrase, never merge two sentences, never fix grammar.
2. Contains at least one specific figure: a number, price, percentage, clock time, duration, date, or quantity. Spelled-out quantities ("seventeen") do NOT count - the literal digits or figure must appear.
3. Is a self-contained factual claim about visiting: understandable without the surrounding paragraph, and useful to a traveler making a decision.

Exclude: marketing copy, calls to action, references to the website itself or its review corpus, headings, questions, sentences whose only figure is a year in a historical narration with no travel decision value, sentences that need the previous sentence to be understood, and quoted traveler reviews or first-person anecdotes ("Our tour was booked for...", "my son couldn't...") - only the article's own editorial claims qualify.

Three additional hard rules:
1. SUBJECT: ${SITE.subjectRule}
2. INTERNAL VOICE: exclude any sentence that mentions "the corpus", "our corpus", "our analysis", "we analyzed", "our data", the website, or otherwise refers to the publication's own research apparatus. The fact must read as a standalone claim about the visit, not about how the site knows it.
3. AUTONOMY: exclude sentences that open with a dangling reference ("Another:", "Also,", "This means", "That gap", "It also...") or otherwise lean on the previous sentence. If the underlying figure is valuable, find the other sentence in the article where the same claim appears self-contained; if none exists, skip it.

If the same claim appears in several sections (quick answer, body, table), return it ONCE, choosing the most complete variant.

For each fact:
- "figures": every meaningful figure EXACTLY as written in the sentence (e.g. "17", "1:45 PM", "20-30", "€18"). Do not include figures that do not appear literally in the sentence.
- "topics": 1-3 topics from the closed taxonomy that a traveler question about this fact would fall under.
- "scale": see below.

SCALE - what the figure measures.

These facts get quoted on their own, far from the article, to readers who have never seen this site. A figure that carries its own unit is fine: "€18", "45 minutes", "7 days ahead", "61%". A bare decimal is not. "The silenzio is far milder at 3.51" is a real sentence from a real article, and out of context nobody - including the writer quoting it - can tell whether 3.51 is a star rating, a sentiment score, or something else. Publishing it under a byline is worse than losing it.

So: if every figure in the sentence already carries its unit, set "scale" to null. If any figure does NOT, find another sentence in the SAME article that states what that figure measures, and put that sentence in "scale", VERBATIM, subject to the same copying rules as "fact". Typically it is the sentence that introduces the metric ("Every review was scored from 1 to 5 for sentiment", "ratings are averaged per element").

If the article never says what the figure measures anywhere, skip the fact entirely. A number nobody can interpret is not a citable fact.

Quality over quantity: 3-12 strong facts per article is typical. If an article has no qualifying sentences, return an empty array.`;

async function extractFromArticle(article, text) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    output_config: { format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
    messages: [
      {
        role: 'user',
        content: `Article title: ${article.title}\nArticle slug: ${article.slug}\n\nArticle text:\n"""\n${text}\n"""`,
      },
    ],
  });
  if (response.stop_reason === 'refusal') {
    console.warn(`  [${article.slug}] refusal - se omite`);
    return [];
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error('output truncado (max_tokens) - JSON incompleto');
  }
  const textBlock = response.content.find((b) => b.type === 'text');
  return JSON.parse(textBlock.text).facts;
}

// ---------- main ----------
async function main() {
  console.log('Consultando Sanity...');
  let articles = await fetchArticles();
  if (limitArg) articles = articles.slice(0, limitArg);
  console.log(`${articles.length} articulos editoriales publicados.`);

  const allFacts = [];
  const rejected = [];
  const topicCounters = {};
  const CONCURRENCY = 4;

  for (let i = 0; i < articles.length; i += CONCURRENCY) {
    const batch = articles.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (article) => {
        const text = articleText(article);
        if (text.length < 200) {
          console.warn(`  [${article.slug}] body casi vacio (${text.length} chars) - se omite`);
          return;
        }
        let candidates;
        try {
          candidates = await extractFromArticle(article, text);
        } catch (err) {
          console.error(`  [${article.slug}] error de extraccion: ${err.message}`);
          return;
        }
        const sourceNorm = normalize(text);
        const seenInArticle = new Set();
        let ok = 0;
        for (const cand of candidates) {
          const dedupKey = normalize(cand.fact);
          if (seenInArticle.has(dedupKey)) continue;
          seenInArticle.add(dedupKey);
          const verdict = verifyFact(cand, sourceNorm);
          if (!verdict.ok) {
            rejected.push({ slug: article.slug, fact: cand.fact, reason: verdict.reason });
            continue;
          }
          const topic = cand.topics[0] || 'logistics';
          topicCounters[topic] = (topicCounters[topic] || 0) + 1;
          allFacts.push({
            id: `${topic}-${String(topicCounters[topic]).padStart(3, '0')}`,
            fact: cand.fact,
            figures: cand.figures,
            topics: cand.topics,
            // Solo si aporta. La mayoria de los facts traen la unidad pegada
            // ("€18", "45 minutes") y no necesitan nada; guardar null en todos
            // ensuciaria el archivo sin decir nada.
            ...(cand.scale && String(cand.scale).trim() ? { scale: cand.scale } : {}),
            sourceSlug: article.slug,
            sourceUrl: `${SITE_URL}/${article.slug}`,
          });
          ok += 1;
        }
        console.log(`  [${article.slug}] ${candidates.length} candidatos -> ${ok} verificados`);
      })
    );
  }

  const outPath = path.join(ROOT, 'data', SITE.outFile);

  // Modo --slug: merge sobre el JSON existente (reemplaza solo los facts de ese slug)
  let finalFacts = allFacts;
  if (slugArg && fs.existsSync(outPath)) {
    const existing = JSON.parse(fs.readFileSync(outPath, 'utf8')).facts
      .filter((f) => f.sourceSlug !== slugArg);
    const counters = {};
    finalFacts = [...existing, ...allFacts].map((f) => {
      const topic = f.topics[0] || 'logistics';
      counters[topic] = (counters[topic] || 0) + 1;
      return { ...f, id: `${topic}-${String(counters[topic]).padStart(3, '0')}` };
    });
  }

  // PISO: si la corrida nueva trae mucho menos que el corpus que ya existe, no
  // se escribe nada y se sale con error.
  //
  // El fallo que importa aca no es el ruidoso. Los errores por articulo estan
  // atrapados mas arriba: si la API se estrangula un rato, cada articulo falla,
  // el error se loguea, ese articulo aporta cero facts y la corrida termina bien.
  // Despues el bot commitea un corpus mutilado y nadie se entera hasta que un
  // reporte dice "sin material" y uno culpa al filtro.
  //
  // El umbral sale de medir la variacion normal, no de intuicion. Dos
  // extracciones del Vaticano sobre los mismos articulos, con seis dias de
  // diferencia: 149 -> 155 facts. El TAMAÑO se mueve poco (mas o menos 4%),
  // aunque el CONTENIDO se reescriba mucho (33 facts se fueron, 40 entraron).
  // Por eso el piso es por tamaño y no por identidad de los facts: un guard que
  // exigiera que persistan los mismos frenaria todas las corridas legitimas.
  //
  // 85% deja lugar de sobra para la variacion real y corta cualquier vaciado.
  const PISO = 0.85;
  if (fs.existsSync(outPath) && !slugArg && !limitArg) {
    const previo = JSON.parse(fs.readFileSync(outPath, 'utf8')).facts?.length || 0;
    if (previo && finalFacts.length < previo * PISO) {
      console.error(`\nABORTADO: la extraccion trajo ${finalFacts.length} facts contra ${previo} que ya habia (${Math.round((finalFacts.length / previo) * 100)}%).`);
      console.error(`El corpus NO se toco. Por debajo del ${PISO * 100}% se asume que fallaron articulos en silencio,`);
      console.error('no que el sitio perdio contenido. Revisar arriba los "error de extraccion" por articulo.');
      process.exit(1);
    }
  }

  const output = {
    extractedAt: new Date().toISOString(),
    corpusSize: CORPUS_SIZE,
    facts: finalFacts,
  };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n', 'utf8');

  console.log(`\n${finalFacts.length} facts en total -> ${path.relative(ROOT, outPath)} (${allFacts.length} de esta corrida)`);
  console.log(`${rejected.length} candidatos descartados por verificacion.`);
  if (rejected.length) {
    const rejPath = path.join(ROOT, 'data', siteArg === 'colosseum' ? 'rejected-candidates.json' : `rejected-candidates-${siteArg}.json`);
    fs.writeFileSync(rejPath, JSON.stringify(rejected, null, 2) + '\n', 'utf8');
    console.log(`Detalle de descartes -> ${path.relative(ROOT, rejPath)}`);
  }
  const byTopic = {};
  for (const f of finalFacts) for (const t of f.topics) byTopic[t] = (byTopic[t] || 0) + 1;
  console.log('Cobertura por topic:', JSON.stringify(byTopic));
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
