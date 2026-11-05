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
//   24 palabras, p75 48, p90 100.
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

// Acumulado de tokens de la corrida, para poder AFIRMAR si el cache funciono en
// vez de suponerlo. Un prefijo por debajo del minimo del modelo no cachea y no
// avisa: deja estos numeros en cero. Si al final de una corrida `leidos` sigue
// en cero, el cache no esta entrando y hay que mirar por que.
let ultimoUso = { escritos: 0, leidos: 0, sinCache: 0 };
export const usoAcumulado = { escritos: 0, leidos: 0, sinCache: 0, llamadas: 0 };

function acumular(u) {
  usoAcumulado.escritos += u.escritos;
  usoAcumulado.leidos += u.leidos;
  usoAcumulado.sinCache += u.sinCache;
  usoAcumulado.llamadas += 1;
}

export function resumenCache() {
  const { escritos, leidos, sinCache, llamadas } = usoAcumulado;
  const total = escritos + leidos + sinCache;
  return {
    llamadas, escritos, leidos, sinCache,
    porcentajeDesdeCache: total ? Math.round((leidos / total) * 100) : 0,
  };
}

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

A question has a literal ask and a reason behind it, and a finding can answer either. It also qualifies when it settles the decision the asker is trying to make, or corrects a belief the post states. Real case: someone asked when January tickets go on sale, because they had been told to book three to six months ahead and kept finding nothing. No finding gave the release date, but one measured that winter visits draw half the crowd complaints of June, and another that sell-outs happen weeks ahead and only in peak season. Those answer what the asker needs - whether to worry - and leaving them out cost the only citable answer of the day. In that case "contesta" is true and "falta" says which part of the literal ask stays unanswered. Sharing the topic is still not enough: the finding has to change what this person believes or does.

"contesta": true only if the chosen findings genuinely answer the specific ask, or the decision or belief behind it as described above. If the material covers the topic but not the question - they asked about an all-you-can-eat buffet and the findings are a la carte prices - say false and pick nothing. False is a normal, cheap, correct outcome. A wrong true produces an answer published under a real person's name that does not answer the question.

The shortlist can be empty. That is a normal case: it means we have no published research on this subject at all. Then "elegidos" is empty and "contesta" is false, but you still judge "forma" - the question was still asked, and someone is still going to answer it from ordinary knowledge.

"falta": one short line in Spanish. If contesta is false, what the material does not have. If true, what the answer will still have to say from ordinary knowledge, or "nada" if the findings cover it whole.

"forma": how much text this question deserves. This is a judgment about THIS question, not a house style.
- "renglon": a yes/no, a single number, one correction. One line, no preamble.
- "frases": one specific thing to do, plus why. Two or three sentences.
- "parrafo": one decision with a trade-off behind it.
- "parrafos": several linked decisions - an order of visits, an itinerary, a dispute with steps.
Measured from 126 real human comments in these subreddits: median 24 words, p75 48, p90 100, 35% a single sentence, 24% ten words or fewer. Long is the exception and has to be earned by the question. When in doubt, go one step shorter.

"forma" is about how much is said, not about how it is laid out. Paragraph breaks follow the punctuation: if the answer explains how something works and then says what to do, that is two paragraphs whatever the length.

"porque_forma": one short line in Spanish saying what in the question sets that length.

