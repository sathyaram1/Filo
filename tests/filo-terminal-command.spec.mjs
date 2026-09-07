// #146.6 — Filo esegue comandi da terminale con livello di sicurezza dal comando.
//
// Contratto della spec (asserisce il SUCCESSO, non l'assenza di errore):
//   • modalità terminale spenta → nessun comando viene eseguito;
//   • "ls/echo" (sola lettura) esegue subito e l'output torna mostrato in chat;
//   • "git push", "mkdir" (modifica recuperabile) NON eseguono senza conferma;
//     dopo la conferma eseguono davvero;
//   • "rm …", un comando inventato e una concatenazione che CONTIENE un comando
//     rischioso richiedono di digitare "conferma" (livello 3);
//   • una concatenazione di soli comandi sicuri (es. `cd x && ls`, #201) NON
//     chiede conferma: il livello è il massimo dei pezzi, non 3 d'ufficio;
//   • il livello è deciso dal main sul comando effettivo, mai dall'LLM.

import { test, expect } from './fixtures/electron.mjs';
import { CONFIRM_HOST, confirmState, clickConfirm, fillConfirmInput } from './helpers/confirm.mjs';
import { tempCanonico } from './helpers/percorsi.mjs';
import path from 'node:path';
import fs from 'node:fs';

const NEWTAB = 'filo://newtab/';

// Esegue un'azione Filo nel main, come farebbe la chat (handleFiloChat).
const execAction = (app, action, opts) =>
  app.evaluate((_electron, { action, opts }) =>
    globalThis.SN_EXECUTE_FILO_ACTION(action, opts), { action, opts });

// Conferma un'azione sospesa (popup livello 2 / "conferma" digitata livello 3).
const confirmAction = (page, action) =>
  page.evaluate(async (a) =>
    chrome.runtime.sendMessage({ type: 'filo_confirm_action', action: a }), action);

// Attiva la modalità terminale (preferenza livello 2): la confermiamo subito.
const enableTerminal = (page) =>
  confirmAction(page, { type: 'IMPOSTA_PREFERENZA', chiave: 'terminale', valore: 'on' });

test('modalità terminale spenta → il comando NON viene eseguito', async ({ app, openTab }) => {
  await openTab(NEWTAB);
  const r = await execAction(app, { type: 'ESEGUI_COMANDO', comando: 'echo ciao' });
  expect(r.executed).toBe(false);
  expect(r.output?.blocked).toBe('disabled');
});

test('livello 1 (sola lettura) esegue subito e cattura l’output', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);
  await enableTerminal(page);
  const r = await execAction(app, { type: 'ESEGUI_COMANDO', comando: 'echo ciao-filo' });
  expect(r.executed).toBe(true);
  expect(r.output.stdout).toContain('ciao-filo');
  expect(r.output.command).toBe('echo ciao-filo');
});

test('livello 2 (mkdir) non esegue senza conferma; la conferma crea la cartella', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);
  await enableTerminal(page);
  const dir = path.join(tempCanonico(), `filo-cmd-${Date.now()}`);
  const action = { type: 'ESEGUI_COMANDO', comando: `mkdir "${dir}"` };

  // Senza conferma: livello 2, non esegue, la cartella non esiste.
  const r = await execAction(app, action);
  expect(r.executed).toBe(false);
  expect(r.needsConfirm).toBe(2);
  expect(fs.existsSync(dir)).toBe(false);

  // Con la conferma dell'utente: esegue davvero.
  const c = await confirmAction(page, action);
  expect(c.executed).toBe(true);
  expect(fs.existsSync(dir)).toBe(true);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
});

test('git push è livello 2 (popup), ma senza conferma non parte', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);
  await enableTerminal(page);
  const r = await execAction(app, { type: 'ESEGUI_COMANDO', comando: 'git push' });
  expect(r.executed).toBe(false);
  expect(r.needsConfirm).toBe(2);
  expect(r.describe).toContain('git push');
});

test('livello 3: rm, comando inventato e concatenazione richiedono "conferma"', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);
  await enableTerminal(page);
  // La concatenazione resta livello 3 SOLO se contiene un comando rischioso
  // (qui `rm`): il massimo dei pezzi vince. Una sequenza di sole letture è
  // gestita dal test successivo (#201).
  for (const comando of ['rm qualcosa', 'comandoinventato', 'echo a && rm b']) {
    const r = await execAction(app, { type: 'ESEGUI_COMANDO', comando });
    expect(r.executed, comando).toBe(false);
    expect(r.needsConfirm, comando).toBe(3);
  }
});

