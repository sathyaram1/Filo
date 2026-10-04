// #737.1 — Col blocco dei popup acceso una pagina non apre schede né va a schermo pieno senza un gesto vero dell'utente;
// il clic dell'utente (anche in un riquadro di un altro sito) sì, uno per gesto. Regole: gestoPerUnaFinestra in
// src/main/services/permessiPagine.js; lo schermo pieno lo rifiuta Chromium se Filo non regala il gesto.

import { test, expect } from './fixtures/electron.mjs';

const schede = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return tm.tabs.map((t) => { try { return t.view.webContents.getURL(); } catch (_) { return t.url || ''; } });
});
const aperteSu = async (app, u) => (await schede(app)).filter((x) => x.replace(/\?$/, '') === u).length;

// Ogni evaluate di Playwright attiva la pagina come un gesto: le pagine qui chiedono da sole, coi loro timer.
const FORME = {
  'window.open senza misure': 'window.open(u)',
  'window.open con _blank': "window.open(u, '_blank')",
  'link con target _blank premuto dallo script': "var a=document.createElement('a');a.href=u;a.target='_blank';document.body.appendChild(a);a.click()",
  'modulo con target _blank inviato dallo script': "var f=document.createElement('form');f.action=u;f.method='get';f.target='_blank';document.body.appendChild(f);f.submit()",
};

for (const [forma, js] of Object.entries(FORME)) {
  test(`una pagina che apre da sola una scheda (${forma}) viene fermata, e «Apri» la apre`, async ({ app, shell, openTab, testServer, avvisi }) => {
    const bersaglio = testServer.html('<title>DA SOLA</title><p>pubblicità</p>');
    await openTab(testServer.html(`<title>Sito</title><p>articolo</p><script>var u=${JSON.stringify(bersaglio)};setTimeout(function(){${js}},600)</script>`));
    const carta = (await avvisi()).locator('.shell-notif.show', { hasText: 'Bloccato popup da 127.0.0.1' });
    await expect(carta).toBeVisible({ timeout: 8000 });
    expect(await aperteSu(app, bersaglio), 'nessuna scheda nuova senza un clic').toBe(0);

    await carta.locator('.shell-notif-action', { hasText: 'Apri' }).click();
    await expect.poll(() => aperteSu(app, bersaglio), { timeout: 8000 }).toBe(1);
  });
}

test('una pagina che si riapre da sola non riempie Filo di schede, e l\'avviso resta uno', async ({ app, shell, openTab, testServer, avvisi }) => {
  const url = testServer.html('<title>Catena</title><script>setInterval(function(){window.open(location.href)},250)</script>');
  await openTab(url);
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show', { hasText: 'Bloccato popup' })).toBeVisible({ timeout: 8000 });
  await shell.waitForTimeout(2500);
  expect(await aperteSu(app, url)).toBe(1);
  await expect(vista.locator('.shell-notif', { hasText: 'Bloccato popup' })).toHaveCount(1);
});

test('il clic dell\'utente apre la scheda che chiede, una sola per clic', async ({ app, openTab, testServer }) => {
  const prima = testServer.html('<title>PRIMA</title>');
  const seconda = testServer.html('<title>SECONDA</title>');
  const collegata = testServer.html('<title>LINK</title>');
  const page = await openTab(testServer.html(`<button id="b" style="width:200px;height:60px"
    onclick="window.open(${JSON.stringify(prima).replace(/"/g, '&quot;')});window.open(${JSON.stringify(seconda).replace(/"/g, '&quot;')})">apri</button>
    <a id="l" href="${collegata}" target="_blank">link</a>`));
  await page.click('#b');
  await expect.poll(() => aperteSu(app, prima), { timeout: 8000 }).toBe(1);
  await page.waitForTimeout(800);
  expect(await aperteSu(app, seconda), 'la seconda finestra dello stesso clic non passa').toBe(0);

  await page.click('#l');
  await expect.poll(() => aperteSu(app, collegata), { timeout: 8000 }).toBe(1);
});

