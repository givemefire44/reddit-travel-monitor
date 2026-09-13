// Junta las entradas duplicadas del ledger de Quora: una por pregunta.
//
// Hasta el 13 sep 2026, cuando una pregunta volvia al pozo (vencia la entrega de
// 21 dias o el descarte de 3) el monitor agregaba una entrada nueva en vez de
// actualizar la vieja. Ese dia habia 51 entradas para 47 preguntas. El monitor ya
// actualiza en su lugar (ver saveLedger); esto limpia lo que quedo de antes.
//
// Regla de fusion, por URL de pregunta:
//   - se queda la entrada mas reciente (su generatedAt, su estado, sus facts);
//   - si alguna copia esta publicada, el resultado es publicada: el bloqueo
//     permanente gana siempre;
//   - las fechas de las copias viejas pasan a `entregasPrevias`;
//   - la posicion en el archivo es la de la primera aparicion.
//
// Uso:
//   node scripts/compactar-ledger.mjs             (dry-run)
//   node scripts/compactar-ledger.mjs --execute

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const LEDGER = path.join(ROOT, 'data', 'quora-ledger.json');
const EXEC = process.argv.includes('--execute');

const ledger = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
const grupos = new Map();
for (const e of ledger.answered) {
  if (!grupos.has(e.questionUrl)) grupos.set(e.questionUrl, []);
  grupos.get(e.questionUrl).push(e);
}

const salida = [];
const vistos = new Set();
let sobrantes = 0;
for (const e of ledger.answered) {
  if (vistos.has(e.questionUrl)) continue;
  vistos.add(e.questionUrl);
  const copias = grupos.get(e.questionUrl);
  if (copias.length === 1) { salida.push(e); continue; }

  const porFecha = [...copias].sort((a, b) => (a.generatedAt || '').localeCompare(b.generatedAt || ''));
  const ultima = porFecha[porFecha.length - 1];
  const fusion = { ...ultima };
  if (copias.some((c) => c.estado === 'publicada')) fusion.estado = 'publicada';
  if (fusion.estado !== 'descartado') delete fusion.descartadaAt;
  const conOrigen = copias.find((c) => c.origen);
  if (conOrigen) fusion.origen = conOrigen.origen;
  fusion.entregasPrevias = [...new Set(porFecha.slice(0, -1)
    .flatMap((c) => [...(c.entregasPrevias || []), c.generatedAt]).filter(Boolean))];

  sobrantes += copias.length - 1;
  console.log(`${copias.map((c) => `${c.estado}@${c.generatedAt}`).join(' + ')}  ->  ${fusion.estado}@${fusion.generatedAt}`);
  console.log(`  ${fusion.questionTitle}`);
  salida.push(fusion);
}

console.log(`\n${ledger.answered.length} entradas -> ${salida.length} (${sobrantes} duplicada(s))`);
if (!sobrantes) process.exit(0);
if (EXEC) {
  ledger.answered = salida;
  fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 2) + '\n', 'utf8');
  console.log('Escrito.');
} else {
  console.log('(dry-run: agregar --execute para escribir)');
}
