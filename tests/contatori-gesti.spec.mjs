// I contatori dei gesti della personalizzazione (#1471) nell'app vera: la barra laterale (perché si apre, cosa ci si
// fa, il nome letto su un'icona, l'icona rimessa nel menu), «Altro…» del tasto destro, le carte e il riquadro della
// home, i moduli dell'Editor, i ripristini delle Preferenze, l'«annulla» su un cambio e i trascinamenti; l'incognito
// no. Forma e spedizione: tests/unit/contatoriGesti.test.mjs.

import { test, expect } from './fixtures/electron.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';
import { barraPage, statoBarra, comandaBarra, pannelloFermo, menuAperto, scegliNelMenu } from './helpers/barra.mjs';

const SHOTS = 'tests/.shots';

async function trovaPagina(app, prova, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const p = app.windows().find((w) => { try { return prova(w.url()); } catch (_) { return false; } });
    if (p) { await p.waitForLoadState('domcontentloaded'); return p; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('pagina non trovata');
}
const homeDi = (app) => trovaPagina(app, (u) => u.startsWith('filo://newtab') && !u.includes('incognito'));

// I gesti di oggi come li manda il documento dei gesti, sommati sulle ore: per misura, chiave e voce, il conto.
// La disposizione di serie è quella dell'ultima ora.
const gesti = (app) => app.evaluate(async () => {
  const C = globalThis.SN_CONTATORI;
  const s = await globalThis.SN_CONTATORI_MAIN.letto();
  const g = C.giornoDi(Date.now());
  const ore = Object.entries(s.ore || {}).filter(([k]) => k.startsWith(`${g}T`)).sort().map(([k, v]) => [k, v]);
  const tot = {};
  for (const [k, dati] of ore) {
    const d = C.documentoGesti({ pseudonimo: 'a'.repeat(20), chiave: k, app: '0.0.0', os: 'linux', dati });
    for (const c of C.MISURE_GESTI) {
      tot[c] = tot[c] || {};
      if (c === 'disposizione_di_serie') { if (Object.keys(d[c]).length) tot[c] = d[c]; continue; }
      for (const [chiave, v] of Object.entries(d[c])) {
        const per = tot[c][chiave] || (tot[c][chiave] = {});
        for (const voce of v.split(';')) {
          const p = voce.split('|');
          const [nome, n] = c === 'barra_aperta' ? [p[0], p[1]] : p.length === 1 ? ['', p[0]] : [p.slice(0, -1).join('|'), p[p.length - 1]];
          per[nome] = (per[nome] || 0) + Number(n);
        }
      }
    }
  }
  return tot;
});
const conto = async (app, misura, chiave, voce = '') => ((await gesti(app))[misura]?.[chiave]?.[voce]) || 0;

// Il testo del suggerimento della barra visibile adesso: è una finestra a sé, sopra la scheda.
const etichetta = (app) => app.evaluate(async ({ BrowserWindow }) => {
  const testi = [];
  for (const w of BrowserWindow.getAllWindows()) {
    if (w._filoTabs || w.isDestroyed() || !w.isVisible()) continue;
    try {
      const t = await w.webContents.executeJavaScript("(document.getElementById('tip') || {}).textContent || ''");
      if (t) testi.push(t);
    } catch (_) {}
  }
  return testi.join(' | ');
});

async function paginaDiProva(openTab, testServer) {
  const page = await testServer.openReady(openTab, '<!doctype html><body style="margin:0;padding:40px;height:1400px"><p id="p">Clic destro qui.</p></body>');
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  return page;
}

test('la barra laterale conta perché si apre e cosa ci si fa, e il nome letto su un’icona prima del clic', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await paginaDiProva(openTab, testServer);
  const barra = await barraPage(app);

  // Aperta da un clic e chiusa senza fare niente: «a vuoto», con quanto è rimasta aperta.
  await comandaBarra(app, 'clic');
  await expect.poll(async () => (await statoBarra(app)).aperta).toBe(true);
  await comandaBarra(app, 'chiudi');
  await expect.poll(() => conto(app, 'barra_aperta', 'clic', 'a_vuoto'), { timeout: 8_000 }).toBe(1);

  // Dal tasto, col nome dell'icona letto e poi un clic: l'apertura è un'azione, il nome «clic». Da tastiera, dopo
  // l'azione la barra si richiude da sé.
  await comandaBarra(app, 'tasto');
  await expect.poll(async () => (await statoBarra(app)).aperta).toBe(true);
  await pannelloFermo(barra);
  const ico = barra.locator('#nav .ico[data-id="reload"]');
  await ico.hover();
  await expect.poll(() => etichetta(app), { timeout: 4000 }).toBe(await ico.getAttribute('aria-label'));
  await ico.click();
  await expect.poll(() => conto(app, 'suggerimento_letto', 'reload', 'barra|clic'), { timeout: 8_000 }).toBe(1);
  await expect.poll(() => conto(app, 'barra_aperta', 'tasto', 'azione'), { timeout: 8_000 }).toBe(1);
  // Il nome letto e lasciato per un'altra icona: «via».
  await comandaBarra(app, 'clic');
  await expect.poll(async () => (await statoBarra(app)).aperta).toBe(true);
  await pannelloFermo(barra);
  const altra = barra.locator('#nav .ico[data-id="home"]');
  await altra.hover();
  await expect.poll(() => etichetta(app), { timeout: 4000 }).toBe(await altra.getAttribute('aria-label'));
  await ico.hover();
  await expect.poll(() => conto(app, 'suggerimento_letto', 'home', 'barra|via'), { timeout: 8_000 }).toBe(1);
  await comandaBarra(app, 'chiudi');
  await expect.poll(() => conto(app, 'barra_aperta', 'clic', 'a_vuoto'), { timeout: 8_000 }).toBe(2);
  expect(await conto(app, 'barra_aperta', 'tasto', 'a_vuoto')).toBe(0);
});

