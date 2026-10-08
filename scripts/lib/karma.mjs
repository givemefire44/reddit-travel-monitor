// Segundo filtro del monitor de Reddit: hilos para sumar karma.
//
// POR QUE EXISTE
//
// El juez de relevancia.mjs contesta una sola pregunta: si el hilo se puede
// responder con nuestro material. Eso encuentra los hilos donde va la marca, que
// es para lo que existe el sistema, pero no los que dan puntos. Y sin puntos no
// se entra a los subs donde estan las mejores preguntas (r/ItalyTravel pide 150).
//
// Medido el 7 oct 2026 sobre los 90 comentarios de u/RomanColosseumExpert, leidos
// del perfil logueado. Neto = puntos menos el 1 con el que arranca cada uno:
//
//   con marca                  16 comentarios   neto   +3   maximo 2
//   sin marca                  73 comentarios   neto +106   maximo 32
//   sin marca, sin los 3 top   70 comentarios   neto  +39
//
// Tres comentarios dieron 67 de los 109 puntos, y ninguno tenia nada del corpus:
// un hotel cambiado por el operador (r/travel, 32), por que el cafe sentado sale
// mas caro (r/rome, 24) y donde tomar el primer vino (r/rome, 14). O sea que el
// juez de material dejaba afuera justo el tipo de hilo que mas rindio. En los 14
// dias anteriores a la medicion, 6 de los 10 comentarios llevaban marca y el
// karma se movio +3.
//
// QUE NO ES
//
// No redacta. Elige el hilo y dice que creeria una buena respuesta; el comentario
// lo escribe quien firma, despues de leer el hilo y de verificar cada dato afuera.
// Tampoco reemplaza al otro juez: corre sobre lo que aquel no eligio.

import Anthropic from '@anthropic-ai/sdk';

// El cliente se crea al primer uso, igual que en relevancia.mjs y por lo mismo:
// a nivel de modulo leeria el entorno antes de que el script cargue el .env.
let _client = null;
const cliente = () => (_client ||= new Anthropic());

const MODEL = process.env.KARMA_MODEL || 'claude-haiku-4-5-20251001';

const SCHEMA = {
  type: 'object',
  properties: {
    hilos: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          n: { type: 'integer' },
          tipo: { type: 'string', enum: ['premisa_equivocada', 'preocupacion', 'como_funciona', 'decision'] },
          cree: { type: 'string' },
          respuesta: { type: 'string' },
          verificar: { type: 'string' },
          dinero: { type: 'boolean' },
        },
        required: ['n', 'tipo', 'cree', 'respuesta', 'verificar', 'dinero'],
        additionalProperties: false,
      },
    },
  },
  required: ['hilos'],
  additionalProperties: false,
};

// El alcance y las exclusiones propias de cada cuenta salen de config.karma. Los
// de abajo son los de la cuenta de Italia, que fue para la que se escribio esto;
// world los pisa desde su config (8 oct 2026), porque "preferi Italia y Roma" no
// tiene sentido en r/vegas.
const ALCANCE_ITALIA = 'It is about Italy, or about how travel works in Europe in general: trains and connections, border and passport checks, flights, bookings, packages, consumer rules. Prefer Italy and Rome when there is a choice.';
const NO_ELEGIR_ITALIA = [
  'Destination advice for places outside Italy: what to see, which day trip, where to stay, which tour or driver. On 2026-10-07 the first run picked "is the Wachau Valley a good day trip from Vienna, and can you recommend a driver": that is local knowledge of Austria plus a request for names, and the account has neither. A question about how a train connection or a border check works is different, wherever it happens.',
];

