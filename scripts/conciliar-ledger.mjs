// Cierra el ledger de Quora contra la lista real de respuestas publicadas.
//
// POR QUE EXISTE
//
// El ledger tiene dos estados y solo uno se escribe solo. Cuando el monitor
// entrega una pregunta, la anota como "entregado". Cuando la respuesta se pega
// en Quora no pasa nada: nadie vuelve a tocar el archivo. Al 2 sep 2026 eso
// dejaba 22 entradas en "entregado" contra 9 en "publicada", y ninguna forma de
// saber cuales de esas 22 estan arriba.
//
// El costo no es cosmetico. El dedup del monitor mira el ledger entero, asi que
// una pregunta ya contestada no vuelve a salir en el reporte — pero una
// entregada y nunca publicada tampoco, y las dos se ven igual. El dia que el
// ledger miente en la otra direccion, el sistema ofrece escribir algo que ya
// esta publicado. Paso: las entradas 29 y 30 se entregaron el 2 sep 2026 sobre
// hilos que ya tenian respuesta nuestra.
//
// LO QUE NO SE HACE ACA
//
// No se le pregunta a Mario cuales publico. No se acuerda, y con razon: son 22
// repartidas en dos semanas. Una lista reconstruida de memoria es exactamente
// el tipo de dato que este repo tiene prohibido tratar como verificado.
//
// La fuente es el perfil de Quora, que lista todas las respuestas de una
// persona. Mario lo abre logueado, copia lo que ve y lo pega en un .txt. Este
// script hace el cruce. No entra a Quora: el sistema entero esta construido
// para no hacerlo.
//
// USO
//
//   node scripts/conciliar-ledger.mjs data/quora-publicadas.txt
//   node scripts/conciliar-ledger.mjs data/quora-publicadas.txt --execute
//
// Sin --execute no escribe nada, como todo script de modificacion del portfolio.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const LEDGER = path.join(ROOT, 'data', 'quora-ledger.json');

const args = process.argv.slice(2);
const EXECUTE = args.includes('--execute');
const ENTRADA = args.find((a) => !a.startsWith('--'));

if (!ENTRADA) {
  console.error('falta el archivo con lo copiado del perfil de Quora');
  console.error('  node scripts/conciliar-ledger.mjs data/quora-publicadas.txt [--execute]');
  process.exit(1);
}

