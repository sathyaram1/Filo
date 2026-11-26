// D-276, #2390 — Nella home il campo della chat non si stringe per gli avvisi della barra: un avviso sta nell'angolo il
// tempo di leggerlo e poi vola nella colonna di sinistra. Misura alle larghezze dove prima il campo si stringeva.

import { test, expect } from './fixtures/electron.mjs';

async function home(app) {
  let page = null;
  await expect.poll(() => {
    page = app.windows().find((w) => { try { return w.url().startsWith('filo://newtab'); } catch (_) { return false; } });
    return !!page;
  }, { timeout: 10_000 }).toBe(true);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 8_000 });
  return page;
}

for (const [W, H] of [[1280, 840], [900, 700], [720, 640]]) {
  test(`home ${W}x${H}: tre avvisi lunghi non cambiano la larghezza del campo, prima, durante e dopo il volo`, async ({ app, shell, avvisi }) => {
    await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows().find((x) => x._filoTabs).setContentSize(w, h), [W, H]);
    const page = await home(app);
    await page.locator('#input').fill('una domanda abbastanza lunga da occupare una riga intera del campo della home');
    await page.evaluate(() => {
      window.__larghezze = new Set();
      const f = document.getElementById('inputForm');
      window.__giro = setInterval(() => window.__larghezze.add(Math.round(f.getBoundingClientRect().width)), 30);
    });
    await shell.evaluate(() => {
      window.filoNotify('Il catalogo è pronto: 14 pagine, 3 offerte nuove', { durationSec: 0 });
      window.filoNotify('Scaricato: relazione-trimestrale-definitiva-con-allegati.pdf', { durationSec: 0 });
      window.filoNotify('Il portachiavi di sistema non risponde: l’accesso vale fino alla chiusura di Filo', { durationSec: 0, actions: [{ label: 'Capito', onClick() {} }] });
    });
    const vista = await avvisi();
    await expect(vista.locator('.shell-notif.show')).toHaveCount(3);
    // Il tempo di leggerli (5 s di serie), poi nella colonna: nell'angolo della home non resta niente.
    await expect(page.locator('#accade > .dash-carta[data-tipo="cornice"]')).toHaveCount(3, { timeout: 10_000 });
    await expect(vista.locator('.shell-notif.show')).toHaveCount(0);
    await page.waitForTimeout(800);
    const larghezze = await page.evaluate(() => { clearInterval(window.__giro); return [...window.__larghezze]; });
    expect(larghezze).toHaveLength(1);
    // Il testo lungo resta tutto visibile: niente righe nascoste sotto lo scorrimento.
    expect(await page.locator('#input').evaluate((t) => t.scrollHeight - t.clientHeight)).toBeLessThanOrEqual(1);
  });
}

// #1551.1 — col testo grande delle Preferenze la home si dispone come in una finestra più stretta: il campo resta
// largo abbastanza da scriverci e la colonna di destra non esce dalla finestra.
for (const [W, H, scala, minimo] of [[1000, 760, 1.25, 240], [1000, 760, 1.5, 200], [720, 640, 1.5, 160]]) {
  test(`testo ${scala * 100}% in una finestra ${W}x${H}: il campo della home resta largo e tutto sta nella finestra`, async ({ app, shell }) => {
    await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows().find((x) => x._filoTabs).setContentSize(w, h), [W, H]);
    let page = await home(app);
    // Quello che salva la pagina Preferenze scegliendo la dimensione del testo.
    await page.evaluate(async (s) => {
      const r = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ settings: { ...((r && r.settings) || {}), textScale: s } });
    }, scala);
    await page.reload();
    page = await home(app);
    await expect.poll(() => page.evaluate(() => document.documentElement.style.zoom)).toBe(String(scala));
    await page.locator('#input').fill('ciao Filo, che tempo fa domani?');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `tests/.shots/home-testo-${scala * 100}-${W}.png` });
    const m = await page.evaluate(() => {
      const r = (id) => document.getElementById(id).getBoundingClientRect();
      const dash = r('dash');
      return { campo: document.getElementById('input').clientWidth, dash, destra: r('right'), invio: r('sendBtn') };
    });
    expect(m.campo).toBeGreaterThanOrEqual(minimo);
    expect(m.destra.right).toBeLessThanOrEqual(m.dash.right + 1);
    expect(m.invio.right).toBeLessThanOrEqual(m.destra.left);
    expect(m.invio.width).toBeGreaterThan(30);
    // La frase breve sta su una riga: il campo non è una fessura che la spezza parola per parola.
    expect(await page.locator('#input').evaluate((t) => Math.round(t.scrollHeight / parseFloat(getComputedStyle(t).lineHeight)))).toBeLessThanOrEqual(2);
  });
}

// #1551.1 — una home aperta, o ingrandita, mentre un avviso che resta finché lo chiudi è già nell'angolo: l'avviso
// vola nella colonna e il tasto Invia resta scoperto.
test('home nuova aperta con un avviso già nell\'angolo, poi ingrandita: l\'avviso lascia l\'angolo e Invia resta scoperto', async ({ app, shell, avvisi, openTab, testServer }) => {
  await home(app);
  const s = await shell.evaluate(() => window.filoShell.tabs.snapshot());
  const vecchia = s.tabs.find((t) => String(t.url || '').startsWith('filo://newtab'));
  await testServer.openReady(openTab, '<h1>Un sito</h1>');
  await shell.evaluate((id) => window.filoShell.tabs.close(id), vecchia.id);
  await shell.evaluate(() => window.filoNotify('Il portachiavi di sistema non risponde: l’accesso vale fino alla chiusura di Filo', { durationSec: 0, actions: [{ label: 'Capito', onClick() {} }] }));
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show')).toHaveCount(1);

  await shell.evaluate((u) => window.filoShell.tabs.open(u), vecchia.url);
  const nuova = await home(app);
  // Lo zoom della home cambiato mentre l'avviso è ancora nell'angolo.
  await app.evaluate(({ webContents }) => {
    webContents.getAllWebContents().find((w) => { try { return w.getURL().startsWith('filo://newtab'); } catch (_) { return false; } }).setZoomFactor(1.25);
  });
  await expect.poll(() => nuova.evaluate(() => window.devicePixelRatio)).toBeGreaterThan(1.2);
  await expect(vista.locator('.shell-notif.show')).toHaveCount(1);
  const conAvviso = await nuova.locator('#inputForm').evaluate((f) => Math.round(f.getBoundingClientRect().width));

  await expect(nuova.locator('#accade > .dash-carta[data-tipo="cornice"]')).toContainText('Il portachiavi', { timeout: 9_000 });
  await expect(vista.locator('.shell-notif.show')).toHaveCount(0);
  await nuova.waitForTimeout(300);
  // Il campo è quello di una home senza avvisi, già mentre l'avviso stava nell'angolo.
  expect(await nuova.locator('#inputForm').evaluate((f) => Math.round(f.getBoundingClientRect().width))).toBe(conAvviso);
});
