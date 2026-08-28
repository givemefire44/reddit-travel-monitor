// Chequea contra la web las afirmaciones que NO tienen un fact del corpus atras.
//
// POR QUE EXISTE
//
// El 28 ago 2026 se publico en r/rome que pagar el servicio de mesa en un bar
// italiano "te compra la mesa" y que podes quedarte todo lo que quieras. En
// Italia no existe un derecho de mesa: hay una tarifa mas alta por consumir
// sentado, que te habilita a consumir sentado y no a ocupar la mesa ocho horas,
// y cuanto te dejan quedarte lo decide cada bar. Mario lo cazo despues de
// publicado.
//
// El comentario era de carril karma, o sea sin corpus. Y ahi esta el agujero: la
// regla "toda cifra sale de un fact" cubre los numeros, y el resto de la frase
// no la cubre nadie. Sin un fact atras, lo que se afirma sale de conocimiento
// general, y el conocimiento general se redondea solo hacia la REGLA LIMPIA,
// que se lee mejor y por eso se cuela. "Depende del bar" es la version cierta y
// la que uno no escribe.
//
// COMO FUNCIONA
//
// Tres pasos, y el del medio es el unico que sale de la maquina:
//
//   1. Un pase extrae del borrador las afirmaciones CHEQUEABLES: como funciona
//      algo, cuanto cuesta, que esta permitido. No las opiniones, no las
//      recomendaciones, no lo que conto quien pregunto.
//   2. Una consulta a Brave por afirmacion.
//   3. Un pase lee los snippets contra la afirmacion y dicta: respaldada,
//      contradicha, depende, o sin evidencia.
//
// QUE NO HACE
//
// No reescribe, no decide si publicar, y no reemplaza al corpus: si un dato esta
// en el corpus, la fuente es el corpus y punto. Esto es para el hueco que el
// corpus no cubre, que en carril karma es el comentario entero.
//
// Y no convierte la web en verdad. Un "sin evidencia" no prueba que sea falso;
// dice que lo estas afirmando sin nada abajo, que en una frase absoluta ya es
// motivo suficiente para bajarle el tono.

import Anthropic from '@anthropic-ai/sdk';

let _client = null;
const cliente = () => (_client ||= new Anthropic());

const MODEL = process.env.VERIFICAR_MODEL || 'claude-sonnet-5';
const MAX_AFIRMACIONES = 6;
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

const SCHEMA_EXTRAER = {
  type: 'object',
  properties: {
    afirmaciones: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          texto: { type: 'string' },
          absoluta: { type: 'boolean' },
          consulta: { type: 'string' },
        },
        required: ['texto', 'absoluta', 'consulta'],
        additionalProperties: false,
      },
    },
  },
  required: ['afirmaciones'],
  additionalProperties: false,
};

const SCHEMA_JUZGAR = {
  type: 'object',
  properties: {
    veredicto: { type: 'string', enum: ['respaldada', 'contradicha', 'depende', 'sin-evidencia'] },
    motivo: { type: 'string' },
  },
  required: ['veredicto', 'motivo'],
  additionalProperties: false,
};

const PROMPT_EXTRAER = `You are given a comment written to be posted publicly under a real person's name. Pull out the statements of fact that a reader could go and check, and that would embarrass the author if wrong.

Include: how something works, what is allowed or required, what something costs, what a place or institution does, what happens if you do X.

Exclude: opinions and recommendations ("I would take February"), anything the asker themselves said, statements about the author, and pure suggestions to go and look at something.

"absoluta": true when the statement admits no exception - it says always, never, nobody, anyone, as long as you like, you can't, it's free, there is no. These are the dangerous ones: a claim that is true most of the time becomes false the moment it is written as a rule.

"consulta": a short web search query in English that would settle it, written the way you would actually search. Not a question, just the terms.

At most ${MAX_AFIRMACIONES} claims, the most checkable and most load-bearing first. If the comment makes no checkable claim, return an empty list, which is a normal outcome.`;

function promptJuzgar(afirmacion) {
  return `A comment is about to be published. This is one factual claim from it:

"${afirmacion}"

Below are web search results. Judge the claim against them ONLY. Do not use what you already believe.

- "respaldada": the results say the same thing.
- "contradicha": the results say otherwise. Say what they say instead.
- "depende": the results show it varies by place, by operator, by season, or by case. This is the verdict that matters most, because it is the one a clean-sounding sentence hides.
- "sin-evidencia": the results do not settle it either way.

"motivo": one short line in Spanish. If contradicha or depende, say what the correct version is, concretely enough to rewrite the sentence with it.`;
}

