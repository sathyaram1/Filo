// La prova da utente (#2507): argomenti e tetti, mosse lette dalla risposta di Haiku, chi l'ha servito, esito e
// resoconto, e il posto dove la trova chi lavora. Il giro intero con Filo aperto: tests/prova-da-utente.spec.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
  TETTO_PASSI, TETTO_MINUTI, leggiArgomenti, leggiMossa, servitoDa, esitoFinale, resoconto, argomentiModello, sistema,
  messaggioPasso,
} from '../agent/provaRegole.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const leggi = (p) => readFileSync(resolve(ROOT, p), 'utf8');

test('i tetti di partenza sono 20 passi e 4 minuti, il modo è da utente e il modello Haiku', () => {
  const a = leggiArgomenti(['--compito', 'apri una scheda']);
  assert.equal(a.ok, true);
  assert.deepEqual([a.opzioni.passi, a.opzioni.minuti, a.opzioni.modo, a.opzioni.modello], [20, 4, 'utente', 'haiku']);
  assert.equal(TETTO_PASSI, 20);
  assert.equal(TETTO_MINUTI, 4);
});

test('senza compito, con un modo sconosciuto o un argomento a metà si ferma dicendo cosa manca', () => {
  assert.match(leggiArgomenti([]).errore, /manca --compito/);
  assert.match(leggiArgomenti(['--compito', '   ']).errore, /manca --compito/);
  assert.match(leggiArgomenti(['--compito', 'x', '--modo', 'robot']).errore, /utente.*chat/);
  assert.match(leggiArgomenti(['--compito', 'x', '--passi']).errore, /vuole un valore/);
  assert.match(leggiArgomenti(['--compito', 'x', '--passi', '0']).errore, /maggiore di zero/);
  assert.match(leggiArgomenti(['--compito', 'x', '--boh']).errore, /sconosciuto/);
  const c = leggiArgomenti(['--compito', 'x', '--modo', 'chat', '--passi', '5', '--minuti', '2']);
  assert.deepEqual([c.opzioni.modo, c.opzioni.passi, c.opzioni.minuti], ['chat', 5, 2]);
});

test('una mossa valida si legge anche dentro un blocco di codice, con il badge che esiste', () => {
  const r = leggiMossa('```json\n{"vedo":"la home","azione":"clic","segno":3}\n```', [1, 2, 3]);
  assert.deepEqual(r, { ok: true, mossa: { azione: 'clic', vedo: 'la home', segno: 3 } });
  assert.deepEqual(leggiMossa('{"azione":"scrivi","testo":"ciao","segno":2}', [2]).mossa, { azione: 'scrivi', vedo: '', testo: 'ciao', segno: 2 });
  assert.equal(leggiMossa('{"azione":"tasto","tasto":"Enter"}', []).mossa.tasto, 'Enter');
  assert.equal(leggiMossa('{"azione":"aspetta","secondi":99}', []).mossa.secondi, 15, 'un\'attesa lunga si accorcia al massimo');
  assert.equal(leggiMossa('{"azione":"scorri"}', []).mossa.dy, 400);
  const f = leggiMossa('{"azione":"fine","esito":"non riuscito","perche":"il pulsante non fa niente"}', []);
  assert.deepEqual(f.mossa, { azione: 'fine', vedo: '', esito: 'non_riuscito', perche: 'il pulsante non fa niente' });
});

