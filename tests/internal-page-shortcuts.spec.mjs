// Regression per il feedback: le scorciatoie globali (Alt+E spiega, Alt+T
// traduci, Alt+H apri Aiuto) e la voce "Aiuto" del menu tasto destro sulla
// linguetta erano MUTE sulle pagine interne di Filo (Editor, Preferenze,
// Opzioni, Cronologia, Feedback, Sicurezza, ...).
//
// Causa: tutti questi cammini mandano lo stesso evento IPC grezzo
// 'shortcut:triggered' al tab attivo; solo il preload delle pagine web esterne
// lo traduceva nel messaggio che i content script ascoltano. Il preload delle
// pagine filo:// non aveva mai replicato l'adattatore, quindi i content script
// (che ci sono) non ricevevano mai l'evento.
//
// ASSERISCE il successo: invocare "Aiuto" su una scheda che mostra una pagina
// interna apre davvero la sidebar Aiuto SU quella pagina, col contesto "invocata
// dalla tab". Prima del fix la sidebar non compariva (assert rosso).

import { test, expect } from './fixtures/electron.mjs';

async function waitForCSReady(page) {
  await page.waitForFunction(
    () => document.documentElement.dataset.filoContentScripts === '1',
    null,
    { timeout: 8_000 },
  );
}

// Campione di pagine interne rappresentative (nascono con preload interno).
for (const [name, url] of [
  ['options', 'filo://options/options.html'],
  ['history', 'filo://history/history.html'],
  ['editor',  'filo://editor/editor.html'],
]) {
  test(`Aiuto (canale shortcut) apre la sidebar sulla pagina interna "${name}"`, async ({ shell, openTab }) => {
    const page = await openTab(url);
    await waitForCSReady(page);

    // Id della scheda attiva (la pagina interna appena aperta).
    const id = await shell.evaluate(async () => {
      const snap = await window.filoShell.tabs.snapshot();
      return snap.activeId;
    });
    expect(id).toBeTruthy();

    // Nessuna sidebar all'inizio.
    await expect(page.locator('.sn-sidebar')).toHaveCount(0);

    // Invoca "Aiuto" come fanno il menu tasto destro sulla linguetta e Alt+H:
    // entrambi passano dall'evento IPC 'shortcut:triggered' sul tab attivo.
    await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);

    // La sidebar Aiuto compare SULLA pagina interna, marcata come invocata dalla
    // tab: prova che l'evento ha attraversato shell→main→preload interno→content.
    // Senza l'adattatore nel preload interno questo assert resta rosso.
    await expect(page.locator('.sn-sidebar[data-invoked-from="tab"]')).toBeVisible({ timeout: 8_000 });
  });
}
