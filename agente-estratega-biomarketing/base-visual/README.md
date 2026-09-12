# Base visual duplicable — plantilla de estrategia

Sacada del diseño real de `BOIS_CANTINA_Propuesta_Posicionamiento_3_Meses.pdf` (14 páginas, colores
extraídos píxel a píxel, no a ojo): navy `#173E4E`, crema `#F5F1D6`, tarjetas `#FFFCEB` / `#E8F0E8`,
acento lima `#C8E27D`, y terracota `#B76845` para detalles de "viral"/promociones. Mismo layout de las
**14 secciones** del original (portada, norte estratégico, persona y momentos, activos, pilares, sistema
mensual, producción, mes 1, mes 2, mes 3, propiedades y acciones, medición, preguntas de validación y
cierre), con todas las tarjetas/pastillas con esquinas redondeadas.

**No depende de fotos.** BOIS es un caso aparte que ya tiene su propio material fotográfico; la
plantilla general no asume que haya fotos disponibles. Los espacios que en el PDF de BOIS ocupaban
fotos acá se resuelven solo con color, tipografía y forma (paneles `deco-panel`: un emblema con un
número grande, una cita tipográfica, un bloque de texto sobre fondo de color). El diseño se ve completo
sin que nadie tenga que mandar una sola imagen; si más adelante hay fotos del cliente, se pueden sumar
como plus, pero nunca son un requisito.

## Archivos

- `estrategia_pdf.py` — **el que importa.** Script Python (reportlab) que arma el PDF de las 14
  secciones. Pensado para correr DENTRO de ChatGPT via Code Interpreter: subilo como Knowledge del GPT
  (junto con la base de BOIS) y activá "Code Interpreter" — el propio agente arma el diccionario de
  datos con el contenido de la charla y los colores de marca, y lo ejecuta solo. El usuario no toca
  código ni archivos.
- `plantilla_estrategia.html` / `datos.ejemplo.json` / `build.js` / `render.js` — versión alternativa
  con Node.js, para quien prefiera generar el PDF localmente sin pasar por ChatGPT (ver más abajo). Es
  el mismo diseño, pero requiere instalar Node y correr un comando por cliente.
- `plantilla_estrategia_demo_BOIS.pdf` / `plantilla_estrategia_demo_otra_marca.pdf` — ejemplos ya
  armados (con la versión HTML), para ver cómo se ve la misma plantilla con dos paletas y rubros
  distintos.

## Opción recomendada: todo dentro de ChatGPT (a prueba de balas)

1. En el GPT "Estratega BioMarketing", Knowledge: subir `estrategia_pdf.py` (además del PDF de BOIS).
2. Capabilities: activar "Code Interpreter & Data Analysis".
3. Listo. El GPT ya tiene la instrucción (sección 14 de `GPT_ESTRATEGA_BIOMARKETING.md`) para armar el
   diccionario de datos con el contenido de cada estrategia y los colores de marca, ejecutar
   `generar_pdf(data, "cliente.pdf")` y entregar el archivo — sin que el usuario haga nada técnico.
4. Si el GPT no tiene los colores de la marca todavía, los va a pedir antes de generar el PDF (nunca
   los inventa). Alcanza con pasárselos en HEX en el chat.

## Alternativa con Node.js (sin pasar por ChatGPT)

Una sola vez, en tu computadora (necesita [Node.js](https://nodejs.org) instalado):

```
npm install playwright
npx playwright install chromium
```

Por cada cliente nuevo:

1. Copiá `datos.ejemplo.json` con otro nombre, por ejemplo `cliente_XXX.json`.
2. Completá los campos con el contenido que te dio el agente GPT (objetivo, pilares, activos, sistema
   de contenido, etc.) y los colores de marca del cliente en HEX, dentro de `"colores"`. Es texto plano,
   no hace falta tocar el HTML ni el CSS. Fijate el campo `"_notas"` del ejemplo: hay varios campos donde
   la plantilla ya pone el punto final (o las comillas de cierre) sola, así que ahí no hay que repetirlo.
3. Corré:

```
node build.js cliente_XXX.json cliente_XXX.pdf
```

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
