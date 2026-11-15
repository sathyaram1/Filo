// La prova da utente (tests/agent/prova.mjs, #2507) per intero, con Filo vero e un modello finto
// (tests/helpers/claudeFinto.mjs): le mosse arrivano davvero alla pagina, l'esito e le schermate finiscono nella
// cartella, i tetti fermano, un modello servito fuori politica interrompe. Il modello vero non gira qui.

import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from './helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FINTO = join(ROOT, 'tests', 'helpers', 'claudeFinto.mjs');

test.describe.configure({ mode: 'serial' });
test.setTimeout(150_000);

let server;
let base;
const salvati = [];
test.beforeAll(async () => {
  server = createServer((q, r) => {
    const u = new URL(q.url, 'http://x');
    if (u.pathname === '/salva') salvati.push(u.searchParams.get('nome'));
    r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    r.end('<!doctype html><title>Modulo</title><h1>Modulo</h1><a href="/altro">Un collegamento</a>'
      + '<input aria-label="Nome" placeholder="Nome"> <button onclick="fetch(\'/salva?nome=\'+encodeURIComponent(document.querySelector(\'input\').value))'
      + '.then(()=>{document.getElementById(\'m\').textContent=\'Salvato\'})">Salva</button><p id="m"></p>');
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(() => server && server.close());

/** Lancia la prova col copione dato → { codice, uscita, esito, cartella }. */
async function prova(copione, argomenti = [], { fornitore } = {}) {
  const cartella = cartellaTemporanea('filo-prova-spec-');
  const env = { ...process.env, FILO_CLAUDE_BIN: FINTO, FILO_CLAUDE_FINTO: JSON.stringify(copione) };
  if (fornitore) env.FILO_CLAUDE_FINTO_FORNITORE = fornitore;
  const figlio = spawn(process.execPath, [join(ROOT, 'tests', 'agent', 'prova.mjs'), '--start', `${base}/modulo`, '--out', cartella, ...argomenti], { cwd: ROOT, env });
  let uscita = '';
  figlio.stdout.on('data', (b) => { uscita += b; });
  figlio.stderr.on('data', (b) => { uscita += b; });
  const codice = await new Promise((ok) => figlio.on('exit', ok));
  const file = join(cartella, 'esito.json');
  const esito = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
  return { codice, uscita, esito, cartella };
}

test('le mosse arrivano alla pagina: il testo va nel campo cliccato, il clic salva, e l\'esito è riuscito con le schermate', async () => {
  salvati.length = 0;
  const r = await prova([
    { azione: 'scrivi', etichetta: '^Nome$', testo: 'Ada Lovelace' },
    { azione: 'clic', etichetta: '^Salva$' },
    { azione: 'fine', esito: 'riuscito', perche: 'compare Salvato' },
  ], ['--compito', 'salva il nome Ada Lovelace']);
  expect(r.esito, r.uscita).not.toBeNull();
  expect(salvati).toEqual(['Ada Lovelace']);
  expect([r.codice, r.esito.esito]).toEqual([0, 'riuscito']);
  expect(r.esito.passi.map((p) => p.mossa.azione)).toEqual(['scrivi', 'clic', 'fine']);
  for (const p of r.esito.passi) expect(existsSync(join(r.cartella, p.schermata)), p.schermata).toBe(true);
  expect(existsSync(join(r.cartella, 'finale.png'))).toBe(true);
  expect(r.esito.servito).toMatchObject({ modelli: ['claude-haiku-5-5'], fornitore: 'Anthropic', violazione: '' });
  expect(readFileSync(join(r.cartella, 'esito.md'), 'utf8')).toMatch(/!\[passo 2\]\(passo-02\.png\)/);
  togliCartella(r.cartella);
});

test('quando la funzione non risponde l\'esito è non riuscito e dice il passo', async () => {
  const r = await prova([
    { azione: 'clic', etichetta: '^Salva$' },
    { azione: 'fine', esito: 'non_riuscito', perche: 'Salvato non compare' },
  ], ['--compito', 'salva']);
  expect([r.codice, r.esito.esito], r.uscita).toEqual([1, 'non riuscito']);
  expect(r.esito.riga).toMatch(/fermo al passo 2: Salvato non compare/);
  togliCartella(r.cartella);
});

test('al tetto dei passi si ferma e dice dove è arrivato', async () => {
  const r = await prova([{ azione: 'aspetta', secondi: 1 }], ['--compito', 'aspetta', '--passi', '3']);
  expect([r.codice, r.esito.esito], r.uscita).toEqual([1, 'fermo']);
  expect(r.esito.passi).toHaveLength(3);
  expect(r.esito.riga).toMatch(/tetto dei 3 passi al passo 3/);
  togliCartella(r.cartella);
});

test('una risposta servita da chi la politica non ammette interrompe la prova', async () => {
  const r = await prova([{ azione: 'fine', esito: 'riuscito' }], ['--compito', 'x'], { fornitore: 'Amazon Bedrock' });
  expect([r.codice, r.esito.esito], r.uscita).toEqual([3, 'interrotto']);
  expect(r.esito.riga).toMatch(/fuori politica.*Amazon Bedrock/);
  togliCartella(r.cartella);
});

test('il menu del tasto destro su una pagina web ha i suoi badge: il modello può sceglierne le voci', async () => {
  const r = await prova([
    { azione: 'destro', etichetta: 'collegamento' },
    { azione: 'fine', seStrato: '.' },
  ], ['--compito', 'apri il menu del collegamento']);
  expect([r.esito.esito, r.esito.riga], r.uscita).toEqual(['riuscito', expect.stringContaining('strato:')]);
  togliCartella(r.cartella);
});
