# Sistema Quora — spec

Hermano del monitor de Reddit (`docs/spec-sistema-reddit-geo.md`), con una
diferencia de fondo: **acá el script no redacta**.

Este documento existe para que cualquier sesión de Claude, abierta en cualquier
carpeta, pueda hacer el trabajo sin depender de la memoria de otra conversación.
Si estás leyendo esto y no sabés nada del sistema, alcanza con esto.

---

## Qué hace el sistema y qué no

Doble clic en `run-quora.bat`. El script:

1. Le pregunta a la **API de Brave** por `site:quora.com <keywords del sitio>`.
   No entra a Quora: Quora devuelve 403 a los bots y su robots.txt prohíbe usar
   su contenido para alimentar sistemas de IA. Al buscador sí se le puede
   preguntar, porque tiene Quora indexado legítimamente.
2. Filtra: descarta lo que no es una pregunta (los Quora Spaces), lo que ya está
   en el ledger, y lo que no nombra la keyword propia de ninguno de los sitios.
3. Elige hasta 5 preguntas y, para cada una, los facts del corpus que aplican.
4. Escribe `output/quora/daily-YYYY-MM-DD-local.md` y para ahí.

**No redacta la respuesta.** Corre con `--sin-borrador`.

### Por qué no redacta

No porque la generación esté rota. Funciona, y sus guards están puestos y
verificados. Lo que no funciona es el resultado: **el texto se lee como escrito
por una máquina**. En Quora eso es fatal, porque la respuesta va firmada con
nombre y apellido y se queda publicada durante años.

Y no se arregla con otra regla de prompt. Cada regla tapa un tell y el modelo
encuentra el siguiente; tres rondas de eso costaron una semana en el sistema de
Reddit. A dos o tres respuestas por semana, automatizar justo la parte cara es
el peor canje posible.

La capa de generación sigue en el código y se puede reactivar sacando
`--sin-borrador` de `run-quora.ps1`. **No se borró a propósito**, para que quede
la evidencia de que se probó y por qué se dejó de lado.

---

## El circuito real

1. Mario hace doble clic en `run-quora.bat`.
2. Pega el reporte en el chat.
3. **Claude tría**: dice cuáles valen la pena y cuáles no, con el motivo.
4. **Claude escribe** las que valen, listas para pegar.
5. Mario las pega en Quora y avisa.
6. Claude anota: `node scripts/quora-monitor.mjs --publicada "<url>"`.

Mario no tiene que acordarse de nada. El paso 6 lo hace Claude.

---

## Cómo triar (paso 3)

El reporte trae 5 preguntas. **Lo normal es que sirvan 2.** No hay cupo que
llenar: si sirven 0, se dice que sirven 0.

Cada bloque del reporte trae un campo clave: **"Respuesta que hoy rankea"**, que
es el snippet de la respuesta que Quora muestra arriba. El generador nunca la
vio; está ahí para juzgar si vale la pena competirle.

### Vale la pena cuando

- La pregunta es **concreta y de logística**: cómo, cuándo, cuánto, en qué orden,
  qué incluye.
- **Los facts entregados contestan lo que preguntaron.** Este es el filtro que
  más descarta y el que el script no puede aplicar solo.
