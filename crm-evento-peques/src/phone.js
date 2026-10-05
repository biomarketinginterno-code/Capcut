'use strict';
// Normaliza teléfonos a formato internacional, solo dígitos (E.164 sin "+").
// Pensado para Argentina: celulares = 54 + 9 + área + número (10 dígitos nacionales).
// Entiende: "223 456-7890", "0223 15 456 7890", "+54 9 223 456 7890", "(11) 15-2345-6789", "541115..."

const digitsOnly = (s) => String(s ?? '').replace(/\D+/g, '');

// 15 de celular: 11 15 xxxxxxxx | 223 15 xxxxxxx | 2262 15 xxxxxx  (12 dígitos nacionales)
function drop15(d) {
  if (d.length !== 12) return d;
  if (d.startsWith('11') && d.slice(2, 4) === '15') return d.slice(0, 2) + d.slice(4);
  if (d.slice(3, 5) === '15') return d.slice(0, 3) + d.slice(5);
  if (d.slice(4, 6) === '15') return d.slice(0, 4) + d.slice(6);
  return d;
}

// rest = dígitos después del código de país (54). Devuelve los 10 dígitos nacionales o null.
function argentineNational(rest, area) {
  let r = rest;
  if (r.startsWith('9') && r.length === 11) r = r.slice(1);
  r = r.replace(/^0+/, '');
  if (area && r.startsWith('15') && r.length === 9) r = r.slice(2); // "15 4567890" sin área
  r = drop15(r);
  if (area && area.length + r.length === 10) r = area + r; // "4567890" sin área
  return r.length === 10 ? r : null;
}

/**
 * @param input  texto tal como lo escribió la persona
 * @param opts   { country: '54', area: '223' }  país y código de área por defecto
 * @returns {{valid:boolean, phone?:string, key?:string, reason?:string}}
 */
function normalizePhone(input, opts = {}) {
  const country = digitsOnly(opts.country || '54');
  const area = digitsOnly(opts.area || '');
  const raw = String(input ?? '').trim();
  let d = digitsOnly(raw);
  if (!d) return { valid: false, reason: 'sin dígitos' };

  const explicit = raw.startsWith('+') || d.startsWith('00');
  d = d.replace(/^00+/, '');

  let cc;
  let national;
  if (explicit) {
    cc = d.startsWith('54') ? '54' : '';
    national = cc ? d.slice(2) : d;
  } else if (d.startsWith(country) && d.length >= (country === '54' ? 12 : 11)) {
    cc = country;
    national = d.slice(country.length);
  } else {
    cc = country;
    national = d;
  }

  let phone;
  if (cc === '54') {
    const n = argentineNational(national, area);
    if (!n) return { valid: false, reason: 'no parece un celular argentino (faltan o sobran dígitos)' };
    phone = '549' + n;
  } else if (cc) {
    phone = cc + national.replace(/^0+/, '');
  } else {
    phone = national; // internacional explícito de otro país: se respeta tal cual
  }

  if (phone.length < 8 || phone.length > 15) return { valid: false, reason: 'largo inválido' };
  return { valid: true, phone, key: phoneKey(phone) };
}

// Clave para detectar duplicados y cruzar respuestas entrantes: últimos 10 dígitos.
// (Meta a veces manda los números argentinos con/sin 9 o con 15; los últimos 10 son estables.)
const phoneKey = (phone) => digitsOnly(phone).slice(-10);

function formatPhone(phone) {
  const d = digitsOnly(phone);
  if (d.startsWith('549') && d.length === 13) return `+54 9 ${d.slice(3)}`;
  return d ? `+${d}` : '';
}

module.exports = { normalizePhone, phoneKey, formatPhone, digitsOnly };
