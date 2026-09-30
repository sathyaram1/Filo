// Verifica #590, giro 18, rilievo 3: l'assistente sulla pagina tiene «Apri comunque» sotto l'apertura
// fermata dalla lista, come la chat della home.

import { test, expect, lista, schede } from '../../helpers/reteFinta.mjs';

test('assistente sulla pagina: NAVIGA fermata dalla lista, sotto c\'è «Apri comunque»', async ({ app, shell, rete }) => {
  test.setTimeout(60_000);
  await lista(shell, ['blocked.test']);
  const bersaglio = rete.pagina('blocked.test', '/', '<h1>SITO</h1>');
  const pagina = rete.pagina('sito.test', '/', '<h1>PAGINA</h1>');
  await shell.evaluate((u) => window.filoShell.tabs.open(u), pagina);
  await expect.poll(async () => (await schede(app)).includes(pagina), { timeout: 8000 }).toBe(true);
  await shell.waitForTimeout(1000);
  const nellAssistente = (code) => app.evaluate(async ({ BrowserWindow }, c) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const t = w._filoTabs.tabs.find((x) => String(x.url).includes('sito.test'));
    return t.view.webContents.executeJavaScriptInIsolatedWorld(999, [{ code: c }]);
  }, code);
  await nellAssistente('window.SN_SIDEBAR.open(), 1');
  const esito = await nellAssistente(`window.__filoSidebarTest.runFiloAction({ type: 'NAVIGA', url: ${JSON.stringify(bersaglio)} })`);
  expect(esito).toBe(false);
  const ultima = await nellAssistente('(() => { const l = document.querySelectorAll(".sn-sidebar-log"); return l.length ? l[l.length - 1].textContent : ""; })()');
  expect(ultima).toContain('fra i siti bloccati');
  const bottoni = await nellAssistente('Array.from(document.querySelectorAll(".sn-sidebar button")).map((b) => b.textContent.trim())');
  expect(bottoni.some((t) => /Apri comunque/.test(t))).toBe(true);
});
