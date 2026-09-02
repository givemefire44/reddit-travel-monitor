// Pasa las reglas de data/canonical-facts.json por TODO el corpus y lista que
// articulos hay que corregir.
//
// POR QUE EXISTE
//
// El chequeo canonico corre sobre un borrador, o sea sobre lo que estamos por
// publicar. Eso llega tarde para el otro problema: el dato equivocado ya esta en
// el sitio, y va a volver a entrar al corpus en cada extraccion, y a los
// borradores de cualquier dia.
//
// El caso: el 2 sep 2026 se verifico que CoopCulture dejo de vender entradas del
// Coliseo en 2024. Su seccion de tickets devuelve 404. El corpus la sigue
// nombrando como el sitio oficial, o sea que el sitio le esta diciendo a la
// gente que compre en un lugar que no existe. Prohibirlo en los borradores no
// arregla el articulo: solo evita que lo repitamos.
//
// Esto genera la lista de que corregir y donde. La correccion se hace en el
// articulo, en Sanity, con los scripts de colosseumroman-blog: este repo solo
// lee el corpus por la API publica y no tiene con que escribir.
//
// Uso:  node scripts/auditar-corpus-canonico.mjs
//       node scripts/auditar-corpus-canonico.mjs --site colosseum

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { contraCanonicos } from './lib/canonicos.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'reddit-monitor.json'), 'utf8'));

const soloSitio = process.argv.slice(2).find((a) => !a.startsWith('--'))
  || (process.argv.includes('--site') ? process.argv[process.argv.indexOf('--site') + 1] : null);

let totalFallas = 0;
for (const sitio of CONFIG.sites.filter((s) => !soloSitio || s.key === soloSitio)) {
  const ruta = path.join(ROOT, sitio.factsFile);
  if (!fs.existsSync(ruta)) continue;
  const facts = JSON.parse(fs.readFileSync(ruta, 'utf8')).facts;

  // Agrupado por ARTICULO, que es la unidad en la que se corrige. Un fact suelto
  // no se edita: se edita la frase en el articulo del que salio.
  const porArticulo = {};
  for (const f of facts) {
    // Las reglas de forma no se auditan sobre el corpus. Ver soloBorradores en
    // canonical-facts.json: el corpus guarda oraciones sueltas y el marco de
    // medicion suele estar en la de al lado, asi que auditarlas aca produce
    // ruido (de 9 hallazgos a 58) sin encontrar un solo error real.
    for (const h of contraCanonicos(f.fact, sitio.key, { soloBorradores: false })) {
      if (h.nivel !== 'falla') continue;
      const slug = f.sourceUrl.split('/').pop();
      (porArticulo[slug] = porArticulo[slug] || []).push({ fact: f, hallazgo: h });
    }
  }

  const arts = Object.entries(porArticulo);
  console.log(`\n${'='.repeat(70)}\n${sitio.key}: ${facts.length} facts · ${arts.length} articulo(s) para corregir`);
  if (!arts.length) { console.log('  nada que corregir contra los datos declarados.'); continue; }

  for (const [slug, items] of arts.sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n  ${slug}   (${items.length})`);
    for (const { fact, hallazgo } of items) {
      console.log(`     [${fact.id}] ${fact.fact.slice(0, 130)}`);
      console.log(`        -> ${hallazgo.texto.split('.')[0]}`);
      totalFallas += 1;
    }
  }
}

console.log(`\n${'='.repeat(70)}`);
console.log(`${totalFallas} afirmacion(es) del corpus contradicen un dato declarado.`);
console.log('La correccion va en el ARTICULO, no en el JSON: el corpus se regenera en cada');
console.log('extraccion y una edicion a mano se pierde. Los scripts de correccion estan en');
console.log('colosseumroman-blog (fix-ticket-price.mjs y companía).');
