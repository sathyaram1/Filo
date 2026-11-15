// #2507 giro 2: chi prova da utente deve poter fare quello che fa chi usa Filo a mano: le scorciatoie della finestra
// (Ctrl+T, Ctrl+W) e il clic su una scheda della barra.

import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FINTO = join(ROOT, 'tests', 'helpers', 'claudeFinto.mjs');

test.setTimeout(150_000);

let server;
let base;
test.beforeAll(async () => {
  server = createServer((q, r) => {
    r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    r.end('<!doctype html><title>Ricette di nonna</title><h1>Ricette di nonna</h1><p>Una pagina.</p>');
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(() => server && server.close());

async function prova(copione) {
  const cartella = cartellaTemporanea('filo-verifica-2507-');
  const env = { ...process.env, FILO_CLAUDE_BIN: FINTO, FILO_CLAUDE_FINTO: JSON.stringify(copione) };
  const figlio = spawn(process.execPath, [join(ROOT, 'tests', 'agent', 'prova.mjs'), '--start', `${base}/`, '--out', cartella, '--compito', 'prova'], { cwd: ROOT, env });
  let uscita = '';
  figlio.stdout.on('data', (b) => { uscita += b; });
  figlio.stderr.on('data', (b) => { uscita += b; });
  await new Promise((ok) => figlio.on('exit', ok));
  const file = join(cartella, 'esito.json');
  const esito = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
  return { uscita, esito, cartella };
}

test('r1 Ctrl+T premuto dentro una pagina apre la scheda nuova con la home, come per chi usa Filo a mano', async () => {
  const r = await prova([
    { azione: 'tasto', tasto: 'Control+t' },
    { azione: 'aspetta', secondi: 2 },
    { azione: 'fine', seBadge: ':Chiedi qualsiasi' },
  ]);
  expect(r.esito, r.uscita).not.toBeNull();
  expect(r.esito.esito, `dopo Ctrl+T la home non c'è: ${r.esito.riga}`).toBe('riuscito');
  togliCartella(r.cartella);
});

test('r1 Ctrl+W premuto dentro una pagina chiude la scheda (resta la home)', async () => {
  const r = await prova([
    { azione: 'tasto', tasto: 'Control+w' },
    { azione: 'aspetta', secondi: 2 },
    { azione: 'fine', seBadge: ':Chiedi qualsiasi' },
  ]);
  expect(r.esito, r.uscita).not.toBeNull();
  expect(r.esito.esito, `dopo Ctrl+W la scheda è ancora aperta: ${r.esito.riga}`).toBe('riuscito');
  togliCartella(r.cartella);
});

test('r2 la scheda della pagina aperta ha un segno nella barra delle schede, così si può cliccare', async () => {
  const r = await prova([{ azione: 'fine', seBadge: '^shell:.*Ricette di nonna' }]);
  expect(r.esito, r.uscita).not.toBeNull();
  expect(r.esito.esito, `nessun segno sulla scheda: ${r.esito.riga}`).toBe('riuscito');
  togliCartella(r.cartella);
});
