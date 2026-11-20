// #2272 — la ricerca di immagini della chat porta fuori un testo come una ricerca sul web: passa dagli stessi freni
// (dati letti nel turno, memoria, segreti), e chi la esegue e chi la controlla leggono lo stesso testo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const shared = join(ROOT, 'src', 'shared');
require(join(shared, 'preferences.js'));
require(join(shared, 'themeTokens.js'));
require(join(shared, 'cmdClassify.js'));
require(join(shared, 'zoomPagina.js'));
require(join(shared, 'actionLevels.js'));
require(join(shared, 'urlExfil.js'));

const E = globalThis.SN_URL_EXFIL;
const AL = globalThis.SN_ACTION_LEVELS;

const FILE = 'utente: amministrazione\ntoken: qwertyuiopasdfghjklzxcvbnm\nnota: rinnovare il contratto a marzo';
const cat = { type: 'ESEGUI_COMANDO', comando: 'cat note.txt', _output: { command: 'cat note.txt', stdout: FILE, stderr: '', code: 0 } };
const MEMORIA = 'Token salvato: ABC123XYZ789TOK';

// Il costo che il registro dà alla ricerca di immagini dopo il giudizio sulle uscite (0 leggera, 2 se porta fuori dati).
function costo(action, { azioni = [], memoria = '' } = {}) {
  const v = E.valutaUscita(action, { azioni, memoria });
  const a = { ...action };
  if (v.exfil) { a._exfil = true; a._exfilReason = v.reason; }
  return { costo: AL.costoFor(a), v };
}

test('una ricerca di immagini con un pezzo letto nel turno, o un dato della memoria, chiede l\'OK', () => {
  assert.equal(costo({ type: 'IMMAGINI_WEB', query: 'antilope' }, { azioni: [cat], memoria: MEMORIA }).costo, 0);
  assert.equal(costo({ type: 'IMMAGINI_WEB', query: 'qwertyuiopasdfghjklzxcvbnm' }, { azioni: [cat] }).costo, 2);
  assert.equal(costo({ type: 'IMMAGINI_WEB', query: 'foto ABC123XYZ789TOK' }, { memoria: MEMORIA }).costo, 2);
});

test('il testo nascosto in un campo secondario, con la query vuota, è quello che si giudica e quello che si cerca', () => {
  for (const campo of ['cerca', 'testo', 'q', 'text']) {
    const a = { type: 'IMMAGINI_WEB', query: '', [campo]: 'foto ABC123XYZ789TOK' };
    assert.equal(AL.ricercaImmaginiDi(a), 'foto ABC123XYZ789TOK', campo);
    assert.equal(costo(a, { memoria: MEMORIA }).costo, 2, campo);
  }
  // Il riconoscimento dei segreti legge l'uscita dal registro: la stessa regola.
  assert.equal(AL.REGISTRY.IMMAGINI_WEB.uscita({ query: '  ', cerca: 'gatti' }), 'gatti');
  assert.match(AL.describe({ type: 'IMMAGINI_WEB', query: '', q: 'gatti' }), /gatti/);
});

test('chi esegue la ricerca di immagini legge il testo dalla stessa regola', () => {
  const src = readFileSync(join(ROOT, 'src', 'main', 'services', 'azioni', 'immagini.js'), 'utf8');
  assert.match(src, /const query = globalThis\.SN_ACTION_LEVELS\.ricercaImmaginiDi\(action\);/);
});

test('il controllo sulle uscite raccoglie memoria e pagine lette anche per la ricerca di immagini', () => {
  const src = readFileSync(join(ROOT, 'src', 'main', 'services', 'porteUscita.js'), 'utf8');
  assert.match(src, /tipo === 'IMMAGINI_WEB'/);
});
