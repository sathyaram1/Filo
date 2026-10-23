// #1623 giro 6: le foto grandi partono tutte col messaggio; dalla fila delle schede un'immagine .jfif entra come sul sito.
import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaInCasa } from '../../helpers/percorsi.mjs';
import { nelMondoDiFilo, statoDi } from '../../helpers/riquadri.mjs';

const JPG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AN//Z', 'base64');

function suDisco(nome, byte) {
  const p = join(cartellaInCasa('filo-test-giro6-'), nome);
  writeFileSync(p, byte);
  return p;
}
async function lascia(page, files, { x = 200, y = 200 } = {}) {
  const s = await page.context().newCDPSession(page);
  const data = { items: [], files, dragOperationsMask: 1 };
  for (const type of ['dragEnter', 'dragOver', 'drop']) await s.send('Input.dispatchDragEvent', { type, x, y, data });
  await s.detach().catch(() => {});
}
const allegati = async (app, page) => (await nelMondoDiFilo(app, page, () => globalThis.__filoSidebarTest?.allegati?.() || [])).map((a) => a.nome);
const SITO = '<!doctype html><html><head><meta charset="utf-8"><title>Sito</title></head>'
  + '<body style="margin:0;height:100vh;font:16px sans-serif"><p>Una pagina che i file non li vuole.</p></body></html>';

test('r1 tre foto del telefono lasciate sul sito e Invio subito: partono tutte e tre col messaggio', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  await nelMondoDiFilo(app, page, () => {
    globalThis.__richieste = [];
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (m, ...r) => {
      if (m && m.type === globalThis.SN_MSG.MSG.AI_REQUEST && m.action === globalThis.SN_CONST.ACTIONS.HELP) {
        globalThis.__richieste.push(m.payload);
        return Promise.resolve({ ok: true, text: '{"text":"ok","status":"done"}' });
      }
      return orig(m, ...r);
    };
    return 1;
  });
  // Una foto da 12 megapixel, oltre i 4 MB: va rimpicciolita prima di entrare.
  const foto = Buffer.from(await app.evaluate(({ nativeImage }) => {
    const w = 4000, h = 3000, px = Buffer.alloc(w * h * 4);
    for (let i = 0; i < px.length; i++) px[i] = (i & 3) === 3 ? 255 : (Math.random() * 256) | 0;
    return nativeImage.createFromBitmap(px, { width: w, height: h }).toJPEG(92).toString('base64');
  }), 'base64');
  expect(foto.length).toBeGreaterThan(4 * 1024 * 1024);
  const files = ['uno.jpg', 'due.jpg', 'tre.jpg'].map((n) => suDisco(n, foto));
  await lascia(page, files);
  await expect.poll(() => nelMondoDiFilo(app, page, () => document.activeElement === document.querySelector('.sn-sidebar-input textarea')), { timeout: 8_000 }).toBe(true);
  await page.keyboard.type('quale delle tre?');
  await page.keyboard.press('Enter');
  await expect.poll(() => nelMondoDiFilo(app, page, () => globalThis.__richieste.length), { timeout: 15_000 }).toBeGreaterThan(0);
  await page.waitForTimeout(3_000);
  const mandate = await nelMondoDiFilo(app, page, () => globalThis.__richieste.map((p) => {
    const u = p.history[p.history.length - 1];
    return Array.isArray(u.content) ? u.content.filter((c) => c.type === 'image_url').length : 0;
  }));
  expect(mandate[0]).toBe(3);
  expect(await allegati(app, page)).toEqual([]);
});

test('r2 un’immagine .jfif lasciata sulla fila delle schede entra come lasciata sulla pagina: nell’Aiuto e nella home', async ({ app, shell, openTab, testServer }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  let casa = null;
  await expect.poll(() => { casa = app.windows().find((w) => w.url().startsWith('filo://newtab')); return Boolean(casa); }, { timeout: 10_000 }).toBe(true);
  await expect(casa.locator('#input')).toBeVisible();
  const vuoto = async () => { const b = await shell.locator('.tab').last().boundingBox(); return { x: b.x + b.width + 260, y: b.y + b.height / 2 }; };
  await lascia(shell, [suDisco('dal web.jfif', JPG)], await vuoto());
  await expect(casa.locator('#imgPreviews .dash-img-preview img')).toHaveCount(1, { timeout: 8_000 });

  const page = await testServer.openReady(openTab, SITO);
  await lascia(page, [suDisco('sulla pagina.jfif', JPG)]);
  await expect.poll(() => allegati(app, page), { timeout: 8_000 }).toEqual(['sulla pagina.jfif']);
  await lascia(shell, [suDisco('sulla fila.jfif', JPG)], await vuoto());
  await expect.poll(() => allegati(app, page), { timeout: 8_000 }).toEqual(['sulla pagina.jfif', 'sulla fila.jfif']);
  expect((await statoDi(app, page, '.sn-toast'))?.testo || '').not.toContain('non è un’immagine');
});
