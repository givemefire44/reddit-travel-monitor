// Huella de estilo de un texto publicado.
//
// Existe por un caso real: las cuatro primeras respuestas de Quora publicadas el
// 22 ago 2026 arrancaban un parrafo con la misma bisagra, cuatro veces:
//   "Something worth knowing about the queue you are trying to avoid"
//   "One thing worth knowing before you plan the day"
//   "One thing I would gently talk you out of"
//   "Then there is the part most answers leave out"
// Ninguna comparte 8 palabras seguidas con otra, asi que el detector de shingles
// que ya existia en el ledger no las vio. Lo que comparten es el ESQUELETO del
// arranque de frase, y eso es lo que un lector atento reconoce como plantilla —
// y lo que una plataforma puede pesar por historial de autor.
//
// Por eso hay dos detectores y no uno:
//
//   shingles  — 8 palabras consecutivas, en cualquier posicion. Caza el parrafo
//               reciclado o reescrito a medias. Es el que ya existia.
//   aperturas — bigramas de las primeras 5 palabras de cada oracion, sacando las
//               palabras de contenido. Caza la MULETILLA: la misma construccion
//               con otro relleno. Es el que faltaba.

import crypto from 'node:crypto';

const h = (s) => crypto.createHash('md5').update(s).digest('hex').slice(0, 10);

const palabras = (t) => t.toLowerCase().replace(/[^a-z0-9\s']+/g, ' ').split(/\s+/).filter(Boolean);

// Palabras de CONTENIDO del dominio. Un bigrama que las contiene habla del tema,
// no del estilo: "standard ticket" repetido en dos respuestas sobre entradas no
// es una muletilla, es el sustantivo del asunto. Sacarlas es lo que deja el
// esqueleto a la vista.
const CONTENIDO = new Set([
  'ticket', 'tickets', 'colosseum', 'vatican', 'forum', 'palatine', 'sistine', 'basilica',
  'peter', "peter's", 'museum', 'museums', 'arena', 'underground', 'hypogeum', 'entry',
  'queue', 'queues', 'line', 'lines', 'tour', 'tours', 'guide', 'guides', 'price', 'prices',
  'euro', 'euros', 'hour', 'hours', 'minute', 'minutes', 'day', 'days', 'week', 'weeks',
  'month', 'months', 'rome', 'roman', 'italy', 'security', 'slot', 'slots', 'floor',
  'official', 'site', 'online', 'door', 'gate', 'skywalk', 'dome', 'chapel', 'trastevere',
]);

// Palabras funcionales. Un bigrama hecho solo de estas no distingue a nadie.
const FUNCION = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'so', 'as', 'at', 'by', 'of', 'to', 'in', 'on',
  'for', 'with', 'from', 'that', 'this', 'these', 'those', 'it', 'its', 'is', 'are', 'was',
  'were', 'be', 'been', 'being', 'you', 'your', 'i', 'we', 'they', 'them', 'he', 'she',
  'do', 'does', 'did', 'have', 'has', 'had', 'will', 'would', 'can', 'could', 'should',
  'not', 'no', 'there', 'here', 'what', 'which', 'when', 'where', 'how', 'than', 'then',
  'up', 'out', 'off', 'over', 'into', 'about', 'all', 'any', 'some', 'more', 'most',
]);

export function shingles(texto, n = 8) {
  const w = palabras(texto);
  const out = new Set();
  for (let i = 0; i + n <= w.length; i++) out.add(h(w.slice(i, i + n).join(' ')));
  return [...out];
}

export function aperturas(texto) {
  // Se corta por oracion Y por parrafo: la muletilla suele abrir parrafo, y un
  // parrafo de una sola linea sin punto final igual cuenta.
  const oraciones = texto
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 12);

  const out = new Set();
  for (const o of oraciones) {
    const w = palabras(o).slice(0, 5);
    for (let i = 0; i + 2 <= w.length; i++) {
      const par = w.slice(i, i + 2);
      // Un bigrama con contenido del dominio habla del tema. Se descarta.
      if (par.some((x) => CONTENIDO.has(x))) continue;
      // Un bigrama de dos palabras funcionales puras ("that is", "you are") no
      // es una huella de nadie: es ingles. La senal esta cuando al menos una de
      // las dos aporta algo — "worth knowing", "one thing", "thing i".
      if (par.every((x) => FUNCION.has(x))) continue;
      if (par.some((x) => /^\d/.test(x))) continue;
      out.add(par.join(' '));
    }
  }
  return [...out];
}

export function huella(texto) {
  return { shingles: shingles(texto), aperturas: aperturas(texto) };
}

// Compara un borrador contra los textos ya publicados.
// Devuelve { verbatim: [...], muletillas: [{frase, veces, donde:[titulos]}] }
export function contraPublicados(texto, publicados) {
  const mio = huella(texto);
  const setSh = new Set(mio.shingles);

  const verbatim = [];
  for (const p of publicados) {
    const comunes = (p.shingles || []).filter((s) => setSh.has(s)).length;
    if (comunes) verbatim.push({ titulo: p.titulo || p.url, comunes });
  }

  // Una apertura que aparece en UNA publicada ya es una repeticion, pero es
  // normal que dos textos compartan alguna por azar. La senal fuerte es la que
  // se repite en DOS o mas: ahi ya no es coincidencia, es muletilla.
  const cuenta = new Map();
  for (const a of mio.aperturas) {
    const donde = publicados.filter((p) => (p.aperturas || []).includes(a));
    if (donde.length) cuenta.set(a, donde.map((p) => p.titulo || p.url));
  }
  const muletillas = [...cuenta.entries()]
    .map(([frase, donde]) => ({ frase, veces: donde.length, donde }))
    .sort((a, b) => b.veces - a.veces);

  return { verbatim, muletillas };
}