- La respuesta que hoy rankea es **genérica, vieja o insegura** ("I haven't been
  in a number of years", "I've never used it, but did some digging").

### No vale la pena cuando

- **Es una pregunta de historia y nuestros facts son de logística.** Contestar
  con cortes de baño y slots de 20 minutos una pregunta sobre qué había bajo el
  Coliseo se lee como folleto.
- **La respuesta de arriba ya la contesta bien y completa.** Agregar una peor
  firmada con tu nombre resta.
- **Los facts no le pegan a la pregunta.** Pasa seguido: el picker matchea por
  topic, no entiende la pregunta.

### Ejemplos reales del 22 ago 2026 (2 de 5)

| Pregunta | Veredicto | Motivo |
|---|---|---|
| Pareja mayor, evitar colas en San Pedro | **sí** | el ticket de €7 con línea separada resuelve el problema exacto |
| "¿Qué le pasa a coopculture.it?" | **sí** | frustración real, y la causa está en el corpus: el tier que se agota en segundos |
| Mejor orden Coliseo/Foro/Vaticano | no | los facts no contestan; uno era sobre problemas de auriculares |
| "¿Qué hay bajo las ruinas?" | no | pregunta de historia, facts de logística |
| San Pedro sin guía | no | la respuesta de arriba ya la contesta bien; nuestros facts son estadísticas de guías |

Y un caso que muestra para qué está el humano: a *"how do you get tickets"* el
picker le mandó un fact sobre **reembolsos cancelados** y cuatro sobre colas de
seguridad. Ninguno contesta la pregunta. El generador escribía el párrafo de los
reembolsos igual.

---

## Cómo escribir la respuesta (paso 4)

### Reglas duras

1. **Toda cifra sale de un fact y se copia exacta.** Si el dato no está en los
   facts ni en la pregunta, no va. Se puede usar cualquier fact del corpus del
   sitio, no solo los 5 que entregó el reporte, siempre citándolo textual.
2. **Prohibido afirmar que algo no existe** porque no está en los facts. Los
   facts son un extracto, no un catálogo.
3. **Cero enlaces salientes.** Regla del portfolio, sin excepciones, ni siquiera
   a la fuente oficial.
4. **Prohibido simular experiencia vivida.** Nada de "when I went". La voz es la
   de alguien que analiza reseñas a escala, no la de un turista.
5. **La firma va sin `.com`:** `Mario Dalo, founder of Intercoper — VaticanTourGuides`.
   Quora **auto-enlaza los dominios en texto plano**, y el ancla que genera es el
   meta title del sitio. Verificado con captura: se publicó como link azul que
   decía "Vatican Tours, Reviewed & Selected | VaticanTourGuides". Sin punto com
   no hay auto-link.

### La voz

Las reglas de abajo son prohibiciones, y cumplirlas todas da un texto **sin
defectos**, que no es lo mismo que un texto bueno. Esto es el lado positivo:
qué hace una respuesta que funciona.

**1. Veredicto en la primera línea.** Sin preámbulo, sin contexto, sin repetir la
pregunta. Las dos publicadas abren así:

> *"Nothing is wrong with the site. You are almost certainly trying to buy the
> one ticket that is engineered to be impossible."*

> *"For an elderly couple the most useful thing I can tell you is that the two
> sites work completely differently, and most of the advice online treats them
> as one visit."*

**2. Nombrar la idea equivocada que trae el que pregunta.** El valor de la
respuesta casi nunca es la lista de datos: es corregir el marco. El de
coopculture cree que el sitio está roto; en realidad eligió el producto
equivocado. La pareja mayor cree que San Pedro no se planifica porque es gratis.
Si no encontrás la idea equivocada, probablemente la pregunta no valía la pena.

**3. Cada cifra viene seguida de qué significa.** Un número solo es folleto. Un
número más su consecuencia es consejo:

> *"St Peter's generates queue complaints at 23.8% against the Museums' 12.1%,
> roughly twice the rate, even though its median reported wait is actually
> shorter, 45 minutes against 60. People are not angrier because they wait
> longer. They are angrier because nobody told them there would be a wait at
> all."*

**4. Un párrafo, una decisión.** No un párrafo un tema. Cada bloque tiene que
dejar al lector con algo que hacer o que descartar.

**5. Frases cortas sueltas para romper el ritmo.** *"There is."* *"Not minutes.
Seconds."* Esto es lo que hace que el ritmo varíe de verdad, en vez de variarlo
a propósito porque una regla lo pide.

**6. Cerrar con una recomendación concreta y en primera persona.** No un resumen.
Lo que harías vos:

> *"If it were my parents, I would book the Museums for a mid-morning slot, buy
> the €7 Basilica ticket for the same day or the next, and treat the two as
> separate outings rather than one long march."*

Es primera persona de **criterio**, no de experiencia: "yo haría" está permitido,
"cuando yo fui" no.

**7. Se puede decir que algo no vale la pena.** Es lo que separa a alguien que
analiza de alguien que vende, y es lo que hace creíble el resto. Ejemplo real:
desaconsejar madrugar, con el dato de que a las 8:00 AM igual había 30 minutos de
cola.

### Tells de IA a evitar

Los tres se detectaron leyendo respuestas ya publicadas:

- **Rayas largas (`—`)**. Una respuesta publicada tenía 6 en 6 párrafos. En el
  cuerpo no va ninguna; la firma es la única excepción.
- **Ritmo parejo.** Párrafos todos de 3-4 líneas. Que varíen de verdad: uno de
  dos líneas, otro de cinco.
- **Abrir repitiendo el título de la pregunta.** El lector la acaba de leer;
  tenerla de vuelta desperdicia la única línea que muchos leen.

### Largo

Quora premia long-form. 400-700 palabras está bien. **No es un rango a llenar**:
si el material da para 350, son 350. Rellenar es su propio tell.

### El perfil

La credencial del perfil de Quora tiene que ser coherente con la voz. Decía
*"Owner at Web Development (2006–present)"* mientras la respuesta afirmaba
analizar reseñas a escala, y con cifras de sentimiento a dos decimales esa
contradicción es lo que más delata. Se cambia una vez y arregla todas las
respuestas.

---

## El ledger

`data/quora-ledger.json`. Es una lista de "ya te la mostré", y nada más.

Existe porque **Brave devuelve el mismo pozo de preguntas cada vez** — son
preguntas viejas con muchas vistas, no cambian de un día para otro. Sin ledger,
el martes te trae las mismas cinco del lunes.

Dos estados:

- **`entregado`** — se mostró, no se sabe si se contestó. Bloquea **21 días** y
  después la pregunta vuelve al pozo.
- **`publicada`** — se marcó a mano con `--publicada`. Bloquea **para siempre**.

### Por qué la entrega caduca

El razonamiento original era registrar todo lo generado para siempre, y era
correcto **mientras el script redactaba**: si un borrador salía en el reporte y
no se publicaba, era porque Mario lo había descartado.

En modo entrega deja de valer. Se contesta una de cinco **por tiempo, no por
calidad**, y las otras cuatro quedaban bloqueadas para siempre: cuatro preguntas
buenas por corrida a la basura, en silencio, contadas como "duplicados" en el
embudo.

### Por qué lo permanente es lo manual

El sistema **no puede verificar** si algo se publicó: no entra a Quora. Entonces
la pregunta al diseñarlo no fue "cómo lo verifico" sino **"qué pasa el día que
nadie se acuerde de marcarlo"**:

- Si el bloqueo permanente fuera el default, olvidarse = **perder** preguntas
  buenas para siempre, sin enterarse.
- Como el default caduca, olvidarse = que reaparezca una ya contestada. Se ve,
  se saltea, listo.

El costo de olvidarse es un segundo de atención en vez de una pregunta muerta.

---

## Gotchas verificados

**Los IDs de los facts NO son estables.** Se reasignan en cada extracción del
corpus. La audioguía era `tickets-003` y tras re-extraer pasó a `guides-009`; el
fact del "Shouting attributed to site staff" era `crowds-007` y pasó a
`crowds-009`. Cualquier pendiente anotado como ID apunta a otro fact al día
siguiente. **Anotarlos por texto.**

**El título del reporte y la URL no siempre coinciden.** Quora reescribe títulos.
Una pregunta figura como *"How to book a Vatican Museum guided tour"* y su URL es
`How-do-I-book-a-Vatican-Museum-guided-tour`. Por eso `--publicada` va con URL.

**Quora da dos URLs para lo mismo.** La de la pregunta, y la de tu respuesta, que
es la misma más `/answer/<autor>`. El botón de compartir devuelve la segunda.
`--publicada` acepta las dos, y también con `?ch=...` pegado atrás.

**El corpus se arregla en el artículo, nunca en el JSON.** Si un fact tiene un
dato viejo, se corrige el artículo publicado en Sanity y se re-extrae. Editar el
JSON a mano se pierde en la próxima corrida del cron de higiene (lun/jue).

---

## Comandos

```bash
# Corrida normal (lo que hace run-quora.bat)
node scripts/quora-monitor.mjs --label local --sin-borrador

# Marcar una como publicada (bloqueo permanente)
node scripts/quora-monitor.mjs --publicada "<url de la pregunta o de la respuesta>"

# Re-extraer el corpus de un sitio tras corregir un artículo
node scripts/extract-citable-facts.mjs --site vatican
```

Corpus vivos: `colosseum` ~997 facts, `vatican` 168, `trastevere` ~74.
Marcas: `ColosseumRoman`, `VaticanTourGuides`, `TrastevereFoodTour`.

La `BRAVE_API_KEY` va en `.env` (ignorado por git, junto con `.env.*`). Una
consulta por *grupo* de keywords y no por keyword: con ~8 consultas por corrida
alcanza para más de 100 corridas dentro del plan gratuito.
