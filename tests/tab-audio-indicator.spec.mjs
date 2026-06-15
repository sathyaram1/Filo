// Indicatore "audio in riproduzione" sulla tab (#feedback indicatore audio).
//
// Una tab che sta suonando deve mostrare un indicatore (altoparlante con onde),
// distinto da quello di "audio mutato", così l'utente riconosce a colpo d'occhio
// quale scheda fa rumore — anche se è in background. L'indicatore è cliccabile
// per silenziare al volo (parità con la voce "Muta" del menu tasto destro).
//
// Lo stato `audible` della tab è alimentato dall'evento Electron
// `audio-state-changed`, che in headless non possiamo far scattare con audio
// reale: lo forziamo dal main (è lo stesso campo che l'evento aggiorna) e
// verifichiamo il rendering + il click reale sull'indicatore.

import { test, expect } from './fixtures/electron.mjs';

// Forza lo stato `audible` della tab web attiva e ribroadcasta alla shell,
// esattamente come farebbe l'handler di 'audio-state-changed'.
async function setAudible(app, value) {
  return app.evaluate(({ BrowserWindow }, v) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const tabs = w._filoTabs;
    const t = tabs.tabs.find((x) => /^https?:/.test(x.url || '')) || tabs.tabs.find((x) => x.id === tabs.activeId);
    t.audible = v;
    tabs._broadcast();
    return t.id;
  }, value);
}

test('una tab che suona mostra l\'indicatore audio, cliccarlo la silenzia', async ({ app, shell, openTab, testServer }) => {
  const url = testServer.html('<title>AUDIO_TAB</title><h1 id="ok">pagina</h1>');
  const page = await openTab(url);
  await page.waitForSelector('#ok');

  // All'inizio nessun indicatore audio.
  await expect(shell.locator('.tab .audio-ind')).toHaveCount(0);

  // La tab inizia a suonare → compare l'indicatore (non quello di muto).
  await setAudible(app, true);
  await expect(shell.locator('.tab .audio-ind')).toHaveCount(1, { timeout: 10_000 });
  await expect(shell.locator('.tab .mute-ind')).toHaveCount(0);

  // Click sull'indicatore → la tab viene silenziata davvero (muted nel main).
  await shell.locator('.tab .audio-ind').click();
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const t = w._filoTabs.tabs.find((x) => /^https?:/.test(x.url || ''));
    return !!t.muted;
  }), { timeout: 10_000 }).toBe(true);

  // Da mutata: niente indicatore audio, c'è quello di muto (cliccabile per riattivare).
  await expect(shell.locator('.tab .audio-ind')).toHaveCount(0);
  await expect(shell.locator('.tab .mute-ind')).toHaveCount(1);

  // Click sull'indicatore di muto → riattiva.
  await shell.locator('.tab .mute-ind').click();
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const t = w._filoTabs.tabs.find((x) => /^https?:/.test(x.url || ''));
    return !!t.muted;
  }), { timeout: 10_000 }).toBe(false);
  // Sta ancora suonando → torna l'indicatore audio.
  await expect(shell.locator('.tab .audio-ind')).toHaveCount(1, { timeout: 10_000 });
});
