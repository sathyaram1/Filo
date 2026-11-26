// Esplorazione, da cancellare: controllo positivo delle prove del giro e foto della pagina con un nome straniero.

import { test, expect } from '../../fixtures/electron.mjs';
import { vistaAvviso, copertura } from '../../helpers/avvisoSito.mjs';
import { paginaDellAiuto } from '../../helpers/riquadri.mjs';
import { fotoDelTurno } from '../../helpers/turniDellAiuto.mjs';

async function preparaModelli(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.HELP]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
}

async function modelloFinto(app, risposta) {
  await app.evaluate((_electron, risposta) => {
    const P = globalThis.SN_PROVIDERS;
    globalThis.__visti = [];
    const finto = async ({ attempts, messages }) => {
      globalThis.__visti.push(JSON.parse(JSON.stringify(messages)));
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text: risposta };
    };
    P.completeWithFallback = finto;
    P.streamCompleteWithFallback = finto;
  }, risposta);
}

async function apriAiuto(app, shell, page) {
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  const aiuto = await paginaDellAiuto(app, page);
  await expect(aiuto.locator('.sn-sidebar')).toBeVisible({ timeout: 8_000 });
  await aiuto.waitForSelector('.sn-sidebar-input textarea', { timeout: 8_000 });
  return aiuto;
}

async function arrivato(app, page) {
  const testo = await app.evaluate(() => JSON.stringify(globalThis.__visti || []));
  return testo.split(new URL(page.url()).origin).join('').replace(/data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/g, '');
}

async function avvisoComparso(app) {
  const coperta = async () => (await copertura(app).catch(() => null))?.coperta === true;
  const fine = Date.now() + 8_000;
  while (!(await coperta())) {
    if (Date.now() > fine) return false;
    await new Promise((r) => setTimeout(r, 100));
  }
  const avviso = await vistaAvviso(app);
  await avviso.getByRole('button', { name: 'Continua' }).click();
  await expect.poll(coperta, { timeout: 6_000 }).toBe(false);
  return true;
}

const modulo = (etichetta, stile = '') => `<!doctype html><html><head><title>Pagamento</title></head><body><h1>Pagamento</h1>
  <form><div><label for="t">Titolare</label> <input id="t"></div>
  <div><label for="c">${etichetta}</label> <input id="c" inputmode="numeric" maxlength="4" style="${stile}"></div>
  <button type="button">Paga</button></form></body></html>`;

for (const nome of ['Cryptogramme visuel', 'Kod bezpieczeństwa', 'Código de seguridad']) {
  test(`controllo: «${nome}» non arriva al modello e fa comparire l'avviso`, async ({ app, shell, openTab, testServer }) => {
    test.setTimeout(60_000);
    const page = await testServer.openReady(openTab, modulo(nome));
    const avviso = await avvisoComparso(app);
    await page.fill('#c', '8264');
    await preparaModelli(app);
    await modelloFinto(app, JSON.stringify({ text: 'Premi «Paga».', status: 'done' }));
    const aiuto = await apriAiuto(app, shell, page);
    await aiuto.fill('.sn-sidebar-input textarea', 'aiutami a pagare');
    await aiuto.press('.sn-sidebar-input textarea', 'Enter');
    await expect(aiuto.locator('.sn-sidebar', { hasText: 'Premi «Paga».' })).toBeVisible({ timeout: 20_000 });
    const testo = await arrivato(app, page);
    expect(testo).toContain(':: #c');
    expect(testo).not.toContain('8264');
    expect(avviso, 'avviso del sito comparso').toBe(true);
  });
}

test('foto: il CVV sotto «Sicherheitscode» è coperto', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, modulo('Sicherheitscode', 'width:200px;font-size:22px'));
  await avvisoComparso(app);
  await preparaModelli(app);
  await modelloFinto(app, JSON.stringify({ text: 'Premi «Paga».', status: 'done' }));
  const aiuto = await apriAiuto(app, shell, page);
  const immagini = [];
  for (const [i, v] of ['8264', '1937'].entries()) {
    await page.fill('#c', v);
    await aiuto.fill('.sn-sidebar-input textarea', 'aiutami a pagare');
    await aiuto.press('.sn-sidebar-input textarea', 'Enter');
    immagini.push(await fotoDelTurno(app, 'aiutami a pagare', i));
  }
  expect(immagini[0]).toMatch(/^data:image\//);
  const diversi = await page.evaluate(async ([a, b]) => {
    const campo = document.querySelector('#c');
    const b0 = campo.getBoundingClientRect();
    const r = { left: b0.left + 3, top: b0.top + 3, width: b0.width - 6, height: b0.height - 6 };
    const pixel = async (url) => {
      const byte = Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), (c) => c.charCodeAt(0));
      const img = await createImageBitmap(new Blob([byte]));
      const cv = document.createElement('canvas');
      cv.width = img.width; cv.height = img.height;
      const ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const sx = img.width / window.innerWidth, sy = img.height / window.innerHeight;
      return ctx.getImageData(Math.round(r.left * sx), Math.round(r.top * sy), Math.round(r.width * sx), Math.round(r.height * sy)).data;
    };
    const [pa, pb] = [await pixel(a), await pixel(b)];
    let n = 0;
    for (let i = 0; i < pa.length; i++) if (pa[i] !== pb[i]) n++;
    return n;
  }, immagini);
  expect(diversi, 'il CVV si legge nella foto').toBe(0);
});
