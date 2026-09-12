# Base visual duplicable — plantilla de estrategia

Sacada del diseño real de `BOIS_CANTINA_Propuesta_Posicionamiento_3_Meses.pdf` (colores extraídos
píxel a píxel, no a ojo): navy `#173E4E`, crema `#F5F1D6`, tarjetas `#FFFCEB` / `#E8F0E8`, acento lima
`#C8E27D`. Mismo layout de 7 slides (portada, norte estratégico, persona y momentos, activos, pilares,
sistema mensual, producción), sin fotos reales y con todas las tarjetas/pastillas con esquinas
redondeadas.

## Archivos

- `plantilla_estrategia.html` — la plantilla editable. Todo el color vive en las variables CSS del
  bloque `:root` al principio del archivo.
- `plantilla_estrategia_demo_BOIS.pdf` — la plantilla renderizada tal cual, con la paleta de BOIS.
- `plantilla_estrategia_demo_otra_marca.pdf` — la MISMA plantilla, sin tocar el layout, con una paleta
  totalmente distinta (borravino/hueso/mostaza) y contenido de otro rubro (indumentaria), para probar
  que no queda pegada a los colores ni al rubro de BOIS.

## Cómo reusarla para un cliente nuevo

1. Abrir `plantilla_estrategia.html` y cambiar solo estas líneas (arriba del todo, dentro de `:root`):

```css
--color-bg:        #F5F1D6;  /* fondo general */
--color-primary:   #173E4E;  /* bloques oscuros / títulos */
--color-accent:    #C8E27D;  /* pastillas, números, círculos */
--color-card-a:    #FFFCEB;  /* tarjeta clara 1 */
--color-card-b:    #E8F0E8;  /* tarjeta clara 2 */
```

   Reemplazar por los HEX reales de la marca del cliente (los mismos que le pedimos en la descarga de
   información del agente GPT). Si la marca tiene tipografías propias, también se pueden cambiar
   `--font-display` (títulos) y `--font-body` (texto).

2. Reemplazar los textos entre corchetes `[ASÍ]` por el contenido real de la estrategia (lo que devuelve
   el GPT Estratega BioMarketing ya da toda esta información en el mismo orden).

3. Reemplazar los bloques `placeholder-media` por las fotos/videos reales del cliente cuando estén.

4. Exportar a PDF. Dos formas:
   - **Rápida (recomendada):** abrir el .html en Chrome → Imprimir → Guardar como PDF → tamaño de papel
     personalizado 1280x720 px (o usar "Ajustar a la página" con orientación horizontal), sin márgenes.
   - **Automática:** con Node instalado, corré una sola vez `npm install playwright && npx playwright
     install chromium`, y después `node render.js plantilla_estrategia.html salida.pdf` genera el PDF
     ya paginado exactamente a 1280x720 (`render.js` está en esta misma carpeta).

## Qué NO cambiar

- Los `border-radius` (`--radius-lg/md/sm`): son las esquinas redondeadas que pediste, quedan iguales
  para cualquier marca.
- La estructura de grids (2 columnas, 3 columnas, 4 columnas) y el orden de las 7 secciones: eso es lo
  que hace que la plantilla sea duplicable — solo cambia la piel (colores/tipografía/contenido), nunca
  el esqueleto.
