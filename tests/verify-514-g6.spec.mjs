// #514 (giro 6) — la faccia opposta dei giri passati. Fin qui si è provato che
// l'Esc NON scavalchi i riquadri aperti; qui si prova che, quando NON c'è
// niente aperto, il tasto esca sempre al primo colpo, su ogni pagina di Filo e
// con ogni fuoco. La regola nuova indovina «quel tasto l'ha usato qualcuno»
// guardando la pagina: se indovina male, l'utente preme Esc e non succede
// niente, che è esattamente la lamentela di partenza.
//
// In coda, la parte avversariale: un sito che si riprende un pezzo di UI di
// Filo già disegnato (il menu del tasto destro appena chiuso) e lo usa come
// esca a ogni Esc, azzerando anche il contatore che dovrebbe fermarlo.

import { test, expect } from './fixtures/electron.mjs';

const PAGINA = '<html><body style="margin:0;height:1200px"><p id="t">parola dentro una frase</p></body></html>';

async function schermoIntero(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    return !!t.contentFullscreen;
  });
}

async function entra(app) {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.setContentFullscreen(true);
  });
  await new Promise((r) => setTimeout(r, 700));
}

async function esc(app) {
  await app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const wc = t.tabs.find((x) => x.id === t.activeId).view.webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  });
  await new Promise((r) => setTimeout(r, 900));
}

async function nuovaSchedaInPrimoPiano(app) {
  const scadenza = Date.now() + 10_000;
  while (Date.now() < scadenza) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded').catch(() => {}); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('nuova scheda non trovata');
}

// Una pagina interna, niente aperto sopra: il primo Esc deve uscire.
async function unSoloEsc({ app, page, nome, prima }) {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await new Promise((r) => setTimeout(r, 800));
  if (prima) await prima();
  await entra(app);
  expect(await schermoIntero(app)).toBe(true);
  await esc(app);
  await expect.poll(() => schermoIntero(app), { timeout: 4000 })
    .toBe(false);
  void nome;
}

const PAGINE = [
  ['gestione', 'filo://manage/manage.html'],
  ['editor', 'filo://editor/editor.html'],
  ['cronologia', 'filo://history/history.html'],
  ['schede archiviate', 'filo://archive/archive.html'],
  ['impostazioni', 'filo://options/'],
  ['preferenze', 'filo://preferences/preferences.html'],
  ['feedback', 'filo://feedback/feedback.html'],
  ['download', 'filo://downloads/downloads.html'],
  ['mazzi', 'filo://decks/decks.html'],
  ['lavagna', 'filo://board/board.html'],
];

for (const [nome, url] of PAGINE) {
  test(`${nome}: niente aperto, un solo Esc esce dallo schermo intero`, async ({ app, openTab }) => {
    test.setTimeout(90_000);
    const page = await openTab(url);
    await unSoloEsc({ app, page, nome });
  });
}

test('home: niente aperto, un solo Esc esce dallo schermo intero', async ({ app }) => {
  const page = await nuovaSchedaInPrimoPiano(app);
  await expect(page.locator('#input')).toBeVisible({ timeout: 8000 });
  await unSoloEsc({ app, page, nome: 'home' });
});

test('home: col fuoco nel campo della chat e del testo scritto, un solo Esc esce', async ({ app }) => {
  const page = await nuovaSchedaInPrimoPiano(app);
  await expect(page.locator('#input')).toBeVisible({ timeout: 8000 });
  await unSoloEsc({
    app,
    page,
    nome: 'home col testo scritto',
    prima: async () => {
      await page.click('#input');
      await page.keyboard.type('ciao filo');
    },
  });
});

test('editor: col fuoco nel testo del documento, un solo Esc esce', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#docbar', { timeout: 15000 });
  await unSoloEsc({
    app,
    page,
    nome: 'editor col testo scritto',
    prima: async () => {
      const campo = page.locator('#editor, .ed-body, [contenteditable="true"]').first();
      if (await campo.count() > 0) {
        await campo.click({ timeout: 5000 }).catch(() => {});
        await page.keyboard.type('due parole').catch(() => {});
      }
    },
  });
});

