// Verifica #586, giro 2 — il riquadro «cosa condividi» e la scheda.
//
// Nel giro 1 la domanda del permesso non era legata alla scheda che l'aveva
// fatta: compariva sopra un sito che non c'entrava e restava lì cambiando
// scheda. È stata legata alla scheda. Il riquadro che sceglie COSA condividere,
// nato nella stessa correzione, quella regola non ce l'ha:
//
//   a) resta sopra la scheda su cui si passa, spingendone giù la pagina, e dice
//      «<sito> vedrà quello che scegli qui» con il nome del sito di un'ALTRA
//      scheda — indistinguibile da quello che si sta guardando. Un clic lì
//      consegna lo schermo a un sito che non si sta nemmeno guardando;
//   b) ce n'è uno solo per tutta la finestra: il secondo scalza il primo senza
//      rispondergli. Chi aveva premuto «condividi» e aveva già detto sì resta
//      ad aspettare due minuti e poi si vede negare, senza nessun segno.
//
// Più la verifica che le cose fra cui scegliere abbiano un nome leggibile in
// italiano: arrivano dal sistema in inglese («Entire screen»).

import { test, expect } from '../../fixtures/electron.mjs';

const html = (nome) => `<!doctype html><html><body style="margin:0"><p>${nome}</p>
<button id="share" style="padding:20px">condividi</button>
<script>
  window.__r = null;
  document.getElementById('share').addEventListener('click', () => {
    navigator.mediaDevices.getDisplayMedia({ video: true }).then(
      (s) => { try { s.getTracks().forEach((t) => t.stop()); } catch (_) {} window.__r = 'ok'; },
      (e) => { window.__r = 'no:' + ((e && e.name) || 'errore'); });
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
      if (t) return t.view.getBounds().y;
    }
    return null;
  });
}

test('il riquadro «cosa condividi» non resta sopra un\'altra scheda', async ({ app, shell, testServer }) => {
  test.setTimeout(180_000);
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
  await expect(chip).toHaveCount(1, { timeout: 20_000 });
  await chip.locator('.perm-chip-allow').click();
  const scelta = shell.locator('.perm-source');
  await expect(scelta).toHaveCount(1, { timeout: 20_000 });
  const cimaConScelta = await cimaAreaPagina(app);

  // Si passa su SITO B: il riquadro appartiene a SITO A e lì non ci deve stare.
  await shell.evaluate((id) => window.filoShell.tabs.activate(id), idB);
  await shell.waitForTimeout(1200);

  const rimasti = await scelta.count();
  const testo = rimasti ? (await scelta.allTextContents())[0] : '';
  expect(
    rimasti,
    'il riquadro che sceglie cosa condividere è rimasto sopra l\'altra scheda, e dice '
    + `${JSON.stringify(testo.slice(0, 90))}: un clic lì consegna lo schermo a un sito che non si sta guardando`,
  ).toBe(0);
  expect(
    await cimaAreaPagina(app),
    'e intanto tiene giù la pagina della scheda su cui si è passati',
  ).toBeLessThan(cimaConScelta);

  // Tornando su SITO A la scelta deve essere ancora lì da fare: non si perde.
  await shell.evaluate((id) => window.filoShell.tabs.activate(id), idA);
  await expect(scelta).toHaveCount(1, { timeout: 20_000 });
  await scelta.locator('.perm-source-cancel').click();
});

test('due schede che chiedono lo schermo: nessuna delle due resta appesa', async ({ app, shell, testServer }) => {
  test.setTimeout(180_000);
  const urlA = testServer.html(html('SITO A'));
  const urlB = testServer.html(html('SITO B'));
  const a = await apriPerUrl(app, shell, urlA);
  const b = await apriPerUrl(app, shell, urlB);
  const idA = await schedaDiUrl(app, urlA);
  const idB = await schedaDiUrl(app, urlB);
  const chip = shell.locator('.perm-chip');
  const scelta = shell.locator('.perm-source');

  // B è la scheda che si sta guardando: chiede, si consente, si apre la scelta.
  await b.click('#share');
  await expect(chip).toHaveCount(1, { timeout: 20_000 });
  await chip.locator('.perm-chip-allow').click();
  await expect(scelta).toHaveCount(1, { timeout: 20_000 });

  // Ora chiede anche A, ci si passa sopra e si consente: la scelta di A prende
  // il posto, quella di B aspetta il suo turno invece di essere buttata via.
  await a.click('#share');
  await shell.evaluate((id) => window.filoShell.tabs.activate(id), idA);
  await expect(chip).toHaveCount(1, { timeout: 20_000 });
  await chip.locator('.perm-chip-allow').click();
  await expect(scelta).toHaveCount(1, { timeout: 20_000 });
  await expect(scelta, 'la scelta mostrata è quella della scheda che si sta guardando')
    .toContainText('vedrà quello che scegli qui');
  await scelta.locator('.perm-source-cancel').click();
  await expect(scelta).toHaveCount(0, { timeout: 20_000 });

  // Tornando su B la sua scelta deve essere ancora lì da fare. Prima veniva
  // scalzata senza risposta: chi aveva premuto «condividi» e detto sì restava
  // ad aspettare due minuti e poi si vedeva negare, senza nessun segno.
  expect(await b.evaluate(() => window.__r), 'la richiesta di B non doveva ancora avere risposta').toBe(null);
  await shell.evaluate((id) => window.filoShell.tabs.activate(id), idB);
  await expect(
    scelta,
    'tornando sulla scheda che aveva chiesto per prima, la scelta di cosa condividere non c\'è più: '
    + 'è stata scalzata dalla seconda senza risponderle, e quella pagina resta ad aspettare due minuti',
  ).toHaveCount(1, { timeout: 20_000 });
  await scelta.locator('.perm-source-cancel').click();
  await expect
    .poll(() => b.evaluate(() => window.__r), { timeout: 20_000 })
    .not.toBe(null);
});

test('le cose fra cui scegliere hanno un nome in italiano', async ({ shell, openTab, testServer }) => {
  test.setTimeout(150_000);
  const page = await testServer.openReady(openTab, html('SITO'));
  const chip = shell.locator('.perm-chip');
  await page.click('#share');
  await expect(chip).toHaveCount(1, { timeout: 20_000 });
  await chip.locator('.perm-chip-allow').click();
  const scelta = shell.locator('.perm-source');
  await expect(scelta).toHaveCount(1, { timeout: 20_000 });
  const nomi = await scelta.locator('.perm-source-item').allTextContents();
  expect(nomi.length, 'niente fra cui scegliere').toBeGreaterThan(0);
  for (const n of nomi) {
    expect(
      n,
      `«${n}»: il nome arriva dal sistema in inglese e resta così dentro una Filo tutta in italiano`,
    ).not.toMatch(/\b(Entire screen|Screen \d|Whole screen)\b/i);
  }
  await scelta.locator('.perm-source-cancel').click();
});
