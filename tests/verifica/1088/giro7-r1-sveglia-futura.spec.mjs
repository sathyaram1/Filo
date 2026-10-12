// #1088 giro 7 — una sveglia o un timer del backup che deve ancora suonare non sparisce all'importazione.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/constants.js');
const { mergeImportedData } = require('../../../src/main/services/exportData.js');
const K = globalThis.SN_CONST.STORAGE_KEYS;

test('r1 una sveglia singola di domani e un timer ancora in corso arrivano dal backup', () => {
  const adesso = Date.parse('2026-10-12T10:00:00Z');
  const backup = [
    { id: 'a1', kind: 'alarm', label: 'dentista', startedAt: '2026-10-12T09:00:00.000Z', endsAt: '2026-10-13T07:00:00.000Z', paused: false },
    { id: 't1', label: 'forno', startedAt: '2026-10-12T09:50:00.000Z', endsAt: '2026-10-12T10:40:00.000Z', paused: false },
  ];
  const { merged } = mergeImportedData({}, { [K.FILO_TIMERS]: backup }, {
    prossimaSveglia: () => null, adesso,
  });
  const ids = (merged[K.FILO_TIMERS] || []).map((t) => t.id);
  expect(ids).toContain('a1');
  expect(ids).toContain('t1');
});
