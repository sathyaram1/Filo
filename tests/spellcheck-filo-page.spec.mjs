// Regressione feedback #4 ("Correttore poco preciso e malfunzionante"):
// segnalate due problematiche distinte.
//
// (A) Lingua suggerimenti: il correttore nativo (Hunspell) suggeriva parole
//     inglesi anche su testo italiano perché la lingua di sistema (spesso en-US)
//     aveva priorità sull'italiano. Fix: configureSpellchecker() ora mette 'it'
//     per prima nella lista — il test verifica che il dizionario italiano sia
//     configurato come primo dizionario disponibile.
//
// (B) Box feedback: cliccando col tasto destro su una parola errata in una
//     textarea di una pagina filo:// (es. il box "Invia feedback") non
//     comparivano suggerimenti. Il meccanismo è identico alle pagine esterne:
//     il broadcast `_spell:native` deve arrivare e il menu Filo deve mostrare
//     la correzione in cima. Il test simula il broadcast e verifica che la riga
//     di correzione appaia nel menu personalizzato di Filo.

import { test, expect } from './fixtures/electron.mjs';

// ── helper: recupera la pagina newtab (è sempre aperta all'avvio) ──────────
async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  let win = null;
  while (Date.now() < deadline) {
    win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(win, 'newtab non trovata').toBeTruthy();
  await win.waitForLoadState('domcontentloaded');
  return win;
}

// ── (A) italiano prioritario nel correttore nativo ─────────────────────────
test('(A) il dizionario italiano è primo nella lista lingue del correttore', async ({ app }) => {
  const info = await app.evaluate(async ({ session }) => {
    const ses = session.defaultSession;
    return {
      available: ses.availableSpellCheckerLanguages || [],
      configured: ses.getSpellCheckerLanguages ? ses.getSpellCheckerLanguages() : [],
    };
  });

  // Su macOS (NSSpellChecker) la lista Hunspell è vuota: skip.
  if (!info.available.length) {
    test.info().annotations.push({ type: 'skip', description: 'nessun dizionario Hunspell (macOS)' });
    return;
  }

  expect(info.configured.length, 'almeno una lingua configurata').toBeGreaterThan(0);

  // Se il dizionario italiano è disponibile nell'ambiente, deve essere il PRIMO.
  const italianAvailable = info.available.some((l) => l.toLowerCase().startsWith('it'));
  if (italianAvailable) {
    expect(
      info.configured[0].toLowerCase().startsWith('it'),
      `l'italiano deve essere il primo dizionario (configured: ${JSON.stringify(info.configured)})`,
    ).toBe(true);
  }
});

// ── (B) suggerimento su filo:// page (box feedback) ────────────────────────
// Simula il right-click su una parola errata in una textarea su una pagina
// interna filo:// (newtab è la più semplice da aprire). Il broadcast
// `_spell:native` viene iniettato manualmente (come fa Electron in produzione
// quando Hunspell trova la parola errata), e verifichiamo che la riga di
// correzione Filo compaia nel menu personalizzato.
test('(B) click destro su parola errata in textarea filo:// mostra la correzione', async ({ app }) => {
  const page = await newtabPage(app);

  // Aspetta che i content script siano montati.
  await page.waitForFunction(
    () => document.documentElement.dataset.filoContentScripts === '1' &&
          typeof globalThis.SN_SPELLCHECK?.onNativeSuggestions === 'function',
    null,
    { timeout: 8_000 },
  );

  // Crea una textarea di test nel documento filo:// e inietta una parola errata.
  // Usa document.body per non interferire con la struttura del newtab.
  const coords = await page.evaluate(() => {
    const ta = document.createElement('textarea');
    ta.style.cssText = 'position:fixed;top:50px;left:50px;width:300px;height:80px;font:16px monospace';
    ta.value = 'quii';
    document.body.appendChild(ta);
    ta.focus();

    const r = ta.getBoundingClientRect();
    const x = r.left + 10;
    const y = r.top + r.height / 2;

    // Inietta il broadcast nativo per "quii" come farebbe Electron via
    // wc.on('context-menu') → wc.send('filo:broadcast').
    const listeners = globalThis.chrome.runtime.onMessage._listeners;
    for (const fn of listeners) {
      try {
        fn({ type: '_spell:native', word: 'quii', suggestions: ['qui', 'quiz'] });
      } catch (_) {}
    }
    return { x, y };
  });

  // Dispatcha il contextmenu sopra la parola.
  await page.evaluate(({ x, y }) => {
    const ev = new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2,
    });
    document.dispatchEvent(ev);
  }, coords);

  // Il menu Filo deve aprirsi con la correzione in cima.
  const correction = page.locator('.sn-menu .sn-menu-correction');
  await expect(correction).toBeVisible({ timeout: 5_000 });

  // Verifica che la correzione mostri il suggerimento nativo italiano.
  await expect(correction.locator('.sn-menu-label').first()).toHaveText('qui');
});
