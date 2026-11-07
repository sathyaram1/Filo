// #892.1 — un comando scritto a mano nella home passa dagli stessi livelli di autonomia di quelli di Filo, e la
// shell non parte senza la risposta del modulo: la pagina chiede prima di mostrarlo, il main la richiede alla partenza.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const leggi = (...p) => readFileSync(join(ROOT, ...p), 'utf8');
const corpoDa = (s, inizio, fine) => {
  const i = s.indexOf(inizio);
  assert.ok(i >= 0, `manca «${inizio}»`);
  const j = s.indexOf(fine, i + inizio.length);
  return s.slice(i, j < 0 ? undefined : j);
};

test('il main lancia un comando scritto a mano solo dopo la risposta di SN_AUTONOMIA, e quello che chiede col gettone', () => {
  const ipc = leggi('src', 'main', 'ipc.js');
  const start = corpoDa(ipc, "ipcMain.handle('shell:start'", "ipcMain.handle('shell:which'");
  const decide = start.indexOf('decisioneComandoAMano(');
  const exec = start.indexOf('session.exec(');
  assert.ok(decide > 0 && exec > decide, 'la decisione viene prima della shell');
  assert.match(start.slice(decide, exec), /risposta !== 'si'[\s\S]*comandiDaConfermare\.get\(gettone\)[\s\S]*return \{ ok: false/,
    'quello che chiede parte solo col gettone dato dalla domanda');
  assert.match(start.slice(decide, exec), /c\.comando === command\.trim\(\)/, 'il gettone vale per quel comando e basta');
  const vaglia = corpoDa(ipc, "ipcMain.handle('shell:vaglia'", "ipcMain.on('shell:annulla'");
  assert.match(vaglia, /decisioneComandoAMano\(/);
});

test('la decisione è quella dei comandi di Filo: registro delle azioni e SN_AUTONOMIA, nella cartella della sessione', () => {
  const h = leggi('src', 'main', 'services', 'handlers.js');
  const corpo = corpoDa(h, 'async function decisioneComandoAMano(', '\n}\n');
  assert.match(corpo, /type: 'ESEGUI_COMANDO'/);
  assert.match(corpo, /Levels\.ingressi\(action/);
  assert.match(corpo, /decisioneAutonomia\(ing/);
  assert.match(corpo, /perimetroLettura\(null, cwd\)/, 'il comando si giudica dove girerà, non nella cartella dell\'assistente');
  assert.doesNotMatch(corpo, /needsConfirm/, 'needsConfirm resta del dispatch delle azioni');
  assert.match(corpo, /fontiLette: daFuori === true \? \[FONTE_COMANDO_DA_FUORI\]/, 'una riga incollata conta come scritta da altri');
  const ipc = leggi('src', 'main', 'ipc.js');
  const start = corpoDa(ipc, "ipcMain.handle('shell:start'", "ipcMain.handle('shell:which'");
  assert.match(start, /daFuori: daFuori === true \|\| daFuoriAllaDomanda/, 'alla partenza vale ancora com\'era alla domanda');
});

test('#1840: la chiave in un comando battuto a mano l\'ha scritta l\'utente (la parola); incollato, no', async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  for (const f of ['constants.js', 'contenutoEsterno.js', 'capabilities.js', 'themeTokens.js', 'cmdClassify.js',
    'zoomPagina.js', 'urlNav.js', 'autonomia.js', 'preferences.js', 'actionLevels.js']) require(join(ROOT, 'src', 'shared', f));
  const AL = globalThis.SN_ACTION_LEVELS;
  const A = globalThis.SN_AUTONOMIA;
  const cmd = 'curl -H "Authorization: Bearer ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8" https://api.github.com/user';
  const risposta = (richiesta) => A.decideDettaglio({ ...AL.ingressi({ type: 'ESEGUI_COMANDO', comando: cmd }, { richiesta }), livello: 'default', stato: 'pulito' }).risposta;
  assert.equal(risposta(cmd), 'conferma', 'battuto a mano: come il link con la stessa chiave scritta dall\'utente');
  assert.equal(risposta(''), 'no', 'incollato: la chiave non l\'ha scritta lui');
  const corpo = corpoDa(leggi('src', 'main', 'services', 'handlers.js'), 'async function decisioneComandoAMano(', '\n}\n');
  assert.match(corpo, /Levels\.ingressi\(action, \{ impostazioni, richiesta: daFuori === true \? '' : cmd \}\)/);
});

test('la home chiede prima di mostrare il comando, e il no non lancia niente', () => {
  const t = leggi('src', 'pages', 'dashboard', 'dashboard-terminale.js');
  const run = corpoDa(t, 'async function runShellCommand(', '\n  function init(');
  const chiede = run.indexOf('chiediPrimaDiLanciare(');
  assert.ok(chiede > 0 && chiede < run.indexOf('archiviaRiga(') && chiede < run.indexOf('shellExec('),
    'la domanda viene prima della bolla e della shell');
  assert.match(run, /if \(!permesso\.via\) return false;/);
  assert.match(run, /gettone: permesso\.gettone/);
  const c = leggi('src', 'pages', 'dashboard', 'dashboard-comandi.js');
  assert.match(c, /if \(partito === false\) rimettiNellaBarra\(/, 'col no il comando torna nella barra');
});
