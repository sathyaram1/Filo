// #2390 giro 1, rilievo 1 — nella home un avviso di una cosa che ha già la sua carta non deve restare a schermo:
// né nell'angolo (il timer arrivato da un sito) né come carta in più (lo scaricamento appena partito).

import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

async function finestraCon(app, prefisso) {
  let w = null;
  await expect.poll(() => {
    w = app.windows().find((x) => { try { return x.url().startsWith(prefisso); } catch (_) { return false; } });
    return !!w;
  }, { timeout: 15_000 }).toBe(true);
  await w.waitForLoadState('domcontentloaded');
  return w;
}

const statoDi = async (shell, nome) => {
  const r = await shell.evaluate(() => window.filoShell.downloads.list());
  return (((r && r.items) || []).find((it) => it.filename === nome) || {}).state ?? null;
};

async function serverLento() {
  const inCorso = [];
  const srv = createServer((req, res) => {
    const nome = (String(req.url || '').split('?')[0].split('/').pop()) || 'grosso.bin';
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': 4 * 1024 * 1024, 'Content-Disposition': `attachment; filename="${nome}"` });
    res.write(Buffer.alloc(64 * 1024, 1));
    inCorso.push(res);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return {
    base: `http://127.0.0.1:${srv.address().port}`,
    async close() {
      for (const res of inCorso.splice(0)) { try { res.destroy(); } catch (_) {} }
      try { srv.closeAllConnections?.(); } catch (_) {}
      await new Promise((r) => srv.close(r));
    },
  };
}

test('r1 timer scaduto su un sito, poi la home: la carta del timer c\'è già, l\'avviso lascia subito l\'angolo', async ({ app, shell, avvisi, openTab, testServer }) => {
  await testServer.openReady(openTab, '<h1>Un sito</h1>');
  const tipo = await shell.evaluate(() => window.SN_MSG.MSG.FILO_ADD_TIMER);
  await shell.evaluate(([t]) => window.filoShell.message({ type: t, label: 'Riso', seconds: 1 }), [tipo]);
  await shell.waitForTimeout(1300);
  await app.evaluate(async () => { await globalThis.__filoAlarmWatcher._tick(); });
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show', { hasText: 'Timer «Riso» scaduto' })).toBeVisible({ timeout: 8_000 });

  await shell.locator('#tabs .tab', { hasText: 'Home' }).click();
  const home = await finestraCon(app, 'filo://newtab');
  await expect(home.locator('#accade > .dash-carta[data-chiave^="timer:"]')).toHaveCount(1, { timeout: 5_000 });
  // Il tempo di disegnare la home, non il tempo di lettura di un avviso.
  await expect(shell.locator('.shell-notif[data-luogo="angolo"]:not([data-closing="1"])')).toHaveCount(0, { timeout: 1_500 });
  await expect(home.locator('#accade > .dash-carta[data-tipo="cornice"]')).toHaveCount(0);
});

test('r1 scaricamento avviato su un sito, poi la home: nessuna carta in più accanto a quella dello scaricamento', async ({ app, shell, avvisi, openTab, testServer }) => {
  test.setTimeout(90_000);
  const srv = await serverLento();
  try {
    const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Pagina col file</title></head><body style="padding:40px">
      <a id="grosso" href="${srv.base}/grosso.bin">Scarica</a></body></html>`);
    await page.locator('#grosso').click();
    await expect.poll(() => statoDi(shell, 'grosso.bin'), { timeout: 20_000 }).toBe('progressing');
    const vista = await avvisi();
    await expect(vista.locator('.shell-notif-msg', { hasText: 'Scaricamento avviato: grosso.bin' })).toBeVisible({ timeout: 10_000 });

    await shell.locator('#tabs .tab', { hasText: 'Home' }).click();
    const home = await finestraCon(app, 'filo://newtab');
    await expect(home.locator('.dash-carta[data-tipo="download"]', { hasText: 'grosso.bin' })).toBeVisible({ timeout: 15_000 });
    // Oltre il tempo dell'avviso di via (5 secondi): se volasse, sarebbe arrivato.
    await home.waitForTimeout(8_000);
    await expect(home.locator('#accade > .dash-carta[data-tipo="cornice"]')).toHaveCount(0);
  } finally {
    await srv.close();
  }
});
