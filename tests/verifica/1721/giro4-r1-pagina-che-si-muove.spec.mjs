// Verifica #1721 giro 4, rilievo 1: se la pagina si muove mentre l'Aiuto la fotografa (chi scorre con la rotella), le
// coperture stanno dove i riquadri erano alla misura e non dove sono nella foto: al modello arriva quello che coprivano.

import { test, expect } from '../../fixtures/electron.mjs';
import { paginaDellAiuto } from '../../helpers/riquadri.mjs';
import { vistaAvviso, copertura } from '../../helpers/avvisoSito.mjs';

const ROSA = [0xc9, 0x25, 0x85];
const tinta = ([r, g, b]) => `rgb(${r},${g},${b})`;
const TURNI = 6;

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

// Più domande di fila all'Aiuto, mentre la pagina si muove: le foto arrivate al modello, una per domanda.
async function fotoDiPiuDomande(app, shell, page) {
  await aiutoFinto(app);
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  const aiuto = await paginaDellAiuto(app, page);
  await aiuto.waitForSelector('.sn-sidebar-input textarea', { timeout: 8_000 });
  for (let i = 1; i <= TURNI; i++) {
    await aiuto.fill('.sn-sidebar-input textarea', `aiutami ${i}`);
    await aiuto.press('.sn-sidebar-input textarea', 'Enter');
    await expect.poll(() => app.evaluate(() => globalThis.__visti.length), { timeout: 20_000 }).toBeGreaterThanOrEqual(i);
    await expect(aiuto.locator('.sn-sidebar-input textarea')).toBeEditable({ timeout: 10_000 });
  }
  return app.evaluate(() => globalThis.__visti.map((msgs) => {
    const utente = [...msgs].reverse().find((m) => m.role === 'user');
    const parti = Array.isArray(utente.content) ? utente.content : [];
    const img = parti.find((p) => p.type === 'image_url');
    return img ? img.image_url.url : null;
  }));
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

test('r1 mentre la pagina scorre, i riquadri di un altro sito arrivano scoperti al modello dell’Aiuto', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(150_000);
  const altro = testServer.html(`<!doctype html><body style="margin:0;background:${tinta(ROSA)}">Saldo 1.234</body>`, { pubblico: true });
  let righe = '';
  for (let i = 0; i < 40; i++) righe += `<p style="height:150px;margin:0">Movimento ${i}</p><iframe src="${altro}" style="width:300px;height:60px;border:0;display:block"></iframe>`;
  // Circa 1000 pixel al secondo, avanti e indietro: chi scorre la pagina con la rotella mentre l'Aiuto lavora.
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Conto</title></head><body style="margin:0">
    ${righe}
    <script>let d = 5; setInterval(() => { if (scrollY > 4000) d = -5; if (scrollY <= 0) d = 5; scrollBy(0, d); }, 5);</script>
    </body></html>`);
  const foto = await fotoDiPiuDomande(app, shell, page);
  const rosa = [];
  for (const u of foto) rosa.push(u ? await pixelDelColore(app, u, ROSA) : 0);
  expect(foto.filter(Boolean).length, 'al modello devono arrivare le foto della pagina').toBeGreaterThan(0);
  expect(Math.max(...rosa), `pixel dei riquadri di un altro sito in ogni foto: ${rosa.join(', ')}`).toBeLessThan(20);
});