function prompt(max, alcance = ALCANCE_ITALIA, noElegir = NO_ELEGIR_ITALIA) {
  return `You pick Reddit threads where one short, kind, well-informed comment is likely to be upvoted. The comment will be written later by a person who knows travel in Italy and Europe well but answers as an ordinary traveller: no brand, no statistics, and never a claim of having been there.

What has actually worked for this account, measured on its own history. Three comments earned most of its karma:

1. Someone booked an adults-only boutique hotel through a UK package operator and was moved on arrival to a family resort two hours away. The comment named the regulation that makes this the operator's problem, said to put the complaint in writing now and not to take the partial offer, and listed where to escalate.
2. Someone was confused that sitting down in a Roman café cost more. The comment explained that the "service fee" is a higher tariff for table service, not a scam, and said how to order so it works in their favour.
3. Someone who had never drunk alcohol asked where to have a first glass of wine in Rome with his wife. The comment was warm, named two gentle wines to ask for, and added one practical detail about the walk back to their hotel.

What they share: the person was worried, confused, or assuming something that is not so; the comment corrected or reframed that, gave one concrete next step, and was plainly on the asker's side.

Pick a thread only when ALL of these hold:
- The person is worried, confused, or starts from a belief that is not true.
- There is a definite answer that a well-informed person can give without personal experience: how a custom, a rule, a ticketing system, a timetable, a fare or a consumer-protection law actually works, or one clear recommendation with its reason.
- That answer can be checked on the web before writing.
- ${alcance}

Do NOT pick:
- Threads asking for personal anecdotes or "has anyone..." experiences. The writer cannot supply lived experience and will not fake it.
- Requests for lists: restaurants, hotels, addresses, things to do.
- Itinerary dumps with no specific doubt in them, trip reports, photos, rants with no question.
- Medical, visa, immigration or legal questions beyond basic consumer rights. Safety incidents.
${noElegir.map((x) => `- ${x}`).join('\n')}
- Money disputes (refunds, chargebacks, cancelled bookings) where the only honest answer is "ask the platform". These qualify only if a precise rule or a precise step resolves the case; when you do pick one, set "dinero" to true.

Be strict. Zero is a valid answer and a common one. Return at most ${max}, best first.

For each pick. The three text fields ("cree", "respuesta", "verificar") MUST be written in Spanish: the person who reads them is a Spanish speaker, and the first run came back in English.
- "n": the number of the thread as given.
- "tipo": premisa_equivocada (they assume something false), preocupacion (they fear something that has a clear answer), como_funciona (they do not understand a system or custom), decision (one choice with a clear right answer and reason).
- "cree": what the person believes or fears, in one line, in their terms.
- "respuesta": what a good comment would establish, in one line: the correction or reframe, and the concrete step. Do not write the comment, and do not prejudge the answer: if it depends on a fact you would have to look up, say what the comment needs to establish, not which way it comes out.
- "verificar": the facts that must be checked on the web before writing, in one line.
- "dinero": true if the thread is about getting money back or about a payment dispute.`;
}

