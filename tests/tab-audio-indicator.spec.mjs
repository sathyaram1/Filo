// Indicatore "audio in riproduzione" sulla tab — comportamento atteso:
//
//  1) La tab suonante riceve la classe .audible e mostra un bagliore animato
//     (box-shadow pulsante col colore del sito, desaturato).
//  2) L'icona dell'altoparlante SOSTITUISCE la favicon nello slot favicon
//     (class .favicon-audible): un UNICO indicatore, sempre visibile a
//     qualsiasi larghezza di tab, che NON si sovrappone mai alla favicon
//     (nessuna favicon di sfondo) e NON viene duplicato altrove nella tab
//     (nessun .audio-ind a fine riga).
//  3) Il click sull'icona silenzia davvero la tab (muted nel main).
//  4) Quando la tab è mutata appare l'indicatore .mute-ind; se poi viene
//     riattivata e stava ancora suonando, torna l'icona audio (una sola).
//
// Lo stato `audible` è forzato dal main (stesso campo di audio-state-changed)
// perché in headless non possiamo produrre audio reale.

import { test, expect } from './fixtures/electron.mjs';

// Forza lo stato `audible` della tab web attiva (e opzionalmente una favicon,
// per verificare che l'icona audio la sostituisca senza sovrapporsi) e
// ribroadcasta alla shell, come farebbe l'handler di 'audio-state-changed'.
async function setAudible(app, value, favicon) {
  return app.evaluate(({ BrowserWindow }, { v, fav }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const tabs = w._filoTabs;
    const t = tabs.tabs.find((x) => /^https?:/.test(x.url || '')) || tabs.tabs.find((x) => x.id === tabs.activeId);
    t.audible = v;
    if (fav) t.favicon = fav;
    tabs._broadcast();
    return t.id;
  }, { v: value, fav: favicon });
}

test('una tab che suona: l\'icona audio sostituisce la favicon, un solo indicatore', async ({ app, shell, openTab, testServer }) => {
  const url = testServer.html('<title>AUDIO_TAB</title><h1 id="ok">pagina</h1>');
  const page = await openTab(url);
  await page.waitForSelector('#ok');

  // All'inizio nessun indicatore audio e nessuna classe audible.
  await expect(shell.locator('.tab.audible')).toHaveCount(0);
  await expect(shell.locator('.tab .favicon-audible')).toHaveCount(0);
  await expect(shell.locator('.tab .audio-ind')).toHaveCount(0);

  // La tab inizia a suonare, con una favicon impostata → classe audible,
  // UNA sola icona audio (nello slot favicon), nessun duplicato a fine riga.
  const favData = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
  await setAudible(app, true, favData);
  await expect(shell.locator('.tab.audible')).toHaveCount(1, { timeout: 10_000 });
  await expect(shell.locator('.tab .favicon-audible')).toHaveCount(1, { timeout: 10_000 });
  // Nessuna duplicazione: l'indicatore a fine riga non esiste più.
  await expect(shell.locator('.tab .audio-ind')).toHaveCount(0);
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

  // SOSTITUZIONE, non overlay: anche con una favicon impostata, lo slot NON
  // mostra la favicon come sfondo (nessuna sovrapposizione icona-su-favicon).
  const faviconBg = await shell.locator('.tab .favicon-audible').evaluate((el) => {
    return getComputedStyle(el).backgroundImage;
  });
  expect(faviconBg).toBe('none');

  // Ed è presente esattamente UNA icona audio in tutta la tab.
  const audioIconCount = await shell.locator('.tab .favicon-audible svg, .tab .audio-ind').count();
  expect(audioIconCount).toBe(1);
});

test('click sull\'icona audio (slot favicon) silenzia la tab, poi la riattiva', async ({ app, shell, openTab, testServer }) => {
  const url = testServer.html('<title>MUTE_TAB</title><h1 id="ok">pagina</h1>');
  const page = await openTab(url);
  await page.waitForSelector('#ok');

  await setAudible(app, true);
  await expect(shell.locator('.tab .favicon-audible')).toHaveCount(1, { timeout: 10_000 });

  // Click sull'icona audio → la tab viene silenziata davvero (muted nel main).
  await shell.locator('.tab .favicon-audible').click();
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const t = w._filoTabs.tabs.find((x) => /^https?:/.test(x.url || ''));
    return !!t.muted;
  }), { timeout: 10_000 }).toBe(true);

  // Da mutata: niente classe audible, niente icona audio, compare mute-ind.
  await expect(shell.locator('.tab.audible')).toHaveCount(0);
  await expect(shell.locator('.tab .favicon-audible')).toHaveCount(0);
  await expect(shell.locator('.tab .audio-ind')).toHaveCount(0);
  await expect(shell.locator('.tab .mute-ind')).toHaveCount(1);

  // Click sull'indicatore di muto → riattiva.
  await shell.locator('.tab .mute-ind').click();
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const t = w._filoTabs.tabs.find((x) => /^https?:/.test(x.url || ''));
    return !!t.muted;
  }), { timeout: 10_000 }).toBe(false);
  // Stava ancora suonando → torna l'icona audio (una sola, nessun duplicato).
  await expect(shell.locator('.tab.audible')).toHaveCount(1, { timeout: 10_000 });
  await expect(shell.locator('.tab .favicon-audible')).toHaveCount(1, { timeout: 10_000 });
  await expect(shell.locator('.tab .audio-ind')).toHaveCount(0);
});
