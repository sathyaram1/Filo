// #648 (giro 2 di verifica) — le due strade che il giro 1 non ha percorso.
//
// Il giro 1 ha provato la pila sopra una pagina di Filo (quattro, otto, dieci,
// dodici), sopra un sito, e l'Esc pigiato in fretta. Restano due strade, e
// tutte e due passano dal punto che la correzione ha cambiato — quello in cui
// Filo smette di credere alla pagina:
//
//  1. LO SCHERMO PIENO DEL SITO. Quando è il sito ad avere lo schermo pieno
//     (il pulsante del lettore video), l'Esc il browser se lo mangia: non
//     arriva alla pagina da solo, glielo consegna Filo. È l'unico ramo in cui,
//     arrivati al tetto, Filo esce E consegna il tasto nello stesso colpo, e
//     nessuna prova lo tocca. Un sito che si prende ogni Esc mentre è a
//     schermo pieno suo è la versione peggiore del «sito ladro»: se lì
//     l'uscita non arrivasse, l'utente resterebbe chiuso dentro a uno schermo
//     che non è nemmeno di Filo. Il tetto è stato alzato da tre a dieci: gli
//     Esc da pigiare crescono, l'uscita no.
//
//  2. LA VOLTA DOPO. Il tetto è una rete che scatta una volta; se il conto non
//     ripartisse da zero, la sessione successiva di schermo intero nascerebbe
//     già sfiduciata e il primo riquadro aperto perderebbe la modalità — cioè
//     il difetto di #648 di nuovo, spostato un minuto più in là.

import { test, expect } from '../../fixtures/electron.mjs';

async function stato(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    return { cf: !!t.contentFullscreen, pageFs: !!t.pageFullscreen };
  });
}
const schermoIntero = async (app) => (await stato(app)).cf;

async function entra(app) {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.setContentFullscreen(true);
  });
  await new Promise((r) => setTimeout(r, 700));
}

// Il tasto vero: passa dal before-input-event del main, com'è quando lo preme
// una persona.
async function esc(app, attesa = 1200) {
  await app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const wc = t.tabs.find((x) => x.id === t.activeId).view.webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  });
  await new Promise((r) => setTimeout(r, attesa));
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

