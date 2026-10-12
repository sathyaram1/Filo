// #1173 giro 1 — un campo fatto quasi tutto di dati da cancellare (un numero lunghissimo, una fila di indirizzi)
// dopo la pulizia è corto: la parte che dice QUALE elemento o QUALE azione deve arrivare, e la pulizia resta veloce.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/contenutoEsterno.js');
require('../../../src/shared/pathsSafety.js');
const S = globalThis.SN_PATHS_SAFETY;

test('r2 un elemento con un numero lunghissimo nell\'attributo tiene il nome del pulsante', () => {
  const sel = `[data-id="${'1'.repeat(1400)}"] button.Paga`;
  expect(S._internal.redactSelector(sel)).toBe('[data-id="[NUMERO]"] button.Paga');
});

test('r2 un elemento con una fila di indirizzi nell\'etichetta tiene la classe in fondo', () => {
  const sel = `[aria-label="${'mario.rossi.lunghissimo@example-company.com, '.repeat(40)}"] .invia`;
  expect(S._internal.redactSelector(sel)).toMatch(/\.invia$/);
});

test('r2 l\'intento con un numero di pratica lunghissimo tiene dove si va', () => {
  const it = `Pagare la pratica ${'1'.repeat(800)} dal menu Fatture`;
  expect(S._internal.sanitizeIntent(it)).toBe('Pagare la pratica [NUMERO] dal menu Fatture');
});

test('r2 la pulizia di un elemento enorme resta veloce', () => {
  const steps = Array.from({ length: 30 }, (_, i) => ({ selector: `${'a'.repeat(60000)}${i}`, action: 'click' }));
  const t = Date.now();
  S.formatKnownPathsForPrompt([{ initialUrl: '/', intent: 'x', steps }]);
  expect(Date.now() - t).toBeLessThan(2000);
});
