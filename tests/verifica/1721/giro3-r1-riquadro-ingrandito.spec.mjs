// Verifica #1721 giro 3, rilievo 1: dentro un riquadro della stessa origine ingrandito dallo stile della pagina (transform),
// la copertura cade fuori posto e quello che doveva coprire arriva leggibile al modello dell'Aiuto.

import { test, expect } from '../../fixtures/electron.mjs';
import { paginaDellAiuto } from '../../helpers/riquadri.mjs';
import { vistaAvviso, copertura } from '../../helpers/avvisoSito.mjs';

const ROSA = [0xc9, 0x25, 0x85];
const tinta = ([r, g, b]) => `rgb(${r},${g},${b})`;

async function superaAvvisoSeCe(app) {
  const coperta = async () => (await copertura(app).catch(() => null))?.coperta === true;
  const fine = Date.now() + 4_000;
  while (!(await coperta())) {
    if (Date.now() > fine) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  await (await vistaAvviso(app)).getByRole('button', { name: 'Continua' }).click();
  await expect.poll(coperta, { timeout: 6_000 }).toBe(false);
}

async function aiutoFinto(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.HELP]: 'deepseek-flash' }, modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const P = globalThis.SN_PROVIDERS;
    globalThis.__visti = [];
    const finto = async ({ attempts, messages }) => {
      globalThis.__visti.push(JSON.parse(JSON.stringify(messages)));
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text: JSON.stringify({ text: 'Ok.', status: 'done' }) };
    };
    P.completeWithFallback = finto;
    P.streamCompleteWithFallback = finto;
  });
}

async function chiediAllAiuto(app, shell, page) {
  await aiutoFinto(app);
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  const aiuto = await paginaDellAiuto(app, page);
  await aiuto.waitForSelector('.sn-sidebar-input textarea', { timeout: 8_000 });
  await aiuto.fill('.sn-sidebar-input textarea', 'aiutami');
  await aiuto.press('.sn-sidebar-input textarea', 'Enter');
  await expect.poll(() => app.evaluate(() => globalThis.__visti.length), { timeout: 20_000 }).toBeGreaterThan(0);
  return app.evaluate(() => {
    const utente = [...globalThis.__visti[0]].reverse().find((m) => m.role === 'user');
    const parti = Array.isArray(utente.content) ? utente.content : [{ type: 'text', text: utente.content }];
    const img = parti.find((p) => p.type === 'image_url');
    return { immagine: img ? img.image_url.url : null, testi: parti.filter((p) => p.type === 'text').map((p) => p.text) };
  });
}

async function pixelDelColore(app, dataUrl, rgb, tol = 40) {
  return app.evaluate(({ nativeImage }, { u, c, tol: t }) => {
    const b = nativeImage.createFromDataURL(u).toBitmap();
    let n = 0;
    for (let i = 0; i < b.length; i += 4) {
      if (Math.abs(b[i + 2] - c[0]) <= t && Math.abs(b[i + 1] - c[1]) <= t && Math.abs(b[i] - c[2]) <= t) n++;
    }
    return n;
  }, { u: dataUrl, c: rgb, tol });
}

test('r1 un riquadro di un altro sito dentro un riquadro dello stesso sito ingrandito resta scoperto', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const altro = testServer.html(`<!doctype html><body style="margin:0;background:${tinta(ROSA)}">Saldo 1.234</body>`, { pubblico: true });
  const stesso = testServer.html(`<!doctype html><body style="margin:0"><iframe id="x" src="${altro}" style="width:150px;height:100px;border:0;display:block"></iframe></body>`);
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Conto</title></head><body style="margin:0">
    <h1>Il tuo conto</h1>
    <iframe id="stesso" src="${stesso}" style="width:150px;height:100px;border:0;transform:scale(2.5);transform-origin:0 0"></iframe></body></html>`);
  await expect(page.frameLocator('#stesso').frameLocator('#x').locator('body')).toContainText('Saldo', { timeout: 10_000 });
  const { immagine } = await chiediAllAiuto(app, shell, page);
  expect(immagine, 'al modello deve arrivare la foto della pagina').toMatch(/^data:image\/jpeg/);
  expect(await pixelDelColore(app, immagine, ROSA), 'il riquadro dell’altro sito si vede nella foto').toBeLessThan(20);
});

test('r1 il numero della carta in un riquadro dello stesso sito ingrandito resta scoperto', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const modulo = testServer.html(`<!doctype html><body style="margin:0"><form><input id="c" name="q" style="width:150px;font:bold 16px monospace;color:${tinta(ROSA)};background:#fff;border:0;outline:0;caret-color:transparent"></form></body>`);
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Pagamento</title></head><body style="margin:0">
    <h1>Pagamento</h1>
    <iframe id="modulo" src="${modulo}" style="width:160px;height:40px;border:0;transform:scale(2.5);transform-origin:0 0"></iframe></body></html>`);
  await superaAvvisoSeCe(app);
  const campo = page.frameLocator('#modulo').locator('#c');
  await campo.fill('4111 1111 1111 1111');
  await campo.blur();
  const { immagine } = await chiediAllAiuto(app, shell, page);
  expect(immagine, 'al modello deve arrivare la foto della pagina').toMatch(/^data:image\/jpeg/);
  expect(await pixelDelColore(app, immagine, ROSA), 'il numero della carta si legge nella foto').toBeLessThan(20);
});
