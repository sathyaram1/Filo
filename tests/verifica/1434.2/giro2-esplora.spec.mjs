// Esplorazione del giro 2 di #1434.2: stampa quello che si vede, non asserisce.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const ids = (menu, sel) => menu.locator(sel).evaluateAll((els) => els.map((e) => `${e.dataset.snIconId}|${e.getAttribute('aria-label')}|${e.dataset.snDisabled || ''}`));
const voci = (menu) => menu.locator('.sn-menu:not(.sn-menu-sub) .sn-menu-item:visible').evaluateAll((els) => els.map((e) => e.textContent.trim().slice(0, 40)));
const appunti = (app) => app.evaluate(({ clipboard }) => clipboard.readText());
const esegui = (app, azione) => app.evaluate((_e, a) => globalThis.SN_EXECUTE_FILO_ACTION(a), azione);

const CAMPO = 'display:block;width:300px;margin-top:16px;font:16px sans-serif';
const CAMPI = `<!doctype html><html><head><title>Campi</title></head><body style="margin:0;padding:40px">
  <input id="mail" type="email" value="mario@posta.it" style="${CAMPO}">
  <input id="segreta" type="password" value="segreta123" style="${CAMPO}">
  <input id="sola" type="text" readonly value="solo lettura" style="${CAMPO}">
  <textarea id="area" style="${CAMPO};height:50px">riga uno
riga due</textarea>
  <div id="ricco" contenteditable="true" style="${CAMPO};border:1px solid #888">testo ricco qui</div>
  <video id="vid" width="240" height="120" style="background:#000" controls disablepictureinpicture></video>
  <audio id="aud" controls style="display:block;margin-top:20px"></audio>
  </body></html>`;

async function dump(label, menu) {
  const fila = await ids(menu, '.sn-menu-row .sn-menu-row-btn[data-sn-icon-id]');
  let griglia = [];
  if (await menu.locator('.sn-menu-row .sn-menu-row-overflow').isVisible().catch(() => false)) {
    await menu.locator('.sn-menu-row .sn-menu-row-overflow').click();
    await pausa(300);
    griglia = await ids(menu, '.sn-menu-icon-grid [data-sn-icon-id]');
  }
  console.log(`== ${label}\n fila: ${JSON.stringify(fila)}\n +: ${JSON.stringify(griglia)}\n voci: ${JSON.stringify(await voci(menu))}`);
}

test('esplora campi', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const page = await testServer.openReady(openTab, CAMPI);
  const menu = menuDi(page);

  // Email: un pezzo selezionato col doppio clic, Ctrl+X del sistema come metro.
  const r = await page.locator('#mail').boundingBox();
  await page.mouse.dblclick(r.x + 80, r.y + r.height / 2);
  await page.keyboard.press('Control+x');
  const nativo = { valore: await page.locator('#mail').inputValue(), appunti: await appunti(app) };
  await page.keyboard.press('Control+z');
  console.log('email nativo', JSON.stringify(nativo), 'dopo z', await page.locator('#mail').inputValue());
  await app.evaluate(({ clipboard }) => clipboard.writeText('prima'));
  await page.mouse.dblclick(r.x + 80, r.y + r.height / 2);
  await page.mouse.click(r.x + 80, r.y + r.height / 2, { button: 'right' });
  await expect(menu.principale).toBeVisible();
  console.log('email fila', JSON.stringify(await ids(menu, '.sn-menu-row .sn-menu-row-btn[data-sn-icon-id]')));
  await menu.locator('.sn-menu-row [data-sn-icon-id="campo:cut"]').click();
  await pausa(500);
  console.log('email filo', JSON.stringify({ valore: await page.locator('#mail').inputValue(), appunti: await appunti(app) }));
  await page.keyboard.press('Control+z');
  await pausa(200);
  console.log('email filo dopo z', await page.locator('#mail').inputValue());

  // Copia di un pezzo dell'email.
  await page.locator('#mail').fill('mario@posta.it');
  await page.mouse.dblclick(r.x + 80, r.y + r.height / 2);
  await page.mouse.click(r.x + 80, r.y + r.height / 2, { button: 'right' });
  await menu.voce('Copia').first().click();
  await pausa(400);
  console.log('email copia voce', await appunti(app));

  for (const sel of ['#segreta', '#sola']) {
    await page.locator(sel).focus();
    await page.keyboard.press('Control+a');
    await page.locator(sel).click({ button: 'right', position: { x: 12, y: 8 } });
    await expect(menu.principale).toBeVisible();
    await dump(sel, menu);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await pausa(200);
  }

  // Area di testo su due righe: Taglia dalla fila e Ctrl+Z.
  await page.locator('#area').focus();
  await page.keyboard.press('Control+a');
  await page.locator('#area').click({ button: 'right', position: { x: 12, y: 8 } });
  await menu.locator('.sn-menu-row [data-sn-icon-id="campo:cut"]').click();
  await pausa(400);
  console.log('area dopo taglia', JSON.stringify(await page.locator('#area').inputValue()), JSON.stringify(await appunti(app)));
  await page.keyboard.press('Control+z');
  await pausa(200);
  console.log('area dopo z', JSON.stringify(await page.locator('#area').inputValue()));

  // Campo ricco: Taglia dalla fila (nel «+»?) o dalla voce, e Ctrl+Z.
  await page.locator('#ricco').focus();
  await page.keyboard.press('Control+a');
  await page.locator('#ricco').click({ button: 'right', position: { x: 12, y: 8 } });
  await dump('ricco', menu);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.locator('#ricco').focus();
  await page.keyboard.press('Control+a');
  await page.locator('#ricco').click({ button: 'right', position: { x: 12, y: 8 } });
  await menu.voce('Taglia').first().click();
  await pausa(400);
  console.log('ricco dopo taglia', JSON.stringify(await page.locator('#ricco').innerHTML()));
  await page.keyboard.press('Control+z');
  await pausa(200);
  console.log('ricco dopo z', JSON.stringify(await page.locator('#ricco').innerHTML()));

  // Filmato senza finestra mobile, e audio.
  await page.locator('#vid').click({ button: 'right' });
  await expect(menu.principale).toBeVisible();
  await dump('video', menu);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.locator('#aud').click({ button: 'right' });
  await expect(menu.principale).toBeVisible();
  await dump('audio', menu);
  await page.keyboard.press('Escape');
});

