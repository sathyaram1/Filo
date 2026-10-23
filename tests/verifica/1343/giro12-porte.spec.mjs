// Verifica #1343 giro 12: le porte dei giri passati, ri-provate sul ramo di adesso (le prove vecchie erano uscite col
// riallineamento). Schede a schermo intero, azioni sulla pagina della barra, due ingranaggi, Massimizza.

import { test, expect } from '../../fixtures/electron.mjs';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { barraPage, comandaBarra, pannelloFermo, menuAperto, statoBarra } from '../../helpers/barra.mjs';

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const sito = (t) => `<!doctype html><html><head><title>${t}</title></head><body style="margin:0;padding:40px;font:16px sans-serif;height:1400px"><h1>${t}</h1></body></html>`;
const SITO = '<!doctype html><html><head><title>Prima</title></head><body><h1>Prima</h1></body></html>';
const DALLE_PREFERENZE = { tab: { id: 5, url: 'filo://preferences/preferences.html' }, url: 'filo://preferences/preferences.html' };

const tmEval = (app, fn, arg) => app.evaluate(({ BrowserWindow }, a) => {
  const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs;
  // eslint-disable-next-line no-new-func
  return new Function('tm', 'arg', a.fn)(tm, a.arg);
}, { fn, arg });
const schermoIntero = (app, on) => tmEval(app, 'tm.setContentFullscreen(arg)', on);
const cima = (app) => tmEval(app, 'const t = tm.tabs.find((x) => x.id === tm.activeId); return { y: t.view.getBounds().y, fila: tm.tabRowHeight };');
const schedeInVista = async (app) => { const c = await cima(app); return c.y === c.fila && c.fila > 0; };
const naviga = (app, u) => tmEval(app, 'tm.navigate(tm.activeId, arg)', u);
const appunti = (app) => app.evaluate(({ clipboard }) => clipboard.readText());
const imposta = (app, s) => app.evaluate(async (_e, a) => globalThis.SN_HANDLE_MESSAGE({ type: 'update_settings', settings: a.s }, a.da), { s, da: DALLE_PREFERENZE });
const shellLasciata = (app, x, y) => app.evaluate(({ BrowserWindow }, p) => {
  BrowserWindow.getAllWindows().find((z) => z._filoTabs && !z._filoIncognito).webContents.sendInputEvent({ type: 'mouseLeave', x: p.x, y: p.y });
}, { x: Math.round(x), y: Math.round(y) });

async function scopriLeSchede(app, openTab, testServer) {
  await testServer.openReady(openTab, sito('Prima'));
  const page = await testServer.openReady(openTab, sito('Seconda'));
  await schermoIntero(app, true);
  await pausa(600);
  await page.mouse.move(400, 200);
  await page.mouse.move(400, 0, { steps: 4 });
  await expect.poll(() => schedeInVista(app)).toBe(true);
  return page;
}

async function icona(app, id) {
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  const ico = barra.locator(`#nav .ico[data-id="${id}"]`);
  if (!(await ico.count())) await barra.locator('#nav [data-altro]').click();
  return ico;
}

async function condividiFaODiceDiNo(app, voluto, attesa = 5000) {
  await app.evaluate(({ clipboard }) => clipboard.writeText('niente'));
  const share = await icona(app, 'share');
  if ((await share.getAttribute('aria-disabled')) === 'true') {
    expect(await share.getAttribute('data-sugg'), 'spenta, dice perché').toBeTruthy();
    return;
  }
  expect(voluto, 'qui non c\'è un indirizzo da condividere: Condividi doveva mostrarsi spenta').not.toBeNull();
  await share.click();
  await expect.poll(() => appunti(app), { timeout: attesa, message: 'Condividi accesa: l\'indirizzo arriva negli appunti' }).toBe(voluto);
}

// ---- schede a schermo intero ----

