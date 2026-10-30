// Sonde del giro 1 di #941.1: l'avviso di via di uno scaricamento, per strade diverse dal link semplice.
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
const avvisoDiVia = (dove, nome) => dove.locator('.shell-notif-msg', { hasText: `Scaricamento avviato: ${nome}` });

test('un link «Scarica» con target=_blank dice anche lui che lo scaricamento è partito', async ({ shell, openTab, testServer, avvisi }) => {
  test.setTimeout(120_000);
  const srv = await apriServerLento();
  try {
    const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Pagina col file</title></head><body style="padding:40px">
      <a id="grosso" target="_blank" href="${srv.base}/blank.bin">Scarica</a></body></html>`);
    await page.locator('#grosso').click();
    await expect.poll(() => statoDi(shell, 'blank.bin'), { timeout: 20_000 }).toBe('progressing');
    const vista = await avvisi();
    await expect(avvisoDiVia(vista, 'blank.bin')).toBeVisible({ timeout: 10_000 });
  } finally {
    await srv.close();
  }
});

test('tre file insieme: tre avvisi leggibili, nel tema scuro', async ({ shell, openTab, testServer, avvisi }) => {
  test.setTimeout(120_000);
  const srv = await apriServerLento();
  try {
    await shell.emulateMedia({ colorScheme: 'dark' });
    const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Pagina coi file</title></head><body style="padding:40px">
      <a id="a" href="${srv.base}/uno-con-un-nome-molto-lungo-per-vedere-come-si-taglia-nell-avviso-di-filo.bin">1</a>
      <a id="b" href="${srv.base}/due.bin">2</a><a id="c" href="${srv.base}/tre.bin">3</a></body></html>`);
    for (const [id, nome] of [['a', 'uno-con-un-nome-molto-lungo-per-vedere-come-si-taglia-nell-avviso-di-filo.bin'], ['b', 'due.bin'], ['c', 'tre.bin']]) {
      await page.locator(`#${id}`).click();
      await expect.poll(() => statoDi(shell, nome), { timeout: 20_000 }).toBe('progressing');
    }
    const vista = await avvisi();
    await expect(avvisoDiVia(vista, 'due.bin')).toBeVisible({ timeout: 10_000 });
    await vista.waitForTimeout(800);
    await vista.screenshot({ path: join(SHOTS, 'verifica-941.1-tre-scuro.png') });
    await shell.screenshot({ path: join(SHOTS, 'verifica-941.1-tre-scuro-shell.png') });
  } finally {
    await srv.close();
  }
});

test('con la pagina Download davanti non arriva l’avviso di via', async ({ shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const srv = await apriServerLento();
  try {
    const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Pagina col file</title></head><body style="padding:40px">
      <a id="grosso" href="${srv.base}/dl.bin">Scarica</a></body></html>`);
    await shell.evaluate(() => window.filoShell.tabs.open('filo://downloads/downloads.html'));
    await expect(shell.locator('#tabs .tab.active')).toContainText('Download', { timeout: 10_000 });
    await page.evaluate(() => document.getElementById('grosso').click());
    await expect.poll(() => statoDi(shell, 'dl.bin'), { timeout: 20_000 }).toBe('progressing');
    await page.waitForTimeout(2000);
    await expect(avvisoDiVia(shell, 'dl.bin')).toHaveCount(0);
  } finally {
    await srv.close();
  }
});
