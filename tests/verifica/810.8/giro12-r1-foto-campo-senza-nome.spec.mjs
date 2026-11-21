// Verifica #810.8 giro 12, rilievo 1: l'IBAN che l'utente scrive in un campo senza nome non va al modello nel testo,
// ma resta leggibile nella foto della pagina che gli arriva insieme.
import { test, expect } from '../../fixtures/electron.mjs';
import { PAGAMENTO, modelli, oltreLAvviso, apriAiuto, chiedi } from './aiuti.mjs';

const IBAN = 'IT60X0542811101000000123456';

test('r1 l’IBAN scritto in un campo senza nome non si legge nella foto che arriva al modello', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, PAGAMENTO('<div>Bonifico</div><input id="x" style="width:400px;height:30px;font-size:18px;background:#fff;color:#000">'));
  await oltreLAvviso(app);
  await modelli(app);
  await app.evaluate(() => {
    const P = globalThis.SN_PROVIDERS;
    globalThis.__visti = [];
    const a = P.completeWithFallback, b = P.streamCompleteWithFallback;
    P.completeWithFallback = async (o) => { globalThis.__visti.push(o.messages); return a(o); };
    P.streamCompleteWithFallback = async (o) => { globalThis.__visti.push(o.messages); return b(o); };
  });
  await page.locator('#x').click();
  await page.keyboard.type(IBAN, { delay: 15 });
  const aiuto = await apriAiuto(app, shell, page);
  await chiedi(aiuto, 'ho scritto giusto?');
  const visti = await app.evaluate(() => globalThis.__visti);
  expect(JSON.stringify(visti), 'nel testo l’IBAN è nascosto, come vuole il lavoro').not.toContain(IBAN);
  let foto = null;
  for (const m of visti.flat()) {
    for (const p of Array.isArray(m && m.content) ? m.content : []) {
      const u = p && (p.image_url?.url || p.url || '');
      if (typeof u === 'string' && u.startsWith('data:image')) foto = u;
    }
  }
  expect(foto, 'nessuna foto della pagina al modello').toBeTruthy();
  // Pixel scuri nel campo oltre la zona dei puntini di copertura: sono le lettere dell'IBAN.
  const scuri = await page.evaluate(async (src) => {
    const r = document.getElementById('x').getBoundingClientRect();
    const img = new Image();
    img.src = src;
    await img.decode();
    const s = img.naturalWidth / window.innerWidth;
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const x0 = Math.round((r.left + 130) * s), x1 = Math.round((r.right - 4) * s);
    const y0 = Math.round((r.top + 4) * s), y1 = Math.round((r.bottom - 4) * s);
    const d = g.getImageData(x0, y0, x1 - x0, y1 - y0).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] < 100) n++;
    return n;
  }, foto);
  expect(scuri, 'l’IBAN dell’utente si legge nella foto della pagina').toBeLessThan(30);
});