test('un clic lento come quello di una persona apre una scheda sola, anche se la pagina ne chiede alla pressione e al clic', async ({ app, openTab, testServer }) => {
  const a = testServer.html('<title>PRESSIONE</title>');
  const b = testServer.html('<title>CLIC</title>');
  const page = await openTab(testServer.html(`<div id="z" style="width:400px;height:300px">zona</div><script>
    document.addEventListener('mousedown',function(){window.open(${JSON.stringify(a)})});
    document.addEventListener('click',function(){window.open(${JSON.stringify(b)})});</script>`));
  await page.mouse.move(100, 100);
  await page.mouse.down();
  await page.waitForTimeout(150);
  await page.mouse.up();
  await expect.poll(() => aperteSu(app, a), { timeout: 8000 }).toBe(1);
  await page.waitForTimeout(1500);
  expect(await aperteSu(app, b), 'il rilascio dello stesso clic non apre la seconda').toBe(0);
});

test('il clic dentro un riquadro di un altro sito apre la sua scheda; da solo il riquadro non apre niente', async ({ app, openTab, testServer }) => {
  const daSolo = testServer.html('<title>RIQUADRO DA SOLO</title>');
  const colClic = testServer.html('<title>RIQUADRO COL CLIC</title>');
  const dentro = testServer.html(`<button id="b" style="width:200px;height:60px"
    onclick="window.open(${JSON.stringify(colClic).replace(/"/g, '&quot;')})">apri</button>
    <script>setTimeout(function(){window.open(${JSON.stringify(daSolo)})},600)</script>`, { pubblico: true });
  const page = await openTab(testServer.html(`<title>Ospite</title><iframe src="${dentro}" width="400" height="200"></iframe>`));
  await expect.poll(() => page.frames().some((f) => f.url() === dentro), { timeout: 8000 }).toBe(true);
  await page.waitForTimeout(1500);
  expect(await aperteSu(app, daSolo)).toBe(0);

  await page.frames().find((f) => f.url() === dentro).click('#b');
  await expect.poll(() => aperteSu(app, colClic), { timeout: 8000 }).toBe(1);
});

test('col blocco spento la scheda che la pagina apre da sola passa', async ({ app, openTab, testServer }) => {
  await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    tm.security.blockPopups = false;
  });
  const bersaglio = testServer.html('<title>PASSA</title>');
  await openTab(testServer.html(`<script>setTimeout(function(){window.open(${JSON.stringify(bersaglio)})},400)</script>`));
  await expect.poll(() => aperteSu(app, bersaglio), { timeout: 8000 }).toBe(1);
});

const SCHERMO = (dopo) => `<button id="b" style="width:200px;height:60px">schermo intero</button>
  <script>window.__fs=[];function chiedi(){document.documentElement.requestFullscreen().then(function(){window.__fs.push('si')},function(){window.__fs.push('no')})}
  document.getElementById('b').addEventListener('click',chiedi);${dopo ? `setTimeout(chiedi,${dopo})` : ''}</script>`;

test('lo schermo intero lo prende solo il clic dell\'utente, anche dentro un riquadro di un altro sito', async ({ openTab, testServer }) => {
  const dentro = testServer.html(SCHERMO(0), { pubblico: true });
  const page = await openTab(testServer.html(`${SCHERMO(600)}<iframe src="${dentro}" allow="fullscreen" width="400" height="200"></iframe>`));
  await page.waitForTimeout(1800);
  expect(await page.evaluate(() => [window.__fs, !!document.fullscreenElement]), 'rifiutato, non lasciato in sospeso').toEqual([['no'], false]);

  await page.click('#b');
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement), { timeout: 6000 }).toBe(true);
  await page.evaluate(() => document.exitFullscreen());
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement), { timeout: 6000 }).toBe(false);

  const riquadro = page.frames().find((f) => f.url() === dentro);
  await riquadro.click('#b');
  await expect.poll(() => riquadro.evaluate(() => !!document.fullscreenElement), { timeout: 6000 }).toBe(true);
});

test('una scorciatoia di Filo premuta sulla pagina non le regala la scheda che apre da sola', async ({ app, openTab, testServer }) => {
  const bersaglio = testServer.html('<title>DA SOLA</title>');
  await openTab(testServer.html(`<title>Sito</title><script>setTimeout(function(){window.open(${JSON.stringify(bersaglio)})},2000)</script>`));
  // Dalla tastiera vera, come arriva al main: prima il Ctrl da solo, poi la T.
  await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const wc = tm.tabs.find((t) => t.id === tm.activeId).view.webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Control', modifiers: ['control'] });
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'T', modifiers: ['control'] });
  });
  await expect.poll(async () => (await schede(app)).filter((u) => u.startsWith('filo://newtab')).length, { timeout: 6000 }).toBeGreaterThan(0);
  await new Promise((r) => setTimeout(r, 2500));
  expect(await aperteSu(app, bersaglio)).toBe(0);
});

