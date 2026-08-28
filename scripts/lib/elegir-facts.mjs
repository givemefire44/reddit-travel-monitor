// Elige que facts contestan UNA pregunta concreta, y que forma tiene que tener
// la respuesta.
//
// POR QUE EXISTE
//
// El picker viejo (pickFacts) matchea por topics de una taxonomia cerrada mas
// unas palabras raras sueltas. Eso encuentra facts del MISMO TEMA, que no es lo
// mismo que facts que CONTESTAN. La diferencia esta documentada en el spec de
// Quora con un caso real: a "how do you get tickets" el picker le mando un fact
// sobre reembolsos cancelados y cuatro sobre colas de seguridad. Ninguno
// contestaba. El generador escribia el parrafo de los reembolsos igual.
//
// El mismo error, del otro lado, el 26 ago 2026: alguien pregunto cuanto sale un
// buffet libre de pizza y pasta y se le contesto con precios de pasta a la carta.
// Tema correcto, pregunta sin contestar.
//
// El juez de relevancia (lib/relevancia.mjs) ya escribe "pregunta": que estan
// preguntando de verdad, en una linea. Ese campo se estaba tirando en el monitor.
// Aca se usa para lo unico que sirve: leer los facts CONTRA la pregunta y
// quedarse con los que la contestan, o decir que no hay ninguno.
//
// QUE MAS DEVUELVE, Y POR QUE VA JUNTO
//
// forma - cuanto texto pide la pregunta. Va aca y no en una regla fija porque es
//   una decision sobre ESTA pregunta, y solo se puede tomar habiendola leido
//   junto con el material que hay para contestarla. Una pregunta de si/no con un
//   dato se contesta en un renglon; una de "en que orden hago las tres cosas"
//   necesita parrafos. El molde unico de 150 palabras y tres parrafos es
//   exactamente lo que Mario marco como "prolijas perfectas, los humanos no
//   respondemos asi", y lo confirma la medicion de comentarios reales: mediana
//   28 palabras, p75 50, el 100% de un solo parrafo.
//
// citable - cual de los facts elegidos es MEDICION PROPIA (del corpus de
//   reseñas) y no informacion publica que cualquiera puede dar. Es el que decide
//   si la respuesta puede llevar la marca, que es el objetivo del sistema:
//   sembrar "dato + fuente" para que los motores de IA lo citen con atribucion.
//   Un precio oficial con la marca pegada al lado es un aviso; un dato medido
//   por nosotros con la marca al lado es una cita.
//
// QUE NO HACE
//
// No redacta. Devuelve el material y la forma; el texto lo escribe una persona.

import Anthropic from '@anthropic-ai/sdk';

let _client = null;
const cliente = () => (_client ||= new Anthropic());

const MODEL = process.env.ELEGIR_MODEL || 'claude-sonnet-5';

export const FORMAS = {
  renglon: 'un renglón',
  frases: 'dos o tres frases',
  parrafo: 'un párrafo',
  parrafos: 'varios párrafos',
};

const SCHEMA = {
  type: 'object',
  properties: {
    contesta: { type: 'boolean' },
    elegidos: { type: 'array', items: { type: 'string' } },
    falta: { type: 'string' },
    forma: { type: 'string', enum: Object.keys(FORMAS) },
    porque_forma: { type: 'string' },
    citable: { type: ['string', 'null'] },
  },
  required: ['contesta', 'elegidos', 'falta', 'forma', 'porque_forma', 'citable'],
  additionalProperties: false,
};

