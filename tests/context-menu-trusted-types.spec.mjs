// #1122 — Su una pagina che impone Trusted Types (accounts.google.com, Gmail, YouTube…) il tasto destro apre il menu di
// Filo con le sue voci, anche se la pagina limita i nomi delle policy o tocca un riquadro prima che carichi; e se il menu
// non si costruisce comunque, compare quello di riserva invece di niente.

import { test, expect } from './fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="padding:40px;font:16px sans-serif">
  <h1>Accedi</h1>
  <p id="paragraph">Usa il tuo account per continuare: una frase da selezionare e spiegare.</p>
  <input id="email" type="email" value="mario.rossi@example.com" style="width:300px">
</body></html>`;

const CSP = {
  'solo obbligo': "require-trusted-types-for 'script'",
  'nessun nome ammesso': "require-trusted-types-for 'script'; trusted-types 'none'",
  'solo i nomi della pagina': "require-trusted-types-for 'script'; trusted-types goog#html",
};

async function apri(openTab, testServer, csp, html = HTML) {
  const page = await openTab(testServer.html(html, { headers: { 'Content-Security-Policy': csp } }));
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  // La pagina impone davvero Trusted Types: un HTML scritto dal sito stesso viene rifiutato.
  const prova = await page.evaluate(() => { try { document.body.insertAdjacentHTML('beforeend', '<b></b>'); return 'passato'; } catch (_) { return 'rifiutato'; } });
  expect(prova).toBe('rifiutato');
  return page;
}

async function menuCompleto(menu) {
  await expect(menu).toBeVisible();
  await expect(menu.getByText('Invia feedback', { exact: true })).toBeVisible();
  // Le icone sono SVG costruite da stringa: devono esserci davvero, non riquadri vuoti.
  expect(await menu.locator('svg').count()).toBeGreaterThan(3);
}

for (const [caso, csp] of Object.entries(CSP)) {
  test(`Trusted Types (${caso}): il tasto destro apre il menu di Filo, e la sua voce apre il riquadro`, async ({ openTab, testServer }) => {
    const page = await apri(openTab, testServer, csp);
    await page.locator('#paragraph').click({ button: 'right' });
    const menu = page.locator('.sn-menu');
    await menuCompleto(menu);
    await menu.getByText('Invia feedback', { exact: true }).click();
    await expect(page.locator('.sn-fb-overlay .sn-fb-text')).toBeVisible();
  });

  // Electron rifà il mondo isolato a ogni documento nuovo del processo, e per un riquadro toccato prima del suo
  // caricamento senza rifare il preload: lì l'esenzione di Filo spariva.
  test(`Trusted Types (${caso}): il menu si apre anche dopo un riquadro toccato prima del caricamento`, async ({ openTab, testServer }) => {
    const figlio = testServer.html('<p>riquadro</p>', { headers: { 'Content-Security-Policy': csp } });
    const page = await apri(openTab, testServer, csp);
    await page.evaluate((u) => {
      const a = document.createElement('iframe'); a.src = u; document.body.append(a); void a.contentWindow.document;
      const b = document.createElement('iframe'); document.body.append(b); b.contentWindow.document.body.textContent = 'vuoto';
    }, figlio);
    await page.waitForTimeout(1200);
    await page.locator('#paragraph').click({ button: 'right' });
    await menuCompleto(page.locator('.sn-menu'));
  });
}

test('Trusted Types: il tasto destro dentro un riquadro della pagina apre il menu di Filo lì', async ({ openTab, testServer }) => {
  const csp = CSP['solo i nomi della pagina'];
  const figlio = testServer.html('<body style="padding:20px"><p id="inner">Testo dentro il riquadro</p></body>', { headers: { 'Content-Security-Policy': csp } });
  const page = await apri(openTab, testServer, csp, HTML.replace('</body>', `<iframe id="embed" src="${figlio}" width="500" height="200"></iframe></body>`));
  const frame = page.frameLocator('#embed');
  await frame.locator('#inner').click({ button: 'right' });
  await menuCompleto(frame.locator('.sn-menu'));
});

test('se il menu di Filo non si costruisce compare quello di riserva, e le sue voci funzionano', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, HTML);
  await app.evaluate(({ webContents }, origine) => {
    const wc = webContents.getAllWebContents().filter((w) => String(w.getURL()).startsWith(origine)).pop();
    return wc.executeJavaScriptInIsolatedWorld(999, [{ code: "SN_MENU.open = () => { throw new Error('prova #1122'); }; true" }]);
  }, testServer.origin);

  await page.locator('#email').click({ button: 'right' });
  const voci = await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.webContents.getURL().startsWith('data:text/html'));
    return w ? w.webContents.executeJavaScript("[...document.querySelectorAll('.item .lbl')].map((n) => n.textContent)") : [];
  }), { timeout: 5000 }).toEqual(expect.arrayContaining(['Seleziona tutto', 'Ricarica']));
  void voci;
  await expect(page.locator('.sn-menu')).toHaveCount(0);

  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.webContents.getURL().startsWith('data:text/html'));
    return w.webContents.executeJavaScript("[...document.querySelectorAll('button.item')].find((b) => b.textContent.trim() === 'Seleziona tutto').click()");
  });
  await expect.poll(() => page.evaluate(() => {
    const el = document.getElementById('email');
    return document.activeElement === el && el.selectionStart === 0 && el.selectionEnd === el.value.length;
  })).toBe(true);
});
