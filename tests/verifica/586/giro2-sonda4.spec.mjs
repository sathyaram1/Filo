// Sonda 4 del giro 2 (#586): la scelta di COSA condividere e la scheda.
import { test, expect } from '../../fixtures/electron.mjs';

const html = (nome) => `<!doctype html><html><body style="margin:0"><p>${nome}</p>
<button id="share" style="padding:20px">condividi</button>
<script>
  document.getElementById('share').addEventListener('click', () => {
    navigator.mediaDevices.getDisplayMedia({ video: true }).then(
      (s) => { try { s.getTracks().forEach((t) => t.stop()); } catch (_) {} window.__r = 'ok'; },
      (e) => { window.__r = (e && e.name) || 'errore'; });
  });
</script></body></html>`;

async function apriPerUrl(app, shell, url) {
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  const fine = Date.now() + 10_000;
  while (Date.now() < fine) {
    const p = app.windows().find((w) => { try { return w.url() === url; } catch (_) { return false; } });
    if (p) {
      await p.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
      return p;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('scheda non trovata: ' + url);
}

async function schedaDiUrl(app, url) {
  return app.evaluate(({ BrowserWindow }, u) => {
    for (const w of BrowserWindow.getAllWindows()) {
      const tm = w._filoTabs;
      if (!tm || !Array.isArray(tm.tabs)) continue;
      const t = tm.tabs.find((x) => { try { return x.view.webContents.getURL() === u; } catch (_) { return false; } });
      if (t) return t.id;
    }
    return null;
  }, url);
}

async function cimaAreaPagina(app) {
  return app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      const tm = w._filoTabs;
      if (!tm || !Array.isArray(tm.tabs)) continue;
      const t = tm.tabs.find((x) => x.id === tm.activeId);
      if (!t) continue;
      return t.view.getBounds().y;
    }
    return null;
  });
}

test('sonda4: la scelta di cosa condividere segue la scheda?', async ({ app, shell, testServer }) => {
  test.setTimeout(150_000);
  const urlA = testServer.html(html('SITO A'));
  const urlB = testServer.html(html('SITO B'));
  const a = await apriPerUrl(app, shell, urlA);
  await apriPerUrl(app, shell, urlB);
  const idA = await schedaDiUrl(app, urlA);
  const idB = await schedaDiUrl(app, urlB);

  await shell.evaluate((id) => window.filoShell.tabs.activate(id), idA);
  await shell.waitForTimeout(400);

  await a.click('#share');
  const chip = shell.locator('.perm-chip');
  await expect(chip).toHaveCount(1, { timeout: 15_000 });
  await chip.locator('.perm-chip-allow').click();
  const scelta = shell.locator('.perm-source');
  await expect(scelta).toHaveCount(1, { timeout: 15_000 });

  await shell.evaluate((id) => window.filoShell.tabs.activate(id), idB);
  await shell.waitForTimeout(1000);
  // eslint-disable-next-line no-console
  console.log('[586-g4] su SITO B — riquadri di scelta visibili:', await scelta.count(),
    '| cima area pagina:', await cimaAreaPagina(app));
  if (await scelta.count()) {
    // eslint-disable-next-line no-console
    console.log('[586-g4] testo del riquadro mentre si guarda SITO B:',
      JSON.stringify((await scelta.allTextContents())[0].slice(0, 120)));
  }
  expect(true).toBe(true);
});

test('sonda4: due schede che chiedono lo schermo insieme', async ({ app, shell, testServer }) => {
  test.setTimeout(150_000);
  const urlA = testServer.html(html('SITO A'));
  const urlB = testServer.html(html('SITO B'));
  const a = await apriPerUrl(app, shell, urlA);
  const b = await apriPerUrl(app, shell, urlB);
  const idA = await schedaDiUrl(app, urlA);
  const idB = await schedaDiUrl(app, urlB);
  const chip = shell.locator('.perm-chip');
  const scelta = shell.locator('.perm-source');

  // B è attiva: chiede e consente → riquadro di scelta aperto
  await b.click('#share');
  await expect(chip).toHaveCount(1, { timeout: 15_000 });
  await chip.locator('.perm-chip-allow').click();
  await expect(scelta).toHaveCount(1, { timeout: 15_000 });

  // ora A (in secondo piano) chiede a sua volta: passo su A e consento
  await a.click('#share');
  await shell.evaluate((id) => window.filoShell.tabs.activate(id), idA);
  await shell.waitForTimeout(800);
  const n1 = await chip.count();
  if (n1) await chip.first().locator('.perm-chip-allow').click();
  await shell.waitForTimeout(1500);
  // eslint-disable-next-line no-console
  console.log('[586-g4] riquadri di scelta dopo il secondo consenso:', await scelta.count(),
    '| pastiglie:', await chip.count());
  // che fine ha fatto la prima richiesta?
  // eslint-disable-next-line no-console
  console.log('[586-g4] esito pagina B:', await b.evaluate(() => window.__r || 'in attesa'));
  void idB;
  expect(true).toBe(true);
});
