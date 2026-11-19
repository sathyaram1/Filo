// #1887 (#1677 + #1342) — Sui siti ogni avviso della pila ha una X che lo chiude subito con la sua chiusura; i riquadri
// chiusi nel documento del sito (cronologia, spiegazione, feedback, Modifica) usano la famiglia generica più vicina al
// carattere scelto, e un @font-face del sito non la ridichiara. Nello strato sopra la scheda e su filo:// il carattere scelto.

import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { nelMondoDiFilo, neiRiquadri } from './helpers/riquadri.mjs';
import { apriCronologia, testiCronologia } from './helpers/cronologiaAppunti.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';

const GEORGIA = "Georgia, 'Times New Roman', serif";
const COURIER = "'Courier New', ui-monospace, monospace";
const SEGRETO = 'pw-Segreta-589-otto';

const PAGINA = `<!doctype html><html><body style="margin:0;padding:40px;font:16px sans-serif;height:100vh">
  <input id="campo" style="width:320px;font-size:16px" value="testo da modificare">
</body></html>`;

function shot(page, name) {
  try { mkdirSync('tests/.shots', { recursive: true }); } catch (_) {}
  return page.screenshot({ path: `tests/.shots/${name}.png` }).catch(() => {});
}

const scegliCarattere = (shell, font) =>
  shell.evaluate((f) => window.filoShell.message({ type: 'update_settings', settings: { themeTokens: f ? { font: f } : {} } }), font);

async function sito(openTab, testServer, html = PAGINA) {
  const page = await testServer.openReady(openTab, html);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1');
  return page;
}

// font-family calcolato del primo nodo, anche dentro un riquadro chiuso di Filo.
const FONT = (sel) => {
  const T = globalThis.SN_FILO_UI && globalThis.SN_FILO_UI._test;
  const el = T ? T.trova(sel) : document.querySelector(sel);
  return el ? getComputedStyle(el).fontFamily : null;
};

