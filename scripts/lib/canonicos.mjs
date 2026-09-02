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

// Cuanto vale una verificacion antes de tener que repetirla. Por regla con
// "caducaEnDias"; si no, esto.
//
// No es un detector, es un recordatorio, y la diferencia importa. Lo que paso
// con CoopCulture no lo habria cazado ningun plazo: los precios se verificaron
// el 19 ago 2026 contra un vendedor que ya no vendia desde 2024, y catorce dias
// despues seguian "frescos". Eso lo caza ir a mirar, o el chequeo contra la web.
// La caducidad sirve para lo otro, que es lo que pasa siempre: nadie vuelve a
// mirar nunca, y un dato de hace ocho meses se sigue citando como verificado.
const CADUCIDAD_DEFAULT = 90;

const diasDesde = (iso) => (iso ? Math.floor((Date.now() - Date.parse(iso)) / 86400000) : null);

function vencida(regla) {
  const dias = diasDesde(regla.verifiedAt);
  if (dias == null) return null;
  const tope = regla.caducaEnDias ?? CADUCIDAD_DEFAULT;
  return dias > tope ? { dias, tope } : null;
}

// Estado de todas las reglas, para mostrarlo donde Mario mira todos los dias:
// el encabezado del reporte del monitor. Un recordatorio que hay que ir a buscar
// no es un recordatorio.
export function vencimientos() {
  if (!fs.existsSync(RUTA)) return { vencidas: [], porVencer: [], sinVerificar: [], enDisputa: [] };
  const { reglas } = JSON.parse(fs.readFileSync(RUTA, 'utf8'));
  const out = { vencidas: [], porVencer: [], sinVerificar: [], enDisputa: [] };
  for (const r of reglas) {
    if (r.estado === 'en-disputa') { out.enDisputa.push(r.label); continue; }
    if (r.estado !== 'verificado') { out.sinVerificar.push(r.label); continue; }
    const dias = diasDesde(r.verifiedAt);
    const tope = r.caducaEnDias ?? CADUCIDAD_DEFAULT;
    if (dias == null) continue;
    if (dias > tope) out.vencidas.push(`${r.label} (verificado hace ${dias} días)`);
    else if (dias > tope - 15) out.porVencer.push(`${r.label} (vence en ${tope - dias} días)`);
  }
  return out;
}

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

        const caduco = vencida(regla);
        if (regla.estado === 'en-disputa') {
          hallazgos.push({
            nivel: 'falla',
            texto: `"${regla.label}": el borrador afirma ${dicho}, y este dato esta EN DISPUTA entre nuestros propios articulos. No publicar hasta verificarlo. ${regla.source}`,
          });
        } else if (dicho !== regla.expected) {
          // Una verificacion vencida deja de mandar: la cifra sigue siendo la
          // declarada, pero contradecirla baja de falla a aviso, porque la
          // realidad pudo haber cambiado y el que no miro fui yo.
          const manda = regla.estado === 'verificado' && !caduco;
          hallazgos.push({
            nivel: manda ? 'falla' : 'aviso',
            texto: `"${regla.label}": el borrador dice ${regla.symbol || ''}${dicho} y el valor declarado es ${regla.symbol || ''}${regla.expected}`
              + (manda ? ` (verificado ${regla.verifiedAt}, ${regla.source})`
                : caduco ? ` — pero esa verificacion es del ${regla.verifiedAt}, hace ${caduco.dias} dias, asi que ninguno de los dos numeros es de fiar`
                  : ` (consenso interno, sin verificar)`),
          });
        } else if (caduco) {
          // Coincide con lo declarado, pero lo declarado vencio. Se avisa igual:
          // repetir un dato viejo con confianza es como se publican los errores.
          hallazgos.push({
            nivel: 'aviso',
            texto: `"${regla.label}": ${regla.symbol || ''}${dicho} coincide con lo declarado, pero se verifico hace ${caduco.dias} dias (tope ${caduco.tope}). Conviene reconfirmarlo antes de publicarlo otra vez.`,
          });
        }
        break; // un hallazgo por regla y por oracion alcanza
      }
    }
  }
  return hallazgos;
}
