// #686.1 giro 6, rilievo 1: col dialogo modale dentro un componente della pagina, o
// aperto dopo il riquadro, il riquadro dello zoom resta fuori dal dialogo e il
// numero battuto non vale. Successo: il clic sul numero e «130» + Invio portano la pagina al 130%.
import { test, expect } from '../../fixtures/electron.mjs';

async function percentOf(app, page) {
  const url = await page.evaluate(() => location.href);
  const f = await app.evaluate(({ webContents }, u) => {
    for (const wc of webContents.getAllWebContents()) {
      let here = ''; try { here = wc.getURL(); } catch (_) {}
      if (here === u) return wc.getZoomFactor();
    }
    return null;
  }, url);
  return f == null ? null : Math.round(f * 100);
}
async function manda(app, page, eventi) {
  const url = await page.evaluate(() => location.href);
  await app.evaluate(({ webContents }, { u, eventi }) => {
    for (const wc of webContents.getAllWebContents()) {
      let here = ''; try { here = wc.getURL(); } catch (_) {}
      if (here !== u) continue;
      for (const ev of eventi) wc.sendInputEvent(ev);
    }
  }, { u: url, eventi });
}
const clic = (x, y, button = 'left') => [
  { type: 'mouseDown', x, y, button, clickCount: 1 },
  { type: 'mouseUp', x, y, button, clickCount: 1 },
];
const cifra = (k) => [{ type: 'keyDown', keyCode: k }, { type: 'char', keyCode: k }, { type: 'keyUp', keyCode: k }];

// Il clic vero sul numero, come lo fa l'utente, poi 130 e Invio.
async function batti130(app, page) {
  const b = await page.locator('#__filo-zoom-percent').boundingBox();
  expect(b, 'il riquadro dello zoom non c\'è').not.toBeNull();
  await manda(app, page, clic(Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2)));
  await page.waitForTimeout(200);
  for (const k of ['1', '3', '0']) await manda(app, page, cifra(k));
  await manda(app, page, [{ type: 'keyDown', keyCode: 'Enter' }, { type: 'keyUp', keyCode: 'Enter' }]);
  await expect.poll(async () => percentOf(app, page), { timeout: 4000 }).toBe(130);
}

for (const modo of ['open', 'closed']) {
  test(`dialogo modale dentro un componente ${modo === 'open' ? 'aperto' : 'chiuso'}: il numero battuto nel riquadro vale`, async ({ app, openTab, testServer }) => {
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="height:4000px"><h1>sito</h1><div id="h"></div>
      <script>const r = document.getElementById('h').attachShadow({ mode: '${modo}' });
      r.innerHTML = '<dialog id="d"><p>Accetti i cookie?</p><button>Accetta</button></dialog>';
      r.getElementById('d').showModal();</script></body></html>`);
    await page.waitForTimeout(800);
    await manda(app, page, clic(150, 600, 'middle'));
    await expect(page.locator('#__filo-zoom-badge')).toBeVisible();
    await batti130(app, page);
  });
}

test('dialogo modale che si apre dopo il riquadro: il numero battuto vale anche senza girare la rotella', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="height:4000px"><h1>sito</h1>
    <dialog id="d"><p>Accetti i cookie?</p><button>Accetta</button></dialog></body></html>`);
  await manda(app, page, clic(150, 600, 'middle'));
  await expect(page.locator('#__filo-zoom-badge')).toBeVisible();
  // Il banner dei cookie arriva un attimo dopo, come su molti siti.
  await page.evaluate(() => document.getElementById('d').showModal());
  await page.waitForTimeout(300);
  await batti130(app, page);
});
