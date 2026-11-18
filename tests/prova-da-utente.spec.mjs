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
async function prova(copione, argomenti = [], { fornitore, home = false, senzaChiave = false } = {}) {
  const cartella = cartellaTemporanea('filo-prova-spec-');
  // Una chiave finta: Filo si accende coi modelli di prova, e nessuna chiamata vera parte da qui.
  const env = { ...process.env, OPENROUTER_API_KEY: 'k-test', FILO_CLAUDE_BIN: FINTO, FILO_CLAUDE_FINTO: JSON.stringify(copione) };
  if (senzaChiave) { delete env.OPENROUTER_API_KEY; delete env.FILO_DEFAULT_OPENROUTER_KEY; }
  if (fornitore) env.FILO_CLAUDE_FINTO_FORNITORE = fornitore;
  const inizio = home ? [] : ['--start', `${base}/modulo`];
  const figlio = spawn(process.execPath, [join(ROOT, 'tests', 'agent', 'prova.mjs'), ...inizio, '--out', cartella, ...argomenti], { cwd: ROOT, env });
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

test('un modello che non risponde più ferma la prova al tetto dei minuti, e l\'esito dice dove era arrivata', async () => {
  const t0 = Date.now();
  const r = await prova([{ azione: 'aspetta', secondi: 1 }, { muto: true }], ['--compito', 'aspetta', '--minuti', '0.5']);
  expect([r.codice, r.esito.esito], r.uscita).toEqual([1, 'fermo']);
  expect(r.esito.riga).toMatch(/tetto dei 0\.5 minuti al passo 2/);
  expect(Date.now() - t0).toBeLessThan(60_000);
  togliCartella(r.cartella);
});

// La home di Filo spento chiede di riscattare un invito e non ha i moduli: lì ogni funzione che passa da un modello
// fallisce per questo, non per il lavoro provato.
for (const modo of ['utente', 'chat']) {
  test(`modo ${modo}: la prova parte da Filo acceso, la home coi moduli e senza l'invito da riscattare`, async () => {
    const conInvito = await prova([{ azione: 'fine', seBadge: ':Apri Crediti$' }], ['--compito', 'guarda', '--modo', modo], { home: true });
    expect(conInvito.esito.esito, `${conInvito.esito.riga}\n${conInvito.uscita}`).toBe('non riuscito');
    togliCartella(conInvito.cartella);
    const coiModuli = await prova([{ azione: 'fine', seBadge: ':(Scrivi|Preferenze)$' }], ['--compito', 'guarda', '--modo', modo], { home: true });
    expect(coiModuli.esito.esito, `${coiModuli.esito.riga}\n${coiModuli.uscita}`).toBe('riuscito');
    togliCartella(coiModuli.cartella);
  });
}

test('senza chiave il modo utente parte da Filo acceso lo stesso, e l\'esito avvisa che i modelli non rispondono', async () => {
  test.skip(existsSync(join(ROOT, 'tests', 'agent', '.env')), 'la chiave sta nel file di chi prova: qui non si toglie');
  const r = await prova([{ azione: 'fine', seBadge: ':(Scrivi|Preferenze)$' }], ['--compito', 'guarda'], { home: true, senzaChiave: true });
  expect(r.esito.esito, `${r.esito.riga}\n${r.uscita}`).toBe('riuscito');
  expect(readFileSync(join(r.cartella, 'esito.md'), 'utf8')).toMatch(/Attenzione.*Nessuna chiave OpenRouter/);
  togliCartella(r.cartella);
});

test('una risposta servita da chi la politica non ammette interrompe la prova', async () => {
  const r = await prova([{ azione: 'fine', esito: 'riuscito' }], ['--compito', 'x'], { fornitore: 'Amazon Bedrock' });
  expect([r.codice, r.esito.esito], r.uscita).toEqual([3, 'interrotto']);
  expect(r.esito.riga).toMatch(/fuori politica.*Amazon Bedrock/);
  togliCartella(r.cartella);
});

test('il tasto destro su un collegamento apre il menu di Filo, e le sue voci hanno i badge', async () => {
  const r = await prova([
    { azione: 'destro', etichetta: 'collegamento' },
    { azione: 'fine', seBadge: '^\\w+:Copia URL$' },
  ], ['--compito', 'apri il menu del collegamento']);
  expect(r.esito.esito, `${r.esito.riga}\n${r.uscita}`).toBe('riuscito');
  togliCartella(r.cartella);
});

// Chi pilota usa la tastiera e la barra delle schede come chi usa Filo a mano (#2507.1): una scorciatoia data per rotta
// quando funziona fa sbagliare il giudizio sulla funzione provata.
test('Ctrl+T premuto mentre si guarda una pagina apre una scheda nuova con la home', async () => {
  const r = await prova([
    { azione: 'tasto', tasto: 'Control+t' },
    { azione: 'aspetta', secondi: 1 },
    { azione: 'fine', seBadge: '^view:Scrivi a Filo$' },
  ], ['--compito', 'apri una scheda nuova']);
  expect(r.esito.esito, `${r.esito.riga}\n${r.uscita}`).toBe('riuscito');
  togliCartella(r.cartella);
});

test('Ctrl+Tab e Ctrl+W, scritti come li scrive una persona, passano alla scheda accanto e la chiudono', async () => {
  const r = await prova([
    { azione: 'tasto', tasto: 'Control+t' },
    { azione: 'aspetta', secondi: 1 },
    { azione: 'tasto', tasto: 'Ctrl+Tab' },
    { azione: 'tasto', tasto: 'Ctrl+W' },
    { azione: 'aspetta', secondi: 1 },
    { azione: 'fine', seBadge: '^view:Scrivi a Filo$', senzaBadge: '^shell:Modulo$' },
  ], ['--compito', 'chiudi la scheda del modulo']);
  expect(r.esito.esito, `${r.esito.riga}\n${r.uscita}`).toBe('riuscito');
  togliCartella(r.cartella);
});

test('le schede della barra hanno i badge: col clic si passa a una scheda e la sua crocetta la chiude', async () => {
  const r = await prova([
    { azione: 'tasto', tasto: 'Control+t' },
    { azione: 'aspetta', secondi: 1 },
    { azione: 'clic', etichetta: '^Modulo$', superficie: 'shell' },
    { azione: 'clic', etichetta: '^Chiudi scheda', superficie: 'shell' },
    { azione: 'aspetta', secondi: 1 },
    { azione: 'fine', seBadge: '^view:Scrivi a Filo$', senzaBadge: '^shell:Modulo$' },
  ], ['--compito', 'torna al modulo e chiudilo']);
  expect(r.esito.esito, `${r.esito.riga}\n${r.uscita}`).toBe('riuscito');
  expect(r.esito.passi.slice(2, 4).map((p) => p.mossa.etichetta)).toEqual(['Modulo', 'Chiudi scheda (Ctrl+W)']);
  togliCartella(r.cartella);
});

test('quello che sta sopra la scheda (la barra laterale) ha i badge anche lui, e si clicca', async () => {
  const r = await prova([
    { azione: 'clic', etichetta: '^Barra laterale$', superficie: 'shell' },
    { azione: 'fine', seBadge: '^strato:' },
  ], ['--compito', 'apri la barra laterale']);
  expect(r.esito.esito, `${r.esito.riga}\n${r.uscita}`).toBe('riuscito');
  togliCartella(r.cartella);
});