test('un’icona rimessa nel menu dal tasto destro della barra: la posa con la sua via, e la barra non è più di serie', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await paginaDiProva(openTab, testServer);
  const barra = await barraPage(app);
  await expect.poll(async () => (await gesti(app)).disposizione_di_serie, { timeout: 8_000 }).toEqual({ primary: 'si', secondary: 'si', bar: 'si' });
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  await barra.locator('#nav .ico[data-id="fullscreen"]').click({ button: 'right' });
  const menu = await menuAperto(app);
  expect(menu, 'il menu dell’icona deve aprirsi').toBeTruthy();
  await scegliNelMenu(menu, 'Rimetti nel menu');
  await expect.poll(async () => (await statoBarra(app)).secondary.includes('fullscreen'), { timeout: 8_000 }).toBe(true);
  await expect.poll(() => conto(app, 'icona_spostata', 'fullscreen', 'bar|secondary|rimessa_nel_menu'), { timeout: 8_000 }).toBe(1);
  expect((await gesti(app)).disposizione_di_serie).toEqual({ primary: 'si', secondary: 'no', bar: 'no' });
  await comandaBarra(app, 'chiudi');
  await expect.poll(() => conto(app, 'barra_aperta', 'clic', 'tasto_destro'), { timeout: 8_000 }).toBe(1);
});

test('«Altro…» del tasto destro conta le aperture e l’icona scelta lì; il nome letto nella riga prima del clic', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await paginaDiProva(openTab, testServer);
  await page.locator('#p').click({ button: 'right' });
  const menu = menuDi(page);
  await expect(menu.principale).toBeVisible({ timeout: 8_000 });
  await menu.locator('.sn-menu-row-overflow').click();
  await expect(menu.griglia).toBeVisible({ timeout: 8_000 });
  await expect.poll(() => conto(app, 'altro_del_menu', 'aperture'), { timeout: 8_000 }).toBe(1);
  await menu.griglia.locator('[data-sn-icon-id="openOptions"]').click();
  await expect.poll(() => conto(app, 'altro_del_menu', 'openOptions'), { timeout: 8_000 }).toBe(1);

  await page.bringToFront();
  await page.locator('#p').click({ button: 'right' });
  await expect(menu.principale).toBeVisible({ timeout: 8_000 });
  const share = menu.icona('share');
  await share.hover();
  await expect(menu.etichetta).toBeVisible({ timeout: 4_000 });
  await menu.icona('qrCode').hover();
  await expect.poll(() => conto(app, 'suggerimento_letto', 'share', 'menu|via'), { timeout: 8_000 }).toBe(1);
  expect(JSON.stringify(await gesti(app))).not.toMatch(/Clic destro qui/);
});

