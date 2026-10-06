/**
 * Conector: Google Forms -> CRM Peques.
 * Cada vez que alguien completa el formulario, esta función manda sus datos al CRM (crea el contacto con su consentimiento).
 *
 * Instalación (una sola vez), en la PLANILLA de respuestas del formulario:
 *   1. Extensiones -> Apps Script. Borrá lo que haya y pegá todo este archivo.
 *   2. Guardá (ícono del disquete) y, en el menú de la izquierda, tocá el reloj «Activadores» -> «Añadir activador».
 *   3. Función: onFormSubmit · Origen del evento: «De una hoja de cálculo» · Tipo: «Al enviar el formulario» -> Guardar.
 *   4. Google te pide permisos la primera vez (conectarse a un servicio externo): aceptá.
 *
 * Las preguntas se reconocen por su título: nombre, teléfono/celular/WhatsApp, mail, nombre del peque, edad, cantidad.
 * Lo que no se reconoce se guarda en las notas del contacto, para no perder nada.
 */
const API = 'https://pyseyxvzaqfjrbugfqry.supabase.co/functions/v1/api/public/signup';
const CLAVE = 'PEGAR_CLAVE_AQUI';

// false: toda persona que completa el formulario se considera que aceptó que la contacten por WhatsApp
//        (el formulario debería decirlo en su descripción).
// true:  solo se inscribe si hay una pregunta de consentimiento («Acepto…») respondida con algo distinto de «No».
const EXIGIR_PREGUNTA_DE_CONSENTIMIENTO = false;

const REGLAS = [ // mismo orden de prioridad que la importación del CRM
  ['child_age', /\bedad\b/],
  ['kids_count', /(cantidad|cant|numero de)\s*(de\s*)?(ninos|ninas|peques|hijos|chicos)/],
  ['child_name', /(hijo|hija|nene|nena|peque|nino|nina|chico|chica)/],
  ['email', /(mail|correo)/],
  ['phone', /(telefono|celular|\bcel\b|whatsapp|wsp|wpp|movil|\btel\b|phone|numero|\bnro\b)/],
  ['notes', /(nota|observ|comentario|\bobs\b|alergi|consulta)/],
  ['name', /(nombre|apellido|contacto|padre|madre|papa|mama|responsable|tutor|name|adulto)/],
];
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

function onFormSubmit(e) {
  const respuestas = e.namedValues || {};
  const datos = {};
  const sobrantes = [];
  let consiente = !EXIGIR_PREGUNTA_DE_CONSENTIMIENTO;

  Object.keys(respuestas).forEach(function (pregunta) {
    const valor = String((respuestas[pregunta] || [])[0] || '').trim();
    const n = norm(pregunta);
    if (!valor || n === 'marca temporal' || n === 'timestamp') return;
    if (/(acepto|consent|autorizo|autoriz)/.test(n)) { consiente = !/^no\b/.test(norm(valor)); return; }
    const campo = (REGLAS.find(function (r) { return r[1].test(n); }) || [])[0];
    if (campo && !datos[campo]) datos[campo] = valor;
    else sobrantes.push(pregunta + ': ' + valor);
  });
  if (sobrantes.length) datos.notes = [datos.notes, sobrantes.join(' | ')].filter(Boolean).join(' | ');

  datos.consent = consiente;
  datos.kids_count = parseInt(datos.kids_count, 10) || 1;
  datos.key = CLAVE;
  enviar(datos);
}

function enviar(datos) {
  for (var intento = 1; intento <= 3; intento++) {
    try {
      const r = UrlFetchApp.fetch(API, { method: 'post', contentType: 'application/json', payload: JSON.stringify(datos), muteHttpExceptions: true });
      const codigo = r.getResponseCode();
      if (codigo === 200) return;
      Logger.log('CRM respondió ' + codigo + ': ' + r.getContentText());
      if (codigo < 500 && codigo !== 429) return; // error de datos: reintentar no sirve (se ve en Ejecuciones)
    } catch (err) {
      Logger.log('Sin conexión con el CRM (intento ' + intento + '): ' + err);
    }
    Utilities.sleep(2000 * intento);
  }
  throw new Error('No se pudo enviar la inscripción al CRM: ' + JSON.stringify(datos.name));
}
