---
name: quora-answer-triage
description: |
  Triar y escribir las respuestas de Quora del portfolio Intercoper
  (ColosseumRoman, VaticanTourGuides, TrastevereFoodTour). Usar SIEMPRE que
  Mario pegue el output del monitor de Quora (un markdown con bloques "###" que
  traen "**Pregunta:**", "**Material disponible para contestarla:**" y
  "**Firma:**"), o cuando pida evaluar qué preguntas de Quora vale la pena
  contestar, escribir una respuesta de Quora, revisar una que ya escribió, o
  humanizar una que se lee como IA. Dispara con frases como "que hacemos con
  estos", "cuales respondo", "escribime la de X", "tiré el quora", "corri el
  monitor", "esta respuesta se nota que es una IA", "daily-YYYY-MM-DD-local.md".
  Produce un veredicto por pregunta con su motivo y las respuestas completas
  listas para pegar, con toda cifra respaldada por el corpus. NO usar para
  Reddit: para eso está reddit-response-drafter.
version: 1.0.0
license: MIT
---

# Triage y redacción de respuestas de Quora

## Qué está pasando cuando esto se dispara

Mario corrió `run-quora.bat` (doble clic) en `C:\Users\Noxi-PC\reddit-travel-monitor`.
El script buscó preguntas de Quora vía la API de Brave, eligió hasta 5 y, para
cada una, los facts del corpus que aplican. **El script no redacta.** Deja el
reporte en `output/quora/daily-YYYY-MM-DD-local.md` y para ahí.

Tu trabajo son los dos pasos que el script no puede hacer: **decidir cuáles
valen la pena** y **escribirlas**.

Si necesitás el detalle completo del sistema (por qué no redacta, el ledger, los
gotchas), leé `docs/spec-quora.md` en ese repo. Este skill trae lo que hace falta
para el trabajo del día.

---

## Paso 1: el triage

El reporte trae 5 preguntas. **Lo normal es que sirvan 2.** No hay cupo que
llenar. Si no sirve ninguna, decilo — es un resultado válido y mucho mejor que
forzar una respuesta floja firmada con el nombre de Mario.

Cada bloque trae un campo que importa más de lo que parece: **"Respuesta que hoy
rankea"**, el snippet de lo que Quora muestra arriba. El script nunca lo usó para
nada; está ahí para que juzgues si vale la pena competirle.

### Vale la pena cuando

- La pregunta es **concreta y de logística**: cómo, cuándo, cuánto, en qué orden,
  qué incluye, por qué falla.
- **Los facts entregados contestan lo que preguntaron.** Este es el filtro que
  más descarta, y el que el script no puede aplicar: matchea por etiqueta de
  tema, no entiende la pregunta.
- La respuesta que hoy rankea es **genérica, vieja o insegura**. Señales
  textuales: "I haven't been in a number of years", "I've never used it, but did
  some digging", un link pegado sin explicación.

### No vale la pena cuando

- **Es una pregunta de historia y los facts son de logística.** Contestar con
  cortes de baño y slots de 20 minutos una pregunta sobre qué había bajo el
  Coliseo se lee como folleto y no ayuda a nadie.
- **La respuesta de arriba ya la contesta bien y completa.** Agregar una peor,
  firmada, resta en vez de sumar.
- **Los facts no le pegan a la pregunta.** Pasa seguido.

### Ejemplo real (22 ago 2026, sirvieron 2 de 5)

| Pregunta | Veredicto | Motivo |
|---|---|---|
| Pareja mayor, evitar colas en San Pedro | **sí** | el ticket de €7 con línea separada resuelve el problema exacto que plantean |
| "¿Qué le pasa a coopculture.it?" | **sí** | frustración real y la causa está en el corpus: el tier que se agota en segundos |
| Mejor orden Coliseo/Foro/Vaticano | no | los facts no contestan; uno era sobre problemas de auriculares |
| "¿Qué hay bajo las ruinas del Coliseo?" | no | pregunta de historia, facts de logística |
| San Pedro sin guía | no | la de arriba ya la contesta bien y completa; nuestros facts son estadísticas de calidad de guías |

Y el caso que muestra para qué hace falta una persona acá: a *"how do you get
tickets"* el selector le mandó un fact sobre **reembolsos cancelados** y cuatro
sobre colas de seguridad. Ninguno contesta la pregunta.

### Formato del veredicto