test('le carte della home: l’uso per colonna e gesto, le mosse scritte dal main, il ripristino; il riquadro di sistema', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const home = await homeDi(app);
  const editor = home.locator('#tieni .dash-carta[data-chiave="editor"]');
  await expect(editor).toBeVisible({ timeout: 10_000 });
  await editor.click({ button: 'right' });
  await expect(home.locator('.dash-menu')).toBeVisible();
  await expect.poll(() => conto(app, 'carta_home', 'editor', 'destra|tasto_destro'), { timeout: 8_000 }).toBe(1);
  await home.locator('.dash-menu-voce', { hasText: 'Togli dalla home' }).click();
  await expect(editor).toHaveCount(0);
  await expect.poll(() => conto(app, 'carta_home', 'editor', 'togli'), { timeout: 8_000 }).toBe(1);

  const altro = home.locator('#altro');
  const box = await altro.boundingBox();
  await home.mouse.click(box.x + box.width - 4, box.y + 4, { button: 'right' });
  await home.locator('.dash-menu-voce', { hasText: 'Rimetti le carte' }).click();
  await expect(editor).toBeVisible({ timeout: 8_000 });
  await expect.poll(() => conto(app, 'carta_home', 'tutte', 'ripristina'), { timeout: 8_000 }).toBe(1);
  expect(await conto(app, 'ripristino', 'carte_home')).toBe(1);

  const ora = home.locator('#sistema .dash-sis-voce[data-voce="ora"]');
  await expect(ora).toBeVisible({ timeout: 10_000 });
  await ora.click();
  await expect.poll(() => conto(app, 'riquadro_sistema', 'ora', 'clic'), { timeout: 8_000 }).toBe(1);
  await home.keyboard.press('Escape');
  await ora.focus();
  await home.keyboard.press('Enter');
  await expect.poll(() => conto(app, 'riquadro_sistema', 'ora', 'tastiera'), { timeout: 8_000 }).toBe(1);
  await home.screenshot({ path: `${SHOTS}/contatori-gesti-home.png` });
});

test('i trascinamenti nella home: da dove a dove e se è servito, e quelli lasciati nel vuoto; mai cosa portano', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const home = await homeDi(app);
  await expect(home.locator('#tieni .dash-carta[data-chiave="mazzi"]')).toBeVisible({ timeout: 10_000 });
  // Gli eventi di trascinamento della pagina, con lo stesso DataTransfer dal prendere al lasciare.
  await home.evaluate(() => {
    const carta = document.querySelector('#tieni .dash-carta[data-chiave="mazzi"]');
    const campo = document.getElementById('inputForm');
    const dt = new DataTransfer();
    carta.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    campo.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    campo.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    // Una seconda presa, lasciata dove nessuno la prende.
    const dt2 = new DataTransfer();
    carta.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt2 }));
    carta.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt2 }));
    // La voce dell'ora presa dalla chat: trascinata in chat, e posata lì.
    const ora = document.querySelector('#sistema .dash-sis-voce[data-voce="ora"]');
    const dt4 = new DataTransfer();
    ora.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt4 }));
    campo.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt4 }));
    // Il browser dice a chi ha preso la voce che il rilascio è andato: fuori da un trascinamento vero lo si finge.
    Object.defineProperty(dt4, 'dropEffect', { value: 'copy' });
    ora.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt4 }));
    // Un testo di un'altra pagina, senza il segno di Filo.
    const dt3 = new DataTransfer();
    dt3.setData('text/plain', 'Appunti riservati di Anna');
    campo.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt3 }));
  });
  await expect.poll(() => conto(app, 'trascinamento', 'carta_home', 'chat_home|posato'), { timeout: 8_000 }).toBe(1);
  await expect.poll(() => conto(app, 'trascinamento', 'carta_home', 'nessuna|annullato'), { timeout: 8_000 }).toBe(1);
  await expect.poll(() => conto(app, 'trascinamento', 'testo_pagina', 'chat_home|posato'), { timeout: 8_000 }).toBe(1);
  await expect.poll(() => conto(app, 'trascinamento', 'voce_sistema', 'chat_home|posato'), { timeout: 8_000 }).toBe(1);
  await expect.poll(() => conto(app, 'riquadro_sistema', 'ora', 'trascina_in_chat'), { timeout: 8_000 }).toBe(1);
  expect(await conto(app, 'trascinamento', 'voce_sistema', 'nessuna|annullato')).toBe(0);
  await expect(home.locator('#input')).toHaveValue(/Appunti riservati di Anna/);
  const stato = JSON.stringify(await app.evaluate(async () => globalThis.SN_CONTATORI_MAIN.letto()));
  expect(stato).not.toContain('Appunti riservati');
  expect(stato).not.toContain('Mazzi');
});

