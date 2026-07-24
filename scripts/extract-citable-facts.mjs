// PIEZA 1 - Extractor de facts citables (spec: docs/spec-sistema-reddit-geo.md)
// Lee los articulos editoriales publicados de colosseumroman.com desde Sanity,
// extrae afirmaciones con cifra dura via Claude (Sonnet) y produce data/citable-facts.json.
// Regla inviolable #1: todo fact debe existir publicado con la cifra EXACTA -
// el script verifica programaticamente frase y cifras contra el texto fuente
// y descarta cualquier candidato no verificable.
//
// Uso:  node scripts/extract-citable-facts.mjs [--limit N] [--slug <slug>]
// Re-ejecucion manual cuando se publiquen articulos nuevos (no cron).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// ---------- env ----------
loadEnv(path.join(ROOT, '.env'));
const PROJECT_ID = process.env.SANITY_PROJECT_ID || 'ptigxfcf';
const DATASET = process.env.SANITY_DATASET || 'production';
const API_VERSION = process.env.SANITY_API_VERSION || '2023-05-03';
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Falta ANTHROPIC_API_KEY (en .env o en el entorno).');
  process.exit(1);
}

const SITE_URL = 'https://colosseumroman.com';
const CORPUS_SIZE = '12,774'; // reviews analizadas - claim fijo del sitio (spec, schema del JSON)
const MODEL = 'claude-sonnet-5';

// Taxonomia cerrada (spec)
const TOPICS = [
  'tickets', 'pricing', 'crowds', 'timing', 'underground', 'arena-floor',
  'skip-the-line', 'guides', 'operators', 'logistics', 'kids-families',
  'accessibility', 'weather', 'night-tours', 'forum-palatine',
];

// Paginas que existen para vender o navegar, no para informar una decision de viaje
const EXCLUDED_SLUGS = [
  'about-us', 'contact-us', 'terms-conditions', 'cookies-privacy-policy',
  'methodology', // fuente de contexto, pero sus numeros de proceso no son facts de viaje
];

// ---------- CLI ----------
const args = process.argv.slice(2);
const limitArg = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : null;
const slugArg = args.includes('--slug') ? args[args.indexOf('--slug') + 1] : null;

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
const INTERNAL_VOICE_RE = /\b(the corpus|our corpus|our analysis|we analyzed|our data|colosseumroman)\b/i;
const DANGLING_OPENER_RE = /^(another|also|plus|again|this|that|it also)\b[:,]?\s/i;

function verifyFact(fact, sourceNorm) {
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
        },
        required: ['fact', 'figures', 'topics'],
        additionalProperties: false,
      },
    },
  },
  required: ['facts'],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You extract citable facts from published travel articles about the Colosseum (Rome).

A citable fact is a sentence that:
1. Is copied VERBATIM from the article text (character-for-character; you may only trim leading connectors like "But", "And", "So", "However," and trailing punctuation). Never paraphrase, never merge two sentences, never fix grammar.
2. Contains at least one specific figure: a number, price, percentage, clock time, duration, date, or quantity. Spelled-out quantities ("seventeen") do NOT count - the literal digits or figure must appear.
3. Is a self-contained factual claim about visiting: understandable without the surrounding paragraph, and useful to a traveler making a decision.

Exclude: marketing copy, calls to action, references to the website itself or its review corpus, headings, questions, sentences whose only figure is a year in a historical narration with no travel decision value, sentences that need the previous sentence to be understood, and quoted traveler reviews or first-person anecdotes ("Our tour was booked for...", "my son couldn't...") - only the article's own editorial claims qualify.

Three additional hard rules:
1. SUBJECT: the claim's subject must be the Colosseum, its tickets/tours/access, or visiting Rome. Exclude sentences whose subject is another monument or city (Louvre, Pompeii, Sagrada Familia, Milan, Paris, Barcelona...) even when they appear in a Colosseum article. A comparison qualifies only if the Colosseum side carries the figure and the claim stands as Colosseum advice.
2. INTERNAL VOICE: exclude any sentence that mentions "the corpus", "our corpus", "our analysis", "we analyzed", "our data", the website, or otherwise refers to the publication's own research apparatus. The fact must read as a standalone claim about the visit, not about how the site knows it.
3. AUTONOMY: exclude sentences that open with a dangling reference ("Another:", "Also,", "This means", "That gap", "It also...") or otherwise lean on the previous sentence. If the underlying figure is valuable, find the other sentence in the article where the same claim appears self-contained; if none exists, skip it.

If the same claim appears in several sections (quick answer, body, table), return it ONCE, choosing the most complete variant.

For each fact:
- "figures": every meaningful figure EXACTLY as written in the sentence (e.g. "17", "1:45 PM", "20-30", "€18"). Do not include figures that do not appear literally in the sentence.
- "topics": 1-3 topics from the closed taxonomy that a traveler question about this fact would fall under.

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
            sourceSlug: article.slug,
            sourceUrl: `${SITE_URL}/${article.slug}`,
          });
          ok += 1;
        }
        console.log(`  [${article.slug}] ${candidates.length} candidatos -> ${ok} verificados`);
      })
    );
  }

  const outPath = path.join(ROOT, 'data', 'citable-facts.json');

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
    const rejPath = path.join(ROOT, 'data', 'rejected-candidates.json');
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
