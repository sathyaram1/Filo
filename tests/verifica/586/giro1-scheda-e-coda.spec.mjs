// Verifica #586, giro 1 — la domanda del permesso e la SCHEDA che l'ha fatta.
//
// Il processo principale manda alla shell anche `tabId`: la domanda nasce da
// una scheda precisa. Qui si controlla cosa succede quando le schede sono due:
//
//  a) una scheda in secondo piano chiede un permesso mentre chi naviga sta
//     guardando un altro sito: la domanda compare comunque sopra la scheda
//     sbagliata, e un «Consenti» dato guardando il sito B finisce al sito A;
//  b) la coda è una sola per tutta la finestra: finché la domanda della scheda
//     in secondo piano è lì, la richiesta della scheda che si sta guardando
//     non compare — resta invisibile fino a due minuti, e poi viene negata;
//  c) cambiando scheda la domanda della scheda di prima resta appesa lì.
//
// Più il confronto con l'unico altro pannello della shell che si apre sopra
// l'area pagina (quello dei download): quello chiede spazio alla view nativa
// prima di mostrarsi, la pastiglia no.

import { test, expect } from '../../fixtures/electron.mjs';

const html = (nome) => `<!doctype html><html><body style="margin:0">
<p id="p">${nome}</p>
<script>
  window.__chiediFotocamera = () => {
    window.__cam = navigator.mediaDevices.getUserMedia({ video: true })
      .then(() => 'ok', (e) => (e && e.name) ? e.name : 'errore');
  };
  window.__chiediPosizione = () => {
    window.__pos = new Promise((res) => navigator.geolocation.getCurrentPosition(
      () => res('ok'), (e) => res('errore:' + e.code)));
  };
</script>
</body></html>`;

// openTab del fixture cerca per hostname: con due schede sullo stesso
// 127.0.0.1 troverebbe sempre la prima. Qui si cerca per URL intera.
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

async function schedaAttiva(app) {
  return app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      const tm = w._filoTabs;
      if (!tm || !Array.isArray(tm.tabs)) continue;
      const t = tm.tabs.find((x) => x.id === tm.activeId);
      return t ? { id: t.id, url: t.url || t.view.webContents.getURL() } : null;
    }
    return null;
  });
}

test('la domanda di una scheda in secondo piano compare sopra la scheda che si sta guardando', async ({ app, shell, testServer }) => {
  test.setTimeout(120_000);
  const urlA = testServer.html(html('SITO A'));
  const urlB = testServer.html(html('SITO B'));
  const pageA = await apriPerUrl(app, shell, urlA);
  const pageB = await apriPerUrl(app, shell, urlB);

  // Chi naviga sta guardando B.
  const attiva = await schedaAttiva(app);
  expect(attiva.url, 'la scheda appena aperta dovrebbe essere quella attiva').toBe(urlB);

  // A, in secondo piano, chiede la fotocamera.
  await pageA.evaluate(() => window.__chiediFotocamera());
  const chip = shell.locator('.perm-chip');
  await expect(chip).toHaveCount(1, { timeout: 10_000 });

  void pageB;
  await shell.waitForTimeout(1500);
  expect(
    await chip.count(),
    'la domanda della scheda in secondo piano compare sopra la scheda che si sta guardando, '
    + 'senza nessun segno che arrivi da un\'altra parte',
  ).toBe(0);

  // Passando su quella scheda, la domanda c'è: non è persa, aspetta il suo turno.
  await shell.evaluate((id) => window.filoShell.tabs.activate(id), (await schedaDiUrl(app, urlA)));
  await expect(chip).toHaveCount(1, { timeout: 10_000 });
  await expect(chip).toContainText('fotocamera');
});

async function schedaDiUrl(app, url) {
  return app.evaluate(({ BrowserWindow }, u) => {
    for (const w of BrowserWindow.getAllWindows()) {
      const tm = w._filoTabs;
      if (!tm || !Array.isArray(tm.tabs)) continue;
      const t = tm.tabs.find((x) => {
        try { return x.view.webContents.getURL() === u; } catch (_) { return false; }
      });
      if (t) return t.id;
    }
    return null;
  }, url);
}

test('la richiesta della scheda che si sta guardando resta invisibile dietro quella di un\'altra scheda', async ({ app, shell, testServer }) => {
  test.setTimeout(120_000);
  const urlA = testServer.html(html('SITO A'));
  const urlB = testServer.html(html('SITO B'));
  const pageA = await apriPerUrl(app, shell, urlA);
  const pageB = await apriPerUrl(app, shell, urlB);

  const hostA = new URL(urlA).host;

  // A (in secondo piano) chiede per primo e occupa l'unica pastiglia.
  await pageA.evaluate(() => window.__chiediFotocamera());
  await expect(shell.locator('.perm-chip')).toHaveCount(1, { timeout: 10_000 });

  // Ora chi naviga, su B, preme il bottone «trovami»: B chiede la posizione.
  await pageB.evaluate(() => window.__chiediPosizione());
  await shell.locator('.perm-chip').first().waitFor({ timeout: 2000 }).catch(() => {});
  await shell.waitForTimeout(1500);

  const testi = await shell.locator('.perm-chip').allTextContents();
  // eslint-disable-next-line no-console
  console.log('[586] pastiglie visibili:', JSON.stringify(testi));

  const chiedeLaPosizione = testi.some((t) => /dove sei/i.test(t));
  expect(
    chiedeLaPosizione,
    `chi naviga è su ${new URL(urlB).host} e ha appena chiesto di essere trovato: la domanda non compare, `
    + `perché la fila è una sola per tutta la finestra e la tiene occupata ${hostA}, che sta in un'altra scheda. `
    + 'Il gesto non produce niente, e dopo due minuti viene negato da solo.',
  ).toBe(true);
});

test('la pastiglia chiede spazio alla view della pagina, come fa il pannello dei download', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const page = await testServer.openReady(openTab, html('SITO'));

  const inset = () => app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      const tm = w._filoTabs;
      if (tm) return { topInset: tm.topInset, chromeCompact: !!tm.chromeCompact };
    }
    return null;
  });

  const prima = await inset();
  await page.evaluate(() => window.__chiediFotocamera());
  await expect(shell.locator('.perm-chip')).toHaveCount(1, { timeout: 10_000 });
  await shell.waitForTimeout(400);
  const dopo = await inset();
  const box = await shell.locator('.perm-chip').boundingBox();
  const cimaPagina = await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      const tm = w._filoTabs;
      if (!tm) continue;
      const t = tm.tabs.find((x) => x.id === tm.activeId);
      if (t) return t.view.getBounds().y;
    }
    return null;
  });

  // eslint-disable-next-line no-console
  console.log('[586] inset prima', JSON.stringify(prima), 'dopo', JSON.stringify(dopo),
    'pastiglia', JSON.stringify(box), 'cima pagina', cimaPagina);

  expect(
    dopo.topInset,
    `la pastiglia occupa y ${box && box.y}..${box && (box.y + box.height)} mentre l'area pagina parte a y ${cimaPagina}: `
    + 'per non finire sotto la view nativa dovrebbe farla scendere, come fa il pannello dei download',
  ).toBeGreaterThan(prima.topInset);
});
