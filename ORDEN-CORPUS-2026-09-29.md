# Orden de trabajo: 16 facts que no sobreviven al chequeo externo

**Fecha:** 29 sep 2026 · **Origen:** la etapa de verificación web de `check-answer.mjs`,
corriendo entre el 24 y el 27 de sep mientras se escribían respuestas.

## Antes de tocar nada, tres cosas

**El corpus no se edita a mano.** Se arregla el artículo y se re-extrae. Cada entrada
de acá dice en qué artículo vive el fact (el `sourceSlug`), que es dónde hay que ir.

**Ninguno de estos se pudo re-verificar hoy.** La API está en su tope hasta el 1 oct,
así que la verificación web está apagada. Lo de abajo es lo que el chequeo reportó esos
días, no una segunda medición. **Al corregir cada uno, volver a chequearlo**: algunos
pueden ser el juez equivocándose, no el fact.

**No todos son el mismo tipo de error.** Van agrupados por tipo, porque el arreglo es
distinto: un número mal se cambia, un absoluto se acota, y a un fact al que le falta la
condición hay que agregarle la condición.

---

## A · Dato equivocado (9)

Se cambia el número o el hecho en el artículo.

### `markets-002` — trastevere
**Artículo:** `trastevere-vs-rome-food-neighborhoods`
> Mercato Trionfale, up in Prati, is Rome's largest with **over 800 stalls**

El Trionfale tiene **270-273 puestos**. Es el error más grande de la lista en
proporción: casi el triple. El resto de la frase (mercado de locales, sin street food,
edificio de hormigón) está bien.

### `grand-canyon-016` — lasvegas
**Artículo:** `is-the-grand-canyon-day-trip-from-las-vegas-worth-it`
> because the **West Rim is private land** and the South Rim is five hours away

No es tierra privada: es **tierra tribal de los Hualapai**, fuera de la jurisdicción del
NPS y con su propia estructura de tarifas. El argumento del fact —que no se puede
comprar la vista sin comprar un producto de acceso— **se sostiene igual** con la
corrección, así que es cambiar dos palabras.

### `format-duration-001` — pompeii
**Artículo:** `7-mistakes-people-make-when-booking-pompeii-tickets-and-tours`
> the site covers approximately **170 acres**

Las fuentes coinciden en **unas 66 hectáreas, o sea ~163 acres**. La diferencia no
cambia el consejo (menos de dos horas se siente apurado), pero es un número publicado
y verificable, así que conviene que esté bien.

### `getting-there-003` — pompeii
**Artículo:** `how-to-get-to-pompeii-from-rome-naples-and-sorrento`
> picking the wrong stop can cost you **20 minutes of walking** or a missed time slot

Desde la estación Pompei de Trenitalia (la del pueblo moderno) a las ruinas son
**unos 10 minutos**. Está al doble. Además hay **más de dos estaciones** que sirven
Pompeya, y el fact habla como si fueran dos.

### `guides-002` — pompeii
**Artículo:** `7-mistakes-people-make-when-booking-pompeii-tickets-and-tours`
> a 2-3 hour guided tour that includes your entry ticket typically adds only a
> **modest extra cost** on top of the base ticket price

La entrada base son **€18-24** y un tour guiado ronda los **€46**: no es un costo
modesto encima, es casi el doble del total. Este ya estaba detectado desde antes de
esta semana. **Es el más urgente de los tres de Pompeya**, porque es el único que puede
hacer que alguien tome una decisión de plata con un número mal.

### `desert-parks-022` — lasvegas (primer problema)
**Artículo:** `valley-of-fire-from-las-vegas`
> reached by an **easy** 1.5-mile round-trip hike

El cartel oficial del sendero dice **moderado**. La distancia está bien.

### `pricing-017` — vatican
**Artículo:** `vatican-tour-product-decoder`
> roughly thirty times the **€25 official ticket**

Las fuentes dan la entrada oficial en **€17-20 más unos €5 de tasa online**. El
multiplicador "treinta veces" descansa sobre esa base, así que si la base cambia, el
multiplicador también. Los otros dos números del fact (el add-on de €300 de San Pedro y
los €750 de la mañana) no se pudieron corroborar afuera; puede ser porque son de una
oferta concreta que medimos, pero conviene revisar de dónde salieron.

---

### `timing-021` — vatican
**Artículo:** `vatican-queue-times` *(añadido el 1 oct 2026)*
> on the **last Sunday of every month**, the Vatican Museums open free of charge

No es cada mes. Se saltean **Pascua, el 29 de junio y el 25-26 de diciembre**,
confirmado en `museivaticani.va`. Salió escribiendo la respuesta de "Is Vatican
City free to enter?", donde quedó corregido; el fact sigue mal.

### `neighborhoods-006` — trastevere — **BORRAR, no corregir**
**Artículo:** por determinar *(añadido el 2 oct 2026)*
> By the same raw method, an "Osteria Santo Spirito" arrived fourth with 23 mentions.

**Ese restaurante está en Florencia**, Piazza Santo Spirito 16/R. No existe en
Roma. El fact ya venía escrito con comillas y con un "an", señal de que el
análisis original desconfiaba del conteo; la verificación del 2 oct lo confirma.

Es el mismo caso que All'Antico Vinaio en la tabla de targets de `SEEDS.md`
(cadena florentina, 49 menciones, descartada el 2 sep): **un corpus de comida
italiana levantado de Reddit arrastra nombres de otras ciudades, y contar
menciones no distingue la ubicación.** Las 23 menciones son reales; lo que es
falso es la conclusión de que señalan un restaurante de Trastevere.

