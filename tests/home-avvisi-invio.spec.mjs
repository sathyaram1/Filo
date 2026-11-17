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
