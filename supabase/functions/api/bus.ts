// @ts-nocheck
// Eventos internos: contacts.ts avisa ('contact:created', 'contact:status') y automations.ts reacciona.
// Evita dependencias circulares y que un error en una automatización rompa el guardado del contacto.
const handlers = new Map();

export const bus = {
  on(event, fn) {
    if (!handlers.has(event)) handlers.set(event, new Set());
    handlers.get(event).add(fn);
  },
  off(event, fn) {
    handlers.get(event)?.delete(fn);
  },
  async fire(event, ...args) {
    for (const fn of [...(handlers.get(event) || [])]) {
      try {
        await fn(...args);
      } catch (e) {
        console.error(`[bus] error en "${event}":`, e);
      }
    }
  },
};
