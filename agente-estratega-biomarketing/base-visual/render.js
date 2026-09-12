// Convierte la plantilla HTML a PDF, un slide de 1280x720 por página.
// Uso: node render.js plantilla_estrategia.html salida.pdf
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const inputHtml = process.argv[2];
  const outputPdf = process.argv[3];
  if (!inputHtml || !outputPdf) {
    console.error('Uso: node render.js <entrada.html> <salida.pdf>');
    process.exit(1);
  }
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto('file://' + path.resolve(inputHtml));
  await page.pdf({
    path: outputPdf,
    width: '1280px',
    height: '720px',
    printBackground: true,
    margin: { top: 0, bottom: 0, left: 0, right: 0 },
  });
  await browser.close();
  console.log('OK ->', outputPdf);
})();
