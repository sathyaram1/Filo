// Verifica #2681.1, giro 1: un campo del CVV chiamato in un'altra lingua è segreto anche coi nomi comuni oltre
// a quelli della segnalazione (la variante «di verifica», che in italiano e in inglese è già segreta, e le lingue
// che Filo conosce per la password). Rossa finché il CVV si legge nella foto della pagina che va al modello.

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

// L'avviso del sito sospetto compare solo se la pagina sembra chiedere la carta: qui si supera se c'è.
async function superaAvvisoSeC(app) {
  const coperta = async () => (await copertura(app).catch(() => null))?.coperta === true;
  const fine = Date.now() + 4_000;
  while (!(await coperta())) {
    if (Date.now() > fine) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  const avviso = await vistaAvviso(app);
  await avviso.getByRole('button', { name: 'Continua' }).click();
  await expect.poll(coperta, { timeout: 6_000 }).toBe(false);
}

// Quanti valori cambiano fra le due foto dentro il campo: zero vuol dire che il CVV non si legge.
async function pixelDiversi(page, immagini) {
  return page.evaluate(async ([a, b]) => {
    const b0 = document.querySelector('#c').getBoundingClientRect();
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
}

const modulo = (etichetta) => `<!doctype html><html><head><title>Pagamento</title></head><body><h1>Pagamento</h1>
  <form><div><label for="t">Titolare</label> <input id="t"></div>
  <div><label for="c">${etichetta}</label> <input id="c" inputmode="numeric" maxlength="4" style="width:200px;font-size:22px"></div>
  <button type="button">Paga</button></form></body></html>`;

const NOMI = [
  'Código de verificación',
  'Code de vérification',
  'Kod zabezpieczający',
  'セキュリティコード',
  'Güvenlik kodu',
];

for (const nome of NOMI) {
  test(`r1 il CVV scritto sotto «${nome}» è coperto nella foto della pagina che va al modello`, async ({ app, shell, openTab, testServer }) => {
    test.setTimeout(60_000);
    const page = await testServer.openReady(openTab, modulo(nome));
    await superaAvvisoSeC(app);
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
    expect(immagini[0], 'al modello deve arrivare la foto della pagina').toMatch(/^data:image\//);
    expect(immagini[1]).toMatch(/^data:image\//);
    expect(await pixelDiversi(page, immagini), `il CVV scritto sotto «${nome}» si legge nella foto`).toBe(0);
  });
}
