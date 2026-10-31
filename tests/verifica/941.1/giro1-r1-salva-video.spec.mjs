// Verifica #941.1 giro 1, rilievo 1: un video salvato dal tasto destro scende senza nessun segno dentro Filo,
// mentre un file da link porta l'avviso di via. Successo: mentre scende, un avviso nomina il file.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const GROSSO = 4 * 1024 * 1024;

async function apriServerLento() {
  const srv = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': GROSSO });
    res.write(Buffer.alloc(64 * 1024, 1));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return {
    base: `http://127.0.0.1:${srv.address().port}`,
    async close() {
      try { srv.closeAllConnections?.(); } catch (_) {}
      await new Promise((r) => srv.close(r));
    },
  };
}

test('r1 un video grosso salvato dal tasto destro, su una pagina, dice che è partito mentre scende', async ({ shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const srv = await apriServerLento();
  try {
    const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Pagina col video</title></head><body style="padding:24px">
      <video id="v" src="${srv.base}/filmato.mp4" preload="none" width="320" height="180" style="background:#333"></video></body></html>`);
    await page.locator('#v').click({ button: 'right', position: { x: 20, y: 20 } });
    const voce = menuDi(page).locator('.sn-menu button', { hasText: 'Salva video come' });
    await expect(voce).toBeVisible();
    await voce.click();
    const stato = async () => {
      const r = await shell.evaluate(() => window.filoShell.downloads.list());
      return (((r && r.items) || []).find((it) => /filmato/.test(it.filename)) || {}).state ?? null;
    };
    await expect.poll(stato, { timeout: 20_000 }).toBe('progressing');
    await expect(shell.locator('.shell-notif-msg', { hasText: 'filmato' })).toHaveCount(1, { timeout: 8000 });
    expect(await stato()).toBe('progressing');
  } finally {
    await srv.close();
  }
});