async function buscar(consulta, apiKey) {
  const url = `https://api.search.brave.com/res/v1/web/search?count=5&q=${encodeURIComponent(consulta)}`;
  for (let i = 0; i < 3; i++) {
    const r = await fetch(url, { headers: { 'X-Subscription-Token': apiKey, Accept: 'application/json' } });
    if (r.status === 429) { await esperar(3000); continue; }
    if (!r.ok) return null;
    const j = await r.json();
    return (j.web?.results || []).map((x) => ({
      titulo: x.title || '',
      texto: (x.description || '').replace(/<[^>]+>/g, ''),
      dominio: (x.meta_url?.hostname || x.url || '').replace(/^https?:\/\//, '').split('/')[0],
    }));
  }
  return null;
}

export async function verificarAfuera(texto, respaldados = []) {
  const apiKey = process.env.BRAVE_API_KEY;
  if (!apiKey) return { ok: false, error: 'falta BRAVE_API_KEY en .env', items: [] };

  // Lo que el corpus ya sostiene no se sale a buscar. Si un dato esta publicado
  // en el sitio, la fuente es el sitio, y mandarlo a Brave solo agrega ruido:
  // una medicion propia sobre 5.657 reseñas no la va a "respaldar" ninguna
  // pagina de terceros, y volveria como "sin evidencia" sobre el unico material
  // que si esta verificado.
  const sistema = respaldados.length
    ? `${PROMPT_EXTRAER}\n\nThe author's own published research already supports the statements below. Do NOT extract any claim that these already cover: it is sourced, and checking it against random web pages would be worse evidence, not better.\n\n${respaldados.map((f) => `- ${f}`).join('\n')}`
    : PROMPT_EXTRAER;

  let afirmaciones = [];
  try {
    const res = await cliente().messages.create({
      model: MODEL,
      max_tokens: 900,
      system: sistema,
      tools: [{ name: 'responder', description: 'Devolver las afirmaciones', input_schema: SCHEMA_EXTRAER }],
      tool_choice: { type: 'tool', name: 'responder' },
      messages: [{ role: 'user', content: texto }],
    });
    // El input de una tool lo escribe el modelo y la API NO lo valida contra el
    // schema. Con este prompt devuelve, a veces, la lista como strings sueltos
    // en vez de objetos: `{...unString}` da un objeto indexado por caracter, y
    // entonces `texto` y `consulta` quedan undefined. El sintoma fue una corrida
    // que busco en Brave, seis veces, la palabra "undefined", y devolvio seis
    // veredictos sobre el significado de undefined en JavaScript.
    //
    // Se normaliza en vez de confiar: un string vale como afirmacion, un objeto
    // sin texto se descarta. Vale para cualquier tool_use, no solo para esta.
    // Y no solo los items: el CAMPO mismo vuelve con otra forma a veces. Visto
    // en dos corridas seguidas: una lo dio como array de objetos (lo correcto),
    // otra como array de strings, otra como un string con el JSON adentro. Nada
    // de eso es un bug del modelo, es lo que significa que la API no valide el
    // schema: lo que viene es una sugerencia, no un contrato.
    let crudas = res.content.find((c) => c.type === 'tool_use')?.input?.afirmaciones;
    if (typeof crudas === 'string') {
      try { crudas = JSON.parse(crudas); } catch { crudas = [crudas]; }
    }
    if (!Array.isArray(crudas)) crudas = crudas && typeof crudas === 'object' ? Object.values(crudas) : [];
    afirmaciones = crudas
      .map((a) => (typeof a === 'string' ? { texto: a, absoluta: false, consulta: a } : a))
      .filter((a) => a && typeof a.texto === 'string' && a.texto.trim())
      .map((a) => ({
        texto: a.texto.trim(),
        absoluta: Boolean(a.absoluta),
        consulta: String(a.consulta || a.texto).trim(),
      }))
      .slice(0, MAX_AFIRMACIONES);
  } catch (e) {
    return { ok: false, error: `extraccion: ${e.message.slice(0, 90)}`, items: [] };
  }

  if (!afirmaciones.length) return { ok: true, items: [] };

  const items = [];
  for (const a of afirmaciones) {
    const resultados = await buscar(a.consulta, apiKey);
    await esperar(1200); // mismo respiro que buscar-reddit.mjs
    if (!resultados || !resultados.length) {
      items.push({ ...a, veredicto: 'sin-evidencia', motivo: 'la busqueda no devolvio resultados', fuentes: [] });
      continue;
    }
    const contexto = resultados.map((r, i) => `[${i + 1}] ${r.dominio}: ${r.titulo}\n${r.texto}`).join('\n\n');
    try {
      const res = await cliente().messages.create({
        model: MODEL,
        max_tokens: 400,
        system: promptJuzgar(a.texto),
        tools: [{ name: 'responder', description: 'Devolver el veredicto', input_schema: SCHEMA_JUZGAR }],
        tool_choice: { type: 'tool', name: 'responder' },
        messages: [{ role: 'user', content: contexto }],
      });
      const out = res.content.find((c) => c.type === 'tool_use')?.input;
      items.push({
        ...a,
        veredicto: out?.veredicto || 'sin-evidencia',
        motivo: out?.motivo || '-',
        fuentes: [...new Set(resultados.map((r) => r.dominio))].slice(0, 3),
      });
    } catch (e) {
      items.push({ ...a, veredicto: 'sin-evidencia', motivo: `error: ${e.message.slice(0, 60)}`, fuentes: [] });
    }
  }
  return { ok: true, items };
}
