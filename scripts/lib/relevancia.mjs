// Decide si un post se puede contestar con nuestro material, preguntandoselo al
// modelo en vez de buscar palabras en una lista.
//
// POR QUE EXISTE
//
// El filtro original decidia con listas escritas a mano: 31 keywords por sitio,
// una taxonomia de topics, y umbrales de cuantos facts. Eso obliga a adivinar de
// antemano como va a escribir la gente, y la gente escribe de infinitas maneras.
//
// El caso que lo dejo claro (25 ago 2026): un post de r/rome pedia "food
// recommendations" y salio marcado "sin corpus" con 70 facts de Trastevere
// disponibles, porque la lista tenia "where to eat in rome" y no "food
// recommendations". El arreglo fue agregar doce frases mas a la lista. El
// siguiente post que use otra forma va a fallar igual.
//
// Eso no converge. Cada corrida producia un parche del MISMO bug, y Mario se
// paso tres dias renegando con ajustes en vez de contestar preguntas.
//
// Aca la pregunta es la correcta: "¿esto se puede contestar con material sobre
// X?" — que es lo que un humano evalua en dos segundos y una lista de strings no
// puede evaluar nunca.
//
// QUE NO HACE
//
// No redacta, no elige facts y no decide si vale la pena contestar. Solo dice si
// hay material y de que sitio. El triage sigue siendo humano.

import Anthropic from '@anthropic-ai/sdk';

// El cliente se crea al primer uso y no al importar. Los imports de un modulo ES
// se evaluan ANTES del cuerpo del que importa, asi que un `new Anthropic()` a
// nivel de modulo lee el entorno antes de que el script haya cargado el .env, y
// falla con "Could not resolve authentication method" teniendo la clave ahi.
let _client = null;
const cliente = () => (_client ||= new Anthropic());

// Modelo chico a proposito: es una clasificacion binaria con justificacion, no
// requiere razonamiento profundo, y corre sobre 50-100 posts por dia.
const MODEL = process.env.RELEVANCIA_MODEL || 'claude-haiku-4-5-20251001';

const SCHEMA = {
  type: 'object',
  properties: {
    // Que preguntan, ANTES de decidir si lo cubrimos. Van separados a proposito:
    // ver el bloque "pregunta" en el prompt.
    pregunta: { type: 'string' },
    sitio: { type: ['string', 'null'] },
    contestable: { type: 'boolean' },
    porque: { type: 'string' },
    temas: { type: 'array', items: { type: 'string' } },
  },
  required: ['pregunta', 'sitio', 'contestable', 'porque', 'temas'],
  additionalProperties: false,
};

function prompt(sitios) {
  return `You decide whether a Reddit post can be answered from a specific body of published research, and from which one.

The available bodies of research are:

${sitios.map((s) => `- "${s.key}": ${s.descripcion}`).join('\n')}

Answer "contestable": true ONLY if the post asks something these materials actually cover. The test is not whether the post mentions a city or a monument in passing: it is whether someone holding this research could give the asker a genuinely useful, specific answer.

Say false for: transport to and from airports, trains between cities, accommodation, parking, shopping, nightlife, medical or legal questions, safety incidents, visas, and anything about a monument or city not in the list above. Also say false for posts that are not really questions (photos, trip reports, complaints).

Be strict. A wrong "true" costs more than a missed "false": it produces an answer written from nothing, published under a real person's name.

"pregunta": what the person is ACTUALLY asking, in one short line, in Spanish. Write this first, before deciding anything. State the specific thing they want to know, in their terms, not the general subject area. "Cuanto sale un buffet libre de pizza y pasta" — not "precios de comida en Roma".

This field exists because of a real failure on 2026-08-26. Someone asked what an all-you-can-eat pizza and pasta buffet typically costs. The material covers à la carte trattoria pricing and has nothing on buffets, but the post was accepted because it looked like a Rome food-pricing question, and the answer written for it talked about pasta plates and deli counters. It did not answer what was asked.

So: the material has to cover the specific ask in "pregunta", not the topic it belongs to. If someone asks about a format, a place, or a product we have no data on, say false even when the general subject is squarely ours.

"porque": one short sentence, in Spanish, saying whether the material covers that specific ask, and which part of it does. Concrete — name the thing, not a category. This is the line a human reads to decide what to answer.

Describe the MATERIAL, never the person. No experience, no years in the trade, no credential of any kind. That line is read as a brief for the writing, and on 2026-09-04 it came back as "la experiencia operativa de veinte años en viajes explica estas asimetrías de precios" and "conocimiento de operador de viajes y afiliado de reservas". The twenty years are real, but they are the SECONDARY credential and they never carry the argument: what does is the review corpus, because it can be checked. A porque that leans on seniority coaches an answer that leans on seniority, and that answer has nothing under it. Say what the research contains that bears on the ask, or say what it does not.

"temas": 1-4 short tags for what the post is about, free-form, lowercase.`;
}

export async function evaluarPost({ titulo, cuerpo }, sitios) {
  const texto = `TITLE: ${titulo}\n\nBODY: ${(cuerpo || '').slice(0, 2500) || '(no body)'}`;
  const res = await cliente().messages.create({
    model: MODEL,
    max_tokens: 500,
    system: prompt(sitios),
    tools: [{ name: 'responder', description: 'Devolver el veredicto', input_schema: SCHEMA }],
    tool_choice: { type: 'tool', name: 'responder' },
    messages: [{ role: 'user', content: texto }],
  });
  const use = res.content.find((c) => c.type === 'tool_use');
  if (!use) return { pregunta: '', sitio: null, contestable: false, porque: 'sin respuesta del modelo', temas: [] };
  const out = use.input;
  // El modelo puede decir contestable con un sitio que no existe. Se valida.
  if (out.sitio && !sitios.some((s) => s.key === out.sitio)) {
    return { ...out, sitio: null, contestable: false, porque: `sitio invalido: ${out.sitio}` };
  }
  if (out.contestable && !out.sitio) out.contestable = false;
  return out;
}

// Corre varios en paralelo con un tope, para no encolar 100 llamadas de golpe.
export async function evaluarLote(posts, sitios, concurrencia = 6) {
  const out = new Array(posts.length);
  let i = 0;
  async function worker() {
    while (i < posts.length) {
      const idx = i++;
      try {
        out[idx] = await evaluarPost(posts[idx], sitios);
      } catch (e) {
        // Un fallo de red no puede tumbar la corrida entera: ese post queda
        // fuera con el motivo a la vista, y los demas siguen.
        out[idx] = { pregunta: '', sitio: null, contestable: false, porque: `error: ${e.message.slice(0, 80)}`, temas: [] };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrencia, posts.length) }, worker));
  return out;
}
