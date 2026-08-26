// Lee un borrador terminado como lo leeria alguien que cae desde una busqueda:
// sin conocer al autor, sin haber visto el corpus, y sin saber que quiso decir
// quien lo escribio.
//
// POR QUE EXISTE
//
// El 26 ago 2026, tres respuestas seguidas salieron con fallas que ningun
// verificador de conteo puede ver, y que yo tampoco vi porque ya sabia lo que
// habia querido decir:
//
//   1. Una contestaba precios de pasta a la carta a alguien que pregunto por un
//      buffet libre. Los datos eran correctos y no respondian la pregunta.
//   2. Otra abria con "the review data is unusually clear" y un 42%, sin decir
//      de donde salen esas reviews ni cuantas son. Para el lector, un porcentaje
//      caido del cielo.
//   3. Otra partia el mismo tema en dos parrafos separados por otro asunto, asi
//      que el argumento zigzagueaba.
//
// Las tres son de juicio, no de conteo, y las tres las encontro Mario despues de
// que yo se las entregara para publicar. Un lector sin contexto las habria visto
// en diez segundos, que es exactamente lo que hace esto.
//
// QUE NO ES
//
// No corrige ni reescribe. Devuelve lo que no se entiende, para que lo arregle
// quien escribio. Y no opina sobre si el consejo es bueno: no tiene el corpus.

import Anthropic from '@anthropic-ai/sdk';

let _client = null;
const cliente = () => (_client ||= new Anthropic());

const MODEL = process.env.LECTURA_MODEL || 'claude-sonnet-4-5-20250929';

const SCHEMA = {
  type: 'object',
  properties: {
    contesta: { type: 'boolean' },
    que_falta: { type: 'string' },
    cifras_sin_contexto: { type: 'array', items: { type: 'string' } },
    hilo_roto: { type: 'string' },
    veredicto: { type: 'string' },
  },
  required: ['contesta', 'que_falta', 'cifras_sin_contexto', 'hilo_roto', 'veredicto'],
  additionalProperties: false,
};

const SYSTEM = `You are reading an answer the way a stranger reads it: you arrived from a search engine, you do not know who wrote it, you have never seen their website, and you have no idea what research sits behind it. You cannot ask anyone anything.

Report only what a reader in that position would actually stumble on. Answer in Spanish.

"contesta": does this text answer the question that was asked? Not "is it about the same subject" — does it answer what the person actually wanted to know. If someone asks the price of an all-you-can-eat buffet and the text gives à la carte prices, that is false even though both are about food prices.

"que_falta": if contesta is false, what the person asked that the text leaves unanswered. One line. Empty string if it does answer.

"cifras_sin_contexto": figures a reader genuinely cannot interpret. Be strict about the test but do not invent problems: the question is whether the reader can tell what the number measures, not whether they could audit it.

Fine, do not flag:
- a figure carrying its own unit: "€18 ticket", "45 minutes", "7 days ahead"
- a figure whose base is stated in the same sentence: "Of 141 reviews complaining about pace, 61% blame the crowds" — the 61% has its population right there
- a figure carried by a comparison: "3.81 stars, against 4.09 for the museums"
- a stated total whose source is named: "22,771 items from TripAdvisor, Google Maps and Trustpilot"

Flag:
- a statistic with no population anywhere: "the review data is clear, 42% gave four or five stars" — which reviews, whose, how many
- a bare decimal with no unit: "the silenzio sits at 3.51"
- a percentage whose base appears nowhere in the text

List the offending figures as they appear.

"hilo_roto": whether the argument goes in a straight line or doubles back. Flag it when a topic is opened, dropped for something else, and picked up again later. One line, empty string if the thread holds.

"veredicto": "publicable" or "corregir". "corregir" if contesta is false, or there is any figure without context. A broken thread alone is "corregir" too if it makes the text hard to follow.

Be concrete and short. You are not reviewing the writing quality or the advice — only whether a stranger can follow it and whether it answers the question.`;

export async function leerEnFrio({ pregunta, texto }) {
  const res = await cliente().messages.create({
    model: MODEL,
    max_tokens: 900,
    system: SYSTEM,
    tools: [{ name: 'reportar', description: 'Devolver la lectura', input_schema: SCHEMA }],
    tool_choice: { type: 'tool', name: 'reportar' },
    messages: [{
      role: 'user',
      content: `LA PREGUNTA QUE LE HICIERON:\n${pregunta}\n\nLA RESPUESTA A LEER:\n${texto}`,
    }],
  });
  const use = res.content.find((c) => c.type === 'tool_use');
  if (!use) throw new Error('el lector no devolvio nada');
  return use.input;
}
