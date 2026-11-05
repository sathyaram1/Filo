// #2181 giro 2: in una routine, con il censimento che non sta nei feedback, «scrivi» si ferma; un --solo che non porta
// nessun numero (una virgola, un cancelletto) non è una scheda chiesta, e non deve lanciare gli agenti su tutti gli aperti.
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function cartellaCon(aperti, conScheda) {
  const dir = cartellaTemporanea('filo-2181-');
  const indice = Array.from({ length: aperti }, (_, i) => ({ id: `id${i + 1}`, num: String(i + 1), stato: 'todo', priorita: 1, aggiornato: 'T', attese: [], unisce: [] }));
  writeFileSync(join(dir, 'indice.json'), JSON.stringify(indice));
  for (let n = 1; n <= conScheda; n++) {
    writeFileSync(join(dir, `${n}.json`), JSON.stringify({
      numero: String(n), titolo_breve: 't', riassunto: 'r', prova: 'p', valido: 'si', tipo: 'bug', area: 'home', urgente: false,
      file_probabili: [], doppione_di: [], parole_chiave: [], risolto_su_main: null, note: '',
      _fonte: { id: `id${n}`, stato: 'todo', aggiornato: 'T', at: '2026-11-05', modello: 'haiku' },
    }));
  }
  return dir;
}

function scrivi(dir, extra) {
  try {
    const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'schede.mjs'), 'scrivi', ...extra, '--dry-run', '--cartella', dir], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FILO_ROUTINE: '1', FILO_ROUTINE_TICKET: 'biglietto-finto-2181' },
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

test('r1 un --solo senza numeri non scavalca il fermo del censimento mancante', () => {
  const dir = cartellaCon(768, 1);
  expect(scrivi(dir, []).out).toMatch(/FERMO/);
  for (const solo of [',', '#']) {
    const r = scrivi(dir, ['--solo', solo]);
    expect(r.out, `--solo ${solo}`).not.toMatch(/\d{3} agenti/);
  }
});
