// Prova del giro 2, rilievo 2 (verifica locale, letture-delta): un segno tolto sul server (pre-approvazione,
// lavoro locale) deve sparire anche dalla lista della Gestione dopo il giro. Non apre Filo: la riga riletta è
// la proiezione della lista, come quella che torna dal giro vero, senza il campo cancellato.

import { test, expect } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('un segno tolto sul server non resta nella lista dopo il giro', async () => {
  await import(pathToFileURL(resolve(ROOT, 'src/shared/feedbackLive.js')).href);
  const LIVE = globalThis.SN_FEEDBACK_LIVE;
  const segno = { by: 'owner@example.com', at: 1 };
  const prima = [{ _id: 'p1', _proiezione: true, _updateTime: '2026-10-04T10:00:00.000001Z', seq: 1, name: 'x', mergePreapproved: segno, localOnly: segno }];
  const riletta = { _id: 'p1', _proiezione: true, _updateTime: '2026-10-04T10:05:00.000001Z', seq: 1, name: 'x' };
  const dopo = LIVE.applyChanges(prima, { fresh: [riletta] }).find((r) => r._id === 'p1');
  expect(dopo.mergePreapproved, 'pre-approvazione tolta sul server').toBeUndefined();
  expect(dopo.localOnly, 'segno di lavoro locale tolto sul server').toBeUndefined();
});
