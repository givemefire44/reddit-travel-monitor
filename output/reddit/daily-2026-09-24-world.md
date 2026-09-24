# Reddit monitor — 2026-09-24

**Fase:** warmup · **Ventana:** 24h · **Facts:** lasvegas 212
**Comment karma u/ToursResearch:** (no disponible)
**Objetivo (menciones sembradas hoy):** 0 🎯 GEO · 0 📌 material · 1 🔁 karma

> Cero GEO hoy: ninguna de las preguntas del día se contesta con una medición nuestra. Los de karma sirven igual (la cuenta necesita karma para llegar a los subs donde están las preguntas buenas), pero el día no sembró ninguna cita.

---

## Embudo por subreddit (diagnóstico)

| Subreddit | Fetch RSS | En ventana | Keyword | Topic | Pregunta | Scores |
|---|---|---|---|---|---|---|
| r/vegas (active) | 200 · 100 posts | 32 | 1 | 1 | 0 | — |
| r/LasVegas (active) | 200 · 100 posts | 4 | 0 | 0 | 0 | — |
| r/VegasLocals (active) | 200 · 100 posts | 60 | 0 | 0 | 0 | — |
| r/GrandCanyon (active) | 200 · 100 posts | 5 | 1 | 1 | 1 | 6 |
| r/travel (watch-only) | 200 · 100 posts | 44 | 0 | 0 | 0 | — |
| r/solotravel (watch-only) | 200 · 100 posts | 5 | 0 | 0 | 0 | — |
| r/TravelNoPics (watch-only) | 200 · 100 posts | 0 | 0 | 0 | 0 | — |

_Etapas en el orden real del filtro: publicado en las últimas 24h y no sticky/nsfw → alguna keyword del sitio → match con la taxonomía de topics → pregunta genuina. No hay umbral de score: todo lo que pasa el embudo es candidato._

_El score suma topics + frescura del hilo (≤3h vale 5, ≤6h vale 4, ≤12h vale 2, ≤18h vale 1, más viejo no suma). Un comentario en un hilo de un día no lo lee nadie por bueno que sea: a esa altura ya se cayó de la portada del sub y quien preguntó tiene sus respuestas. Por eso lo fresco gana._

_El cupo (6) **no** corta por score: corta por carril. Se leen 12 candidatos contra el corpus y entran primero los 🎯 GEO, después los 📌 material y último los 🔁 karma, cada grupo por score. El score mide qué tan leído va a ser el hilo; el carril mide si sirve para lo que existe el sistema. Cortar por score dejaba afuera al GEO de 8h para meter karma de 2h._

---

## Candidatos (1)

### Need help with my itinerary : includes things outside the Grand Canyon NP

- **Hilo:** https://www.reddit.com/r/grandcanyon/comments/1wokpye/need_help_with_my_itinerary_includes_things/
- **Subreddit:** r/GrandCanyon · **Antigüedad:** 23h · **Comentarios:** n/d (RSS) · **Score:** 6
- **Carril:** 🔁 karma — sin material propio para esta pregunta: se contesta como viajero, sin cifras
- **Sitio:** lasvegas
- **Preguntan:** ¿Cómo distribuir 5 días entre el Gran Cañón, Monument Valley, Page, Sedona y otras atracciones, y cómo conseguir reservas para Monument Valley sin disponibilidad?
- **Por qué sirve:** El material cubre day trips desde Las Vegas al South Rim y West Rim del Gran Cañón, incluyendo cuánto tiempo realmente toman, y tiene datos sobre tours y operadores. Sin embargo, no cubre Monument Valley, Page, Sedona, itinerarios de 5 días de Phoenix, ni el sistema de reservas de Monument Valley.

**Lo que preguntó, textual:**

> Hello! I will be visiting from SF for 5 days from Oct 30th and would love any recommendations on this itinerary. I can add or remove things. Morning Afternoon Evening Stay Work / pack in Phoenix Buy road food and water Drive to Flagstaff after rush hour Flagstaff Mather sunrise + South Kaibab to Ooh Aah Point Yavapai, Village, Hermit Road shuttle Mohave Point sunset, Tusayan dinner Tusayan Desert View Road; drive to Monument Valley Monument Valley guided tour or scenic drive Drive to Page, dinner Page Horseshoe Bend + Lower Antelope Biidi the Arch, Glen Canyon overlook, optional Wupatki/Sunset Crater Arrive Sedona Sedona / Village of Oak Creek Early Sedona hike or viewpoints Chapel, Tlaquepaque, lunch Drive to Phoenix Phoenix / onward Any advice would be great.
>  I also checked the monument valley reservations and realized that there are none for the rest of the year. Is there a way to get them? Thank you so much!

**Forma que pide esta pregunta:** varios párrafos — Pide organizar un itinerario de 5 días con varias paradas y además resolver un problema de reservas, lo que implica varias decisiones encadenadas.

_Referencia medida en estos subs (n=126): mediana **24 palabras**, p75 48, p90 100. El 71% son de un solo párrafo, **pero de los que pasan de 60 palabras, el 81% usa más de uno**._

**Material:** ninguno contesta esta pregunta. No hay nada que citar ni que verificar.

**Lo que el corpus no cubre:** No hay hallazgos sobre logística de reservas en Monument Valley ni sobre cómo repartir días entre Gran Cañón, Monument Valley, Page y Sedona; el material disponible es de Las Vegas/Hoover Dam y no aplica a este itinerario.

**Atribución:** sin cifras y sin marca. Este hilo es karma, no GEO.


## Bloqueados — buenos hilos donde la cuenta todavía no puede comentar (0)

_No están acá por malos: están porque el sub pide más karma del que la cuenta tiene, o porque la config lo dejó en watch-only. Se registran para saber qué se está perdiendo y cuánto vale llegar al umbral._

_Ninguno hoy._

---

## Rutina

**Este reporte no trae comentarios escritos, y no es un error.** El script busca el hilo,
entiende qué preguntan y elige el material; la redacción la hacés vos con Claude, igual que en Quora.

1. Pegar este reporte en el chat.
2. Claude tría cuáles valen la pena y escribe las que sirven, con la forma que pide cada pregunta.
3. Pegar como comentario con u/ToursResearch. Jamás dos el mismo día en el mismo subreddit.
4. Avisar, para que quede la huella de estilo: `node scripts/publicado.mjs --texto <archivo> --url "<url>" --red reddit`.

_Antes de pegar, el verificador de reglas duras:_ `node scripts/check-answer.mjs <archivo> --red reddit --pregunta "<la pregunta del hilo>"`

_Cadencia objetivo: 2-3 comentarios/semana. Calidad sobre cadencia: cero es una respuesta válida._