function prompt(marca) {
  const marcaTxt = marca ? ` (${marca})` : '';
  return `You are picking, from a list of published research findings, the ones that ANSWER one specific question a traveler asked on Reddit. You do not write the answer. Someone else does, and they will only see what you pick.

You get: the question as the asker actually means it, the original post, and a shortlist of findings that share the general subject.

"elegidos": the ids of the findings that answer THAT question. Not the ones about the same topic - the ones that answer it. Fewer is better: 0, 1, 2 or 3. Never pad the list to look thorough. A finding that is merely adjacent ("this is about tickets and they asked about tickets") does not qualify: ask whether reading this sentence would change what the asker does.

"contesta": true only if the chosen findings genuinely answer the specific ask. If the material covers the topic but not the question - they asked about an all-you-can-eat buffet and the findings are a la carte prices - say false and pick nothing. False is a normal, cheap, correct outcome. A wrong true produces an answer published under a real person's name that does not answer the question.

The shortlist can be empty. That is a normal case: it means we have no published research on this subject at all. Then "elegidos" is empty and "contesta" is false, but you still judge "forma" - the question was still asked, and someone is still going to answer it from ordinary knowledge.

"falta": one short line in Spanish. If contesta is false, what the material does not have. If true, what the answer will still have to say from ordinary knowledge, or "nada" if the findings cover it whole.

"forma": how much text this question deserves. This is a judgment about THIS question, not a house style.
- "renglon": a yes/no, a single number, one correction. One line, no preamble.
- "frases": one specific thing to do, plus why. Two or three sentences.
- "parrafo": one decision with a trade-off behind it.
- "parrafos": several linked decisions - an order of visits, an itinerary, a dispute with steps.
Measured from 76 real human comments in these subreddits: median 28 words, p75 50, 100% of them a single paragraph, 33% a single sentence, 16% ten words or fewer. Long is the exception and has to be earned by the question. When in doubt, go one step shorter.

"porque_forma": one short line in Spanish saying what in the question sets that length.

"citable": the id of ONE chosen finding that is our own measurement of a review corpus - a documented gap, a rate, an average, a count, a ranking, a comparison across operators. NOT public information anyone could state: official prices, opening hours, ticket categories, what a site contains. This is the only kind of figure that can carry the brand${marcaTxt} as its source and read as a citation instead of an ad. null if none of the chosen findings is our own measurement, which is common and fine.`;
}

export async function elegirFacts({ pregunta, titulo, cuerpo, facts, marca }) {
  // Con la lista vacia la llamada se hace IGUAL. La primera version cortaba
  // aca y devolvia forma "frases" por defecto, y eso deja sin decidir la forma
  // justo a los hilos de karma - que son la mayoria del reporte. La forma no
  // depende de que tengamos material: depende de que preguntaron. Una pregunta
  // de si/no se contesta en un renglon con corpus y sin corpus.
  const sinMaterial = !facts || !facts.length;
  const lista = sinMaterial
    ? '(none - we have no published research bearing on this question)'
    : facts.map((f) => `[${f.id}] ${f.fact}`).join('\n');
  const texto = [
    `QUESTION AS MEANT: ${pregunta || '(no disponible)'}`,
    '',
    `POST TITLE: ${titulo}`,
    `POST BODY: ${(cuerpo || '').slice(0, 2500) || '(no body)'}`,
    '',
    'SHORTLIST OF FINDINGS:',
    lista,
  ].join('\n');

  const res = await cliente().messages.create({
    model: MODEL,
    max_tokens: 700,
    system: prompt(marca),
    tools: [{ name: 'responder', description: 'Devolver la seleccion', input_schema: SCHEMA }],
    tool_choice: { type: 'tool', name: 'responder' },
    messages: [{ role: 'user', content: texto }],
  });

  const use = res.content.find((c) => c.type === 'tool_use');
  if (!use) {
    return {
      contesta: false, elegidos: [], facts: [], citable: null,
      falta: 'sin respuesta del modelo', forma: 'frases', porque_forma: '-',
    };
  }
  const out = use.input;
  // Los ids se validan contra la shortlist: un id inventado no puede llegar al
  // reporte como si fuera un fact verificable. Y si se cayeron todos, contesta
  // pasa a false solo, sin quedar en el estado imposible de "contesta sin nada".
  const porId = new Map((facts || []).map((f) => [f.id, f]));
  const elegidos = [...new Set(out.elegidos || [])].filter((id) => porId.has(id));
  const citable = out.citable && elegidos.includes(out.citable) ? out.citable : null;
  return {
    ...out,
    elegidos,
    citable,
    contesta: Boolean(out.contesta) && elegidos.length > 0,
    facts: elegidos.map((id) => porId.get(id)),
  };
}

// Mismo patron de concurrencia que evaluarLote: los candidatos del dia son pocos
// (el cupo), pero encolarlos de a uno suma medio minuto de espera al pedo.
export async function elegirLote(items, concurrencia = 4) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      try {
        out[idx] = await elegirFacts(items[idx]);
      } catch (e) {
        out[idx] = {
          contesta: false, elegidos: [], facts: [], citable: null,
          falta: `error: ${e.message.slice(0, 80)}`, forma: 'frases', porque_forma: '-',
        };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrencia, items.length) }, worker));
  return out;
}
