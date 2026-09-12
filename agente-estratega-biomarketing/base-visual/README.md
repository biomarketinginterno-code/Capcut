# Base visual duplicable — plantilla de estrategia

Sacada del diseño real de `BOIS_CANTINA_Propuesta_Posicionamiento_3_Meses.pdf` (colores extraídos
píxel a píxel, no a ojo): navy `#173E4E`, crema `#F5F1D6`, tarjetas `#FFFCEB` / `#E8F0E8`, acento lima
`#C8E27D`. Mismo layout de 7 slides (portada, norte estratégico, persona y momentos, activos, pilares,
sistema mensual, producción), con todas las tarjetas/pastillas con esquinas redondeadas.

**No depende de fotos.** BOIS es un caso aparte que ya tiene su propio material fotográfico; la
plantilla general no asume que haya fotos disponibles. Los espacios que en el PDF de BOIS ocupaban
fotos acá se resuelven solo con color, tipografía y forma (paneles `deco-panel`: un emblema con un
número grande, una cita tipográfica, un bloque de texto sobre fondo de color). El diseño se ve completo
sin que nadie tenga que mandar una sola imagen; si más adelante hay fotos del cliente, se pueden sumar
como plus, pero nunca son un requisito.

## Archivos

- `plantilla_estrategia.html` — la plantilla. No hace falta tocarla a mano para usarla con un cliente
  nuevo (ver más abajo); todo el color vive en las variables CSS del bloque `:root` al principio del
  archivo, por si alguna vez hace falta un ajuste de diseño más de fondo.
- `datos.ejemplo.json` — ejemplo de archivo de datos (contenido + colores) para un cliente ficticio.
  Se usa como plantilla para cargar cada cliente nuevo.
- `build.js` — script que arma el PDF final a partir de un archivo de datos, sin usar IA. **Este es el
  paso recomendado**, para no gastar tokens de Claude/ChatGPT cada vez que hay que armar el diseño.
- `render.js` — alternativa más simple: convierte el .html a PDF tal cual está (sin reemplazar nada),
  útil solo si se prefiere editar `plantilla_estrategia.html` directamente a mano.
- `plantilla_estrategia_demo_BOIS.pdf` / `plantilla_estrategia_demo_otra_marca.pdf` — ejemplos ya
  armados, para ver cómo se ve la misma plantilla con dos paletas y rubros distintos.

## Cómo usarla para un cliente nuevo (recomendado, sin gastar tokens)

Una sola vez, en tu computadora (necesita [Node.js](https://nodejs.org) instalado):

```
npm install playwright
npx playwright install chromium
```

Por cada cliente nuevo:

1. Copiá `datos.ejemplo.json` con otro nombre, por ejemplo `cliente_XXX.json`.
2. Completá los campos con el contenido que te dio el agente GPT (objetivo, pilares, activos, sistema
   de contenido, etc.) y los colores de marca del cliente en HEX, dentro de `"colores"`. Es texto plano,
   no hace falta tocar el HTML ni el CSS. Fijate el campo `"_notas"` del ejemplo: hay 11 campos donde
   la plantilla ya pone el punto final (o las comillas de cierre) sola, así que ahí no hay que repetirlo.
3. Corré:

```
node build.js cliente_XXX.json cliente_XXX.pdf
```

Eso genera el PDF final, ya diseñado y con los colores de esa marca, en un solo paso — sin abrir Claude
ni ChatGPT para el diseño. Solo hace falta volver a esta sesión si en algún momento se necesita cambiar
la estructura/el layout de la plantilla en sí (agregar una sección nueva, cambiar un grid, etc.), no
para cargar cada cliente.

## Alternativa manual (editar el HTML a mano)

Si en algún caso puntual no querés usar el JSON: abrí `plantilla_estrategia.html`, reemplazá los
colores en `:root` y los textos entre corchetes `[ASÍ]` directamente en el archivo, y exportá a PDF:
- **Rápida:** abrir el .html en Chrome → Imprimir → Guardar como PDF → tamaño de papel personalizado
  1280x720 px (o "Ajustar a la página" horizontal), sin márgenes.
- **Con el script:** `node render.js plantilla_estrategia.html salida.pdf` (usa el mismo Node/Playwright
  del paso anterior).

## Qué NO cambiar

- Los `border-radius` (`--radius-lg/md/sm`): son las esquinas redondeadas que pediste, quedan iguales
  para cualquier marca.
- La estructura de grids (2 columnas, 3 columnas, 4 columnas) y el orden de las 7 secciones: eso es lo
  que hace que la plantilla sea duplicable — solo cambia la piel (colores/tipografía/contenido), nunca
  el esqueleto.
