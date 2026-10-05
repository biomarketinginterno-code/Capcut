'use strict';
const { localToDate, formatDay, formatHour } = require('./time');

// Variables disponibles en los mensajes: {{nombre}}, {{fecha}}, etc.
const VARIABLES = [
  { name: 'nombre', desc: 'Nombre de pila del contacto' },
  { name: 'nombre_completo', desc: 'Nombre completo del contacto' },
  { name: 'hijo', desc: 'Nombre del peque' },
  { name: 'edad', desc: 'Edad del peque' },
  { name: 'cantidad_ninos', desc: 'Cantidad de peques' },
  { name: 'evento', desc: 'Nombre del evento' },
  { name: 'fecha', desc: 'Día del evento (ej: sábado 15 de noviembre)' },
  { name: 'hora', desc: 'Hora del evento (ej: 16:00 hs)' },
  { name: 'lugar', desc: 'Lugar del evento' },
  { name: 'direccion', desc: 'Dirección del evento' },
];

function firstName(full) {
  const w = String(full || '').trim().split(/\s+/)[0] || '';
  return w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : '';
}

function contactVars(contact, settings) {
  const at = localToDate(settings.event_at_local, settings.timezone);
  return {
    nombre: firstName(contact.name),
    nombre_completo: contact.name || '',
    hijo: contact.child_name || '',
    edad: contact.child_age || '',
    cantidad_ninos: String(contact.kids_count ?? ''),
    evento: settings.event_name || '',
    fecha: at ? formatDay(at, settings.timezone) : '',
    hora: at ? formatHour(at, settings.timezone) : '',
    lugar: settings.event_place || '',
    direccion: settings.event_address || '',
  };
}

const render = (text, vars) =>
  String(text ?? '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (vars[k] === undefined ? '' : vars[k]));

// Meta no admite saltos de línea, tabs ni 4+ espacios seguidos dentro de un parámetro de plantilla.
const cleanParam = (s) => String(s ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {4,}/g, '   ').trim() || '-';

/** Plantilla de Meta: { name, lang, params:[nombres de variable en orden] } -> con valores. */
function renderTemplate(tpl, vars) {
  if (!tpl || !tpl.name) return null;
  return {
    name: tpl.name,
    lang: tpl.lang || 'es_AR',
    params: (tpl.params || []).map((p) => cleanParam(vars[p])),
  };
}

/** Normaliza lo que llega del panel: { name, lang, params: "nombre, evento" | [..] } -> { name, lang, params:[..] } o null. */
function cleanTemplate(t) {
  if (!t || !String(t.name || '').trim()) return null;
  const params = Array.isArray(t.params) ? t.params : String(t.params || '').split(/[,\s]+/);
  return {
    name: String(t.name).trim(),
    lang: String(t.lang || 'es_AR').trim(),
    params: params.map((p) => String(p).replace(/[{}\s]/g, '')).filter(Boolean),
  };
}

module.exports = { VARIABLES, contactVars, render, renderTemplate, cleanTemplate, firstName };