Agrupá en "sirven" y "no sirven", una línea de motivo por pregunta. Sin
preámbulo. Después van las respuestas completas de las que sirven.

---

## Paso 2: escribir

### El ethos se comparte, el registro es de Quora

El portfolio tiene un ethos único y **tres registros distintos**, uno por
superficie: `advisor-prose-system` para las páginas de tour,
`reddit-response-drafter` para Reddit, y este para Quora. No son la misma voz en
distinto largo: el contrato social de cada lugar es diferente, y confundirlos es
lo que hace que un texto se lea fuera de lugar.

**Lo que se hereda, porque es la marca y no el formato:**

- **El sello Reviewed. Compared. Selected.** Reviewaste (sabés los específicos),
  comparaste (citás las alternativas reales y sus brechas), seleccionaste (tomás
  posición, incluso para decirle al comprador equivocado que pase).
- **El test de textura ganada**, que reemplaza al viejo "borrá el adjetivo":
  *¿esta frase carga un hecho, una comparación o un juicio?* Si sí, se queda con
  textura y todo. Si es adjetivo puro sin nada abajo, se corta. La textura no es
  el enemigo; la textura **vacía** lo es.
- **Los superlativos prohibidos:** unforgettable, breathtaking, magical,
  stunning, world-class, of-a-lifetime, must-see, immersive, ultimate, iconic,
  "soak in/up", atmosphere, vibe, nestled, gateway.
- **Comparar contra una alternativa NOMBRADA con la brecha exacta**, nunca un
  vago "bastante más caro".
- **El pase anti-IA:** después de escribir, corré el skill `humanizer`. Ahí están
  los tells catalogados (regla de tres, rayas largas, análisis en "-ing",
  atribuciones vagas, paralelismos negativos), mucho mejor que cualquier lista
  que improvises acá.

**Lo que NO se hereda de las páginas de tour, y por qué:**

1. **La persona.** `advisor-prose-system` dice que sos *"alguien que tomó el
   tour"*. Acá eso está **prohibido**: la respuesta va firmada con nombre y
   apellido, y simular una visita es el tell más caro que existe. La persona de
   Quora es la de quien **analiza reseñas a escala**. Primera persona de
   criterio, nunca de experiencia: "yo haría" sí, "cuando yo fui" no.
2. **La arquitectura de secciones.** Nada de Quick Answer / The Experience / Is
   It Worth It. Una respuesta es una pieza sola.
3. **Los bolds.** La regla del portfolio es 1-2 por sección. En Quora está sin
   probar y en un texto corto y firmado puede leerse como marketing. Ante la
   duda, ninguno.

**Lo que sí se hereda y acá vale doble: la apertura citable.** La primera oración
tiene que sostenerse sola — si un motor de IA levanta solo esa frase, tiene que
seguir siendo correcta y útil. En Quora importa más que en las páginas, porque
los motores citan Quora mucho y porque Quora muestra ese arranque como snippet.
Con una vuelta de tuerca propia: **no puede repetir el título de la pregunta.**
El lector la acaba de leer, y devolvérsela desperdicia la única línea que muchos
leen. En una página de tour este problema no existe.

### Cómo se ve en la práctica

**Apertura citable, sin preámbulo.** De las dos publicadas el 22 ago:

> *"Nothing is wrong with the site. You are almost certainly trying to buy the
> one ticket that is engineered to be impossible."*

> *"For an elderly couple the most useful thing I can tell you is that the two
> sites work completely differently, and most of the advice online treats them
> as one visit."*

**Nombrá la idea equivocada que trae quien pregunta.** El valor casi nunca es la
lista de datos: es corregir el marco. El de coopculture cree que el sitio está
roto, cuando eligió el producto equivocado. La pareja mayor cree que San Pedro no
se planifica porque es gratis. Si no encontrás la idea equivocada, es probable
que la pregunta no valiera la pena.

**Cada cifra viene seguida de qué significa.** Un número solo es folleto; un
número más su consecuencia es consejo:

> *"St Peter's generates queue complaints at 23.8% against the Museums' 12.1%,
> roughly twice the rate, even though its median reported wait is actually
> shorter, 45 minutes against 60. People are not angrier because they wait
> longer. They are angrier because nobody told them there would be a wait at
> all."*

**Un párrafo, una decisión.** No un párrafo un tema. Cada bloque deja al lector
con algo que hacer o que descartar.

