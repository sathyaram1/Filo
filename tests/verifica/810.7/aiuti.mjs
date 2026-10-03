// Aiuti delle prove di verifica di #810.7: modello finto che registra quello che gli arriva, assistente di pagina.

import { expect } from '../../fixtures/electron.mjs';

export const CARTE = ['4111 1111 1111 1111', '5500 0000 0000 0004'];

export const modulo = (campo) => `<!doctype html><html><head><title>Pagamento</title></head><body><h1>Pagamento</h1>
  <form>${campo}<button type="button">Paga</button></form></body></html>`;

export async function preparaModelli(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: {
        [C.ACTIONS.HELP]: 'deepseek-flash', [C.ACTIONS.SPELLCHECK_WORD]: 'deepseek-flash', [C.ACTIONS.EXPLAIN]: 'deepseek-flash',
      },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
}

export async function modelloFinto(app, testo) {
  await app.evaluate((_electron, testo) => {
    const P = globalThis.SN_PROVIDERS;
    globalThis.__visti = [];
    const finto = async ({ attempts, messages }) => {
      globalThis.__visti.push(JSON.parse(JSON.stringify(messages)));
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text: testo };
    };
    P.completeWithFallback = finto;
    P.streamCompleteWithFallback = finto;
  }, testo);
}

// Il testo arrivato al modello, senza l'indirizzo del server di prova e senza le immagini.
export async function arrivato(app, page) {
  const testo = await app.evaluate(() => JSON.stringify(globalThis.__visti || []));
  return testo.split(new URL(page.url()).origin).join('').replace(/data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/g, '');
}

export async function superaAvviso(page) {
  const continua = page.getByRole('button', { name: 'Continua' });
  if (await continua.isVisible({ timeout: 6_000 }).catch(() => false)) {
    await continua.click();
    await expect(continua).toHaveCount(0, { timeout: 6_000 });
  }
}

export async function apriAiuto(shell, page) {
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  await page.waitForSelector('.sn-sidebar-input textarea', { timeout: 8_000 });
}

export async function chiedi(app, page, testo, n) {
  await page.fill('.sn-sidebar-input textarea', testo);
  await page.press('.sn-sidebar-input textarea', 'Enter');
  await expect.poll(() => app.evaluate(() => globalThis.__visti.length), { timeout: 20_000 }).toBe(n);
}

export async function ultimaImmagine(app) {
  return app.evaluate(() => {
    const utente = [...globalThis.__visti.at(-1)].reverse().find((m) => m.role === 'user');
    const parte = Array.isArray(utente.content) && utente.content.find((p) => p.type === 'image_url');
    return parte ? parte.image_url.url : null;
  });
}

// Quanti pixel cambiano fra due immagini della pagina dentro il rettangolo r (coordinate della pagina).
export async function pixelDiversi(page, immagini, r) {
  return page.evaluate(async ([a, b, r]) => {
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
  }, [...immagini, r]);
}