"citable": the id of ONE chosen finding that is our own measurement: something the publisher measured across a body of visitor reviews. A rate, a percentage, an average rating, a documented gap between two things, a count of reviews, a ranking, a comparison across operators, a sentiment score. Nobody could state it without having done the analysis. NOT public information: anything a well-informed person could state without any analysis. Official prices, opening hours, ticket categories, release windows, what a site contains, how to get somewhere, history, what a dish is, how long a tour lasts. The distinction is not typographic: "the official ticket costs 25 euros online" and "23.8% of reviews mention the queue" are both numbers, and only the second is a measurement. Be strict: when a finding could plausibly have been written by someone who simply visited and paid attention, it is public information. Real case: "The Museums are closed every Sunday except the last of the month, when they open free from 9:00 AM to 2:00 PM, which is also the busiest day of the month" was marked citable and is not. The hours are the official schedule, and "the busiest day" is common knowledge with no count behind it. This is the only kind of figure that can carry the brand${marcaTxt} as its source and read as a citation instead of an ad. null if none of the chosen findings is our own measurement, which is common and fine.`;
}

// UN HORARIO NO ES MEDICION NUESTRA, LO DIGA O NO EL MODELO.
//
// El 4 nov 2026 dos hilos de 47h sobre el Vaticano salieron 🎯 GEO por
// free-sunday-001: "closed every Sunday except the last of the month, when they
// open free from 9:00 AM to 2:00 PM with last entry at 12:30 - which is also the
// busiest day of the month". Es el horario oficial mas una afirmacion general;
// el articulo no tiene ningun conteo atras. Como GEO se comieron dos lugares del
// cupo, y por eso quedo afuera "Absinthe vs Mystere", fresco y con mediciones.
//
// Se intento primero por la instruccion: se le copio al selector la definicion
// de auditar-citables.mjs y se le escribio este caso textual. Siguio marcandolo
// en 3 de 3 corridas, y el clasificador de la auditoria, preguntado aparte,
// tambien. Lo que lo engaña es "the busiest day": el gemelo free-sunday-003,
// mismas horas sin esa frase, sale publico.
//
// La regla es angosta a proposito. "La distincion no es tipografica" sigue
// valiendo para los precios y los porcentajes (ver auditar-citables.mjs), pero
// esta es otra: si las UNICAS cifras son horas de reloj y el texto no cuenta
// nada (ni reseñas, ni personas, ni un numero en palabras), no puede ser la
// medicion de un cuerpo de reseñas. Medido ese dia sobre los 2.579 facts de los
// 7 sitios: veta 86, todos horarios, consejos de horario o anecdotas sueltas. El
// unico dudoso es grand-canyon-017 ("Pickups cluster between 5am and 7am"), que
// sale de reseñas pero no dice a quien se conto; su gemelo grand-canyon-021, que
// si lo dice, no se veta. Solo baja el carril: el fact se sigue entregando.
const RELOJ = /^\s*(\d{1,2}([:.]\d{2})?\s*(a\.?m\.?|p\.?m\.?)|\d{1,2}:\d{2})\s*$/i;
const CUENTA = /\b(reviews?|reviewers?|rated|ratings?|stars?|verdicts?|sample|complain\w*|mention\w*|describ\w*|report\w*|accounts?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|hundred|dozen|half|most|majority|average\w*|median)\b/i;
export function esHorario(f) {
  const cifras = (f?.figures || []).map(String);
  if (!cifras.length || !cifras.every((x) => RELOJ.test(x))) return false;
  const resto = cifras.reduce((t, x) => t.split(x).join(' '), f.fact);
  if (/\d/.test(resto)) return false;
  return !CUENTA.test(resto);
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
  // EL ORDEN DE ESTOS DOS BLOQUES ES LO QUE DECIDE EL COSTO, no un detalle de
  // estilo. El caching de Anthropic es un match de PREFIJO: cachea desde el
  // principio del pedido hasta la marca, y cualquier byte distinto antes de esa
  // marca tira el cache abajo.
  //
  // Antes el texto iba pregunta -> post -> facts, todo en un bloque. Como la
  // pregunta cambia en cada candidato, no habia prefijo estable: el corpus
  // entero se pagaba de nuevo en cada llamada. Medido el 12 oct 2026, el bloque
  // de facts de colosseum son ~32.000 tokens; por 221 candidatos de una corrida
  // son 7,1 millones de tokens de entrada, unos US$14 a precio de Sonnet 5 — y
  // eso disparo dos recargas automaticas de credito el mismo dia.
  //
  // Ahora los facts van PRIMERO y con la marca de cache. Son los mismos para
  // todas las preguntas de un sitio dentro de una corrida, asi que se escriben
  // una vez y se leen a 0,1x: ~US$1,50 en lugar de ~US$14.
  //
  // Que el modelo lea igual no esta en duda: las dos partes viajan en la misma
  // llamada. Y la pregunta queda ULTIMA, que es la posicion donde mejor se
  // obedece una instruccion.
  const bloqueFacts = ['SHORTLIST OF FINDINGS:', lista].join('\n');
  const bloquePregunta = [
    `QUESTION AS MEANT: ${pregunta || '(no disponible)'}`,
    '',
    `POST TITLE: ${titulo}`,
    `POST BODY: ${(cuerpo || '').slice(0, 2500) || '(no body)'}`,
  ].join('\n');

  const res = await cliente().messages.create({
    model: MODEL,
    max_tokens: 700,
    system: prompt(marca),
    tools: [{ name: 'responder', description: 'Devolver la seleccion', input_schema: SCHEMA }],
    tool_choice: { type: 'tool', name: 'responder' },
    messages: [{
      role: 'user',
      content: [
        // La marca va en el bloque de facts: todo lo anterior (tools y system)
        // tambien queda cacheado, porque el prefijo se cuenta desde el principio.
        { type: 'text', text: bloqueFacts, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: bloquePregunta },
      ],
    }],
  });

  // Sin esto el cambio no se puede comprobar: un prefijo por debajo del minimo
  // del modelo (1.024 tokens en Sonnet 5) NO cachea y no da ningun error, solo
  // deja estos contadores en cero. Se expone para que el monitor lo informe.
  ultimoUso = {
    escritos: res.usage?.cache_creation_input_tokens || 0,
    leidos: res.usage?.cache_read_input_tokens || 0,
    sinCache: res.usage?.input_tokens || 0,
  };
  acumular(ultimoUso);

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
  let citable = out.citable && elegidos.includes(out.citable) ? out.citable : null;
  if (citable && esHorario(porId.get(citable))) citable = null;
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
      // REINTENTOS, y el error marcado como error.
      //
      // El 2 sep 2026 una corrida de Quora devolvio cero candidatos y el reporte
      // dijo "sin material para ESTA pregunta" en 22 de 23. No era verdad:
      // fallaron las llamadas con "Connection error". El catch las convertia en
      // un veredicto negativo, o sea un fallo de red disfrazado de conclusion —
      // el mismo patron que ya nos habia mordido con el corpus mutilado.
      //
      // Ahora se reintenta con espera creciente, y si igual falla el resultado
      // lleva `error: true`: quien lo consuma tiene que poder distinguir "el
      // corpus no la contesta" de "no pudimos preguntarselo".
      let ultimo;
      for (let intento = 0; intento < 3; intento++) {
        try {
          out[idx] = await elegirFacts(items[idx]);
          ultimo = null;
          break;
        } catch (e) {
          ultimo = e;
          if (intento < 2) await new Promise((r) => setTimeout(r, 1500 * (intento + 1)));
        }
      }
      if (ultimo) {
        out[idx] = {
          contesta: false, elegidos: [], facts: [], citable: null, error: true,
          falta: `no se pudo consultar: ${ultimo.message.slice(0, 80)}`,
          forma: 'frases', porque_forma: '-',
        };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrencia, items.length) }, worker));
  return out;
}