async function preparaProvider(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN_DEEP]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.SN_PROVIDER_OPENROUTER = {
      ...globalThis.SN_PROVIDER_OPENROUTER,
      streamComplete: async ({ onDelta }) => {
        await new Promise((r) => setTimeout(r, 30_000));
        onDelta('.');
        return { text: '.', usage: {} };
      },
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Sito a schermo pieno SUO, che si riprende un pezzo di Filo a ogni Esc.
//
// Il pulsante chiede lo schermo pieno (gesto vero, quindi il permesso c'è), e
// da lì in poi ogni Esc viene usato per staccare e riattaccare un nodo di
// Filo: agli occhi di Filo sembra un riquadro che si chiude, cioè la prova
// forte che fa rivendicare il tasto.
const LADRA_A_SCHERMO_PIENO = `<!doctype html><html><body style="margin:0;height:1200px">
<p id="t">parola dentro una frase</p>
<button id="fs" style="font-size:20px">schermo intero</button>
<script>
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

  document.getElementById('fs').addEventListener('click', function () {
    try { document.documentElement.requestFullscreen(); } catch (_) {}
  });

  window.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    setTimeout(function () {
      if (rubato && rubato.isConnected) { try { rubato.remove(); } catch (_) {} }
      setTimeout(riattacca, 60);
    }, 0);
  }, true);
</script>
</body></html>`;

test('sito a schermo pieno suo che si prende ogni Esc: l\'utente esce lo stesso', async ({ app, openTab, testServer }) => {
  test.setTimeout(300_000);
  const page = await testServer.openReady(openTab, LADRA_A_SCHERMO_PIENO);

  // L'esca: un pezzo di Filo disegnato davvero sulla pagina (il menu del tasto
  // destro), che il sito si tiene quando si chiude.
  await page.locator('#t').click({ button: 'right' });
  await expect(page.locator('.sn-menu').first()).toBeVisible({ timeout: 8000 });
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => !!window.__rubato), { timeout: 8000 }).toBe(true);
  await page.evaluate(() => window.__riattacca());
  await new Promise((r) => setTimeout(r, 300));

  // Lo schermo pieno se lo prende il SITO, col suo pulsante.
  await page.locator('#fs').click();
  await expect.poll(() => schermoIntero(app), { timeout: 8000 }).toBe(true);
  expect((await stato(app)).pageFs, 'lo schermo pieno doveva essere della pagina').toBe(true);

  // Il tetto è dieci rivendicazioni: al massimo l'undicesimo Esc esce. Ne
  // pigiamo qualcuno in più, e contiamo quanti ne sono serviti davvero.
  let usciti = 0;
  for (let i = 1; i <= 16 && !usciti; i += 1) {
    await esc(app);
    if (!(await schermoIntero(app))) usciti = i;
  }
  expect(usciti, 'sedici Esc e il sito tiene ancora l\'utente dentro allo schermo pieno').toBeGreaterThan(0);
  console.log(`[#648 giro2] sito ladro a schermo pieno suo: uscito all'Esc numero ${usciti}`);
  // E l'uscita è davvero un'uscita: anche lo schermo pieno del SITO se n'è
  // andato, altrimenti resterebbe un documento convinto di essere a schermo
  // pieno dentro una view tornata sotto la barra.
  await expect.poll(async () => (await stato(app)).pageFs, { timeout: 8000 }).toBe(false);
  await expect.poll(
    () => page.evaluate(() => !!document.fullscreenElement),
    { timeout: 8000 },
  ).toBe(false);
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. La volta dopo è una volta nuova.
test('dopo che il tetto è scattato, la sessione dopo riparte da zero', async ({ app }) => {
  test.setTimeout(300_000);
  const ALTA = 12;
  const page = await nuovaSchedaInPrimoPiano(app);
  await preparaProvider(app);
  await page.waitForFunction(() => !!window.SN_POPUP?.openStreaming && !!window.SN_CONST, null, { timeout: 15_000 });

  async function impila(n) {
    await page.evaluate((k) => {
      for (let i = 1; i <= k; i += 1) {
        window.SN_POPUP.openStreaming({
          action: window.SN_CONST.ACTIONS.EXPLAIN_DEEP,
          payload: { selection: 'r' + i, sentence: 'una frase con r' + i + ' dentro' },
          anchor: { x: 120, y: 300 },
          title: 'r' + i,
        });
      }
    }, n);
    await expect.poll(() => page.locator('.sn-popup').count(), { timeout: 10_000 }).toBe(n);
    await new Promise((r) => setTimeout(r, 400));
  }

  // Prima sessione: una pila più alta del tetto, così il tetto scatta davvero.
  await entra(app);
  await impila(ALTA);
  let scattato = false;
  for (let i = 1; i <= ALTA && !scattato; i += 1) {
    await esc(app);
    if (!(await schermoIntero(app))) scattato = true;
  }
  expect(scattato, `dopo ${ALTA} Esc il tetto non è mai scattato: la prova non direbbe nulla`).toBe(true);

  // Ripuliamo lo schermo dai riquadri rimasti, senza toccare nient'altro.
  for (let i = 0; i < ALTA && await page.locator('.sn-popup').count() > 0; i += 1) {
    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 200));
  }
  await expect.poll(() => page.locator('.sn-popup').count(), { timeout: 8000 }).toBe(0);

  // Seconda sessione: un riquadro solo. Il primo Esc è suo, la modalità resta.
  await entra(app);
  await impila(1);
  await esc(app);
  expect(
    { rimasti: await page.locator('.sn-popup').count(), modalita: await schermoIntero(app) },
    'la sessione dopo è nata sfiduciata: il primo Esc si è portato via la modalità',
  ).toEqual({ rimasti: 0, modalita: true });

  await esc(app);
  await expect.poll(() => schermoIntero(app), { timeout: 8000 }).toBe(false);
});
