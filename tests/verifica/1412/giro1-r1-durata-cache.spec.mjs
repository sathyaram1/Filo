// Verifica #1412 giro 1: la durata della cache della chat è una costante della spec (§ Le costanti), modificabile
// come le altre in Preferenze e chiedendolo a Filo; oggi l'ora è scritta fissa nel piano dei punti di cache.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/constants.js');
require('../../../src/shared/filoContesto.js');
require('../../../src/shared/vociImpostazioni.js');
require('../../../src/shared/preferences.js');

const CACHE = /cache/i;

test('r1 la durata della cache si cambia in Preferenze e chiedendolo a Filo', () => {
  const campi = Object.values(globalThis.SN_VOCI_IMPOSTAZIONI.PAGINE.preferences.campi || {});
  expect(campi.filter((p) => CACHE.test(String(p))), 'una voce di Preferenze che scrive la durata della cache').not.toEqual([]);
  const setters = globalThis.SN_PREF.PREF_SETTERS || [];
  const scrive = setters.flatMap((s) => (s && Array.isArray(s.scrive) ? s.scrive : []));
  expect(scrive.filter((p) => CACHE.test(String(p))), 'Filo sa cambiarla a parole').not.toEqual([]);
});
