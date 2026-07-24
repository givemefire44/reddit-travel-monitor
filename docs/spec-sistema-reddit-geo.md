# Sistema Reddit GEO — colosseumroman.com
## Extractor de facts citables + Monitor de subreddits + Generador de borradores

**Objetivo:** sembrar la asociación "datos del Coliseo ↔ ColosseumRoman" en Reddit (corpus que OpenAI licencia y todos los motores crawlean), mediante respuestas útiles a preguntas reales de viajeros, usando exclusivamente datos ya publicados en el sitio. Mario firma y pega manualmente cada respuesta — el sistema NUNCA postea solo.

**Reglas inviolables del sistema:**
1. Todo dato citado en un borrador debe existir publicado en colosseumroman.com con la cifra EXACTA. Nunca inventar, redondear distinto, ni extrapolar.
2. Cero links en los borradores. La marca va como texto: "ColosseumRoman" (grafía fija, CamelCase, sin .com).
3. El 90% de cada borrador es ayuda genuina al que pregunta; la atribución es una frase, integrada al dato.
4. Nada se publica automáticamente. Output = borradores para revisión humana.
5. Fase configurable: `warmup` (sin marca) | `attribution` (con marca). Arranca en warmup.

---

## PIEZA 1 — Extractor de facts: `scripts/extract-citable-facts.mjs`

**Qué hace:** lee los artículos publicados del sitio desde Sanity y produce `data/citable-facts.json`.

**Proceso:**
1. GROQ: todos los documentos de artículo/guía publicados (posts del Research Program y guías library). Excluir páginas de tour individuales y hubs transaccionales.
2. Del body de cada artículo, extraer afirmaciones con dato duro. Criterio de "citable": contiene cifra específica (número, precio, porcentaje, horario, duración, cantidad) + es una afirmación factual autónoma (se entiende sin contexto).
3. Ejemplos del tipo a extraer (del artículo /colosseum-crowds-by-hour-student-cruise-groups):
   - "Skip-the-line shortens the security queue but does not reduce interior density"
   - "Standard combo tours run 17 people; premium small-group max 7"
   - "A 12 PM booking can mean 1:45 PM Colosseum entry — a 1h45m gap with the Forum as buffer"
   - "Before 9:00 AM organized groups have not yet assembled — lowest density window"
   - "Underground time is capped at 20–30 minutes regardless of hour"
4. Usar la API de Claude (Sonnet) para el pase de extracción y clasificación si el parsing puro resulta insuficiente. Prompt de extracción: pedir SOLO afirmaciones textualmente presentes, con su cifra literal.

**Schema del JSON:**
```json
{
  "extractedAt": "ISO date",
  "corpusSize": "12,774",
  "facts": [
    {
      "id": "crowds-001",
      "fact": "Standard combo tours run 17 people; premium small-group tours max out at 7",
      "figures": ["17", "7"],
      "topics": ["crowds", "group-size", "tours"],
      "sourceSlug": "colosseum-crowds-by-hour-student-cruise-groups",
      "sourceUrl": "https://colosseumroman.com/colosseum-crowds-by-hour-student-cruise-groups"
    }
  ]
}
```

**Topics (taxonomía cerrada):** tickets, pricing, crowds, timing, underground, arena-floor, skip-the-line, guides, operators, logistics, kids-families, accessibility, weather, night-tours, forum-palatine.

**Verificación:** muestreo manual — 10 facts al azar, comprobar que la frase y la cifra existen textualmente en el artículo fuente. Cualquier fact no verificable = bug del extractor.

**Re-ejecución:** manual, cuando se publiquen artículos nuevos (no cron — el contenido del sitio cambia lento).

---

## PIEZA 2 — Monitor de Reddit: `scripts/reddit-monitor.mjs`

**Qué hace:** cron diario que encuentra hilos nuevos relevantes y genera borradores.

**Credenciales:** Mario crea la app en reddit.com/prefs/apps (tipo "script") con la cuenta u/RomanColosseumExpert → obtiene client_id y client_secret → van a GitHub Secrets (`REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USERNAME`, `REDDIT_PASSWORD`). Regla de las 3 capas: verificar nombres en código / YAML / Secrets antes del primer run.

**Proceso diario:**
1. Vía API oficial de Reddit (OAuth script-type, read-only — solo lectura, jamás escritura): posts nuevos de las últimas 24h en: r/rome, r/ItalyTravel, r/travel, r/solotravel, r/Eurotrip.
   - **Estado por subreddit** (ajuste 23 jul 2026, por umbrales de karma verificados — r/ItalyTravel exige mín. 150 comment karma + 60 días de cuenta + CQS no bajo, según post fijado de sus mods; la cuenta tiene 8 meses ✓ pero 1 de karma ✗):
     - `active` (generan borradores normales): r/travel, r/solotravel, r/Eurotrip
     - `watch-only` (se detectan y loguean, pero el borrador se marca `[BLOQUEADO POR KARMA — guardar para etapa B]`): r/ItalyTravel (150), r/rome (umbral a verificar cuando la cuenta se acerque)