test('gestione: col fuoco nella ricerca (barra aperta e poi chiusa), un solo Esc esce', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const page = await openTab('filo://manage/manage.html');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  // Apri e richiudi la ricerca col mouse: quando poi si preme Esc non c'è più
  // niente di aperto, e il tasto deve valere «esci dallo schermo intero».
  await page.click('#mgSearchToggle');
  await new Promise((r) => setTimeout(r, 300));
  await page.click('#mgSearchToggle');
  await new Promise((r) => setTimeout(r, 300));
  await unSoloEsc({ app, page, nome: 'gestione dopo la ricerca' });
});

// ── Un sito che si riprende un pezzo di Filo e lo usa come esca ───────────────
// Il marchio nel documento non basta più (giro 5), ma gli ELEMENTI disegnati da
// Filo stanno comunque nel DOM del sito: quando il menu del tasto destro si
// chiude, il nodo staccato resta a portata del sito, che se lo tiene, se lo
// riattacca e se lo ristacca a ogni Esc. In più azzera con eventi finti il
// contatore che dovrebbe fermarlo dopo tre rivendicazioni.
const paginaLadra = (conEventiFinti) => `<!doctype html><html><body style="margin:0;height:1200px">
<p id="t">parola dentro una frase</p>
<script>
  var EVENTI_FINTI = ${conEventiFinti ? 'true' : 'false'};
  var rubato = null;
  new MutationObserver(function (muts) {
    for (var i = 0; i < muts.length; i++) {
      var rm = muts[i].removedNodes;
      for (var j = 0; j < rm.length; j++) {
        var n = rm[j];
        if (n.nodeType === 1 && n.getAttribute && n.getAttribute('data-sn-ui') !== null) {
          rubato = n;
          window.__rubato = true;
        }
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

  function riattacca() {
    if (!rubato || rubato.isConnected) return;
    try {
      rubato.style.cssText = 'position:fixed;left:-9999px;width:1px;height:1px';
      document.documentElement.appendChild(rubato);
    } catch (_) {}
  }
  window.__riattacca = riattacca;

  window.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    setTimeout(function () {
      // Stacca l'esca nello stesso giro del tasto: sembra un riquadro di Filo
      // che si è chiuso.
      if (rubato && rubato.isConnected) { try { rubato.remove(); } catch (_) {} }
      // E azzera il contatore delle rivendicazioni con eventi che il sito può
      // fabbricare da solo.
      try {
        if (EVENTI_FINTI) {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
          window.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        }
      } catch (_) {}
      setTimeout(riattacca, 60);
    }, 0);
  }, true);
</script>
</body></html>`;

test('sito ladro: si riprende un pezzo di Filo e nega l\'uscita a ripetizione', async ({ app, openTab, testServer }) => {
  test.setTimeout(240_000);
  const page = await testServer.openReady(openTab, PAGINA_LADRA);
  // Prima serve un pezzo di Filo davvero disegnato su questa pagina: il menu
  // del tasto destro, la cosa più comune che un utente ci apre sopra.
  await page.locator('#t').click({ button: 'right' });
  await expect(page.locator('.sn-menu').first()).toBeVisible({ timeout: 8000 });
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => !!window.__rubato), { timeout: 8000 }).toBe(true);
  await page.evaluate(() => window.__riattacca());
  await new Promise((r) => setTimeout(r, 300));

  await entra(app);
  const esiti = [];
  for (let i = 0; i < 6; i++) {
    esiti.push(await schermoIntero(app));
    if (!esiti[esiti.length - 1]) break;
    await esc(app);
  }
  expect(await schermoIntero(app), `Esc ripetuto e non si esce mai: ${JSON.stringify(esiti)}`).toBe(false);
});