test('un file dal disco lasciato nella home fuori dal campo entra in chat e si conta posato, come sul campo', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const home = await homeDi(app);
  await expect(home.locator('#input')).toBeVisible();
  const foto = join(cartellaInCasa('filo-test-gesti-'), 'foto.png');
  writeFileSync(foto, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  // Il rilascio vero del sistema, lontano dalla casella: la pagina non lo fabbrica.
  const s = await home.context().newCDPSession(home);
  const data = { items: [], files: [foto], dragOperationsMask: 1 };
  for (const type of ['dragEnter', 'dragOver', 'drop']) await s.send('Input.dispatchDragEvent', { type, x: 120, y: 120, data });
  await s.detach().catch(() => {});
  await expect(home.locator('#imgPreviews .dash-img-preview img')).toHaveCount(1, { timeout: 5_000 });
  await expect.poll(() => conto(app, 'trascinamento', 'file_disco', 'chat_home|posato'), { timeout: 8_000 }).toBe(1);
  expect(JSON.stringify(await app.evaluate(async () => globalThis.SN_CONTATORI_MAIN.letto()))).not.toContain('foto.png');
});

test('l’Editor conta la vista delle impostazioni, la griglia ridimensionata e il modulo aggiunto, per tipo', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const page = await openTab('filo://editor/editor.html');
  await page.waitForLoadState('domcontentloaded');
  await page.locator('.ed-module[data-type="settings"]').click();
  await expect(page.locator('#settingsView')).toBeVisible();
  await expect.poll(() => conto(app, 'modulo_editor', 'impostazioni'), { timeout: 8_000 }).toBe(1);
  await page.locator('[data-gs="cols+"]').click();
  await expect.poll(() => conto(app, 'modulo_editor', 'griglia', '8|10'), { timeout: 8_000 }).toBe(1);
  await page.locator('.ed-cell-empty').first().click();
  await page.locator('[data-add="word-count"]').click();
  await expect.poll(() => conto(app, 'modulo_editor', 'word-count', 'aggiunto'), { timeout: 8_000 }).toBe(1);
  await page.locator('.ed-module[data-type="settings"]').click();
  await expect(page.locator('#settingsView')).toBeHidden();
  await page.locator('.ed-module[data-type="word-count"]').first().click();
  await expect.poll(() => conto(app, 'modulo_editor', 'word-count', 'usato'), { timeout: 8_000 }).toBe(1);
});

test('le Preferenze contano cosa si rimette di serie, per nome e mai il valore, e le avanzate arrivate sullo schermo', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await app.evaluate(async () => globalThis.SN_STORAGE.updateSettings({ themeTokens: { accent: '#123456' } }));
  const page = await openTab('filo://preferences/preferences.html');
  await page.waitForLoadState('domcontentloaded');
  const ripristina = page.locator('.sn-token-reset[aria-label="Ripristina accent"]');
  await expect(ripristina).toHaveCount(1, { timeout: 10_000 });
  // Aperta la pagina, le avanzate stanno più sotto: non si contano finché non ci si arriva.
  await new Promise((r) => setTimeout(r, 500));
  expect(await conto(app, 'ripristino', 'avanzate_viste')).toBe(0);
  await ripristina.scrollIntoViewIfNeeded();
  await ripristina.click();
  await expect.poll(() => conto(app, 'ripristino', 'token', 'accent'), { timeout: 8_000 }).toBe(1);
  await expect.poll(() => conto(app, 'ripristino', 'avanzate_viste'), { timeout: 8_000 }).toBe(1);
  await page.locator('#resetAllTokens').click();
  await expect.poll(() => conto(app, 'ripristino', 'tutti_token'), { timeout: 8_000 }).toBe(1);
  expect(JSON.stringify(await gesti(app))).not.toContain('123456');
});