**Frases cortas sueltas para romper el ritmo.** *"There is."* *"Not minutes.
Seconds."* Esto hace que el ritmo varíe de verdad, en lugar de variarlo a
propósito porque una regla lo pide — que se nota.

**Cerrá con una recomendación concreta en primera persona**, no con un resumen:

> *"If it were my parents, I would book the Museums for a mid-morning slot, buy
> the €7 Basilica ticket for the same day or the next, and treat the two as
> separate outings rather than one long march."*

Primera persona de **criterio**, no de experiencia: "yo haría" sí, "cuando yo
fui" no.

**Se puede decir que algo no vale la pena.** Es lo que separa a alguien que
analiza de alguien que vende, y lo que hace creíble todo el resto. Caso real:
desaconsejar madrugar, con el dato de que a las 8:00 AM igual había 30 minutos
de cola.

### Reglas duras

Estas no son de estilo. Una respuesta que las viola no es mejorable: no se
publica.

1. **Toda cifra sale de un fact y se copia exacta.** Si el dato no está en los
   facts ni en la pregunta, no va. Podés usar cualquier fact del corpus del
   sitio y no solo los 5 que entregó el reporte, siempre citándolo textual.
   Los corpus están en `data/citable-facts*.json` (el campo se llama `fact`, no
   `text`).
2. **Nunca afirmar que algo no existe** porque no está en los facts. Los facts
   son un extracto, no un catálogo.
3. **Cero enlaces salientes.** Regla del portfolio, sin excepciones, ni siquiera
   a la fuente oficial.
4. **Nunca simular experiencia vivida.** Nada de "when I went", "I remember".
5. **La firma va sin `.com`:** `Mario Dalo, founder of Intercoper — VaticanTourGuides`.
   Quora **auto-enlaza los dominios en texto plano**, y el ancla que genera es el
   meta title del sitio: se publicó una respuesta donde la firma quedó como link
   azul que decía "Vatican Tours, Reviewed & Selected | VaticanTourGuides". Sin
   punto com no hay auto-link. Las marcas son `ColosseumRoman`,
   `VaticanTourGuides`, `TrastevereFoodTour`.

### Tells de IA

Los tres se detectaron leyendo respuestas ya publicadas:

- **Rayas largas (`—`) en el cuerpo.** Una respuesta publicada tenía 6 en 6
  párrafos. La firma es la única excepción.
- **Ritmo parejo**, párrafos todos de 3-4 líneas.
- **Abrir repitiendo el título de la pregunta.** El lector la acaba de leer.

### Largo

400-700 palabras suele estar bien, porque Quora premia long-form. **No es un
rango a llenar**: si el material da para 350, son 350. Rellenar es su propio
tell.

### Después de cada respuesta

Decí de qué fact salió cada cifra, en una línea. Sirve para que Mario verifique
en un clic y para que quede constancia de que ninguna es inventada.

---

## Paso 3: cuando Mario avisa que publicó

Marcá cada una en el ledger. Es un paso tuyo, no de él:

```bash
node scripts/quora-monitor.mjs --publicada "<url>"
```

Acepta tanto la URL de la pregunta como la de la respuesta (la misma más
`/answer/<autor>`, que es la que da el botón de compartir) y tolera el
`?ch=...` pegado atrás.

**Marcá solo lo que Mario confirmó.** Ante la duda, dejalo en `entregado`: así
la pregunta reaparece a los 21 días y él la saltea, en vez de quedar bloqueada
para siempre y perderse.

---

## Cosas que ya costaron tiempo

**Los IDs de los facts no son estables.** Se reasignan en cada extracción del
corpus: la audioguía era `tickets-003` y pasó a `guides-009`. Anotá cualquier
pendiente por texto, nunca por ID.

**El campo del fact se llama `fact`, no `text`.** Filtrar por `x.text` devuelve
vacío y parece que el corpus está roto.

**Verificá en el código, no en las notas.** Dos "defectos pendientes" reportados
el 22 ago ya estaban arreglados: `inventedFigures` existía con otro nombre
(`unbackedFigures`) y el mis-tagging de topics estaba resuelto hacía un día.

**El corpus se arregla en el artículo, nunca en el JSON.** Si un fact tiene un
dato viejo, se corrige el artículo en Sanity y se re-extrae con
`node scripts/extract-citable-facts.mjs --site <sitio>`. Editar el JSON a mano se
pierde en la próxima corrida del cron de higiene.
