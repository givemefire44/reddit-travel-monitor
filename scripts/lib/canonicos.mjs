// Compara un borrador contra los datos declarados en data/canonical-facts.json.
//
// POR QUE EXISTE, Y POR QUE NO ES EL CHEQUEO DEL CORPUS
//
// El chequeo del corpus responde "¿esta cifra esta publicada en algun articulo
// nuestro?". Es la regla dura numero uno y sirve contra la invencion. No sirve
// contra la CONTRADICCION: si dos articulos dicen cosas distintas, las dos
// cifras estan en el corpus y las dos pasan.
//
// Eso se publico. El 29 ago 2026 un comentario en r/rome dijo que el Full
// Experience "con arena floor y underground" sale 7 dias antes. Los dos numeros
// estaban en el corpus. El del arena es correcto; el del subterraneo dice 30 en
// cuatro articulos del sitio. Alguien planificaba su viaje con eso, y lo
// descubrimos porque volvio a preguntar.
//
// Aca la pregunta es otra: "¿esta cifra es la que declaramos correcta?".
//
// LOS TRES ESTADOS
//
//   verificado       alguien miro la fuente oficial. Otra cifra es FALLA.
//   consenso-interno es lo que dicen nuestros articulos, sin verificar afuera.
//                    Otra cifra es aviso: puede que el articulo este viejo.
//   en-disputa       nuestros propios articulos se contradicen. Afirmar
//                    CUALQUIER cifra es FALLA, hasta que alguien lo cierre.
//
// El tercero es el que importa y el que el modelo del portfolio no tenia. Sin
// el, un dato en disputa se publica igual: el borrador cita uno de los dos
// articulos, el chequeo del corpus lo aprueba, y nadie se entera de que el otro
// articulo dice lo contrario.
//
// QUE NO HACE
//
// No busca contradicciones por su cuenta. Eso se probo tres veces en
// colosseumroman-blog el 19 ago 2026 y dio 12, 219 y 218 alertas, todas falsas:
// las cifras del sitio viven en tablas comparativas y fichas de tours, donde ser
// distintas es lo correcto, y de las palabras vecinas no se deduce si dos
// numeros hablan de lo mismo. Aca se declara y se verifica, nada mas.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const RUTA = path.join(ROOT, 'data', 'canonical-facts.json');

export function contraCanonicos(texto) {
  if (!fs.existsSync(RUTA)) return [];
  const { reglas } = JSON.parse(fs.readFileSync(RUTA, 'utf8'));
  const hallazgos = [];

  for (const regla of reglas) {
    // Reglas PROHIBIDAS: no hay cifra que comparar, hay algo que no se puede
    // afirmar. Hicieron falta el 2 sep 2026, cuando se verifico que CoopCulture
    // dejo de vender entradas del Coliseo: el corpus la sigue nombrando como el
    // sitio oficial en seis facts, y una regla numerica no caza eso.
    if (regla.prohibido) {
      for (const p of regla.prohibido) {
        const m = texto.match(new RegExp(p, 'i'));
        if (!m) continue;
        hallazgos.push({
          nivel: 'falla',
          texto: `"${regla.label}": el borrador dice "${m[0].trim().slice(0, 60)}". ${regla.motivo} (verificado ${regla.verifiedAt})`,
        });
        break;
      }
      continue;
    }

    // excludeIf mira la ORACION, no el texto entero: en un comentario corto
    // casi siempre aparece alguna palabra de exclusion en algun lado, y con el
    // texto entero la regla no se dispararia nunca.
    for (const oracion of texto.split(/(?<=[.!?])\s+/)) {
      if (regla.excludeIf && new RegExp(regla.excludeIf, 'i').test(oracion)) continue;
      for (const p of regla.patterns) {
        const m = oracion.match(new RegExp(p, 'i'));
        if (!m || !m[1]) continue;
        const dicho = Number(m[1]);
        if (Number.isNaN(dicho)) continue;

        if (regla.estado === 'en-disputa') {
          hallazgos.push({
            nivel: 'falla',
            texto: `"${regla.label}": el borrador afirma ${dicho}, y este dato esta EN DISPUTA entre nuestros propios articulos. No publicar hasta verificarlo. ${regla.source}`,
          });
        } else if (dicho !== regla.expected) {
          hallazgos.push({
            nivel: regla.estado === 'verificado' ? 'falla' : 'aviso',
            texto: `"${regla.label}": el borrador dice ${regla.symbol || ''}${dicho} y el valor declarado es ${regla.symbol || ''}${regla.expected}`
              + (regla.estado === 'verificado' ? ` (verificado ${regla.verifiedAt}, ${regla.source})` : ` (consenso interno, sin verificar)`),
          });
        }
        break; // un hallazgo por regla y por oracion alcanza
      }
    }
  }
  return hallazgos;
}
