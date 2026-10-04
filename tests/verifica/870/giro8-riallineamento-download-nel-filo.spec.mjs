// #870 riallineamento — la carta di uno scaricamento portata nel filo resta segnata come contenuto esterno
// anche dopo la fusione con i cambi sulla bolla (#867), che toccavano la stessa scrittura dell'archivio.

import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

async function home(app) {
  const scadenza = Date.now() + 15_000;
  while (Date.now() < scadenza) {
    const w = app.windows().find((x) => { try { return x.url().startsWith('filo://newtab'); } catch (_) { return false; } });
    if (w) {
      await w.waitForLoadState('domcontentloaded');
      await expect(w.locator('#tieni .dash-carta').first()).toBeVisible({ timeout: 10_000 });
      return w;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('home non trovata');
}

test('la carta di uno scaricamento si apre nel filo e la frase resta marcata come esterna', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const srv = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="contratto-gas.bin"' });
    res.end(Buffer.alloc(2048, 0x61));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const sito = await testServer.openReady(openTab, `<a id="f" href="http://127.0.0.1:${srv.address().port}/contratto-gas.bin">gas</a>`);
    await sito.locator('#f').click();
    const page = await home(app);
    const carta = page.locator('#accade .dash-carta[data-tipo="download"]', { hasText: 'contratto-gas.bin' });
    await expect(carta.locator('.dash-carta-stato')).toHaveText(/^scaricato/, { timeout: 15_000 });
    await carta.locator('.dash-carta-testa').click();
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Ho scaricato «contratto-gas.bin»' })).toBeVisible({ timeout: 10_000 });
    await expect.poll(async () => app.evaluate(async () => {
      const l = await globalThis.SN_FILO_CHATS.list();
      for (const c of l) {
        const chat = await globalThis.SN_FILO_CHATS.get(c.id);
        const m = (chat && chat.messages || []).find((x) => x.role === 'filo' && /contratto-gas\.bin/.test(x.text));
        if (m) return m.esterno || 'senza';
      }
      return null;
    }), { timeout: 10_000 }).toBe('dal nome di un file scaricato');
  } finally {
    try { srv.closeAllConnections?.(); } catch (_) {}
    await new Promise((r) => srv.close(r));
  }
});