const finestreSu = (app, pezzo) => app.evaluate(({ BrowserWindow }, p) => BrowserWindow.getAllWindows()
  .filter((w) => { try { return w.webContents.getURL().includes(p); } catch (_) { return false; } }).length, pezzo);

test('una finestra di accesso la apre solo il clic: da sola la pagina non apre nemmeno quella', async ({ app, openTab, testServer, avvisi }) => {
  const accesso = `${testServer.html('<title>ACCESSO</title>')}?client_id=a&response_type=code`;
  const page = await openTab(testServer.html(`<button id="b" style="width:200px;height:60px"
    onclick="window.open(${JSON.stringify(accesso).replace(/"/g, '&quot;')}, 'login', 'width=400,height=500')">Accedi</button>
    <script>setTimeout(function(){window.open(${JSON.stringify(accesso)})},600)</script>`));
  await expect((await avvisi()).locator('.shell-notif.show', { hasText: 'Bloccato popup' })).toBeVisible({ timeout: 8000 });
  expect(await finestreSu(app, 'client_id=a')).toBe(0);
  expect(await aperteSu(app, accesso)).toBe(0);

  await page.click('#b');
  await expect.poll(() => finestreSu(app, 'client_id=a'), { timeout: 8000 }).toBe(1);
});

// Giro 3: il gesto è di chi l'ha ricevuto, l'avviso si chiude, «Apri» rifà l'accesso dalla pagina, la forma non conta.
test('il clic sull\'articolo non vale per il riquadro pubblicitario di un altro sito che prova ad aprire schede', async ({ app, openTab, testServer }) => {
  const bersaglio = testServer.html('<title>PUBBLICITA</title>');
  const ad = testServer.html(`<p>ad</p><script>setInterval(function(){window.open(${JSON.stringify(bersaglio)})},300)</script>`, { pubblico: true });
  const page = await openTab(testServer.html(`<title>Articolo</title><p style="height:200px">testo da leggere</p><iframe src="${ad}" width="300" height="100"></iframe>`));
  await expect.poll(() => page.frames().some((f) => f.url() === ad), { timeout: 8000 }).toBe(true);
  await page.waitForTimeout(1000);
  await page.mouse.click(50, 50);
  await page.keyboard.press('a');
  await page.waitForTimeout(2000);
  expect(await aperteSu(app, bersaglio)).toBe(0);
});

test('chiuso l\'avviso di una pagina che riprova di continuo, non torna finché si resta su quella pagina', async ({ openTab, testServer, avvisi }) => {
  await openTab(testServer.html('<title>Catena</title><p>articolo</p><script>setInterval(function(){window.open(location.href)},700)</script>'));
  const vista = await avvisi();
  const carta = vista.locator('.shell-notif.show', { hasText: 'Bloccato popup' });
  await expect(carta).toBeVisible({ timeout: 8000 });
  await carta.locator('.shell-notif-close').click();
  await new Promise((r) => setTimeout(r, 3000));
  await expect(vista.locator('.shell-notif.show', { hasText: 'Bloccato popup' })).toHaveCount(0);
});

test('«Apri» su una finestra di accesso bloccata la fa aprire alla pagina, collegata a lei', async ({ app, openTab, testServer, avvisi }) => {
  const accesso = `${testServer.html('<title>ACCESSO</title><script>document.title = window.opener ? "COLLEGATA" : "STACCATA"</script>')}?client_id=z&response_type=code`;
  await openTab(testServer.html(`<title>Sito</title><script>setTimeout(function(){window.open(${JSON.stringify(accesso)}, 'login', 'width=400,height=500')},1500)</script>`));
  const carta = (await avvisi()).locator('.shell-notif.show', { hasText: 'Bloccato popup' });
  await expect(carta).toBeVisible({ timeout: 10000 });
  await carta.locator('.shell-notif-action', { hasText: 'Apri' }).click();
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
    .filter((w) => { try { return w.webContents.getURL().includes('client_id=z'); } catch (_) { return false; } })
    .map((w) => w.webContents.getTitle()).join()), { timeout: 8000 }).toBe('COLLEGATA');
  expect(await aperteSu(app, accesso)).toBe(0);
});

