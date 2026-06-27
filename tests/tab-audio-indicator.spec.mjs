// Indicatore "audio in riproduzione" sulla tab — comportamento atteso:
//
//  1) La tab suonante riceve la classe .audible e mostra un bagliore animato
//     (box-shadow pulsante col colore del sito, desaturato).
//  2) L'icona dell'altoparlante compare in DUE posti:
//       a) nello slot favicon (class .favicon-audible) — sempre visibile,
//          anche quando la tab è strettissima e il titolo è clippato;
//       b) a fine tab, prima del close button (class .audio-ind) — visibile
//          nelle tab sufficientemente larghe.
//  3) Entrambi i punti di click silenziamo davvero la tab (muted nel main).
//  4) Quando la tab è mutata appare l'indicatore .mute-ind; se poi viene
//     riattivata e stava ancora suonando, tornano i due indicatori audio.
//
// Lo stato `audible` è forzato dal main (stesso campo di audio-state-changed)
// perché in headless non possiamo produrre audio reale.

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

test('una tab che suona ha classe audible, icona favicon-audible e audio-ind a fine riga', async ({ app, shell, openTab, testServer }) => {
  const url = testServer.html('<title>AUDIO_TAB</title><h1 id="ok">pagina</h1>');
  const page = await openTab(url);
  await page.waitForSelector('#ok');

  // All'inizio nessun indicatore audio e nessuna classe audible.
  await expect(shell.locator('.tab.audible')).toHaveCount(0);
  await expect(shell.locator('.tab .audio-ind')).toHaveCount(0);
  await expect(shell.locator('.tab .favicon-audible')).toHaveCount(0);

  // La tab inizia a suonare → classe audible, icone in entrambi i posti, nessun mute-ind.
  await setAudible(app, true);
  await expect(shell.locator('.tab.audible')).toHaveCount(1, { timeout: 10_000 });
  await expect(shell.locator('.tab .favicon-audible')).toHaveCount(1, { timeout: 10_000 });
  await expect(shell.locator('.tab .audio-ind')).toHaveCount(1, { timeout: 10_000 });
  await expect(shell.locator('.tab .mute-ind')).toHaveCount(0);

  // Il bagliore è attivo: la tab ha l'animazione tab-glow-pulse.
  const hasGlowAnimation = await shell.locator('.tab.audible').evaluate((el) => {
    return getComputedStyle(el).animationName.includes('tab-glow-pulse');
  });
  expect(hasGlowAnimation).toBe(true);

  // L'icona nel favicon-slot è visibile (non display:none) — essenziale per
  // le tab strette dove il titolo è clippato.
  const favAudibleVisible = await shell.locator('.tab .favicon-audible').evaluate((el) => {
    const s = getComputedStyle(el);
    return s.display !== 'none' && parseFloat(s.width) > 0;
  });
  expect(favAudibleVisible).toBe(true);

  // L'audio-ind a fine riga è visibile.
  const audioIndVisible = await shell.locator('.tab .audio-ind').evaluate((el) => {
    const s = getComputedStyle(el);
    return s.display !== 'none';
  });
  expect(audioIndVisible).toBe(true);
});

test('click sull\'audio-ind a fine riga silenzia la tab', async ({ app, shell, openTab, testServer }) => {
  const url = testServer.html('<title>MUTE_TAB</title><h1 id="ok">pagina</h1>');
  const page = await openTab(url);
  await page.waitForSelector('#ok');

  await setAudible(app, true);
  await expect(shell.locator('.tab .audio-ind')).toHaveCount(1, { timeout: 10_000 });

  // Click sull'audio-ind → la tab viene silenziata davvero (muted nel main).
  await shell.locator('.tab .audio-ind').click();
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const t = w._filoTabs.tabs.find((x) => /^https?:/.test(x.url || ''));
    return !!t.muted;
  }), { timeout: 10_000 }).toBe(true);

  // Da mutata: niente classe audible, niente icone audio, compare mute-ind.
  await expect(shell.locator('.tab.audible')).toHaveCount(0);
  await expect(shell.locator('.tab .audio-ind')).toHaveCount(0);
  await expect(shell.locator('.tab .favicon-audible')).toHaveCount(0);
  await expect(shell.locator('.tab .mute-ind')).toHaveCount(1);

  // Click sull'indicatore di muto → riattiva.
  await shell.locator('.tab .mute-ind').click();
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const t = w._filoTabs.tabs.find((x) => /^https?:/.test(x.url || ''));
    return !!t.muted;
  }), { timeout: 10_000 }).toBe(false);
  // Stava ancora suonando → tornano entrambe le icone audio.
  await expect(shell.locator('.tab.audible')).toHaveCount(1, { timeout: 10_000 });
  await expect(shell.locator('.tab .favicon-audible')).toHaveCount(1, { timeout: 10_000 });
  await expect(shell.locator('.tab .audio-ind')).toHaveCount(1, { timeout: 10_000 });
});

test('click sul favicon-audible (slot favicon) silenzia la tab', async ({ app, shell, openTab, testServer }) => {
  const url = testServer.html('<title>MUTE_FAV</title><h1 id="ok">pagina</h1>');
  const page = await openTab(url);
  await page.waitForSelector('#ok');

  await setAudible(app, true);
  await expect(shell.locator('.tab .favicon-audible')).toHaveCount(1, { timeout: 10_000 });

  // Click sullo slot favicon → la tab viene silenziata.
  await shell.locator('.tab .favicon-audible').click();
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const t = w._filoTabs.tabs.find((x) => /^https?:/.test(x.url || ''));
    return !!t.muted;
  }), { timeout: 10_000 }).toBe(true);

  await expect(shell.locator('.tab.audible')).toHaveCount(0);
  await expect(shell.locator('.tab .favicon-audible')).toHaveCount(0);
});
