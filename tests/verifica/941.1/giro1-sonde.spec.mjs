// Sonde della verifica #941.1 giro 1: l'avviso di via di uno scaricamento fuori dalla home.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SHOTS = join(ROOT, 'tests', '.shots');
const GROSSO = 4 * 1024 * 1024;

async function apriServerLento() {
  const inCorso = [];
  const srv = createServer((req, res) => {
    const nome = (String(req.url || '').split('?')[0].split('/').pop()) || 'grosso.bin';
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': GROSSO,
      'Content-Disposition': `attachment; filename="${nome}"`,
    });
    res.write(Buffer.alloc(64 * 1024, 1));
    inCorso.push(res);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return {
    base: `http://127.0.0.1:${srv.address().port}`,
    finisci() { for (const res of inCorso.splice(0)) res.end(Buffer.alloc(GROSSO - 64 * 1024, 1)); },
    async close() {
      try { srv.closeAllConnections?.(); } catch (_) {}
      await new Promise((r) => srv.close(r));
    },
  };
}

const statoDi = async (shell, nome) => {
  const r = await shell.evaluate(() => window.filoShell.downloads.list());
  return (((r && r.items) || []).find((it) => it.filename === nome) || {}).state ?? null;
};
const via = (dove, nome) => dove.locator('.shell-notif-msg', { hasText: `Scaricamento avviato: ${nome}` });

test('sonda A: pagina normale, avviso visibile in chiaro e scuro', async ({ shell, openTab, testServer, avvisi }) => {
  test.setTimeout(120_000);
  const srv = await apriServerLento();
  try {
    const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>P</title></head><body style="padding:40px">
      <a id="g" href="${srv.base}/grosso-a.bin">Scarica</a></body></html>`);
    await page.locator('#g').click();
    await expect.poll(() => statoDi(shell, 'grosso-a.bin'), { timeout: 20_000 }).toBe('progressing');
    const vista = await avvisi();
    await expect(via(vista, 'grosso-a.bin')).toBeVisible({ timeout: 10_000 });
    await shell.screenshot({ path: join(SHOTS, 'v941-A-shell.png') });
    await vista.screenshot({ path: join(SHOTS, 'v941-A-chiaro.png') });
    await shell.emulateMedia({ colorScheme: 'dark' });
    await vista.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(500);
    await vista.screenshot({ path: join(SHOTS, 'v941-A-scuro.png') });
    console.log('A testo', await vista.locator('.shell-notif').first().innerText());
  } finally { await srv.close(); }
});

test('sonda B: link target=_blank', async ({ shell, openTab, testServer, avvisi }) => {
  test.setTimeout(120_000);
  const srv = await apriServerLento();
  try {
    const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>P</title></head><body style="padding:40px">
      <a id="g" target="_blank" href="${srv.base}/blank.bin">Scarica</a></body></html>`);
    await page.locator('#g').click();
    await expect.poll(() => statoDi(shell, 'blank.bin'), { timeout: 20_000 }).toBe('progressing');
    await page.waitForTimeout(2500);
    console.log('B schede', await shell.locator('#tabs .tab').allInnerTexts());
    console.log('B via nel modello', await via(shell, 'blank.bin').count());
    expect(await via(shell, 'blank.bin').count()).toBe(1);
  } finally { await srv.close(); }
});

test('sonda C: otto file insieme', async ({ shell, openTab, testServer, avvisi }) => {
  test.setTimeout(120_000);
  const srv = await apriServerLento();
  try {
    const links = Array.from({ length: 8 }, (_, i) => `<a class="g" href="${srv.base}/multi-${i}.bin">f${i}</a>`).join(' ');
    const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>P</title></head><body style="padding:40px">${links}</body></html>`);
    await page.evaluate(() => document.querySelectorAll('a.g').forEach((a) => a.click()));
    await page.waitForTimeout(4000);
    const r = await shell.evaluate(() => window.filoShell.downloads.list());
    console.log('C stati', ((r && r.items) || []).filter((x) => x.filename.startsWith('multi-')).map((x) => x.state));
    console.log('C avvisi di via nel modello', await shell.locator('.shell-notif-msg', { hasText: 'Scaricamento avviato' }).count());
    const vista = await avvisi();
    await vista.screenshot({ path: join(SHOTS, 'v941-C-otto.png') });
    await shell.screenshot({ path: join(SHOTS, 'v941-C-shell.png') });
  } finally { await srv.close(); }
});

test('sonda D: pagina Download davanti, poi Impostazioni', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const srv = await apriServerLento();
  try {
    const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>P</title></head><body style="padding:40px">
      <a id="g" href="${srv.base}/dl-d.bin">x</a><a id="h" href="${srv.base}/opt-d.bin">y</a></body></html>`);
    await shell.evaluate(() => window.filoShell.tabs.open('filo://downloads/'));
    await page.waitForTimeout(1500);
    console.log('D attiva', await shell.locator('#tabs .tab.active').innerText());
    await page.evaluate(() => document.getElementById('g').click());
    await expect.poll(() => statoDi(shell, 'dl-d.bin'), { timeout: 20_000 }).toBe('progressing');
    await page.waitForTimeout(2000);
    console.log('D via con Download davanti', await via(shell, 'dl-d.bin').count());
    await shell.evaluate(() => window.filoShell.tabs.open('filo://options/'));
    await page.waitForTimeout(1500);
    console.log('D attiva2', await shell.locator('#tabs .tab.active').innerText());
    await page.evaluate(() => document.getElementById('h').click());
    await expect.poll(() => statoDi(shell, 'opt-d.bin'), { timeout: 20_000 }).toBe('progressing');
    await page.waitForTimeout(2000);
    console.log('D via con Impostazioni davanti', await via(shell, 'opt-d.bin').count());
  } finally { await srv.close(); }
});

test('sonda F: senza scheda home, Vedi nella home', async ({ app, shell, openTab, testServer, avvisi }) => {
  test.setTimeout(120_000);
  const srv = await apriServerLento();
  try {
    const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Pagina F</title></head><body style="padding:40px">
      <a id="g" href="${srv.base}/f.bin">x</a></body></html>`);
    const home = shell.locator('#tabs .tab', { hasText: 'Home' });
    const n = await home.count();
    for (let i = 0; i < n; i++) {
      const id = await home.first().getAttribute('data-id');
      await shell.evaluate((x) => window.filoShell.tabs.close(x), id);
      await page.waitForTimeout(300);
    }
    console.log('F schede', await shell.locator('#tabs .tab').allInnerTexts());
    await page.locator('#g').click();
    await expect.poll(() => statoDi(shell, 'f.bin'), { timeout: 20_000 }).toBe('progressing');
    const vista = await avvisi();
    await expect(via(vista, 'f.bin')).toBeVisible({ timeout: 10_000 });
    await vista.locator('.shell-notif-action', { hasText: 'Vedi nella home' }).click();
    await page.waitForTimeout(2000);
    console.log('F schede dopo', await shell.locator('#tabs .tab').allInnerTexts(), 'attiva', await shell.locator('#tabs .tab.active').innerText());
    const w = app.windows().find((x) => x.url().startsWith('filo://newtab'));
    if (w) {
      await expect(w.locator('.dash-carta[data-tipo="download"]', { hasText: 'f.bin' })).toBeVisible({ timeout: 15_000 });
      await w.screenshot({ path: join(SHOTS, 'v941-F-home.png') });
    }
  } finally { await srv.close(); }
});
