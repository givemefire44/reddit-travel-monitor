# Sistema Reddit GEO — portfolio Intercoper

Hermano del monitor de Quora (`docs/spec-quora.md`), y desde el 27 ago 2026 con
la misma decisión de fondo: **el script no redacta**.

Este documento existe para que cualquier sesión de Claude, abierta en cualquier
carpeta, pueda hacer el trabajo sin depender de la memoria de otra conversación.
Si estás leyendo esto y no sabés nada del sistema, alcanza con esto.

---

## Para qué existe

Para que un dato medido por nosotros quede publicado en Reddit **junto al nombre
del sitio que lo midió**. Reddit es corpus que OpenAI licencia y que todos los
motores crawlean: un comentario que dice *"analizamos ~12.000 reseñas del Coliseo
en ColosseumRoman y los slots del subterráneo se cortan en 20-30 minutos"* es una
cita con fuente. El mismo dato sin el nombre es huérfano.

El karma **no es el objetivo, es el peaje**. Los subs donde están las preguntas
buenas piden karma para dejarte comentar (r/ItalyTravel: 150 de comment karma +
60 días de cuenta + CQS no bajo, regla publicada y verificada el 8 ago 2026).

De ahí los tres carriles con los que el reporte marca cada hilo:

| Carril | Cuándo | Marca |
|---|---|---|
| 🎯 **GEO** | hay un fact que es **medición nuestra**: un % del corpus de reseñas, un gap documentado, un promedio, un conteo | **sí**, una sola mención |
| 📌 **material** | contesta con datos, pero **públicos**: precio oficial, horario, qué incluye un ticket | no |
| 🔁 **karma** | no hay material para *esa* pregunta; se contesta como viajero, **sin una sola cifra** | no |

Pegarle la marca a un precio oficial no es una cita, es un aviso, y se nota. Por
eso la mención solo viaja con medición propia.

## Reglas inviolables

1. Toda cifra citada existe publicada en el sitio con la cifra **exacta**. Nunca
   inventar, redondear distinto ni extrapolar.
2. Cero links y cero dominios. La marca va como texto: `ColosseumRoman`,
   CamelCase, sin `.com`.
3. Nada se publica automáticamente, y **el script nunca postea**. Es read-only.
4. En Reddit **no se firma**. (En Quora sí. Ver la tabla de diferencias en la
   skill `reddit-answer-triage`.)
5. Prohibido simular experiencia vivida, y prohibido negarla. La presencia física
   no se toca en ninguna dirección.

---

## PIEZA 1 — Extractor de facts: `scripts/extract-citable-facts.mjs`

Lee los artículos publicados de cada sitio desde Sanity y produce un
`data/citable-facts-<sitio>.json` con las afirmaciones que tienen dato duro
(cifra específica + afirmación factual autónoma), cada una con sus topics y su
`sourceUrl`.

```bash
node scripts/extract-citable-facts.mjs --site vatican
```

Corpus vivos: `colosseum` 873 · `vatican` 149 · `pompeii` 118 · `milan` 84 ·
`trastevere` 70.

**Los IDs de los facts NO son estables**: se reasignan en cada extracción.
Cualquier pendiente que anotes, anotalo por texto, nunca por id.

**El corpus se arregla en el artículo, nunca en el JSON.** Si un fact tiene un
dato viejo se corrige el artículo en Sanity y se re-extrae; editar el JSON a mano
se pierde en la próxima corrida.

---

## PIEZA 2 — Monitor: `scripts/reddit-monitor.mjs`

Doble clic en `run-monitor.bat`. Espera hilos nuevos en los subreddits de
`config/reddit-monitor.json` (17 al 27 ago 2026) y entrega los mejores del día.

```
fetch RSS  →  ventana 24h, no sticky/nsfw
           →  JUEZ de relevancia      (lib/relevancia.mjs, Haiku, 1 llamada por post)
           →  pregunta genuina
           →  dedup de crossposts + guard de "ya comentamos ahí"
           →  SELECTOR de material    (lib/elegir-facts.mjs, Sonnet, sobre el doble del cupo)
           →  orden por CARRIL, corte por cupo
```

