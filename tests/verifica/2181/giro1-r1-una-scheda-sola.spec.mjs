// #2181 giro 1: il fermo del censimento in una routine cede con una sola scheda salvata. Il manutentore ne scrive una
// con «scrivi --solo N» (lo suggerisce incroci), e il mattino dopo «scrivi» riparte su tutti gli altri aperti alla cieca.
import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
const APERTI = 768;

const scheda = (num) => ({
  numero: String(num), stato: 'todo', mittente: 'utente', titolo_breve: 'Menu che non si apre',
  riassunto: 'Il menu del tasto destro non si apre sulle immagini.', tipo: 'bug', area: 'browser-schede',
  file_probabili: ['src/content/menu.js'], urgente: false, valido: 'si', prova: 'Letto il gestore: il caso manca.',
  risolto_su_main: null, doppione_di: [], parole_chiave: ['menu'], note: '',
  _fonte: { id: `f${num}`, stato: 'todo', aggiornato: 'A', at: '2026-11-05T10:00:00.000Z', modello: 'haiku' },
});

test('r1 una scheda scritta con --solo non apre la riscrittura alla cieca di tutti gli altri aperti', () => {
  const dir = cartellaTemporanea('verifica-2181-');
  try {
    const cartella = join(dir, 'schede');
    mkdirSync(cartella, { recursive: true });
    const indice = Array.from({ length: APERTI }, (_, i) => ({ id: `f${i + 1}`, num: String(i + 1), stato: 'todo', aggiornato: 'A', attese: [], unisce: [] }));
    writeFileSync(join(cartella, 'indice.json'), JSON.stringify(indice));
    // La sola scheda nei feedback: quella che il manutentore ha scritto ieri per incroci, ricopiata da elenca.
    writeFileSync(join(cartella, '5.json'), JSON.stringify(scheda(5)));
    const env = { ...process.env, FILO_ROUTINE: '1', FILO_ROUTINE_TICKET: 'biglietto-finto', FILO_ROUTINE_API: 'http://127.0.0.1:9' };
    const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'schede.mjs'), 'scrivi', '--dry-run', '--cartella', cartella], { cwd: ROOT, env, encoding: 'utf8' });
    expect(`${r.stdout}${r.stderr}`).not.toMatch(new RegExp(`${APERTI - 1} agenti`));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/FERMO/);
  } finally { togliCartella(dir); }
});