test('una mossa sbagliata torna al modello con l\'errore, mai eseguita a caso', () => {
  assert.match(leggiMossa('non so', [1]).errore, /JSON/);
  assert.match(leggiMossa('{"azione":"vola"}', [1]).errore, /sconosciuta/);
  assert.match(leggiMossa('{"azione":"clic","segno":9}', [1, 2]).errore, /#9 non c'è/);
  assert.match(leggiMossa('{"azione":"clic"}', [1]).errore, /numero di un badge/);
  assert.match(leggiMossa('{"azione":"scrivi","testo":""}', [1]).errore, /testo/);
  assert.match(leggiMossa('{"azione":"fine"}', []).errore, /riuscito/);
});

test('servito da Anthropic stessa va bene; lo stesso modello da un rivenditore è fuori politica', () => {
  const buono = servitoDa({ 'claude-haiku-5-5': { canonicalModel: 'claude-haiku-5-5', provider: 'firstParty' } });
  assert.deepEqual(buono, { modelli: ['claude-haiku-5-5'], fornitore: 'Anthropic', violazione: '' });
  const fuori = servitoDa({ 'claude-haiku-5-5': { canonicalModel: 'claude-haiku-5-5', provider: 'Amazon Bedrock' } });
  assert.match(fuori.violazione, /Amazon Bedrock.*not-producer/);
  assert.equal(servitoDa(undefined).fornitore, '');
});

test('l\'esito dice riuscito, non riuscito col passo, fermo al tetto o interrotto', () => {
  const passi = [{ n: 1, vedo: 'la home' }, { n: 2, vedo: 'la pagina' }];
  assert.equal(esitoFinale({ fine: { esito: 'riuscito', perche: 'la scheda c\'è' }, passi }).codice, 0);
  const no = esitoFinale({ fine: { esito: 'non_riuscito', perche: 'non succede niente' }, passi });
  assert.deepEqual([no.esito, no.codice], ['non riuscito', 1]);
  assert.match(no.riga, /passo 2: non succede niente/);
  const fermo = esitoFinale({ passi, tetto: 'tempo', opzioni: { minuti: 4 } });
  assert.equal(fermo.esito, 'fermo');
  assert.match(fermo.riga, /4 minuti al passo 2.*la pagina/);
  assert.match(esitoFinale({ passi, tetto: 'passi', opzioni: { passi: 20 } }).riga, /20 passi/);
  assert.deepEqual(esitoFinale({ passi, errore: 'il modello è uscito' }).codice, 3);
});

test('il resoconto ha ogni passo con la sua schermata e dice che il giudizio è un indizio', () => {
  const md = resoconto({
    opzioni: { compito: 'apri una scheda', modo: 'utente', modello: 'haiku' },
    esito: esitoFinale({ fine: { esito: 'riuscito', perche: 'ok' }, passi: [{}] }),
    passi: [{ n: 1, vedo: 'la home', schermata: 'passo-01.png', mossa: { azione: 'clic', segno: 2, etichetta: 'Nuova scheda' } }],
    servito: { modelli: ['claude-haiku-5-5'], fornitore: 'Anthropic', violazione: '' },
    costo: 0.01,
    secondi: 30,
    finale: 'finale.png',
  });
  assert.match(md, /1\. la home → clic sul badge #2 \(«Nuova scheda»\)/);
  assert.match(md, /!\[passo 1\]\(passo-01\.png\)/);
  assert.match(md, /finale\.png/);
  assert.match(md, /indizio/);
  assert.match(md, /servito da Anthropic/);
});

test('il modello gira senza strumenti, senza impostazioni e senza sessione salvata', () => {
  const a = argomentiModello('haiku', 'p');
  for (const x of ['--tools=', '--no-session-persistence', '--strict-mcp-config']) assert.ok(a.includes(x), x);
  assert.equal(a[a.indexOf('--setting-sources') + 1], '');
  assert.equal(a[a.indexOf('--model') + 1], 'haiku');
});

test('nel modo chat il compito si chiede a Filo, non si fa a mano', () => {
  assert.match(sistema('chat'), /lo CHIEDI a Filo/);
  assert.doesNotMatch(sistema('utente'), /CHIEDI a Filo/);
  assert.match(messaggioPasso({ compito: 'c', passo: 1, passi: 20, secondiRestanti: 200, map: [{ i: 1, page: 'shell', tag: 'button', label: 'Home' }] }), /#1 \[shell\] button "Home"/);
});

test('la cartella delle prove non finisce nel repo', () => {
  const ignorato = execFileSync('git', ['check-ignore', '-q', 'tests/agent/.out/prova-x/passo-01.png', '&&', 'echo'].slice(0, 3), { cwd: ROOT, stdio: 'pipe' });
  assert.equal(String(ignorato), '');
});

test('chi lavora lo trova: lo script npm e una riga fra le prove della lamentela nei ruoli di chi risolve', () => {
  assert.equal(JSON.parse(leggi('package.json')).scripts['test:prova'], 'node tests/agent/prova.mjs');
  for (const ruolo of ['routines/roles/resolver.md', 'routines/roles/resolver-ripresa.md']) {
    assert.match(leggi(ruolo), /includi: _prova-da-utente\.md/, ruolo);
  }
  assert.match(leggi('routines/roles/_prova-da-utente.md'), /npm run test:prova/);
});
