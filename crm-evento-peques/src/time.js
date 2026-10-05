'use strict';
// Manejo de zona horaria sin dependencias (Intl). El evento se guarda como hora local
// ("2026-11-15T16:00") + zona, así no se corre si cambia el servidor de lugar/zona.

function offsetMinutes(date, tz) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(date).map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return (asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000;
}

/** "YYYY-MM-DDTHH:mm" en hora de `tz` -> Date (UTC). null si no se puede parsear. */
function localToDate(local, tz) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(String(local || ''));
  if (!m) return null;
  const naive = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let t = naive - offsetMinutes(new Date(naive), tz) * 60000;
  t = naive - offsetMinutes(new Date(t), tz) * 60000; // 2ª pasada por si cruza un cambio horario
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDay(date, tz) {
  // Intl devuelve "domingo, 15 de noviembre"; en un mensaje queda mejor sin la coma
  return new Intl.DateTimeFormat('es-AR', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(date).replace(',', '');
}

function formatHour(date, tz) {
  const t = new Intl.DateTimeFormat('es-AR', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
  return `${t} hs`;
}

module.exports = { localToDate, formatDay, formatHour, offsetMinutes };
