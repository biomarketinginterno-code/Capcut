// Arma el PDF final de la estrategia a partir de UN archivo de datos (JSON),
// sin tocar el HTML y sin usar Claude/ChatGPT para el paso de diseño.
//
// Uso:
//   npm install playwright        (una sola vez)
//   npx playwright install chromium   (una sola vez)
//   node build.js datos_cliente.json salida.pdf
//
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

function get(obj, dotPath) {
  const val = dotPath.split('.').reduce((o, k) => {
    const m = k.match(/^(.+)\[(\d+)\]$/);
    if (m) return (o || {})[m[1]] ? (o[m[1]][Number(m[2])]) : undefined;
    return (o || {})[k];
  }, obj);
  if (val === undefined || val === null) {
    throw new Error(`Falta el campo "${dotPath}" en el JSON de datos.`);
  }
  return String(val);
}

// Reemplazos de TEXTO, en el mismo orden en que aparecen en plantilla_estrategia.html.
// Como usamos reemplazo NO global, cada entrada consume UNA aparicion del texto,
// de arriba hacia abajo -> por eso el orden de esta lista tiene que respetar el
// orden real del archivo (ya viene armado para plantilla_estrategia.html tal cual
// se entrega; si se edita el HTML a mano, hay que ajustar esta lista).
const TEXT_REPLACEMENTS = [
  // SLIDE 1 - Portada
  ['[MARCA]', 'marca'],
  ['[LINEA/PRODUCTO]', 'linea'],
  ['[Palabra clave 1]', 'palabras_clave[0]'],
  ['[Palabra clave 2]', 'palabras_clave[1]'],
  ['[Palabra clave 3]', 'palabras_clave[2]'],
  ['[MARCA]', 'marca'],
  ['[Pilar A] 50%', 'portada.pill_a'],
  ['[Pilar B] 50%', 'portada.pill_b'],
  ['[Transversal]', 'portada.pill_c'],
  ['[DD.MM.AAAA]', 'fecha'],
  ['[N]', 'portada.duracion_meses'],
  ['[Frase corta que resume el espíritu de la marca en una linea.]', 'portada.frase_espiritu'],

  // SLIDE 2 - Norte estrategico
  ['[Frase que resume el objetivo de posicionamiento en una linea, tono directo]', 'slide2.objetivo'],
  ['[Frase de posicionamiento en 2-3 lineas, la promesa central de la marca.]', 'slide2.hipotesis'],
  ['[Aclaracion: donde esta la sofisticacion/diferencial y donde NO.]', 'slide2.aclaracion'],
  ['[MARCA]', 'marca'],
  ['[Que NO es]', 'slide2.que_no_es'],
  ['[Que SI es, en una linea]', 'slide2.que_si_es'],
  ['[MARCA]', 'marca'],
  ['[AÑO]', 'anio'],

  // SLIDE 3 - Persona y momentos
  ['[Una linea sobre cuando vive la marca durante el dia/semana]', 'slide3.intro'],
  ['[DATO]', 'slide3.stats[0].titulo'],
  ['[Descripcion corta del segmento 1]', 'slide3.stats[0].desc'],
  ['[SEGMENTO]', 'slide3.stats[1].titulo'],
  ['[Descripcion corta del segmento 2]', 'slide3.stats[1].desc'],
  ['[SEGMENTO]', 'slide3.stats[2].titulo'],
  ['[Descripcion corta del segmento 3]', 'slide3.stats[2].desc'],
  ['[VALOR]', 'slide3.stats[3].titulo'],
  ['[Que percepcion de valor buscamos]', 'slide3.stats[3].desc'],
  ['[Que se consume]', 'slide3.momentos[0].que'],
  ['[Frase en primera persona]', 'slide3.momentos[0].frase'],
  ['[Que se consume]', 'slide3.momentos[1].que'],
  ['[Frase en primera persona]', 'slide3.momentos[1].frase'],
  ['[Que se consume]', 'slide3.momentos[2].que'],
  ['[Frase en primera persona]', 'slide3.momentos[2].frase'],
  ['[MARCA]', 'marca'],
  ['[AÑO]', 'anio'],

  // SLIDE 4 - Activos reales
  ['[MARCA]', 'marca'],
  ['[ACTIVO 1]', 'slide4.activos[0].titulo'],
  ['[Por que importa, en 1-2 lineas]', 'slide4.activos[0].desc'],
  ['[ACTIVO 2]', 'slide4.activos[1].titulo'],
  ['[Por que importa, en 1-2 lineas]', 'slide4.activos[1].desc'],
  ['[ACTIVO 3]', 'slide4.activos[2].titulo'],
  ['[Por que importa, en 1-2 lineas]', 'slide4.activos[2].desc'],
  ['[ACTIVO 4]', 'slide4.activos[3].titulo'],
  ['[Por que importa, en 1-2 lineas]', 'slide4.activos[3].desc'],
  ['[ACTIVO 5]', 'slide4.activos[4].titulo'],
  ['[Por que importa, en 1-2 lineas]', 'slide4.activos[4].desc'],
  ['[ACTIVO 6]', 'slide4.activos[5].titulo'],
  ['[Por que importa, en 1-2 lineas]', 'slide4.activos[5].desc'],
  ['[MARCA]', 'marca'],
  ['[AÑO]', 'anio'],

  // SLIDE 5 - Pilares
  ['[N]', 'slide5.n_pilares'],
  ['[Cómo se reparte el peso entre ellos, ej. 50%/50%]', 'slide5.reparto'],
  ['[PILAR 1]', 'slide5.pilares[0].titulo'],
  ['[Que muestra este pilar]', 'slide5.pilares[0].desc'],
  ['[PILAR 2]', 'slide5.pilares[1].titulo'],
  ['[Que muestra este pilar]', 'slide5.pilares[1].desc'],
  ['[PILAR 3]', 'slide5.pilares[2].titulo'],
  ['[Que muestra este pilar]', 'slide5.pilares[2].desc'],
  ['[PILAR 4]', 'slide5.pilares[3].titulo'],
  ['[Que muestra este pilar]', 'slide5.pilares[3].desc'],
  ['[PILAR 5]', 'slide5.pilares[4].titulo'],
  ['[Que muestra este pilar]', 'slide5.pilares[4].desc'],
  ['[PILAR 6]', 'slide5.pilares[5].titulo'],
  ['[Que muestra este pilar]', 'slide5.pilares[5].desc'],
  ['[que si / que nunca, en una linea contundente]', 'slide5.regla'],
  ['[MARCA]', 'marca'],
  ['[AÑO]', 'anio'],

  // SLIDE 6 - Sistema mensual
  ['[N]', 'slide6.n_piezas'],
  ['[Como debe entrar el contenido: tono, duracion, estilo]', 'slide6.intro'],
  ['[N]', 'slide6.n_reels'],
  ['[PILAR]', 'slide6.reels[0].pilar'],
  ['[Que se muestra]', 'slide6.reels[0].que'],
  ['[PILAR]', 'slide6.reels[1].pilar'],
  ['[Que se muestra]', 'slide6.reels[1].que'],
  ['[PILAR]', 'slide6.reels[2].pilar'],
  ['[Que se muestra]', 'slide6.reels[2].que'],
  ['[PILAR / VIRAL]', 'slide6.reels[3].pilar'],
  ['[N]', 'slide6.n_placas'],
  ['[Concepto + foto + copy minimo]', 'slide6.placas[0].desc'],
  ['[Concepto + foto + copy minimo]', 'slide6.placas[1].desc'],
  ['[PILAR A]', 'slide6.tag_a'],
  ['[PILAR B]', 'slide6.tag_b'],
  ['[TRANSVERSAL]', 'slide6.tag_c'],
  ['[MARCA]', 'marca'],
  ['[AÑO]', 'anio'],

  // SLIDE 7 - Produccion
  ['[MARCA]', 'marca'],
  ['[Item de produccion 1]', 'slide7.checklist[0]'],
  ['[Item de produccion 2]', 'slide7.checklist[1]'],
  ['[Item de produccion 3]', 'slide7.checklist[2]'],
  ['[Item de produccion 4]', 'slide7.checklist[3]'],
  ['[duracion]', 'slide7.lenguaje.duracion'],
  ['[texto]', 'slide7.lenguaje.texto'],
  ['[personas]', 'slide7.lenguaje.personas'],
  ['[sonido/musica]', 'slide7.lenguaje.sonido'],
  ['[MARCA]', 'marca'],
  ['[AÑO]', 'anio'],

  // SLIDES 8-10 - Mes 1 / Mes 2 / Mes 3 (misma estructura de 6 filas x 3 meses)
  ...['mes1', 'mes2', 'mes3'].flatMap((mes) => [
    ['[Título del mes]', `${mes}.titulo`],
    ['[Objetivo del mes]', `${mes}.objetivo`],
    ['[EJE]', `${mes}.filas[0].eje`],
    ['[IDEA]', `${mes}.filas[0].idea`],
    ['[Qué mostramos]', `${mes}.filas[0].que`],
    ['[EJE]', `${mes}.filas[1].eje`],
    ['[IDEA]', `${mes}.filas[1].idea`],
    ['[Qué mostramos]', `${mes}.filas[1].que`],
    ['[EJE]', `${mes}.filas[2].eje`],
    ['[IDEA]', `${mes}.filas[2].idea`],
    ['[Qué mostramos]', `${mes}.filas[2].que`],
    ['[EJE VIRAL]', `${mes}.filas[3].eje`],
    ['[IDEA]', `${mes}.filas[3].idea`],
    ['[Qué mostramos]', `${mes}.filas[3].que`],
    ['[EJE]', `${mes}.filas[4].eje`],
    ['[IDEA]', `${mes}.filas[4].idea`],
    ['[Qué mostramos]', `${mes}.filas[4].que`],
    ['[EJE]', `${mes}.filas[5].eje`],
    ['[IDEA]', `${mes}.filas[5].idea`],
    ['[Qué mostramos]', `${mes}.filas[5].que`],
    ['[Nota de cierre del mes]', `${mes}.nota`],
    ['[MARCA]', 'marca'],
    ['[AÑO]', 'anio'],
  ]),

  // SLIDE 11 - Propiedades y acciones
  ['[MARCA]', 'marca'],
  ['[PROPIEDAD 1]', 'slide11.propiedades[0].titulo'],
  ['[Descripcion de la propiedad 1]', 'slide11.propiedades[0].desc'],
  ['[PROPIEDAD 2]', 'slide11.propiedades[1].titulo'],
  ['[Descripcion de la propiedad 2]', 'slide11.propiedades[1].desc'],
  ['[PROPIEDAD 3]', 'slide11.propiedades[2].titulo'],
  ['[Descripcion de la propiedad 3]', 'slide11.propiedades[2].desc'],
  ['[PROPIEDAD 4]', 'slide11.propiedades[3].titulo'],
  ['[Descripcion de la propiedad 4]', 'slide11.propiedades[3].desc'],
  ['[PROPIEDAD 5]', 'slide11.propiedades[4].titulo'],
  ['[Descripcion de la propiedad 5]', 'slide11.propiedades[4].desc'],
  ['[PROPIEDAD 6]', 'slide11.propiedades[5].titulo'],
  ['[Descripcion de la propiedad 6]', 'slide11.propiedades[5].desc'],
  ['[Regla de promociones para esta marca]', 'slide11.promociones'],
  ['[MARCA]', 'marca'],
  ['[AÑO]', 'anio'],

  // SLIDE 12 - Medicion
  ['[Metrica contenido 1]', 'slide12.contenido[0]'],
  ['[Metrica contenido 2]', 'slide12.contenido[1]'],
  ['[Metrica contenido 3]', 'slide12.contenido[2]'],
  ['[Metrica contenido 4]', 'slide12.contenido[3]'],
  ['[Metrica negocio 1]', 'slide12.negocio[0]'],
  ['[Metrica negocio 2]', 'slide12.negocio[1]'],
  ['[Metrica negocio 3]', 'slide12.negocio[2]'],
  ['[Metrica negocio 4]', 'slide12.negocio[3]'],
  ['[Metrica marca 1]', 'slide12.marca[0]'],
  ['[Metrica marca 2]', 'slide12.marca[1]'],
  ['[Metrica marca 3]', 'slide12.marca[2]'],
  ['[Metrica marca 4]', 'slide12.marca[3]'],
  ['[Que se revisa a 30/60/90 dias]', 'slide12.revision'],
  ['[MARCA]', 'marca'],
  ['[AÑO]', 'anio'],

  // SLIDE 13 - Validacion (preguntas)
  ...Array.from({ length: 12 }, (_, i) => [`[Pregunta ${i + 1}]`, `slide13.preguntas[${i}]`]),
  ['[MARCA]', 'marca'],
  ['[AÑO]', 'anio'],

  // SLIDE 14 - Cierre
  ['[Palabra clave 1]', 'palabras_clave[0]'],
  ['[Palabra clave 2]', 'palabras_clave[1]'],
  ['[Palabra clave 3]', 'palabras_clave[2]'],
  ['[Frase de cierre sobre que debe lograr el contenido de esta marca]', 'slide14.frase_cierre'],
  ['[MARCA]', 'marca'],
];