No tiene arreglo por reescritura. Se borra.

---

## B · Absolutos que mueren con un contraejemplo (2)

No se cambia el dato: se acota a la muestra.

### `shows-018` — lasvegas
**Artículo:** `las-vegas-show-ratings-what-they-hide`
> "Clowns" appears in 42% of O's and **in none of Absinthe's**

El "ninguna" es lo que falla. Buscando afuera apareció una reseña negativa real de
Absinthe quejándose justamente de eso: *"The clowning was dated even then"*. El 42% de O
probablemente esté bien; lo que hay que escribir es **"en nuestra muestra"** en vez de
un cero universal.

### `desert-parks-022` — lasvegas (segundo problema)
**Artículo:** `valley-of-fire-from-las-vegas`
> one of the most photographed spots **in Nevada**

Cierto **dentro del parque**, no de Nevada. Es el mismo fact que el del sendero "fácil",
así que se arreglan juntos.

---

## C · Les falta la condición (4)

El dato es cierto en su caso y falso como regla general.

### `timing-001` — pompeii
**Artículo:** `7-mistakes-people-make-when-booking-pompeii-tickets-and-tours`
> **Most** official Pompeii tickets work on a simple time-band system

Las bandas horarias existen **solo en temporada alta**, del 16 de marzo al 14 de octubre
según `pompeiisites.org`. Fuera de esa ventana el fact es falso. Falta la condición de
temporada.

### `helicopter-001` — lasvegas
**Artículo:** `grand-canyon-west-vs-south-rim-from-las-vegas`
> it covers in **under an hour** what the road does in two, and **some** of them land

La duración total del vuelo **varía mucho** por operador: desde ~70 minutos ida y vuelta
hasta tours de 3 a 4 horas. Y "algunos aterrizan" es cierto pero se lee como si el
aterrizaje fuera lo normal. Este fact bloqueó una respuesta el 24 de sep.

### `resort-fees-001` — lasvegas
**Artículo:** `how-much-las-vegas-trip-costs`
> typically **$40 to $55** per night before tax

El rango real es más ancho: el promedio ronda los **$39-40**, en el Strip va de **$44 a
$57**, fuera del Strip y en downtown baja a **$15-25**, y hay excepciones sin cargo
(Four Seasons). El "almost every Strip hotel" está bien; el rango está angosto.

### `getting-there-007` — pompeii
**Artículo:** `how-to-get-to-pompeii-from-rome-naples-and-sorrento`
> which takes about **30-40 minutes**

Las fuentes dan **30-37, la mayoría 30-33**. Es el error más chico de la lista y el
menos urgente.

---

## D · Contexto arrancado en la extracción (1)

**Este es el caso más peligroso de todos**, porque el número está bien y no se
contradice con nada de afuera: solo se ve abriendo el artículo.

### `tickets-018` — vatican
**Artículo:** `vatican-queue-times`
> The median stated wait among reviews mentioning advance booking is 50 minutes;
> among those describing buying on the day it is 45.

Dos cosas que el artículo dice y el fact no trae:

1. Las cifras son de **los dos sitios juntos** (Museos + San Pedro), no de los Museos.
2. El artículo advierte, textual: *"The sample of walk-up reviews is small enough that
   we would not lean on the direction of that difference"*.

El 27 de sep se escribió una respuesta de Quora cuyo remate entero era que reservar no
compra una cola más corta — **exactamente la dirección que el artículo se niega a
afirmar**. Se cazó antes de publicar y se reescribió con `crowds-015` (mediana de los
Museos: 60 minutos, media de 91), y con el dato correcto **la recomendación se dio
vuelta**.

**El arreglo no es solo este fact.** Si el extractor puede separar una cifra de su
salvedad, puede haber más casos así, y ninguno lo va a encontrar el chequeo web. Vale
revisar si el extractor tiene forma de arrastrar la advertencia, o al menos de marcar el
fact como "viene con condición en el artículo".

---

## E · No está mal el fact, lo aplica mal el monitor (1)

### `getting-around-012` — lasvegas
**Artículo:** `most-expensive-first-timer-mistakes-las-vegas`
> what looks like a 10-minute walk on a map is often 20-30 minutes

**Cierto como regla del Strip.** El 26 de sep el monitor lo ofreció para el hilo *"How
long does it take to walk from The Flamingo to Caesar's forum?"*, dos hoteles vecinos,
donde no aplica: los 12 comentarios del hilo decían 10-15 minutos y varios se burlaban
de los 25.

**No hay nada que corregir en el artículo.** Queda anotado porque el selector no puede
detectar esto —hace match léxico con "walk" y "minutes" sin evaluar si la generalización
alcanza al caso— y lo único que lo caza es leer el hilo, que ya es obligatorio.

---

## Resumen para el día que se arregle

| Sitio | Facts | Artículos a tocar |
|---|---|---|
| lasvegas | 5 (+1 anotado) | 4 |
| pompeii | 4 | 2 |
| vatican | 2 | 2 |
| trastevere | 1 | 1 |

**Colosseum no tiene ninguno.** Es el corpus más viejo y el más estresado, y no me falló
un fact en toda la semana. Trastevere tiene uno solo. Los dos que concentran el problema
—lasvegas y pompeii— son de los últimos extraídos, lo que sugiere mirar qué cambió en el
pipeline entre unos y otros antes de dar por casualidad la diferencia.

**Orden sugerido:** primero `guides-002` (puede costarle plata a alguien), después
`markets-002` y `grand-canyon-016` (errores de hecho grandes y fáciles), después el
grupo C (agregar condiciones), y `tickets-018` último pero mirando el extractor y no
solo el fact.