const norm = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// El slug de una URL de Quora es el titulo con guiones, asi que normalizado
// coincide con el titulo normalizado. Eso permite pegar URLs, titulos, o el
// copy-paste crudo del perfil con las dos cosas mezcladas.
function slugDeUrl(linea) {
  const m = linea.match(/quora\.com\/([^/?#\s]+)/i);
  return m ? norm(decodeURIComponent(m[1])) : null;
}

// Palabras que aparecen en casi todas estas preguntas y por lo tanto no
// distinguen nada. Sin sacarlas, "visiting the vatican" y "visiting the
// colosseum" comparten la mitad de los tokens.
const VACIAS = new Set('a an the is are was were do does did to in on at of for and or you your i my we our it this that what how when where which why can could should would if with without from as be been being there their they them me us not no yes s t'.split(' '));

const tokens = (t) => new Set(norm(t).split(' ').filter((w) => w && !VACIAS.has(w)));

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

const ledger = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
const pendientes = ledger.answered
  .map((e, i) => ({ e, i }))
  .filter(({ e }) => e.estado !== 'publicada');

// Del archivo pegado sale una lista de "cosas publicadas". Cada linea no vacia
// que no sea un comentario cuenta: puede ser una URL, un titulo, o las dos.
const lineas = fs.readFileSync(ENTRADA, 'utf8')
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));

const publicadas = lineas.map((l) => {
  const slug = slugDeUrl(l);
  const texto = slug || norm(l);
  return { linea: l, texto, toks: tokens(texto) };
});

console.log(`ledger: ${ledger.answered.length} entradas, ${pendientes.length} sin marcar como publicadas`);
console.log(`pegado: ${publicadas.length} lineas utiles\n`);

const exactos = [];
const dudosos = [];
const usadas = new Set();

for (const { e, i } of pendientes) {
  const tn = e.titleNormalized || norm(e.questionTitle);
  const tt = tokens(tn);

  // Primero exacto: el normalizado del titulo, o el slug de la URL. Cuando
  // coincide asi no hay nada que decidir.
  const exacto = publicadas.find((p) => p.texto === tn || (e.questionUrl && slugDeUrl(e.questionUrl) === p.texto));
  if (exacto) {
    exactos.push({ i, e, con: exacto.linea, score: 1 });
    usadas.add(exacto.linea);
    continue;
  }

  // Despues por parecido. Quora recorta los titulos en algunas vistas del
  // perfil, asi que el copy-paste puede venir sin la cola de la pregunta.
  let mejor = null;
  for (const p of publicadas) {
    const s = jaccard(tt, p.toks);
    if (!mejor || s > mejor.score) mejor = { con: p.linea, score: s };
  }
  if (mejor && mejor.score >= 0.55) {
    dudosos.push({ i, e, ...mejor });
    usadas.add(mejor.con);
  }
}

const imprimir = (lista, titulo) => {
  if (!lista.length) return;
  console.log(`${titulo} (${lista.length})`);
  for (const m of lista) {
    console.log(`  [${String(m.i).padStart(2)}] ${m.e.questionTitle.slice(0, 78)}`);
    if (m.score < 1) console.log(`       parecido ${m.score.toFixed(2)} con: ${m.con.slice(0, 78)}`);
  }
  console.log('');
};

imprimir(exactos, 'COINCIDENCIA EXACTA -> pasan a publicada');
imprimir(dudosos, 'PARECIDAS -> revisar antes de aplicar');

const sinTocar = pendientes.filter(({ i }) => ![...exactos, ...dudosos].some((m) => m.i === i));
if (sinTocar.length) {
  console.log(`SIGUEN PENDIENTES (${sinTocar.length}) — entregadas y sin rastro en el perfil`);
  for (const { e, i } of sinTocar) {
    console.log(`  [${String(i).padStart(2)}] ${e.generatedAt} ${(e.site || '-').padEnd(10)} ${e.questionTitle.slice(0, 66)}`);
  }
  console.log('');
}

// Antes de listar las sobrantes hay que descontar las que ya estaban marcadas
// como publicadas en el ledger. Sin esto, las 9 que ya estaban cerradas
// aparecian como "contestadas fuera del sistema" — 22 en vez de 13, y la lista
// que Mario iba a mirar tenia un tercio de ruido.
for (const e of ledger.answered) {
  if (e.estado !== 'publicada') continue;
  const tn = e.titleNormalized || norm(e.questionTitle);
  const tt = tokens(tn);
  const p = publicadas.find((x) => x.texto === tn) || publicadas.find((x) => jaccard(tt, x.toks) >= 0.55);
  if (p) usadas.add(p.linea);
}

const sobrantes = publicadas.filter((p) => !usadas.has(p.linea));
if (sobrantes.length) {
  // Una respuesta publicada que el ledger no conoce no es un error: son las que
  // Mario contesto por su cuenta, sin pasar por el monitor. Se avisan igual,
  // porque el ledger tambien alimenta el dedup y conviene que las tenga.
  console.log(`EN EL PERFIL Y NO EN EL LEDGER (${sobrantes.length}) — contestadas fuera del sistema`);
  for (const p of sobrantes) console.log(`  ${p.linea.slice(0, 88)}`);
  console.log('');
}

if (!EXECUTE) {
  console.log(`DRY-RUN. Con --execute se marcan ${exactos.length} exactas` + (dudosos.length ? ` y ${dudosos.length} parecidas` : '') + '.');
  process.exit(0);
}

const hoy = new Date().toISOString().slice(0, 10);
for (const m of [...exactos, ...dudosos]) {
  ledger.answered[m.i].estado = 'publicada';
  ledger.answered[m.i].publicadaAt = hoy;
  ledger.answered[m.i].confirmadaPor = m.score === 1 ? 'perfil-exacto' : `perfil-parecido-${m.score.toFixed(2)}`;
}
fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 2) + '\n');
console.log(`escrito: ${exactos.length + dudosos.length} entradas pasaron a publicada`);