for (const [titolo, dove] of [
  ['giro 6: col menu di una scheda aperto le schede restano', '.tab:has-text("Prima")'],
  ['giro 6: col menu della linguetta della barra aperto le schede restano', '#barra-maniglia'],
]) {
  test(titolo, async ({ app, shell, openTab, testServer }) => {
    await scopriLeSchede(app, openTab, testServer);
    const bersaglio = shell.locator(dove).first();
    const box = await bersaglio.boundingBox();
    await shell.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await bersaglio.click({ button: 'right' });
    const menu = await menuAperto(app);
    expect(menu, 'il menu si apre').not.toBeNull();
    await shellLasciata(app, box.x + box.width / 2, box.y + box.height + 20);
    await menu.mouse.move(20, 20);
    await menu.mouse.move(30, 40, { steps: 3 });
    await pausa(1200);
    expect(await schedeInVista(app), 'col menu aperto le schede non se ne vanno').toBe(true);
  });
}

test('giro 6: con le schede scoperte un clic su un collegamento della pagina lo segue', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;font:16px sans-serif;height:1400px">
    <div style="height:100px"></div><a id="link" href="#arrivato" style="display:inline-block;height:20px;margin-left:200px">vai al capitolo</a>
    <div style="height:400px"></div><h2 id="arrivato">Capitolo</h2></body></html>`);
  await schermoIntero(app, true);
  await expect.poll(async () => (await cima(app)).y).toBe(0);
  await page.mouse.move(400, 200);
  await page.mouse.move(400, 0, { steps: 4 });
  await expect.poll(() => schedeInVista(app)).toBe(true);
  const box = await page.locator('#link').boundingBox();
  const x = box.x + 20;
  const y = box.y + 10;
  const allaPagina = (ev) => tmEval(app, 'tm.tabs.find((x) => x.id === tm.activeId).view.webContents.sendInputEvent(arg)', ev);
  await allaPagina({ type: 'mouseMove', x: Math.round(x), y: Math.round(y) });
  const prima = (await cima(app)).y;
  await allaPagina({ type: 'mouseDown', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
  await pausa(700);
  const salita = prima - (await cima(app)).y;
  await allaPagina({ type: 'mouseUp', x: Math.round(x), y: Math.round(y + salita), button: 'left', clickCount: 1 });
  await expect.poll(() => page.evaluate(() => location.hash), { timeout: 3000 }).toBe('#arrivato');
});

test('giro 7: la barra aperta dalla linguetta delle schede resta ferma sotto il puntatore', async ({ app, shell, openTab, testServer }) => {
  await scopriLeSchede(app, openTab, testServer);
  const maniglia = shell.locator('#barra-maniglia');
  const box = await maniglia.boundingBox();
  await shell.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await maniglia.click();
  const barra = await barraPage(app);
  await expect.poll(async () => (await statoBarra(app)).aperta).toBe(true);
  await pausa(400);
  const prima = await statoBarra(app);
  await shellLasciata(app, box.x + box.width / 2, box.y + box.height + 4);
  const home = await barra.locator('#nav .ico[data-id="home"]').boundingBox();
  const x = home.x + home.width / 2;
  const y = home.y + home.height / 2;
  await barra.mouse.move(x, y, { steps: 3 });
  await pausa(1500);
  const dopo = await statoBarra(app);
  const sotto = await barra.evaluate(([px, py]) => {
    const b = document.elementFromPoint(px, py)?.closest('.ico');
    return b ? b.dataset.id : null;
  }, [x, y + (prima.bounds.y - dopo.bounds.y)]);
  expect(dopo.aperta).toBe(true);
  expect(sotto, 'sotto il puntatore fermo c\'è ancora Home').toBe('home');
});

test('giro 7: il bordo alto di un riquadro a metà pagina non scopre le schede', async ({ app, openTab, testServer }) => {
  const dentro = testServer.html('<!doctype html><html><body style="margin:0;background:#cde;height:100vh">Video incorporato</body></html>', { pubblico: true });
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Articolo</title></head><body style="margin:0;font:16px sans-serif">
    <div style="height:300px;padding:20px">Testo dell'articolo</div>
    <iframe src="${dentro}" style="display:block;width:600px;height:300px;border:0;margin-left:100px"></iframe>
    <div style="height:900px"></div></body></html>`);
  await expect.poll(() => page.frames().length).toBeGreaterThan(1);
  await schermoIntero(app, true);
  await expect.poll(async () => (await cima(app)).y).toBe(0);
  const riquadro = await page.locator('iframe').boundingBox();
  await page.mouse.move(400, riquadro.y + 100);
  await page.mouse.move(400, riquadro.y + 1, { steps: 4 });
  await pausa(1200);
  expect((await cima(app)).y, 'a metà schermo la pagina resta dov\'è').toBe(0);
});

