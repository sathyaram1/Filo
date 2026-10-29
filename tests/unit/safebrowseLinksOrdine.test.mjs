// #1792 — I link a schermo partono prima degli altri anche quando la pagina è lenta a disegnarsi: il primo lotto aspetta
// che l'osservatore abbia detto quali link nuovi si vedono. Il content script gira in un mondo finto, coi tempi in mano.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../../src/content/safebrowseLinks.js', import.meta.url), 'utf8');

function mondo({ n = 1000, visibilita = 'visible' } = {}) {
  const links = [];
  for (let i = 0; i < n; i++) links.push({ href: `https://risultato-${i}.esempio.com/pagina/${i}` });
  links[0].href = 'https://paypa1.com/in-fondo';
  links[n - 1].href = 'https://paypal-login.com/in-cima';
  const inattivo = [];
  const timer = [];
  const mandati = [];
  let osservatore = null;
  const osservati = new Set();
  const sb = {
    location: { protocol: 'https:', href: 'https://risultati.example.com/' },
    document: { links, readyState: 'complete', visibilityState: visibilita, addEventListener() {} },
    chrome: { runtime: { sendMessage: (msg, cb) => { mandati.push(msg.urls); cb({ ok: true }); } } },
    requestIdleCallback: (fn) => { inattivo.push(fn); },
    setTimeout: (fn, ms) => { timer.push({ fn, ms }); return timer.length; },
    clearTimeout: (id) => { if (timer[id - 1]) timer[id - 1].fn = null; },
    IntersectionObserver: class {
      constructor(cb) { this.cb = cb; osservatore = this; }
      observe(el) { osservati.add(el); }
      unobserve(el) { osservati.delete(el); }
    },
    MutationObserver: class { observe() {} },
  };
  vm.createContext(sb);
  vm.runInContext(SRC, sb);
  return {
    links, mandati, timer,
    // I momenti liberi della pagina: quelli già chiesti, e quelli che chiedono i messaggi mandati nel frattempo.
    libera() { for (let i = 0; i < 50 && inattivo.length; i++) inattivo.shift()(); },
    // Il primo disegno: l'osservatore dice di ogni link nuovo se si vede.
    disegna(aSchermo) {
      const voci = [...osservati].map((target) => ({ target, isIntersecting: aSchermo.includes(target) }));
      osservatore.cb(voci);
    },
  };
}

test('la pagina lenta a disegnarsi: il primo lotto aspetta lo schermo e parte dal link che si vede', () => {
  const m = mondo();
  m.libera();
  assert.deepEqual(m.mandati, [], 'prima del primo disegno non parte niente nell\'ordine della pagina');
  m.disegna([m.links[m.links.length - 1]]);
  m.libera();
  assert.equal(m.mandati[0][0], 'https://paypal-login.com/in-cima');
  assert.equal(m.mandati.flat().length, m.links.length, 'poi tutti, una volta sola');
  assert.equal(new Set(m.mandati.flat()).size, m.links.length);
});

test('un osservatore che non risponde non ferma l\'esame: dopo l\'attesa i link partono nell\'ordine della pagina', () => {
  const m = mondo();
  m.libera();
  assert.deepEqual(m.mandati, []);
  const attesa = m.timer.find((t) => t.fn && t.ms >= 1000);
  assert.ok(attesa, 'c\'è un\'attesa con un tetto');
  attesa.fn();
  m.libera();
  assert.equal(m.mandati[0][0], 'https://paypa1.com/in-fondo');
  assert.equal(m.mandati.flat().length, m.links.length);
});

test('una pagina nascosta non si disegna e non aspetta', () => {
  const m = mondo({ visibilita: 'hidden' });
  m.libera();
  assert.equal(m.mandati[0][0], 'https://paypa1.com/in-fondo');
  assert.equal(m.mandati.flat().length, m.links.length);
});
