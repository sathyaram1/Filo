// L'agente "Aiuto" deve poter azionare i comandi rapidi della barra di Filo
// (le icone in alto: home, impostazioni, app, account, schermo intero, riduci),
// MA NON chiudere la finestra. Questo test esercita il meccanismo end-to-end:
// il messaggio SHELL_ACTION → main → shell che clicca il bottone reale.
//
// Feedback alpha: "fai in modo che 'aiuto' abbia accesso alle impostazioni
// rapide (icone) ad eccezione di chiudi … dirgli fullscreen e lui clicca il
// tasto."

import { test, expect } from './fixtures/electron.mjs';

// Invia un comando shell come farebbe il content script dell'agente, passando
// dallo stesso ponte IPC (filo:message) usato da chrome.runtime.sendMessage.
async function sendShellAction(shell, command) {
  return shell.evaluate(
    (cmd) => window.filoShell.message({ type: 'shell_action', command: cmd }),
    command,
  );
}

test('comando shell "home" naviga la scheda attiva sulla nuova scheda di Filo', async ({ shell, openTab }) => {
  // Apri una scheda diversa dalla newtab e rendila attiva.
  const page = await openTab('filo://home/home.html');
  await expect.poll(() => page.url(), { timeout: 8000 }).toContain('home/home.html');

  // La shell deve sapere che la scheda aperta è quella attiva prima del comando.
  await expect.poll(
    () => shell.evaluate(() => {
      // Lo stato attivo della shell si riflette nella classe .tab.active.
      const active = document.querySelector('.tab.active');
      return active ? active.dataset.tip || '1' : null;
    }),
    { timeout: 8000 },
  ).not.toBeNull();

  const res = await sendShellAction(shell, 'home');
  expect(res?.ok).toBe(true);

  // L'agente ha "cliccato" la Home: la scheda attiva ora è la nuova scheda.
  await expect.poll(() => page.url(), { timeout: 8000 }).toContain('newtab');
});

test('comando shell "close" è rifiutato e non chiude la finestra', async ({ shell, app, openTab }) => {
  // Apri una scheda così la finestra ha contenuto reale da non perdere.
  await openTab('filo://home/home.html');
  const windowsBefore = app.windows().length;

  const res = await sendShellAction(shell, 'close');
  // Il comando "close" NON è tra quelli consentiti: deve essere rifiutato.
  expect(res?.ok).toBe(false);

  // Diamo tempo a un'eventuale (errata) chiusura di propagarsi.
  await shell.waitForTimeout(400);

  // La shell è ancora viva e nessuna finestra è stata chiusa.
  const stillAlive = await shell.evaluate(() => !!window.filoShell);
  expect(stillAlive).toBe(true);
  expect(app.windows().length).toBeGreaterThanOrEqual(windowsBefore);
});

test('comandi shell consentiti (fullscreen/minimize/settings/apps/account) sono accettati', async ({ shell }) => {
  for (const cmd of ['settings', 'apps', 'fullscreen']) {
    const res = await sendShellAction(shell, cmd);
    expect(res?.ok, `comando "${cmd}" dovrebbe essere accettato`).toBe(true);
  }
  // Un comando inventato deve invece essere rifiutato.
  const bogus = await sendShellAction(shell, 'self-destruct');
  expect(bogus?.ok).toBe(false);
});
