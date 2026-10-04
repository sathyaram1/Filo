// Giro 2, rilievo 2: «archivia dopo un'ora e mezza» chiesto a Filo diventa 15 ore,
// perché le ore di inattività perdono la virgola. Logica pura: niente finestra.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
for (const m of ['constants', 'contenutoEsterno', 'timeFormat', 'storage', 'themeTokens', 'tabColor', 'nomiSito',
  'ttsVoices', 'filoMemory', 'preferences']) {
  require(`../../../src/shared/${m}.js`);
}

test('un numero di ore con la virgola non diventa dieci volte tanto', () => {
  const P = globalThis.SN_PREF;
  for (const v of ['1,5', '1.5', 1.5]) {
    const r = P.buildPreferencePartial('ore_inattivita', v);
    const ore = r && r.partial ? r.partial.autoArchive.idleHours : null;
    expect(ore === null || ore <= 2, `«${v}» è diventato ${ore} ore`).toBe(true);
  }
});
