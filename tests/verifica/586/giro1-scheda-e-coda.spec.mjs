// Verifica #586, giro 1 — la domanda del permesso e la SCHEDA che l'ha fatta.
//
// Il difetto trovato: la fila delle domande era una sola per tutta la finestra
// e non guardava da quale scheda venisse la richiesta. Due conseguenze, tutte e
// due provate qui:
//
//  a) una scheda lasciata in secondo piano faceva comparire la sua domanda
//     sopra il sito che si stava leggendo, senza nessun segno che venisse da
//     un'altra parte;
//  b) tenendo occupato l'unico posto, la richiesta della scheda che si stava
//     GUARDANDO non compariva: chi premeva «trovami» non otteneva niente, e
//     dopo due minuti gli veniva negato.
//
// Più la misura che conta per farsi vedere: la domanda cade dentro l'area della
// pagina, che il sistema disegna sopra la cornice di Filo, quindi deve far
// scendere la pagina finché è aperta (come il pannello dei download) e
// rimetterla a posto quando si chiude.

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

test('la domanda di una scheda in secondo piano aspetta il suo turno', async ({ app, shell, testServer }) => {
  test.setTimeout(120_000);
  const urlA = testServer.html(html('SITO A'));
  const urlB = testServer.html(html('SITO B'));
  const pageA = await apriPerUrl(app, shell, urlA);
  await apriPerUrl(app, shell, urlB);

  // Chi naviga sta guardando B.
  const attiva = await schedaAttiva(app);
  expect(attiva.url, 'la scheda appena aperta dovrebbe essere quella attiva').toBe(urlB);

  // A, in secondo piano, chiede la fotocamera.
  await pageA.evaluate(() => window.__chiediFotocamera());
  const chip = shell.locator('.perm-chip');
  await shell.waitForTimeout(2000);
  expect(
    await chip.count(),
    'la domanda della scheda in secondo piano compare sopra il sito che si sta leggendo, '
    + 'senza nessun segno che venga da un\'altra parte',
  ).toBe(0);

  // Passando su quella scheda la domanda c'è: non è persa, aspettava il turno.
  await shell.evaluate((id) => window.filoShell.tabs.activate(id), await schedaDiUrl(app, urlA));
  await expect(chip).toHaveCount(1, { timeout: 10_000 });
  await expect(chip).toContainText('fotocamera');
});

test('la richiesta della scheda che si sta guardando compare anche se un\'altra scheda ha una domanda in sospeso', async ({ app, shell, testServer }) => {
  test.setTimeout(120_000);
  const urlA = testServer.html(html('SITO A'));
  const urlB = testServer.html(html('SITO B'));
  const pageA = await apriPerUrl(app, shell, urlA);
  const pageB = await apriPerUrl(app, shell, urlB);

  // A, in secondo piano, chiede per primo.
  await pageA.evaluate(() => window.__chiediFotocamera());
  await shell.waitForTimeout(1500);

  // Ora chi naviga, su B, preme il bottone «trovami»: B chiede la posizione.
  await pageB.evaluate(() => window.__chiediPosizione());
  const chip = shell.locator('.perm-chip');
  await expect(chip).toHaveCount(1, { timeout: 10_000 });
  const testi = await chip.allTextContents();
  // eslint-disable-next-line no-console
  console.log('[586] pastiglie visibili:', JSON.stringify(testi));

  expect(
    testi.some((t) => /dove sei/i.test(t)),
    `chi naviga è su ${new URL(urlB).host} e ha appena chiesto di essere trovato: la domanda deve comparire, `
    + 'non restare dietro a quella di una scheda che non sta guardando',
  ).toBe(true);
});

test('la pastiglia fa scendere la pagina, e la rimette a posto quando si chiude', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const page = await testServer.openReady(openTab, html('SITO'));

  const cimaPagina = () => app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      const tm = w._filoTabs;
      if (!tm) continue;
      const t = tm.tabs.find((x) => x.id === tm.activeId);
      if (t) return t.view.getBounds().y;
    }
    return null;
  });

  const cimaPrima = await cimaPagina();
  await page.evaluate(() => window.__chiediFotocamera());
  await expect(shell.locator('.perm-chip')).toHaveCount(1, { timeout: 10_000 });
  await shell.waitForTimeout(500);
  const box = await shell.locator('.perm-chip').boundingBox();
  const cimaDopo = await cimaPagina();

  // eslint-disable-next-line no-console
  console.log('[586] pastiglia', JSON.stringify(box), 'cima pagina prima', cimaPrima, 'dopo', cimaDopo);

  expect(
    cimaDopo,
    `la pastiglia occupa y ${box && box.y}..${box && (box.y + box.height)}: l'area pagina deve scendere sotto di lei, `
    + 'come fa col pannello dei download, altrimenti la vista nativa la copre',
  ).toBeGreaterThanOrEqual(box.y + box.height);

  await shell.locator('.perm-chip .perm-chip-x').click();
  await expect(shell.locator('.perm-chip')).toHaveCount(0, { timeout: 8_000 });
  await expect.poll(cimaPagina, { timeout: 8_000 }).toBe(cimaPrima);
});
