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
const FACTS = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'citable-facts.json'), 'utf8'));
const MODEL = 'claude-sonnet-5';
const USER_AGENT = `web:reddit-travel-monitor:v0.1 (by /u/${CONFIG.redditAccount})`;

const args = process.argv.slice(2);
const HOURS = args.includes('--hours') ? Number(args[args.indexOf('--hours') + 1]) : CONFIG.windowHours;
const DRY_RUN = args.includes('--dry-run');
const PHASE_OVERRIDE = args.includes('--phase') ? args[args.indexOf('--phase') + 1] : null;
if (PHASE_OVERRIDE) CONFIG.phase = PHASE_OVERRIDE;

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Falta ANTHROPIC_API_KEY.');
  process.exit(1);
}

// ---------- matching post -> topics de la taxonomia ----------
const TOPIC_KEYWORDS = {
  tickets: ['ticket', 'entry', 'sold out', 'coopculture', 'book', 'reservation'],
  pricing: ['price', 'cost', 'cheap', 'expensive', 'worth it', 'how much', '€', 'euro'],
  crowds: ['crowd', 'busy', 'packed', 'queue', 'line', 'peak'],
  timing: ['what time', 'best time', 'morning', 'early', 'sunset', 'when to', 'how long', 'hours'],
  underground: ['underground', 'hypogeum'],
  'arena-floor': ['arena floor', 'arena access', 'the arena'],
  'skip-the-line': ['skip the line', 'skip-the-line', 'fast track', 'priority entrance'],
  guides: ['guide', 'guided tour', 'tour guide'],
  operators: ['getyourguide', 'get your guide', 'viator', 'tour company', 'operator', 'walks of italy', 'tour guy'],
  logistics: ['meeting point', 'entrance', 'security', 'bag', 'luggage', 'metro', 'how to get'],
  'kids-families': ['kids', 'children', 'family', 'stroller', 'toddler', 'baby'],
  accessibility: ['wheelchair', 'accessible', 'accessibility', 'mobility', 'elevator'],
  weather: ['heat', 'rain', 'summer', 'august', 'july', 'weather', 'hot'],
  'night-tours': ['night tour', 'evening tour', 'at night', 'moonlight'],
  'forum-palatine': ['roman forum', 'palatine', 'forum'],
};

