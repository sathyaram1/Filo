// La prova da utente (#2507) dalla parte di Filo: la preparazione fa rispondere davvero la chat della home, e i segni
// numerati che riceve il modello sono quelli delle superfici nella schermata, non di quelle tagliate via.
// Il fornitore è finto: nessuna chiamata vera parte da qui.

import { test, expect } from './fixtures/electron.mjs';
import { preparaFilo } from './agent/provaPreparazione.mjs';
import { markInteractables, clearMarks, clickMark } from './agent/driver.mjs';
import { home, chiedi } from './helpers/chatFinta.mjs';

test.describe('profilo nuovo', () => {
  test.use({ accoglienzaFatta: false });

  test('dopo la preparazione la richiesta arriva alla chat della home, e la chat risponde', async ({ app, shell }) => {
    await preparaFilo(app, shell, 'k-test');
    // Il fornitore finto lascia passare impostazioni e scelta del modello di Filo: risponde solo al posto della rete.
    await app.evaluate(() => {
      globalThis.__provaChiamate = [];
      globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta }) => {
        globalThis.__provaChiamate.push({ modello: attempts[0].model, messaggi: JSON.parse(JSON.stringify(messages)) });
        onDelta && onDelta('Eccomi, sono Filo.');
        return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text: 'Eccomi, sono Filo.', toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
      };
    });
    const page = await home(app);
    await chiedi(page, 'ciao Filo');
    await expect(page.getByText('Eccomi, sono Filo.').first()).toBeVisible({ timeout: 15_000 });
    const chiamate = await app.evaluate(() => globalThis.__provaChiamate);
    expect(chiamate.length).toBeGreaterThan(0);
    expect(JSON.stringify(chiamate[0].messaggi)).toContain('ciao Filo');
  });
});

// La conferma di Filo sta in una radice chiusa: si vedeva nella schermata, ma senza segni il modello non poteva rispondere.
test('la conferma di Filo ha i segni sui suoi pulsanti, e il clic sul segno di OK conferma', async ({ app, shell }) => {
  const page = await home(app);
  await page.evaluate(() => {
    window.__esitoConferma = 'aperta';
    window.SN_CONFIRM_UI.confirm({ title: 'Filo chiede conferma', text: 'Aprire la pagina?' }).then((ok) => { window.__esitoConferma = ok; });
  });
  await expect.poll(async () => {
    const { map } = await markInteractables(app, shell);
    await clearMarks(app, shell);
    return map.filter((m) => /^(OK|Annulla)$/i.test(m.label)).map((m) => m.label).sort();
  }, { timeout: 10_000 }).toEqual(['Annulla', 'OK']);
  const { map } = await markInteractables(app, shell);
  console.log('DBG raf', await page.evaluate(() => Promise.race([new Promise((r) => requestAnimationFrame(() => r('raf'))), new Promise((r) => setTimeout(() => r('niente raf'), 2000))])), await page.evaluate(() => [document.visibilityState, document.hasFocus()]));
  const okM = map.find((m) => /^OK$/i.test(m.label));
  console.log('DBG el', await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e && (e.className || e.tagName); }, [okM.x, okM.y]));
  await clickMark(app, shell, map, map.find((m) => /^OK$/i.test(m.label)).i);
  await expect.poll(() => page.evaluate(() => window.__esitoConferma)).toBe(true);
});

// La home lasciata per una pagina resta una vista nascosta grande quanto la scheda: dava i suoi segni sopra la pagina.
test('una vista tagliata fuori dalla finestra o nascosta non dà segni, una dentro sì', async ({ app, shell }) => {
  await app.evaluate(async ({ BrowserWindow, WebContentsView }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const [larga] = win.getContentSize();
    const vista = async (bounds, testo, visibile = true) => {
      const v = new WebContentsView();
      win.contentView.addChildView(v);
      v.setBounds(bounds);
      v.setVisible(visibile);
      await v.webContents.loadURL(`data:text/html,<button style="width:120px;height:40px">${testo}</button>`);
    };
    await vista({ x: 200, y: 200, width: 300, height: 120 }, 'Dentro');
    await vista({ x: larga + 40, y: 200, width: 300, height: 120 }, 'Fuori');
    await vista({ x: 200, y: 400, width: 300, height: 120 }, 'Nascosta', false);
  });
  await expect.poll(async () => {
    const { map } = await markInteractables(app, shell);
    await clearMarks(app, shell);
    return map.map((m) => m.label).filter((l) => /^(Dentro|Fuori|Nascosta)$/.test(l)).sort();
  }, { timeout: 10_000 }).toEqual(['Dentro']);
});
