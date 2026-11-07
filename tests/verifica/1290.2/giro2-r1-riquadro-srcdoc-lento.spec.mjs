// Verifica #1290.2 giro 2, rilievo 1: un riquadro riempito dalla pagina (srcdoc) che c'era già e finisce di caricarsi
// dopo Traduci non è testo nuovo.
import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';
import { stub, watchToasts, toasts, clickTranslateIcon, iconaTraduci, frameInner, framePage } from './aiuto-giro2.mjs';

const PIXEL = 'R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

async function immagineLenta(ms) {
  const server = createServer((_req, res) => {
    setTimeout(() => { res.writeHead(200, { 'Content-Type': 'image/gif' }); res.end(Buffer.from(PIXEL, 'base64')); }, ms);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${server.address().port}/foto.gif`,
    chiudi: () => { try { server.closeAllConnections?.(); server.close(); } catch (_) {} },
  };
}

test('r1 riquadro scritto nel srcdoc che finisce di caricarsi dopo Traduci: tradotto, e niente «testo nuovo»', async ({ app, openTab, testServer }) => {
  test.setTimeout(120000);
  await stub(app);
  const foto = await immagineLenta(7000);
  try {
    const interno = frameInner('ZZSRCDOC', `<img src='${foto.url}' width='40' height='40' alt=''>`).replace(/"/g, '&quot;');
    const page = await testServer.openReady(openTab, framePage(`<iframe id="emb" style="width:520px;height:220px" srcdoc="${interno}"></iframe>`));
    const riq = page.frameLocator('#emb');
    await expect(riq.locator('#fbody')).toHaveText(/^ZZSRCDOC /, { timeout: 30000 });
    const f = () => page.frames().find((x) => x !== page.mainFrame());
    // Il presupposto: si preme Traduci con il riquadro ancora in caricamento.
    expect(await f().evaluate(() => document.readyState)).not.toBe('complete');
    await watchToasts(page);
    await clickTranslateIcon(app);
    await expect(riq.locator('#fbody')).toHaveText(/^IT ZZSRCDOC /, { timeout: 60000 });
    await expect.poll(() => toasts(page), { timeout: 60000 }).toContain('Pagina tradotta');
    await expect.poll(() => f().evaluate(() => document.readyState), { timeout: 30000 }).toBe('complete');
    await page.waitForTimeout(800);
    expect(await toasts(page)).not.toContain('aggiunta');
    await expect(await iconaTraduci(app)).toHaveAttribute('aria-label', 'Mostra originale');
  } finally { foto.chiudi(); }
});
