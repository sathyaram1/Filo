// Verifica #949 giro 8, rilievi 2 e 3: come la chat legge le parole che il modello le passa (logica pura, senza Electron).
// r2: «com'è impostato?» come ricerca torna tutte le voci, non due a caso. r3: «2 giorni» di inattività non sono 2 ore.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
for (const m of ['constants', 'contenutoEsterno', 'timeFormat', 'storage', 'i18n', 'themeTokens', 'tabColor', 'nomiSito',
  'ttsVoices', 'filoMemory', 'preferences', 'cambi', 'actionLevels', 'actionTools', 'capabilities', 'vociImpostazioni']) {
  require(`../../../src/shared/${m}.js`);
}
const V = globalThis.SN_VOCI_IMPOSTAZIONI;
const P = globalThis.SN_PREF;

test('r2: la domanda «com\'è impostato?» passata come ricerca legge tutte le voci, blocco della pubblicità compreso', () => {
  const r = V.righePerModello({ security: { adblock: { enabled: false } } }, { cerca: 'com\'è impostato?', sistema: 'linux' });
  expect(r.righe.join('\n')).toContain('- blocco di pubblicità e tracker: spento');
});

test('r3: «archivia dopo 2 giorni» non diventa 2 ore, «1 settimana» non diventa 1 ora', () => {
  const due = P.buildPreferencePartial('ore_inattivita', '2 giorni');
  expect(due && !due.rifiuto ? due.partial.autoArchive.idleHours : 'rifiuto').not.toBe(2);
  const sett = P.buildPreferencePartial('ore_inattivita', '1 settimana');
  expect(sett && !sett.rifiuto ? sett.partial.autoArchive.idleHours : 'rifiuto').not.toBe(1);
});
