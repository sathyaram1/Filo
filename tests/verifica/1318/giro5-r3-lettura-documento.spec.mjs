// Verifica #1318, giro 5: r3, il controllo prima della lettura di un documento vede il percorso pulito come lo legge la
// lettura: stesso giudizio nudo, fra virgolette, fra apici inversi o come «file://».

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
for (const f of ['urlNav', 'cmdClassify', 'actionLevels']) require(resolve(`src/shared/${f}.js`));

const perimetro = { home: '/home/utente', cwd: '/home/utente', win: false, reti: [] };
const giudizio = (percorso) => {
  const a = { type: 'LEGGI_DOCUMENTO', percorso, _perimetro: perimetro };
  return { costo: globalThis.SN_ACTION_LEVELS.costoFor(a), motivo: globalThis.SN_CMD_CLASSIFY.fuoriPerimetro(percorso, perimetro) };
};

test('r3 un documento nella cartella personale chiesto come «file://» si giudica come scritto nudo', () => {
  expect(giudizio('file:///home/utente/Documenti/conto.pdf')).toEqual(giudizio('/home/utente/Documenti/conto.pdf'));
});

test('r3 un documento fuori dalla cartella personale fra apici inversi si giudica come scritto nudo', () => {
  expect(giudizio('`/srv/condivisa/conto.pdf`')).toEqual(giudizio('/srv/condivisa/conto.pdf'));
});