test('l’«annulla» su un cambio conta l’impostazione, chi l’aveva fatto e quanto dopo; il «rifai» no', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const home = await homeDi(app);
  const manda = (msg) => home.evaluate((m) => new Promise((ok) => chrome.runtime.sendMessage({ ...m, type: self.SN_MSG.MSG[m.tipo] }, ok)), msg);
  await manda({ tipo: 'UPDATE_SETTINGS', settings: { theme: 'dark' } });
  const id = await app.evaluate(async () => {
    await globalThis.SN_REGISTRO_CAMBI.attesa();
    const t = await globalThis.SN_REGISTRO_CAMBI.tutti();
    return t.filter((e) => e.tipo === 'impostazioni' && !e.annulla).pop()?.id;
  });
  expect(id, 'il cambio è nel registro').toBeTruthy();
  const r = await manda({ tipo: 'CAMBI_ANNULLA', id });
  expect(r && r.ok).toBe(true);
  await expect.poll(() => conto(app, 'annulla_cambio', 'theme', 'interfaccia|s10'), { timeout: 8_000 }).toBe(1);
  // Il rifai annulla l'annullo: non è un ripensamento sul cambio.
  const rifai = await manda({ tipo: 'CAMBI_ANNULLA', id: r.id === id ? (await app.evaluate(async () => (await globalThis.SN_REGISTRO_CAMBI.tutti()).filter((e) => e.annulla).pop()?.id)) : r.id });
  expect(rifai && rifai.ok).toBe(true);
  await new Promise((x) => setTimeout(x, 300));
  expect(Object.values((await gesti(app)).annulla_cambio.theme || {}).reduce((a, n) => a + n, 0)).toBe(1);
});

test('una scheda trascinata nella striscia delle schede si conta come posata', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  await paginaDiProva(openTab, testServer);
  await expect(shell.locator('.tab')).toHaveCount(2, { timeout: 8_000 });
  const prima = await shell.locator('.tab').first().boundingBox();
  const seconda = await shell.locator('.tab').nth(1).boundingBox();
  await shell.mouse.move(prima.x + 20, prima.y + prima.height / 2);
  await shell.mouse.down();
  await shell.mouse.move(prima.x + 40, prima.y + prima.height / 2, { steps: 4 });
  await shell.mouse.move(seconda.x + seconda.width - 10, seconda.y + seconda.height / 2, { steps: 10 });
  await shell.mouse.up();
  await expect.poll(() => conto(app, 'trascinamento', 'scheda', 'striscia_schede|posato'), { timeout: 8_000 }).toBe(1);
});

test('in incognito la barra laterale non conta le sue aperture', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await shell.evaluate(() => window.filoShell.openIncognito());
  await trovaPagina(app, (u) => u.includes('incognito=1'), 15_000);
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => !!BrowserWindow.getAllWindows().find((x) => x._filoTabs && x._filoIncognito)?._filoTabs?.barra), { timeout: 10_000 }).toBe(true);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && x._filoIncognito);
    w._filoTabs.barra.apri('clic');
    w._filoTabs.barra.chiudi();
  });
  await new Promise((r) => setTimeout(r, 500));
  expect(await conto(app, 'barra_aperta', 'clic', 'a_vuoto')).toBe(0);
  // La stessa cosa nella finestra normale si conta: la prova vede davvero il conto.
  await comandaBarra(app, 'clic');
  await comandaBarra(app, 'chiudi');
  await expect.poll(() => conto(app, 'barra_aperta', 'clic', 'a_vuoto'), { timeout: 8_000 }).toBe(1);
});
