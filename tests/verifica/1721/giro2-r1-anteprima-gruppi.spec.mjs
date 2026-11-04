// Verifica #1721 giro 2, rilievo 1: l'anteprima della carta coi gruppi di cifre distanziati (uno per elemento, sparsi
// sulla larghezza della carta disegnata) arriva leggibile al modello dell'Aiuto.

import { test, expect } from '../../fixtures/electron.mjs';
import { paginaDellAiuto } from '../../helpers/riquadri.mjs';
import { vistaAvviso, copertura } from '../../helpers/avvisoSito.mjs';

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

const ROSA = [0xc9, 0x25, 0x85];
const tinta = ([r, g, b]) => `rgb(${r},${g},${b})`;

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

test('r1 l’anteprima della carta coi gruppi di cifre distribuiti sulla carta disegnata non si legge nella foto per l’Aiuto', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Pagamento</title></head><body>
    <div style="width:380px;height:220px;border-radius:14px;background:#333;padding:24px;box-sizing:border-box">
      <div id="numero" style="display:flex;justify-content:space-between;margin-top:90px;font:22px monospace">
        <span style="background:${tinta(ROSA)};color:#fff">####</span><span style="background:${tinta(ROSA)};color:#fff">####</span>
        <span style="background:${tinta(ROSA)};color:#fff">####</span><span style="background:${tinta(ROSA)};color:#fff">####</span></div></div>
    <form><label for="c">Numero della carta</label> <input id="c" autocomplete="cc-number" style="width:280px;font-size:18px"></form>
    <script>document.getElementById('c').addEventListener('input', (e) => {
      const g = (e.target.value.replace(/\\D/g, '') + '################').slice(0, 16).match(/.{4}/g);
      document.querySelectorAll('#numero span').forEach((s, i) => { s.textContent = g[i]; });
    });</script></body></html>`);
  await superaAvvisoSeCe(app);
  await page.fill('#c', '4111 1111 1111 1111');
  await expect(page.locator('#numero')).toContainText('1111');
  const { immagine } = await chiediAllAiuto(app, shell, page);
  expect(immagine).toMatch(/^data:image\/jpeg/);
  const n = await pixelDelColore(app, immagine, ROSA);
  expect(n, 'il numero della carta si legge nell’anteprima').toBeLessThan(20);
});