test('il clic che chiede una finestra con le misure la apre', async ({ app, openTab, testServer }) => {
  const condividi = testServer.html('<title>CONDIVIDI</title>');
  const page = await openTab(testServer.html(`<button id="b" style="width:200px;height:60px"
    onclick="window.open(${JSON.stringify(condividi).replace(/"/g, '&quot;')}, 'share', 'width=600,height=400')">Condividi</button>`));
  await page.click('#b');
  await expect.poll(() => aperteSu(app, condividi), { timeout: 8000 }).toBe(1);
});

test('Maiuscolo+clic su un link lo apre', async ({ app, openTab, testServer }) => {
  const collegata = testServer.html('<title>LINK</title>');
  const page = await openTab(testServer.html(`<a id="l" href="${collegata}" style="font-size:40px">link</a>`));
  await page.click('#l', { modifiers: ['Shift'] });
  await expect.poll(() => aperteSu(app, collegata), { timeout: 8000 }).toBe(1);
});

test('senza clic una pagina non apre il programma di posta; col clic sì', async ({ app, openTab, testServer, avvisi }) => {
  await app.evaluate(({ shell }) => { globalThis.__esterni = []; shell.openExternal = async (u) => { globalThis.__esterni.push(u); }; });
  const page = await openTab(testServer.html(`<a id="m" href="mailto:x@y.it" style="position:fixed;left:0;top:0;width:200px;height:60px;display:block">scrivici</a>
    <script>setTimeout(function(){window.open('mailto:a@b.it')},500);setTimeout(function(){location.href='mailto:c@d.it'},1200)</script>`));
  await expect((await avvisi()).locator('.shell-notif.show', { hasText: 'Bloccata la posta aperta da 127.0.0.1' })).toBeVisible({ timeout: 8000 });
  await page.waitForTimeout(1500);
  expect(await app.evaluate(() => globalThis.__esterni)).toEqual([]);
  // Col mouse su un punto noto: la navigazione verso mailto: fermata non finisce mai, e un locator la aspetterebbe.
  await page.mouse.click(50, 30);
  await expect.poll(() => app.evaluate(() => globalThis.__esterni), { timeout: 6000 }).toEqual(['mailto:x@y.it']);
});

// Giro 4: posta, telefono e SMS non sono un sito, e l'avviso non mostra l'indirizzo come se lo fosse.
for (const [indirizzo, testo] of [
  ['mailto:a@b.it', 'Bloccata la posta aperta da 127.0.0.1'],
  ['tel:+390612345', 'Bloccata la chiamata avviata da 127.0.0.1'],
  ['sms:+390612345', "Bloccato l'SMS aperto da 127.0.0.1"],
]) {
  test(`l'avviso di ${indirizzo.split(':')[0]} aperto da solo nomina il sito che ci ha provato e l'app, e «Apri» la apre`, async ({ app, openTab, testServer, avvisi }) => {
    await app.evaluate(({ shell }) => { globalThis.__esterni = []; shell.openExternal = async (u) => { globalThis.__esterni.push(u); }; });
    await openTab(testServer.html(`<title>Sito</title><p>x</p><script>setTimeout(function(){window.open(${JSON.stringify(indirizzo)})},600)</script>`));
    const carta = (await avvisi()).locator('.shell-notif.show', { hasText: testo });
    await expect(carta).toBeVisible({ timeout: 8000 });
    expect(await carta.innerText()).not.toContain(indirizzo);
    await carta.locator('.shell-notif-action', { hasText: 'Apri' }).click();
    await expect.poll(() => app.evaluate(() => globalThis.__esterni), { timeout: 6000 }).toEqual([indirizzo]);
  });
}