test('giro 11: sopra un riquadro di un altro sito in cima le schede compaiono', async ({ app, openTab, testServer }) => {
  const dentro = testServer.html('<!doctype html><html><body style="margin:0;background:#cde;height:100vh">Pubblicità</body></html>', { pubblico: true });
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Testa</title></head><body style="margin:0">
    <iframe src="${dentro}" style="display:block;width:100%;height:250px;border:0"></iframe><div style="height:1200px">Articolo</div></body></html>`);
  await expect.poll(() => page.frames().length).toBeGreaterThan(1);
  await schermoIntero(app, true);
  await pausa(800);
  await page.mouse.move(400, 150);
  await page.mouse.move(400, 0, { steps: 5 });
  await expect.poll(() => tmEval(app, 'return tm.schedeInAlto.visibili'), { timeout: 4000 }).toBe(true);
});

test('giro 10: il quadrato fra le schede scoperte a schermo intero fa uscire dallo schermo intero', async ({ app, shell, openTab, testServer }) => {
  await scopriLeSchede(app, openTab, testServer);
  const max = shell.locator('#win-max');
  await expect(max).toBeVisible();
  const box = await max.boundingBox();
  await shell.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await max.click();
  await expect.poll(() => tmEval(app, 'return !!tm.contentFullscreen'), { timeout: 3000, message: 'il clic toglie lo schermo intero' }).toBe(false);
});

// ---- azioni sulla pagina della barra ----

test('giro 11: su un sito dove Filo è spento Condividi copia o si spegne dicendo perché', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  await imposta(app, { blocklist: [new URL(page.url()).hostname] });
  await pausa(1500);
  await condividiFaODiceDiNo(app, page.url());
});

test('giro 11: su un PDF Condividi copia o si spegne dicendo perché', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, SITO);
  const url = testServer.asset(readFileSync('tests/fixtures/documenti/documento-con-testo.pdf'), 'application/pdf');
  await naviga(app, url);
  await pausa(3000);
  await condividiFaODiceDiNo(app, url);
});

test('giro 11: su una pagina che sta arrivando Condividi non si perde', async ({ app, openTab, testServer }) => {
  const lento = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.write('<!doctype html><title>Lenta</title><h1>Arriva…</h1>' + ' '.repeat(4096));
    setTimeout(() => res.end('<p>finita</p>'), 6000);
  });
  await new Promise((r) => lento.listen(0, '127.0.0.1', r));
  try {
    await testServer.openReady(openTab, SITO);
    const url = `http://127.0.0.1:${lento.address().port}/lenta`;
    await naviga(app, url);
    await pausa(1500);
    await condividiFaODiceDiNo(app, url, 10_000);
  } finally {
    lento.close();
  }
});

test('giro 11: sulla pagina di un sito che non risponde Condividi copia l\'indirizzo del sito', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, SITO);
  const url = 'http://127.0.0.1:9/irraggiungibile';
  await naviga(app, url);
  await pausa(4000);
  await condividiFaODiceDiNo(app, url);
});

test('giro 11: sulla home Condividi non copia un indirizzo interno', async ({ app }) => {
  await pausa(1500);
  await condividiFaODiceDiNo(app, null);
});

test('giro 11: con «Altro…» aperto Opzioni Filo e Impostazioni hanno icone diverse', async ({ app }) => {
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  await barra.locator('#nav [data-altro]').click();
  const opzioni = barra.locator('#nav .ico[data-id="openOptions"] svg');
  await expect(opzioni).toBeVisible();
  const a = await opzioni.innerHTML();
  const b = await barra.locator('[data-comando="settings"] svg').innerHTML();
  expect(a).not.toBe(b);
});