test.describe('la X degli avvisi (#1677)', () => {
  test('un avviso lungo si chiude subito con la X, e un clic finto del sito sulla X non lo chiude', async ({ app, openTab, testServer }) => {
    const page = await sito(openTab, testServer);
    await nelMondoDiFilo(app, page, () => { globalThis.SN_POPUP.showToast('Avviso che resterebbe un minuto', { duration: 60000 }); });
    const avviso = page.locator('.sn-toast', { hasText: 'Avviso che resterebbe un minuto' });
    await expect(avviso).toHaveClass(/sn-toast-visible/);
    const x = avviso.locator('.sn-toast-x');
    await expect(x).toBeVisible();
    await expect(x).toHaveAttribute('title', 'Chiudi');
    expect((await avviso.textContent()).trim(), 'la X non entra nel testo dell\'avviso').toBe('Avviso che resterebbe un minuto');

    await page.evaluate(() => document.querySelector('.sn-toast-x').click());
    await page.waitForTimeout(400);
    await expect(avviso, 'il sito non chiude un avviso di Filo dalla X').toBeVisible();

    await x.hover();
    await page.waitForTimeout(200);
    await shot(page, 'toast-x-1677-hover');
    await x.click();
    await expect(avviso).toHaveCount(0, { timeout: 1500 });
  });

  test('un avviso fisso con la sua chiusura: la X chiama quella, una volta sola', async ({ app, openTab, testServer }) => {
    const page = await sito(openTab, testServer);
    await nelMondoDiFilo(app, page, () => {
      globalThis.__chiusure = 0;
      const el = document.createElement('div');
      el.className = 'sn-save-confirm sn-save-confirm-visible';
      el.textContent = 'Avviso fisso del chiamante';
      globalThis.SN_POPUP.mountToast(el, { sticky: true, chiudi: () => { globalThis.__chiusure++; globalThis.SN_POPUP.unmountToast(el); } });
    });
    const avviso = page.locator('.sn-save-confirm', { hasText: 'Avviso fisso del chiamante' });
    await expect(avviso.locator('.sn-toast-x')).toBeVisible();
    await shot(page, 'toast-x-1677-pill');
    await avviso.locator('.sn-toast-x').click();
    await expect(avviso).toHaveCount(0);
    expect(await nelMondoDiFilo(app, page, () => globalThis.__chiusure)).toBe(1);

    // Con durata 0 l'avviso aspetta chi l'ha aperto: la X lo chiude lo stesso, come il «Chiudi» del tasto destro.
    await nelMondoDiFilo(app, page, () => { globalThis.SN_POPUP.showToast('Sto lavorando', { duration: 0 }); });
    const lavoro = page.locator('.sn-toast', { hasText: 'Sto lavorando' });
    await expect(lavoro).toHaveClass(/sn-toast-visible/);
    await lavoro.locator('.sn-toast-x').click();
    await expect(lavoro).toHaveCount(0, { timeout: 1500 });
  });

  test('nel tema scuro la X si vede', async ({ app, shell, openTab, testServer }) => {
    await shell.evaluate(() => window.filoShell.message({ type: 'update_settings', settings: { theme: 'dark' } }));
    const page = await sito(openTab, testServer);
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.snTheme)).toBe('dark');
    await nelMondoDiFilo(app, page, () => { globalThis.SN_POPUP.showToast('Avviso nel tema scuro', { duration: 0 }); });
    const avviso = page.locator('.sn-toast', { hasText: 'Avviso nel tema scuro' });
    await expect(avviso).toHaveClass(/sn-toast-visible/);
    await expect(avviso.locator('.sn-toast-x')).toBeVisible();
    await page.waitForTimeout(400);
    const scorre = await page.evaluate(() => document.querySelector('.sn-toasts').scrollHeight > document.querySelector('.sn-toasts').clientHeight);
    expect(scorre, 'la X sta dentro l\'avviso: un avviso solo non fa scorrere la pila').toBe(false);
    await shot(page, 'toast-x-1677-scuro');
  });
});