// posts: [{ sub, title, selftext, ageHours, ... }]. Devuelve los elegidos con sus
// campos originales mas el veredicto, en el orden de preferencia del modelo.
// Nunca tira: si la API falla devuelve { error }, porque este filtro es un extra
// y no puede llevarse puesta una corrida que ya junto sus candidatos.
//
// SEGUNDA ETAPA: LEER EL HILO ANTES DE DARLO POR BUENO (8 oct 2026)
//
// El feed de un sub no trae la cantidad de comentarios, asi que la primera etapa
// elige a ciegas de eso. El 8 oct eligio seis hilos del tipo correcto entre las
// dos cuentas y cinco ya estaban resueltos al abrirlos: el del pasaporte tenia 57
// comentarios con la misma respuesta, y en r/vegas uno de 2 horas ya tenia 11.
// Contestar ahi es repetir, y lo repetido se vota en contra (el -4 de r/hotels).
// Ahora se preseleccionan el doble, se leen los comentarios de cada uno y un
// segundo pase dice si queda algo sin contestar. Lo que antes se hacia a mano.
export async function buscarKarma(posts, { max = 4, alcance, noElegir, leerHilo, pausaMs = 8000 } = {}) {
  if (!posts.length) return { elegidos: [], descartados: [], mirados: 0 };
  const preseleccion = leerHilo ? Math.max(max * 2, 8) : max;
  const lista = posts.map((p, i) => (
    `[${i + 1}] r/${p.sub} · ${p.ageHours}h\nTITLE: ${p.title}\nBODY: ${(p.selftext || '').replace(/\s+/g, ' ').slice(0, 700) || '(no body)'}`
  )).join('\n\n');
  let candidatos = [];
  try {
    const res = await cliente().messages.create({
      model: MODEL,
      max_tokens: 2500,
      system: prompt(preseleccion, alcance || undefined, Array.isArray(noElegir) && noElegir.length ? noElegir : undefined),
      tools: [{ name: 'elegir', description: 'Devolver los hilos elegidos', input_schema: SCHEMA }],
      tool_choice: { type: 'tool', name: 'elegir' },
      messages: [{ role: 'user', content: lista }],
    });
    const use = res.content.find((c) => c.type === 'tool_use');
    const hilos = Array.isArray(use?.input?.hilos) ? use.input.hilos : [];
    const vistos = new Set();
    for (const h of hilos) {
      const p = posts[h.n - 1];
      // El modelo puede devolver un numero que no existe o repetir uno. Se valida.
      if (!p || vistos.has(h.n)) continue;
      vistos.add(h.n);
      candidatos.push({ ...p, ...h });
      if (candidatos.length >= preseleccion) break;
    }
  } catch (e) {
    return { elegidos: [], descartados: [], mirados: posts.length, error: (e?.message || String(e)).slice(0, 160) };
  }
  if (!leerHilo || !candidatos.length) {
    return { elegidos: candidatos.slice(0, max), descartados: [], mirados: posts.length };
  }

  // Los comentarios de cada preseleccionado, de a uno y con pausa: Reddit corta
  // por IP si se le pide seguido. Un hilo que no se pudo leer NO se descarta ni
  // se da por bueno: queda marcado, y lo lee quien vaya a escribir.
  for (let i = 0; i < candidatos.length; i++) {
    if (i) await new Promise((r) => setTimeout(r, pausaMs));
    const r = await leerHilo(candidatos[i].url);
    candidatos[i].comentariosLeidos = r.ok;
    candidatos[i].nComentarios = r.ok ? r.comentarios.length : null;
    candidatos[i]._comentarios = r.ok ? r.comentarios : [];
    if (!r.ok) candidatos[i].errorLectura = (r.error || 'sin detalle').slice(0, 80);
  }

  const aRevisar = candidatos.filter((c) => c.comentariosLeidos && c.nComentarios > 0);
  if (aRevisar.length) {
    const bloque = aRevisar.map((c, i) => [
      `[${i + 1}] r/${c.sub} — ${c.title}`,
      `POST: ${(c.selftext || '').replace(/\s+/g, ' ').slice(0, 700) || '(no body)'}`,
      `COMMENTS (${c.nComentarios}):`,
      ...c._comentarios.slice(0, 30).map((k) => `- ${k.autor}: ${k.texto.slice(0, 280)}`),
    ].join('\n')).join('\n\n');
    try {
      const res = await cliente().messages.create({
        model: MODEL,
        max_tokens: 1500,
        system: PROMPT_REVISION,
        tools: [{ name: 'revisar', description: 'Devolver la revision de cada hilo', input_schema: SCHEMA_REVISION }],
        tool_choice: { type: 'tool', name: 'revisar' },
        messages: [{ role: 'user', content: bloque }],
      });
      const use = res.content.find((c) => c.type === 'tool_use');
      for (const v of (Array.isArray(use?.input?.hilos) ? use.input.hilos : [])) {
        const c = aRevisar[v.n - 1];
        if (!c) continue;
        c.resuelto = v.resuelto === true;
        c.falta = v.falta || '';
      }
    } catch (e) {
      // Sin la revision no se sabe cual esta resuelto. No se descarta ninguno por
      // las dudas: se entregan con el conteo de comentarios y el aviso.
      for (const c of aRevisar) c.errorRevision = (e?.message || String(e)).slice(0, 80);
    }
  }
  for (const c of candidatos) {
    if (c.comentariosLeidos && c.nComentarios === 0) { c.resuelto = false; c.falta = 'Nadie contestó todavía.'; }
    delete c._comentarios;
  }
  return {
    elegidos: candidatos.filter((c) => c.resuelto !== true).slice(0, max),
    descartados: candidatos.filter((c) => c.resuelto === true),
    mirados: posts.length,
  };
}

const SCHEMA_REVISION = {
  type: 'object',
  properties: {
    hilos: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          n: { type: 'integer' },
          resuelto: { type: 'boolean' },
          falta: { type: 'string' },
        },
        required: ['n', 'resuelto', 'falta'],
        additionalProperties: false,
      },
    },
  },
  required: ['hilos'],
  additionalProperties: false,
};

const PROMPT_REVISION = `You are checking Reddit threads before someone writes a comment in them. For each thread you get the original post and the comments already there. Decide whether a new comment still has something useful to add. Return one entry per thread, with "n" as given.

"resuelto": true when the existing comments already give the asker a correct, complete answer, or when the asker has said they are satisfied. A new comment repeating it adds nothing, and repeated answers get downvoted. Also true when the thread has turned into an argument about the asker or into jokes, so that a serious answer would be buried.

"resuelto": false when nobody has really answered, when the answers contradict each other and nobody has settled it, or when the answers miss something specific the asker needs: a step, a condition, the other direction of the trip, a rule nobody named.

"falta": in Spanish, one line. If resuelto is false, what a new comment could add that is not there yet. If true, why nothing is left ("ya le dijeron X y el autor agradeció"). Do not invent facts: describe the gap, not the answer.

Be strict: when in doubt, it is resolved. Two real cases from October 2026. "My US passport is running out of pages" had 57 comments giving the same correct answer ten times over: resolved. A thread about changing from the Eurostar to a Dutch train in Rotterdam had six comments covering the outbound trip, and nobody had mentioned that on the way back the passport check happens in Rotterdam before boarding: not resolved, and that gap was the comment worth writing.`;