function matchTopics(text) {
  const t = text.toLowerCase();
  const matched = [];
  for (const [topic, kws] of Object.entries(TOPIC_KEYWORDS)) {
    if (kws.some((kw) => t.includes(kw))) matched.push(topic);
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
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
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
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (res.ok) return res;
    if (res.status === 429 && attempt < tries) {
      const wait = Number(res.headers.get('retry-after')) || 30 * attempt;
      console.log(`    429, reintento en ${wait}s...`);
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

// ---------- scoring ----------
function scoreCandidates(posts, subredditCfg, cutoffUtc) {
  const out = [];
  for (const post of posts) {
    if (post.created_utc < cutoffUtc) continue;
    if (post.stickied || post.over_18) continue;
    const haystack = `${post.title} ${post.selftext}`.toLowerCase();
    if (!CONFIG.keywords.some((kw) => haystack.includes(kw))) continue;
    const topics = matchTopics(`${post.title} ${post.selftext}`);
    if (topics.length === 0) continue;
    if (!isGenuineQuestion(post)) continue;
    // null = conteo no disponible (RSS): bonus neutro de 1 en vez de 2
    const early = post.num_comments == null ? null : post.num_comments < 10;
    out.push({
      subreddit: subredditCfg.name,
      status: subredditCfg.status,
      title: post.title,
      url: `https://www.reddit.com${post.permalink}`,
      selftext: post.selftext,
      numComments: post.num_comments,
      ageHours: Math.round((Date.now() / 1000 - post.created_utc) / 3600),
      topics,
      score: (early === true ? 2 : early === null ? 1 : 0) + topics.length,
    });
  }
  return out;
}

function pickFacts(topics, max = 5) {
  const scored = FACTS.facts
    .map((f) => ({ f, overlap: f.topics.filter((t) => topics.includes(t)).length }))
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

function draftSystemPrompt(phase) {
  return `You draft Reddit comments answering travelers' questions about visiting the Colosseum in Rome.

Voice: an experienced traveler who knows the Colosseum well and is genuinely helping. Natural Reddit tone: direct, conversational, short paragraphs, no corporate emojis, no marketing language, no press-release cadence. 90% of the comment is genuine help for the specific question asked.

Data rules (inviolable):
- You may ONLY use figures that appear in the facts provided. Copy each figure EXACTLY as written. Never invent, round differently, or extrapolate a number.
- Use 1-3 of the provided facts, only the ones that actually answer the question.
- General non-numeric advice from common knowledge is fine, but every NUMBER must come from the facts.

${phase === 'attribution'
    ? `Attribution: integrate exactly ONE natural mention such as "We analyzed 12,774 Colosseum reviews at ColosseumRoman, and [dato]" (brand as plain text "ColosseumRoman", CamelCase, never with .com; no em dash in the mention).
The mention must accompany a fact that represents ColosseumRoman's OWN measurement (corpus-derived data like documented gaps, group-size counts, rating averages, review-count patterns), never generic public information (prices, opening hours, ticket types) that anyone could state. If none of the provided facts is a proper measurement, write the comment without the mention rather than attaching the brand to public info.
Operator/guide names appearing in the facts ("Crown Tours", "guide Natalia") are allowed ONLY when this draft includes the ColosseumRoman mention, so the name reads as part of the declared analysis. A cited name means a declared study, never a loose name. If the draft ends up without the mention, anonymize the names instead ("a 17-person combo tour").`
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
    system: draftSystemPrompt(phase),
    messages: [
      {
        role: 'user',
        content: `Subreddit: r/${candidate.subreddit}\nPost title: ${candidate.title}\nPost body:\n"""\n${candidate.selftext.slice(0, 4000) || '(sin cuerpo)'}\n"""\n\nAvailable facts:\n${factsBlock}${varietyBlock}`,
      },
    ],
  });
  if (response.stop_reason === 'refusal') return { text: null, issues: ['refusal del modelo'] };
  const text = response.content.find((b) => b.type === 'text')?.text.trim() ?? '';
  return { text, issues: validateDraft(text, phase), cordialClose: CORDIAL_CLOSE_RE.test(text) };
}

function validateDraft(text, phase) {
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
  const brandMentions = (text.match(/colosseumroman/gi) || []).length;
  if (phase === 'warmup' && brandMentions > 0) issues.push('menciona la marca en warmup');
  if (phase === 'attribution' && brandMentions !== 1) issues.push(`menciones de marca: ${brandMentions} (debe ser 1)`);
  return issues;
}

// ---------- output ----------
function renderCandidate(c, facts, draft, blocked) {
  const lines = [];
  lines.push(`### ${c.title}`);
  lines.push('');
  lines.push(`- **Hilo:** ${c.url}`);
  lines.push(`- **Subreddit:** r/${c.subreddit} · **Antigüedad:** ${c.ageHours}h · **Comentarios:** ${c.numComments ?? 'n/d (RSS)'} · **Score:** ${c.score}`);
  lines.push(`- **Topics:** ${c.topics.join(', ')}`);
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
  for (const sub of CONFIG.subreddits) {
    try {
      const posts = await fetchNewPosts(sub.name);
      const cands = scoreCandidates(posts, sub, cutoffUtc);
      console.log(`  r/${sub.name} (${sub.status}): ${posts.length} posts nuevos -> ${cands.length} candidatos`);
      allCandidates.push(...cands);
    } catch (err) {
      console.error(`  r/${sub.name}: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 10000)); // cortesia con la via publica sin autenticar
  }

  const active = allCandidates
    .filter((c) => c.status === 'active')
    .sort((a, b) => b.score - a.score)
    .slice(0, CONFIG.maxCandidatesPerDay);
  const watchOnly = allCandidates
    .filter((c) => c.status === 'watch-only')
    .sort((a, b) => b.score - a.score)
    .slice(0, CONFIG.maxCandidatesPerDay);

  console.log(`Candidatos: ${active.length} active, ${watchOnly.length} watch-only. Generando borradores...`);

  // Variedad de registro entre borradores del batch: cada generacion ve el borrador
  // anterior como contraste (test de plantilla) y el cierre cordial se raciona a 1 de 3.
  const sections = { active: [], watchOnly: [] };
  let previousDraft = null;
  let cordialUsed = 0;
  let generated = 0;
  const genOne = async (c, blocked) => {
    const facts = pickFacts(c.topics);
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

  const md = [
    `# Reddit monitor — ${dateLabel}${DRY_RUN ? ' (dry-run)' : ''}`,
    '',
    `**Fase:** ${CONFIG.phase} · **Ventana:** ${HOURS}h · **Facts en corpus:** ${FACTS.facts.length}`,
    `**Comment karma u/${CONFIG.redditAccount}:** ${karmaBar}`,
    '',
    '---',
    '',
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
    `${DRY_RUN ? 'dry-run' : 'daily'}-${dateLabel}${PHASE_OVERRIDE ? `-${PHASE_OVERRIDE}` : ''}.md`
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