test('esplora finestra e parole', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  for (const a of [
    { type: 'SPOSTA_ICONA', icona: 'forward', dove: 'menu', contesto: 'pagina' },
    { type: 'SPOSTA_ICONA', icona: 'back', dove: 'fila', contesto: 'pagina' },
    { type: 'SPOSTA_ICONA', icona: 'reload', dove: 'altro_fila', contesto: 'pagina' },
    { type: 'SPOSTA_ICONA', icona: 'testo:copy', dove: 'barra' },
    { type: 'SPOSTA_ICONA', icona: 'home', dove: 'fila' },
  ]) console.log('parole', JSON.stringify(a), '->', JSON.stringify(await esegui(app, a)));
  console.log('layout', JSON.stringify(await app.evaluate(async () => globalThis.SN_LAYOUT_ICONE.leggi())));
  const seconda = testServer.html('<!doctype html><html><head><title>Seconda</title></head><body style="height:900px"><div id="vuoto" style="height:400px"></div></body></html>');
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Prima</title></head>
    <body style="margin:0;padding:40px;height:900px"><a id="vai" href="${seconda}">avanti</a><div id="vuoto" style="height:400px"></div></body></html>`);
  const menu = menuDi(page);
  await page.locator('#vuoto').click({ button: 'right' });
  await expect(menu.principale).toBeVisible();
  await dump('pagina nuova', menu);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.locator('#vai').click();
  await page.waitForURL(seconda);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  await page.locator('#vuoto').click({ button: 'right' });
  await expect(menu.principale).toBeVisible();
  console.log('seconda', JSON.stringify(await ids(menu, '.sn-menu-row .sn-menu-row-btn[data-sn-icon-id]')));
  await menu.locator('.sn-menu-row [data-sn-icon-id="back"]').click();
  await pausa(1500);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  console.log('dopo indietro', page.url());
  await page.locator('#vuoto').click({ button: 'right' });
  await expect(menu.principale).toBeVisible();
  console.log('prima di nuovo', JSON.stringify(await ids(menu, '.sn-menu-row .sn-menu-row-btn[data-sn-icon-id]')));
  const avanti = menu.locator('.sn-menu-row [data-sn-icon-id="forward"]');
  if (await avanti.count()) {
    await avanti.click();
    await pausa(1500);
    console.log('dopo avanti', page.url());
  }
  const att = await app.evaluate(async () => {
    const s = await globalThis.chrome.storage.local.get(null);
    return Object.keys(s).filter((k) => /attivit|activity|registro/i.test(k));
  });
  console.log('chiavi attività', JSON.stringify(att));
});
