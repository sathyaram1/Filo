// Verifica #1469 giro 3: un «Riprova» lasciato a metà non è un «Riprova» riuscito.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

const oggi = (app) => app.evaluate(async () => {
  const s = await globalThis.SN_CONTATORI_MAIN.letto();
  const g = globalThis.SN_CONTATORI.giornoDi(Date.now());
  const out = {};
  for (const [k, ora] of Object.entries(s.ore || {})) {
    if (!k.startsWith(`${g}T`)) continue;
    for (const [chiave, conti] of Object.entries(ora.navRiprove || {})) {
      const a = (out[chiave] = out[chiave] || conti.map(() => 0));
      conti.forEach((n, i) => { a[i] += n; });
    }
  }
  return out;
});
const tm = (app, fn, arg) => app.evaluate(({ BrowserWindow }, [f, a]) => {
  const t = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs;
  return new Function('t', 'a', f)(t, a);
}, [fn, arg]);

async function server(gestisci, porta = 0) {
  const s = createServer(gestisci);
  await new Promise((r, no) => { s.once('error', no); s.listen(porta, '127.0.0.1', r); });
  return { porta: s.address().port, async chiudi() { try { s.closeAllConnections?.(); } catch (_) {} await new Promise((r) => s.close(r)); } };
}

async function paginaErrore(app, openTab, testServer) {
  const page = await openTab(testServer.html('<!doctype html><title>partenza</title><p id="partenza">partenza</p>'));
  const id = await tm(app, 'return t.activeId');
  const spento = await server((q, r) => r.end('x'));
  const porta = spento.porta;
  await spento.chiudi();
  await tm(app, 't.navigate(a[0], a[1])', [id, `http://127.0.0.1:${porta}/pagina`]);
  await expect(page.locator('#err-retry')).toBeVisible({ timeout: 15_000 });
  return { page, id, porta };
}

test('r1 «Riprova» su un sito che non risponde, poi Indietro: nessun «Riprova» riuscito', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const { page, id, porta } = await paginaErrore(app, openTab, testServer);
  const appeso = await server(() => {}, porta);
  try {
    await page.locator('#err-retry').click({ noWaitAfter: true });
    await page.waitForTimeout(1500);
    await tm(app, 't.goBack(a)', id);
    await page.waitForTimeout(3000);
    const conti = (await oggi(app))['-102'] || [0, 0];
    expect(conti[0]).toBe(0);
  } finally { await appeso.chiudi(); }
});

test('r1 «Riprova» che riceve uno scaricamento, poi Indietro: nessun «Riprova» riuscito', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const { page, id, porta } = await paginaErrore(app, openTab, testServer);
  const scarica = await server((q, r) => { r.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="a.bin"' }); r.end('dati'); }, porta);
  try {
    await page.locator('#err-retry').click({ noWaitAfter: true });
    await page.waitForTimeout(2500);
    await tm(app, 't.goBack(a)', id);
    await page.waitForTimeout(3000);
    const conti = (await oggi(app))['-102'] || [0, 0];
    expect(conti[0]).toBe(0);
  } finally { await scarica.chiudi(); }
});