**El juez** (`lib/relevancia.mjs`) reemplazó a las listas de keywords escritas a
mano, que no convergían: cada corrida producía un parche del mismo bug. Devuelve
si el post se puede contestar, con qué sitio, **y qué están preguntando de
verdad, en una línea**.

**El selector** (`lib/elegir-facts.mjs`) lee los facts **contra esa pregunta** y
se queda con los que la contestan, o dice que ninguno. Existe porque el picker
por topics encuentra facts del mismo *tema*, que no es lo mismo: a "¿los
estudiantes de arquitectura entran gratis?" le adjuntaba los cinco facts de
precios de entrada. Devuelve además:

- **`forma`** — cuánto texto pide *esta* pregunta: un renglón / dos o tres frases
  / un párrafo / varios párrafos. Es lo que reemplaza al molde único.
- **`citable`** — cuál de los facts elegidos es medición propia, o sea si la
  respuesta puede llevar la marca. Es lo que decide el carril.

**El cupo corta por carril, no por score.** El score mide qué tan leído va a ser
el hilo (frescura); el carril mide si sirve para lo que existe el sistema.
Cortando por score, un GEO de 8h perdía contra un karma de 2h.

### Banderas

```bash
node scripts/reddit-monitor.mjs --label local           # la corrida normal
node scripts/reddit-monitor.mjs --dry-run               # no toca el daily del bot
node scripts/reddit-monitor.mjs --solo-subs rome,travel # probar sin esperar 17 fetch
node scripts/reddit-monitor.mjs --con-borrador          # reactiva la generación (ver abajo)
```

### Por qué no redacta

No porque la generación esté rota: sus guards están puestos y verificados. Lo
que no funciona es el resultado. Mario, sobre los borradores del 27 ago 2026:
*"son muy prolijas perfectas, los humanos no respondemos así"*.

Los 76 comentarios humanos medidos ese día en esos mismos subs le dan la razón
con números — `scripts/analizar-humanos.mjs`:

```
p25 16 · MEDIANA 28 · p75 50 · p90 90 palabras
16% de 10 palabras o menos · 82% de 60 o menos
100% de UN SOLO párrafo · 33% de UNA SOLA oración
```

El generador venía produciendo 150-190 palabras en tres o cuatro párrafos: arriba
del percentil 90 de largo **y** estructuralmente único en la muestra. Y siempre
con el mismo molde.

Eso no se arregla con otra regla de prompt. Cada regla tapa un tell y el modelo
encuentra el siguiente; tres rondas de eso costaron una semana. A dos o tres
comentarios por semana, automatizar justo la parte cara es el peor canje posible.

La capa de generación sigue en el código y se reactiva con `--con-borrador`.
**No se borró a propósito**, para que quede la evidencia de que se probó.

---

## PIEZA 3 — Búsqueda: `scripts/buscar-reddit.mjs`

El monitor **espera**; esto **busca**. Le pregunta a Brave `site:reddit.com` con
consultas escritas como escribe alguien con el problema, y evalúa los resultados
con el mismo juez.

```bash
node scripts/buscar-reddit.mjs           # todos los dominios
node scripts/buscar-reddit.mjs booking   # uno solo
node scripts/buscar-reddit.mjs --rehacer # ignora el ledger de ya-vistos
```

Existe porque el monitor pasivo esperaba, y esperaba en el lugar equivocado: los
9 subs originales los elegimos adivinando, y una búsqueda de treinta segundos
encontró las preguntas en r/loveholidays, r/LegalAdviceUK, r/RomeTravel y
r/ItalyTravelAdvice, ninguno en la lista.

Escribe `output/reddit/busqueda-YYYY-MM-DD.md`, partido en **frescos** (≤7 días),
**recientes** (8-90) y **viejos** (+90). Los viejos **no dan karma** — nadie los
lee ya — pero **sí quedan indexados**, que es lo que un motor de IA cita después.
Un hilo viejo vale la pena si es GEO; si es karma, no vale nunca. Y antes de
contestar uno, mirar las reglas del sub: varios prohíben el necroposting.

---

## PIEZA 4 — El circuito real