const COLOR_VARS = {
  bg: '--color-bg',
  primary: '--color-primary',
  accent: '--color-accent',
  card_a: '--color-card-a',
  card_b: '--color-card-b',
  on_primary: '--color-on-primary',
  border: '--color-border',
};

async function main() {
  const [, , dataPath, outPdf] = process.argv;
  if (!dataPath || !outPdf) {
    console.error('Uso: node build.js datos_cliente.json salida.pdf');
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  let html = fs.readFileSync(path.join(__dirname, 'plantilla_estrategia.html'), 'utf8');

  // 1) Colores de marca
  if (data.colores) {
    for (const [key, cssVar] of Object.entries(COLOR_VARS)) {
      if (data.colores[key]) {
        const re = new RegExp(`(${cssVar}:\\s*)#[0-9A-Fa-f]{6};`);
        html = html.replace(re, `$1${data.colores[key]};`);
      }
    }
  }

  // 2) Contenido, en orden
  for (const [placeholder, jsonPath] of TEXT_REPLACEMENTS) {
    const value = get(data, jsonPath);
    if (!html.includes(placeholder)) {
      throw new Error(`No se encontro "${placeholder}" en la plantilla (¿se edito el HTML?).`);
    }
    html = html.replace(placeholder, value);
  }

  const tmpHtml = path.join(__dirname, '.build_tmp.html');
  fs.writeFileSync(tmpHtml, html, 'utf8');

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto('file://' + tmpHtml);
  await page.pdf({
    path: outPdf,
    width: '1280px',
    height: '720px',
    printBackground: true,
    margin: { top: 0, bottom: 0, left: 0, right: 0 },
  });
  await browser.close();
  fs.unlinkSync(tmpHtml);
  console.log('Listo ->', outPdf);
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