test('#390 — i git che scartano lavoro non salvato chiedono la conferma forte, anche mascherati', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);
  await enableTerminal(page);
  // Il livello lo decide il main sul comando EFFETTIVO: le forme che buttano
  // via modifiche non salvate devono fermarsi al livello 3 ("conferma"), anche
  // quando sono riscritte con virgolette/barre che la shell rimuove comunque
  // (scenario "comando suggerito da una pagina ostile").
  for (const comando of [
    'git checkout .', 'git checkout "."', "git checkout '.'",
    'git checkout .""', "git checkout ''.", 'git checkout ./',
    'git checkout -- src/app.js', 'git checkout README.md',
    'git stash drop', 'git stash "drop"', "git stash d''rop", 'git stash clear',
  ]) {
    const r = await execAction(app, { type: 'ESEGUI_COMANDO', comando });
    expect(r.executed, comando).toBe(false);
    expect(r.needsConfirm, comando).toBe(3);
  }
  // Cambio/creazione ramo e salvataggio stash: nessun lavoro perso → popup OK.
  for (const comando of ['git checkout main', 'git checkout "main"', 'git checkout -b nuovo origin/main', 'git stash', 'git stash pop']) {
    const r = await execAction(app, { type: 'ESEGUI_COMANDO', comando });
    expect(r.executed, comando).toBe(false);
    expect(r.needsConfirm, comando).toBe(2);
  }
});

test('#201 — una concatenazione di soli comandi sicuri esegue senza conferma', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);
  await enableTerminal(page);
  // `cd <tmp> <sep> echo <marker>`: due letture concatenate. Prima del fix #201
  // il solo separatore la portava a livello 3 ("conferma" per un'azione
  // irreversibile); ora il livello è il massimo dei pezzi (1) → esegue subito.
  //
  // Il separatore è quello che capisce la shell che gira DAVVERO (la sceglie
  // src/main/services/terminal.js in base alla piattaforma): Windows PowerShell
  // 5.1 non conosce `&&` e lo rifiuta come errore di sintassi, quindi lì il
  // comando non uscirebbe mai — e il rosso parlerebbe della shell, non del
  // livello di sicurezza, che è la cosa in prova qui. Che `&&` valga 1 su una
  // sequenza di sole letture lo verifica tests/unit/cmdClassify.test.mjs, che è
  // logica pura e gira uguale ovunque.
  const separatore = process.platform === 'win32' ? ';' : '&&';
  const marker = `filo201-${Date.now()}`;
  const r = await execAction(app, {
    type: 'ESEGUI_COMANDO',
    comando: `cd "${tempCanonico()}" ${separatore} echo ${marker}`,
  });
  expect(r.executed).toBe(true);
  expect(r.needsConfirm).toBeFalsy();
  expect(r.output.stdout).toContain(marker);
});

test('UI: l’output di un comando livello 1 compare nella bolla di chat', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  await enableTerminal(page);
  const action = {
    type: 'ESEGUI_COMANDO', comando: 'echo ciao',
    _output: { command: 'echo ciao', stdout: 'ciao\n', stderr: '', code: 0, truncated: false, timedOut: false },
  };
  await page.evaluate((a) => {
    const host = document.createElement('div');
    host.id = 'test-actions';
    document.body.appendChild(host);
    window.__filoDashActions.renderActions(host, [a]);
  }, action);
  await expect(page.locator('#test-actions .dash-cmd-line')).toContainText('$ echo ciao');
  await expect(page.locator('#test-actions .dash-cmd-output')).toContainText('ciao');
});

test('UI livello 3: digitando "conferma" il comando esegue e l’output compare in chat', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  await enableTerminal(page);
  const action = {
    type: 'ESEGUI_COMANDO', comando: 'echo confermato',
    _confirm: { level: 3, text: 'Eseguire nel terminale:\necho confermato' },
  };
  await page.evaluate((a) => {
    const host = document.createElement('div');
    host.id = 'test-actions';
    document.body.appendChild(host);
    window.__filoDashActions.renderActions(host, [a]);
  }, action);

  const btn = page.locator('#test-actions .dash-action-btn');
  await expect(btn).toContainText('echo confermato');
  await btn.click();

  await expect(page.locator(CONFIRM_HOST)).toBeVisible();
  // bloccato finché non si digita "conferma"
  await expect.poll(async () => (await confirmState(page)).okDisabled).toBe(true);
  await fillConfirmInput(page, 'conferma');
  await expect.poll(async () => (await confirmState(page)).okDisabled).toBe(false);
  await clickConfirm(page, 'danger');

  // Successo: l'output del comando appena eseguito compare nella bolla.
  await expect(page.locator('#test-actions .dash-cmd-output')).toContainText('confermato');
});