// Giro 6: su una pagina che spende ogni clic per una sua pubblicità, ciò che l'utente ha scelto si apre lo stesso, e il
// menu di Filo (disegnato sulla pagina) non è un clic dato a lei.
const PUBBLICITA = "document.addEventListener('mousedown',function(){window.open(AD)})";
for (const [nome, opz] of Object.entries({ 'il clic centrale': { button: 'middle' }, 'Ctrl+clic': { modifiers: ['Control'] }, 'il clic su un link che apre una scheda': {} })) {
  test(`${nome} apre il collegamento anche se la pagina apre una pubblicità a ogni clic`, async ({ app, openTab, testServer }) => {
    const ad = testServer.html('<title>AD</title>');
    const dest = testServer.html('<title>DEST</title>');
    const blank = nome.includes('scheda') ? 'target="_blank"' : '';
    const page = await testServer.openReady(openTab, `<!doctype html><body style="padding:24px"><a id="l" href="${dest}" ${blank}>collegamento</a>
      <script>var AD=${JSON.stringify(ad)};${PUBBLICITA}</script></body>`);
    await page.waitForTimeout(5600);
    await page.locator('#l').click(opz);
    await expect.poll(() => aperteSu(app, dest), { timeout: 6000 }).toBe(1);
  });
}

test('«Apri in nuova tab» del menu di Filo apre il collegamento anche se la pagina apre una pubblicità a ogni clic', async ({ app, openTab, testServer }) => {
  const ad = testServer.html('<title>AD</title>');
  const dest = testServer.html('<title>DEST</title>');
  const page = await testServer.openReady(openTab, `<!doctype html><body style="padding:24px"><a id="l" href="${dest}">collegamento</a>
    <script>var AD=${JSON.stringify(ad)};${PUBBLICITA}</script></body>`);
  await page.locator('#l').click({ button: 'right', position: { x: 8, y: 8 } });
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible();
  await page.waitForTimeout(5600);
  await menu.locator('button', { hasText: 'Apri in nuova tab' }).first().click();
  await expect.poll(() => aperteSu(app, dest), { timeout: 6000 }).toBe(1);
});

test('scegliere «Copia URL» nel menu di Filo non lascia alla pagina aprire la sua pubblicità', async ({ app, openTab, testServer }) => {
  const ad = testServer.html('<title>AD</title>');
  const page = await testServer.openReady(openTab, `<!doctype html><body style="padding:24px"><a id="l" href="https://example.com/x">collegamento</a>
    <script>var AD=${JSON.stringify(ad)};document.addEventListener('click',function(){window.open(AD)},true)</script></body>`);
  await page.locator('#l').click({ button: 'right', position: { x: 8, y: 8 } });
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible();
  await page.waitForTimeout(5600);
  await menu.locator('button', { hasText: 'Copia URL' }).first().click();
  await page.waitForTimeout(2000);
  expect(await aperteSu(app, ad), 'nessuna pubblicità dal clic sul menu di Filo').toBe(0);
});

test('un collegamento di posta cliccato apre il programma di posta anche se la pagina apre una pubblicità a ogni clic', async ({ app, openTab, testServer }) => {
  await app.evaluate(({ shell }) => { globalThis.__esterni = []; shell.openExternal = async (u) => { globalThis.__esterni.push(u); }; });
  const ad = testServer.html('<title>AD</title>');
  const page = await testServer.openReady(openTab, `<!doctype html><body style="padding:24px"><a id="l" href="mailto:x@y.it">scrivici</a>
    <script>var AD=${JSON.stringify(ad)};${PUBBLICITA}</script></body>`);
  await page.waitForTimeout(5600);
  await page.locator('#l').click({ noWaitAfter: true });
  await expect.poll(() => app.evaluate(() => globalThis.__esterni), { timeout: 6000 }).toEqual(['mailto:x@y.it']);
});

test('il pulsante di un modulo che apre una scheda la apre anche se la pagina apre una pubblicità a ogni clic', async ({ app, openTab, testServer }) => {
  const ad = testServer.html('<title>AD</title>');
  const dest = testServer.html('<title>DEST</title>');
  const page = await testServer.openReady(openTab, `<!doctype html><body style="padding:24px">
    <form action="${dest}" method="get" target="_blank"><input name="q" value="ciao mondo"><button id="b">Cerca</button></form>
    <script>var AD=${JSON.stringify(ad)};${PUBBLICITA}</script></body>`);
  await page.waitForTimeout(5600);
  await page.locator('#b').click();
  await expect.poll(async () => (await schede(app)).filter((x) => x.startsWith(`${dest}?q=ciao`)).length, { timeout: 6000 }).toBe(1);
});
