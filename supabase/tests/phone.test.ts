// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone, phoneKey, formatPhone } from '../functions/api/phone.ts';
import { parseDelimited, toCSV } from '../functions/api/csv.ts';
import { localToDate, formatDay, formatHour } from '../functions/api/time.ts';
import { render, contactVars } from '../functions/api/template.ts';

const MDP = { country: '54', area: '223' };
const ok = (input, expected, opts = MDP) => {
  const r = normalizePhone(input, opts);
  assert.equal(r.valid, true, `${input} -> ${r.reason}`);
  assert.equal(r.phone, expected, input);
};

test('teléfonos argentinos en todos los formatos habituales', () => {
  ok('223 456-7890', '5492234567890');
  ok('2234567890', '5492234567890');
  ok('0223 15 456 7890', '5492234567890');
  ok('(0223) 15-4567890', '5492234567890');
  ok('+54 9 223 456 7890', '5492234567890');
  ok('+5492234567890', '5492234567890');
  ok('5492234567890', '5492234567890');
  ok('542234567890', '5492234567890');
  ok('0054 9 223 4567890', '5492234567890');
  ok('11 2345-6789', '5491123456789');
  ok('(011) 15 2345 6789', '5491123456789');
  ok('541115 23456789', '5491123456789'); // formato que a veces manda Meta (con 15)
  ok('2262 15 456789', '5492262456789');   // área de 4 dígitos
});

test('números sin código de área usan el área por defecto', () => {
  ok('456-7890', '5492234567890');
  ok('15 456-7890', '5492234567890');
  assert.equal(normalizePhone('456-7890', { country: '54', area: '' }).valid, false);
});

test('rechaza lo que no es un teléfono', () => {
  for (const bad of ['', 'abc', '123', '223 456', '+54 9 223 456789012345']) {
    assert.equal(normalizePhone(bad, MDP).valid, false, bad);
  }
});

test('otros países: respeta el código internacional', () => {
  ok('+598 99 123 456', '59899123456');
  ok('+1 (415) 555-2671', '14155552671');
  ok('099 123 456', '59899123456', { country: '598' });
});

test('la clave de duplicados es estable entre variantes', () => {
  const a = normalizePhone('+54 9 223 456 7890', MDP);
  const b = normalizePhone('0223 15 4567890', MDP);
  assert.equal(a.key, b.key);
  assert.equal(normalizePhone('541115 23456789', MDP).key, phoneKey('5491123456789'));
  assert.equal(formatPhone('5492234567890'), '+54 9 2234567890');
});

test('csv: separadores, comillas y saltos de línea', () => {
  assert.deepEqual(parseDelimited('a;b;c\n1;"x;y";3\n'), [['a', 'b', 'c'], ['1', 'x;y', '3']]);
  assert.deepEqual(parseDelimited('a\tb\r\n"l1\nl2"\t"co""mo"'), [['a', 'b'], ['l1\nl2', 'co"mo']]);
  assert.deepEqual(parseDelimited('\uFEFFnombre,tel\nAna,1\n\n,\n'), [['nombre', 'tel'], ['Ana', '1']]);
});

test('csv: exportación bloquea fórmulas', () => {
  const out = toCSV(['n'], [['=HYPERLINK("x")'], ['+54 9'], ['normal']]);
  assert.match(out, /"'=HYPERLINK\(""x""\)"/);
  assert.match(out, /'\+54 9/);
  assert.match(out, /\r\nnormal\r\n/);
});

test('hora local del evento -> fecha UTC (Argentina = UTC-3)', () => {
  const d = localToDate('2026-11-15T16:00', 'America/Argentina/Buenos_Aires');
  assert.equal(d.toISOString(), '2026-11-15T19:00:00.000Z');
  assert.equal(formatHour(d, 'America/Argentina/Buenos_Aires'), '16:00 hs');
  assert.match(formatDay(d, 'America/Argentina/Buenos_Aires'), /domingo 15 de noviembre/);
  assert.equal(localToDate('basura', 'UTC'), null);
});

test('variables de mensaje', () => {
  const settings = { event_name: 'Fiesta', event_at_local: '2026-11-15T16:00', timezone: 'America/Argentina/Buenos_Aires', event_place: 'Plaza', event_address: 'Calle 1' };
  const v = contactVars({ name: 'mARÍA pérez', child_name: 'Juan', child_age: '5', kids_count: 2 }, settings);
  assert.equal(render('Hola {{nombre}} ({{ hijo }}), {{hora}} en {{lugar}}. {{desconocida}}!', v), 'Hola María (Juan), 16:00 hs en Plaza. !');
});
