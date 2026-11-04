// Giro 1 della verifica #1918, rilievo 1, la parte dell'app: in una sessione locale chi legge eredita le radici di ciò
// che legge, e una conversazione scritta da biglietti puliti non sporca (punto 2 della segnalazione). Non apre Filo.
// Il modo in cui il verdetto del server arriva qui può cambiare con la correzione: le prove dicono cosa deve valere.
import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { motiviDiLettura, sporca, ENV_FILE } from '../../../scripts/lib/biglietto-locale.mjs';

const TURNO_ROUTINE = "--- Aggiornamento dell'agente del 1/11/2026 ---\nReport del lavoro.";

test('r1 un feedback fidato con una conversazione scritta solo da biglietti puliti non sporca chi lo legge', () => {
  // Il server sa chi ha scritto la conversazione: nessun biglietto sporco (scrittoSporco false, nessuna radice).
  const motivi = motiviDiLettura({ fiducia: 'fidato', radici: [], notes: TURNO_ROUTINE, scrittoSporco: false });
  expect(motivi).toEqual([]);
});

test('r1 leggere il testo di un utente porta al server la sua radice, non una della sola sessione', async () => {
  const dir = cartellaTemporanea('verifica-1918-');
  const file = join(dir, 'biglietto.json');
  writeFileSync(file, JSON.stringify({ ticket: 'x'.repeat(40), fp: 'f'.repeat(64), natoIl: 1 }));
  const mandati = [];
  const fetchImpl = async (_url, init) => {
    mandati.push(JSON.parse(init.body).data);
    return { ok: true, status: 200, json: async () => ({ result: { ok: true, fiducia: 'non_fidato' } }) };
  };
  await sporca('letto #1500: testo di un feedback non fidato', {
    env: { [ENV_FILE]: file }, cwd: dir, radici: ['feedback:1500'],
    deps: { fetchImpl, idToken: async () => 'token-finto' },
  });
  const sporco = mandati.find((d) => d.op === 'sporca');
  expect(sporco, 'la sessione ha detto lo sporco al server').toBeTruthy();
  expect(sporco.radici || [], 'le radici di ciò che ha letto').toContain('feedback:1500');
});