test.describe('il carattere dei riquadri sui siti (#1342)', () => {
  test('cronologia, spiegazione, feedback e Modifica nel documento del sito prendono la generica del carattere scelto, e lo seguono senza ricaricare', async ({ app, shell, openTab, testServer }) => {
    for (const t of ['un testo qualsiasi', SEGRETO]) {
      await shell.evaluate((x) => window.filoShell.message({ type: 'push_clipboard_entry', entry: { type: 'text', text: x } }), t);
    }
    await scegliCarattere(shell, GEORGIA);
    const page = await sito(openTab, testServer);

    await apriCronologia(app, page, '#campo');
    await expect.poll(() => testiCronologia(app, page)).toContain(SEGRETO);
    await expect.poll(() => carattereCronologia(app, page)).toBe('serif');
    await page.keyboard.press('Escape');
    await expect(menuDi(page).pannelli).toHaveCount(0);

    // Dove lo strato sopra la scheda non c'è (un riquadro incorporato, una finestra senza schede) i riquadri restano nel
    // documento, in uno shadow root chiuso: è lì che vale la protezione.
    await nelMondoDiFilo(app, page, () => {
      globalThis.SN_RIQUADRI_SOPRA.apri = () => false;
      globalThis.SN_FEEDBACK_UI.open();
      globalThis.SN_EDITBOX.openEditBox('testo da modificare', { sostituisci: () => {} });
      globalThis.SN_POPUP.openStreaming({ action: globalThis.SN_CONST.ACTIONS.EXPLAIN, payload: { selection: 'parola' }, anchor: { x: 60, y: 60, width: 10, height: 10 }, title: 'Spiega' });
    });
    const riquadri = { feedback: '.sn-fb-text', modifica: '.sn-editbox-instruction', spiegazione: '.sn-popup' };
    for (const [nome, sel] of Object.entries(riquadri)) {
      await expect.poll(() => nelMondoDiFilo(app, page, FONT, sel), { message: nome }).toBe('serif');
    }
    await shot(page, 'carattere-1342-georgia');

    await scegliCarattere(shell, COURIER);
    for (const [nome, sel] of Object.entries(riquadri)) {
      await expect.poll(() => nelMondoDiFilo(app, page, FONT, sel), { message: nome }).toBe('monospace');
    }
    await shot(page, 'carattere-1342-courier');

    await scegliCarattere(shell, null);
    await expect.poll(() => nelMondoDiFilo(app, page, FONT, '.sn-fb-text')).toBe('system-ui, sans-serif');
  });

  test('nello strato sopra la scheda e sulle pagine di Filo resta il carattere scelto', async ({ app, shell, openTab, testServer }) => {
    await scegliCarattere(shell, GEORGIA);
    const page = await sito(openTab, testServer);
    await nelMondoDiFilo(app, page, () => { globalThis.SN_FEEDBACK_UI.open(); });
    // Il browser riscrive le virgolette della pila: si confronta il valore calcolato.
    const calcolato = GEORGIA.replace(/'/g, '"');
    await expect.poll(() => neiRiquadri(app, page, FONT, '.sn-fb-text')).toBe(calcolato);

    const nuova = await openTab('filo://newtab/');
    await nuova.waitForFunction(() => !!globalThis.SN_FEEDBACK_UI);
    await nuova.evaluate(() => globalThis.SN_FEEDBACK_UI.open());
    await expect.poll(() => nuova.evaluate(FONT, '.sn-fb-text')).toBe(calcolato);
  });

  // Un font del sito diviso in un pezzo per carattere, dichiarato col nome scelto e col nome "serif" fra virgolette: i
  // pezzi che il browser carica direbbero al sito quali caratteri ha disegnato la cronologia.
  const FAMIGLIE_SPIA = ['Georgia', 'Times New Roman', 'serif', 'system-ui', 'sans-serif'];
  const ALFABETO = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_';
  const PAGINA_SPIA = `<!doctype html><html><head><style>
${FAMIGLIE_SPIA.flatMap((fam) => [...ALFABETO].map((c) => {
    const cp = c.codePointAt(0).toString(16);
    return `@font-face{font-family:"${fam}";src:url('/spia-${cp}.woff');unicode-range:U+${cp};}`;
  })).join('\n')}
</style></head><body style="padding:40px;font-family:monospace">
  <input id="campo" style="width:320px;font-size:16px">
  <script>
  window.caratteriVisti = () => [...document.fonts].filter((f) => f.status !== 'unloaded')
    .map((f) => String.fromCodePoint(parseInt(f.unicodeRange.replace(/^U\\+/i, ''), 16))).join('');
  </script>
</body></html>`;

  test('con Georgia scelta, un @font-face del sito col suo nome o con "serif" non vede cosa disegna la cronologia', async ({ app, shell, openTab, testServer }) => {
    for (const t of ['un testo qualsiasi', SEGRETO]) {
      await shell.evaluate((x) => window.filoShell.message({ type: 'push_clipboard_entry', entry: { type: 'text', text: x } }), t);
    }
    await scegliCarattere(shell, GEORGIA);
    const page = await sito(openTab, testServer, PAGINA_SPIA);
    expect(await page.evaluate(() => window.caratteriVisti())).toBe('');

    await apriCronologia(app, page, '#campo');
    await expect.poll(() => testiCronologia(app, page)).toContain(SEGRETO);
    expect(await carattereCronologia(app, page)).toBe('serif');
    await page.waitForTimeout(800);
    const visti = await page.evaluate(() => window.caratteriVisti());
    for (const c of ['5', '8', '9', 'S']) {
      expect(visti, `il sito non deve sapere che la cronologia contiene «${c}»`).not.toContain(c);
    }
  });
});
