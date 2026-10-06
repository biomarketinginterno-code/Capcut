// @ts-nocheck
// Inscripción pública desde la landing page (sin sesión). Crea el contacto en el CRM con su consentimiento.
// Defensas: campo trampa para bots, tope de inscripciones por IP y global por hora, y validación estricta de los datos.
import { db, getSettings, getRaw, HttpError } from './db.ts';
import * as contacts from './contacts.ts';
import { normalizePhone } from './phone.ts';
import { countAttempt } from './auth.ts';
import { safeEqual } from './whatsapp.ts';

const PER_IP = 8;        // inscripciones por IP y por hora (una familia puede anotar a varios chicos desde la misma red)
const GLOBAL = 300;      // inscripciones por hora en total: corta una inundación de bots sin molestar a las familias reales
const HOUR = 3600;

const str = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Devuelve el contacto creado, o null si ya existía / era un bot (en ambos casos la persona ve «¡Listo!»). */
export async function signup(input, ip) {
  if (str(input.website, 50)) return null; // los bots completan el campo oculto: se descarta en silencio
  // El conector del Google Form (Apps Script) manda con una clave propia: sus pedidos salen todos de las mismas IP de
  // Google, así que el tope por IP bloquearía inscripciones reales. El tope global sigue valiendo.
  const secret = await getRaw('signup_key');
  const trusted = Boolean(secret) && safeEqual(String(input.key ?? ''), secret);
  if ((!trusted && (await countAttempt(`lead:${ip}`, HOUR)) > PER_IP) || (await countAttempt('lead:all', HOUR)) > GLOBAL) {
    throw new HttpError(429, 'Recibimos muchas inscripciones desde tu conexión. Probá de nuevo en un rato o escribinos por WhatsApp.');
  }
  const name = str(input.name, 120);
  if (name.length < 2) throw new HttpError(400, 'Escribí tu nombre y apellido.');
  if (input.consent !== true) throw new HttpError(400, 'Tenés que aceptar que te contactemos por WhatsApp para poder inscribirte.');
  const s = await getSettings();
  const p = normalizePhone(input.phone, { country: s.default_country, area: s.default_area });
  if (!p.valid) throw new HttpError(400, 'Revisá el número de WhatsApp: tiene que ser un celular con código de área (por ejemplo 223 456-7890).');
  const email = str(input.email, 160);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Revisá el email: no parece válido.');

  if (await db.one('select 1 from contacts where phone_key = $1', [p.key])) return null; // ya inscripto: no se pisa nada ni se avisa que existe
  try {
    return await contacts.create({
      name, phone: input.phone, email,
      child_name: str(input.child_name, 120), child_age: str(input.child_age, 40), kids_count: input.kids_count,
      notes: str(input.notes, 500), source: trusted ? 'google-forms' : 'landing', status: 'interesado', tags: [trusted ? 'google-forms' : 'landing'],
      consent_note: trusted ? 'Formulario de Google de la landing: aceptó que lo contacten por WhatsApp' : 'Formulario de la landing: aceptó que lo contacten por WhatsApp',
    });
  } catch (e) {
    if (e?.status === 409) return null; // carrera: lo anotaron en el mismo instante
    throw e;
  }
}