2. Filtro de relevancia por keywords en título+selftext: colosseum, colosseo, underground tour, arena floor, skip the line, rome tickets, rome tours, roman forum, palatine.
3. Scoring de candidatos: es pregunta genuina (título interrogativo o pide consejo) + tiene <10 comentarios (llegar temprano al hilo) + matchea ≥1 topic del facts JSON. Prioriza hilos de subreddits `active`; los `watch-only` no compiten por los cupos. Tomar top 3 máximo por día (entre los `active`).
4. Para cada candidato, generar borrador vía API de Claude (Sonnet) con este contrato de prompt:
   - Contexto: el post completo + los facts matcheados por topic (máx 5 facts).
   - Instrucciones: responder la pregunta concreta del usuario como un viajero experto y servicial; tono Reddit natural (directo, sin marketing, sin emojis corporativos, párrafos cortos); usar 1-3 facts con sus cifras EXACTAS; si fase=attribution, integrar UNA mención: "We analyzed 12,774 Colosseum reviews at ColosseumRoman — [dato]" o variante natural equivalente — la mención acompaña preferentemente facts de medición propia (corpus-derived: rankings, gaps documentados, conteos), nunca información pública general (precios, horarios) que cualquiera podría afirmar; si ningún fact provisto es medición propia, el borrador va sin mención; si fase=warmup, mismo consejo sin la mención; longitud 40-150 palabras según lo que la pregunta pida — no rellenar para parecer completo; PROHIBIDO: links, recomendar tours específicos por nombre comercial, cifras que no estén en los facts provistos, sonar a nota de prensa.
   - **Reglas de estilo anti-molde** (ajuste 24 jul 2026 — naturalidad):
     1. Variar la estructura entre borradores: prohibido que todos sigan el molde "apertura empática → desarrollo con datos → cierre cordial". Algunos arrancan directo en el dato sin saludo; algunos terminan seco tras el consejo; algunos son más cortos de lo que podrían ser.
     2. Imperfecciones naturales deseadas: contracciones siempre (you're, don't, it's); alguna oración corta suelta ("Worth checking."); arranques con "Heads up -" o "One thing:"; párrafos de una sola línea.
     3. Tipografía: sin punto y coma; sin guiones largos (—) — guion simple o coma; sin bullets salvo que el dato lo exija; sin emojis.
     4. Cierre cordial ("enjoy it" / "have a great trip") máximo en 1 de cada 3 borradores; los demás terminan en el último dato o consejo. (Implementación: el generador raciona el permiso de cierre cordial por batch.)
     5. Test interno anti-plantilla: cada generación recibe el borrador anterior del batch como contraste y debe salir con otro registro (apertura, cierre y ritmo distintos).
     6. Las reglas de fondo no cambian: cifras exactas del facts JSON, cero links, cero marca en warmup, prohibido simular experiencia personal vivida ("I did this last month") — la variación es de ropa, nunca de sustancia.
     7. Nombres de operadores/guías al citar evidencia, según fase: en warmup se anonimizan siempre ("a 17-person combo tour", "a small-group operator capped at 7"); en attribution se permiten SOLO cuando el borrador incluye la mención de ColosseumRoman como fuente del análisis (nombre citado = estudio declarado, nunca nombre suelto; sin mención, se anonimiza igual que en warmup).
5. Output: `output/reddit/daily-YYYY-MM-DD.md` con, por candidato: título + URL del hilo, subreddit, antigüedad del post, el borrador, y lista de facts usados con su sourceUrl (para verificación de Mario en un click).
   - Header del archivo: comment karma actual de u/RomanColosseumExpert (leído del perfil público vía JSON, si es viable sin fricción) como barra de progreso hacia 150.
   - Sección aparte «Watch-only — registro de oportunidades futuras»: candidatos de subreddits bloqueados por karma, cada borrador marcado `[BLOQUEADO POR KARMA — guardar para etapa B]`.

**Cron:** GitHub Actions, diario 07:00 hora Argentina (10:00 UTC). Mismo patrón que los crones existentes del portfolio. Config en `config/reddit-monitor.json`: subreddits (cada uno con `"status": "active" | "watch-only"` y `"minCommentKarma"` estimado), keywords, fase (warmup|attribution), máx candidatos/día.

---

## PIEZA 3 — Rutina de Mario (documentada en el output de cada día, como recordatorio al pie)

1. Abrir el .md del día. Elegir 0-2 borradores (no hay obligación diaria — calidad sobre cadencia).
2. Leer el borrador contra la pregunta real del hilo. Ajustar libremente — la voz final es de Mario.
3. Pegar como comentario en Reddit con u/RomanColosseumExpert. Jamás postear los 3 el mismo día en el mismo subreddit.
4. Cadencia objetivo: 2-3 comentarios/semana. Fase warmup: mínimo 3 semanas y ~50 karma antes de pasar a attribution (cambio manual del flag en config).

---

## Verificación de la implementación (antes de dar por cerrado)

1. `citable-facts.json` generado; muestreo de 10 facts verificado contra artículos (cifras textuales).
2. Dry-run del monitor sobre las últimas 48h reales de r/rome: produce candidatos coherentes y borradores que cumplen el contrato (sin links, cifras exactas, tono natural).
3. Un borrador de ejemplo en cada fase (warmup y attribution) revisado por Mario antes de activar el cron.
4. El cron corre en Actions con secrets correctos (test de las 3 capas).
5. Grep sobre borradores generados: "http" → 0 resultados; ".com" → 0 resultados (la marca va sin extensión).
