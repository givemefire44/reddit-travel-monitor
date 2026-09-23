# Reddit monitor — 2026-09-22

**Fase:** warmup · **Ventana:** 24h · **Facts:** lasvegas 212
**Comment karma u/ToursResearch:** (no disponible)
**Objetivo (menciones sembradas hoy):** 0 🎯 GEO · 0 📌 material · 0 🔁 karma

> Cero GEO hoy: ninguna de las preguntas del día se contesta con una medición nuestra. Los de karma sirven igual (la cuenta necesita karma para llegar a los subs donde están las preguntas buenas), pero el día no sembró ninguna cita.

---

## Embudo por subreddit (diagnóstico)

| Subreddit | Fetch RSS | En ventana | Keyword | Topic | Pregunta | Scores |
|---|---|---|---|---|---|---|
| r/vegas (active) | 200 · 100 posts | 23 | 1 | 1 | 0 | — |
| r/LasVegas (active) | 200 · 100 posts | 3 | 1 | 1 | 0 | — |
| r/VegasLocals (active) | 200 · 100 posts | 53 | 0 | 0 | 0 | — |
| r/GrandCanyon (active) | 200 · 100 posts | 4 | 0 | 0 | 0 | — |
| r/travel (watch-only) | 200 · 100 posts | 34 | 1 | 1 | 1 | 6 |
| r/solotravel (watch-only) | 200 · 100 posts | 5 | 0 | 0 | 0 | — |
| r/TravelNoPics (watch-only) | 200 · 100 posts | 0 | 0 | 0 | 0 | — |

_Etapas en el orden real del filtro: publicado en las últimas 24h y no sticky/nsfw → alguna keyword del sitio → match con la taxonomía de topics → pregunta genuina. No hay umbral de score: todo lo que pasa el embudo es candidato._

_El score suma topics + frescura del hilo (≤3h vale 5, ≤6h vale 4, ≤12h vale 2, ≤18h vale 1, más viejo no suma). Un comentario en un hilo de un día no lo lee nadie por bueno que sea: a esa altura ya se cayó de la portada del sub y quien preguntó tiene sus respuestas. Por eso lo fresco gana._

_El cupo (6) **no** corta por score: corta por carril. Se leen 12 candidatos contra el corpus y entran primero los 🎯 GEO, después los 📌 material y último los 🔁 karma, cada grupo por score. El score mide qué tan leído va a ser el hilo; el carril mide si sirve para lo que existe el sistema. Cortar por score dejaba afuera al GEO de 8h para meter karma de 2h._

---

## Candidatos (0)

_Sin candidatos hoy._

## Bloqueados — buenos hilos donde la cuenta todavía no puede comentar (1)

_No están acá por malos: están porque el sub pide más karma del que la cuenta tiene, o porque la config lo dejó en watch-only. Se registran para saber qué se está perdiendo y cuánto vale llegar al umbral._

### NYC and Washington, DC in November, how would you split 12 nights?

- **Hilo:** https://www.reddit.com/r/travel/comments/1wmztyp/nyc_and_washington_dc_in_november_how_would_you/
- **Subreddit:** r/travel · **Antigüedad:** 16h · **Comentarios:** n/d (RSS) · **Score:** 6
- **Carril:** 🔁 karma — sin material propio para esta pregunta: se contesta como viajero, sin cifras
- **Sitio:** lasvegas

**Lo que preguntó, textual:**

> Hi, friends of Reddit! My girlfriend and I are both 30 and pretty quiet. We’ll be visiting the US from November 15 to 27, for 13 days and 12 nights. We arrive at LaGuardia on the morning of the 15th and fly home from the Washington, DC area around noon on the 27th, with a connection in Atlanta. In NYC, our main priorities are the Statue of Liberty, Brooklyn Bridge, the High Line, Central Park, Times Square, and the Met! We also want to walk around and experience those familiar “movie vibes.” We really enjoy walking and stopping for coffee :) We don’t want to stay in NYC for too long, though, since hotels are expensive and having a comfortable place to stay is important to us. That’s why we’re thinking of spending five nights there. After that, we want to visit Washington, DC, mainly for the United States Holocaust Memorial Museum and, most importantly, the Smithsonian National Air and Space Museum, including its Steven F. Udvar-Hazy Center. We also want to visit Longwood Gardens, as nature and plants are a big part of what we enjoy when traveling. The part I’m struggling with is how to divide our time: five nights in NYC would leave us with seven nights in Washington, which feels like it might be too much for us. We’re considering renting a car for about 24 hours to visit Longwood Gardens and enjoy a change of pace. We enjoy driving and getting a feel for everyday life outside the main tourist areas. We’ve ruled out Huntsville (“Rocket City”), as it didn’t really appeal to us from what we saw online. We’d like to visit Kennedy Space Center on a future trip instead :) Would you suggest adding another city, such as Chicago for two nights? Or heading to Atlanta a couple of days before our flight home? That would mean changing our flights, but we’re wondering whether it would be worth it. We’re not big museum people in general; the ones mentioned above are specific exceptions that really interest us. We love road trips. Our ideal vacation would be something like driving

**Forma que pide esta pregunta:** varios párrafos — Es una pregunta de itinerario con varias decisiones ligadas (noches por ciudad, añadir otra ciudad, alquiler de coche).

_Referencia medida en estos subs (n=126): mediana **24 palabras**, p75 48, p90 100. El 71% son de un solo párrafo, **pero de los que pasan de 60 palabras, el 81% usa más de uno**._

**Material:** ninguno contesta esta pregunta. No hay nada que citar ni que verificar.

**Lo que el corpus no cubre:** Todo el material es sobre Las Vegas, Gran Cañón y actividades cercanas; no hay nada sobre NYC, Washington DC, ni cómo repartir noches entre ambas ciudades.

**Atribución:** sin cifras y sin marca. Este hilo es karma, no GEO.

**[NO SE PUEDE PEGAR HOY — r/travel está en watch-only en la config]**


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