1. Mario hace doble clic en `run-monitor.bat`.
2. Pega el reporte en el chat.
3. **Claude tría**: dice cuáles valen la pena y cuáles no, con el motivo.
4. **Claude escribe** las que valen, con la forma que pide cada pregunta.
5. Mario las pega en Reddit y avisa.
6. Claude registra la huella de estilo:
   `node scripts/publicado.mjs --texto <archivo> --url "<url>" --red reddit`

Los pasos 3 y 4 los guía la skill **`reddit-answer-triage`**. La voz de quien
firma está en **`mario-dalo-voice`**.

Antes de pegar, el verificador de las reglas que se pueden contar:

```bash
node scripts/check-answer.mjs comentario.txt --red reddit --pregunta "<la pregunta del hilo>"
```

Chequea superlativos, presencia física en las dos direcciones, rayas largas,
largo contra los percentiles reales, menciones de marca, socios comerciales
(nunca nombrar GetYourGuide ni Viator), negaciones de inexistencia, y la huella
de estilo contra todo lo ya publicado. Con `--pregunta` agrega la **lectura
ciega**: un pase que lee el comentario sin saber qué quisiste decir.

Y corre el **chequeo contra la web** (`lib/verificar-afuera.mjs`, `--sin-red` lo
apaga), que cubre el hueco que deja la regla del corpus: "toda cifra sale de un
fact" protege los números y no protege el resto de la oración, que en carril
karma es el comentario entero. Extrae las afirmaciones verificables, busca cada
una en Brave y dicta `respaldada` / `contradicha` / `depende` / `sin-evidencia`.
Con `--site`, los facts que respaldan las cifras del texto se le pasan al
extractor para que **no** salga a buscar lo que el corpus ya sostiene.

Existe por un caso publicado: el 28 ago 2026 un comentario en r/rome afirmó que
pagar el servicio de mesa en un bar italiano "te compra la mesa" y que podés
quedarte lo que quieras. No existe un derecho de mesa: hay una tarifa más alta
por consumir sentado, y cuánto te dejan quedarte lo decide cada bar. No fue una
cifra inventada, fue una regla limpia sobre algo que varía por local — y la
regla limpia se lee mejor, que es exactamente por lo que se cuela.

`data/publicados.json` es **compartido con Quora** a propósito: una muletilla
gastada en Quora sigue siendo la misma muletilla en Reddit, bajo el mismo nombre
y en el mismo rubro.

### Cadencia

2-3 comentarios por semana. Nunca dos el mismo día en el mismo subreddit: es el
patrón que Reddit marca como spam desde una cuenta nueva. Cero es un resultado
válido — calidad sobre cadencia.

---

## Gotchas verificados

**El cron de Actions no corre solo, y es a propósito.** Los feeds RSS dan 403
desde las IPs de datacenter y abren desde IP residencial. Además el karma depende
de llegar temprano al hilo: un reporte de las 07:00 llega con horas encima cuando
Mario se sienta a comentar. Queda `workflow_dispatch` para dispararlo a mano.

**El feed no siempre trae el cuerpo del post.** Cuando no lo trae, la pregunta y
los facts salieron del **título solo**, y el reporte lo avisa con un ⚠️. No
contestar a ciegas: el 26 ago 2026 un post que parecía "revisá mi itinerario"
listaba cinco preocupaciones numeradas y el comentario contestó media pregunta.

**Un sitio nuevo en `config.sites` necesita también su taxonomía de topics en
`TOPIC_KEYWORDS_BY_SITE`.** Pompeya y Milán entraron el 25 ago sin ella, y como
`bestSiteByFacts` recorre todos los sitios, un solo post que los mencionara
tumbaba el **subreddit entero**. r/ItalyTravel y r/ItalyTravelAdvice — los dos
mejores — figuraron días como "FETCH ERROR" con el fetch devolviendo 200.
Arreglado el 27 ago, con un `|| {}` de cinturón para que la próxima vez degrade
en vez de romperse.

**El modo tracción está apagado** desde el 20 ago: old.reddit pasó a exigir login
(302 → `/login/?reason=lor2`) y era la única fuente de puntaje y número de
comentarios. Si Reddit reabre old.reddit, `traction.enabled` a `true`.
