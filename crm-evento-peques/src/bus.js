'use strict';
// Eventos internos: contacts.js avisa ('contact:created', 'contact:status') y automations.js reacciona.
// Evita dependencias circulares y que un error en una automatización rompa el guardado del contacto.
const { EventEmitter } = require('node:events');

const bus = new EventEmitter();

bus.fire = (event, ...args) => {
  for (const fn of bus.listeners(event)) {
    try {
      fn(...args);
    } catch (e) {
      console.error(`[bus] error en "${event}":`, e);
    }
  }
};

module.exports = bus;
