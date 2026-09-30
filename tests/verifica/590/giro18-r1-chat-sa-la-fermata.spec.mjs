// Verifica #590, giro 18, rilievo 1: la chat che ha chiesto l'apertura sa che la lista l'ha fermata,
// anche quando la pagina passa da un rimbalzo del server o quando a chiedere è l'assistente sulla pagina.

import { test, expect, lista, schede } from '../../helpers/reteFinta.mjs';
import { home, modelloFinto, chiamateAlModello, ripristina, chiedi } from '../../helpers/chatFinta.mjs';

const naviga = (url, id = 'n1') => ({ id, name: 'NAVIGA', arguments: JSON.stringify({ url, etichetta: 'pagina' }) });

test('chat della home: la pagina aperta rimanda da sé a un accorciatore che rimbalza sul sito della lista', async ({ app, shell, rete }) => {
  test.setTimeout(60_000);
  await lista(shell, ['blocked.test']);
  const bersaglio = rete.pagina('blocked.test', '/', '<h1>SITO</h1>');
  const corto = rete.rimbalzo('accorcia.test', '/r', bersaglio);
  const ponte = rete.pagina('sito.test', '/ponte', `<h1>Stai lasciando il sito…</h1><script>location.replace(${JSON.stringify(corto)})</script>`);
  const page = await home(app);
  await modelloFinto(app, [{ toolCalls: [naviga(ponte)] }, { text: 'RISPOSTA' }]);
  try {
    await chiedi(page, 'apri quel link');
    await expect(page.locator('.dash-bubble-filo', { hasText: 'RISPOSTA' })).toBeVisible({ timeout: 20_000 });
    expect((await schede(app)).filter((u) => u.includes('blocked.test'))).toEqual([]);
    const tool = JSON.stringify(((await chiamateAlModello(app))[1] || []).filter((m) => m && m.role === 'tool'));
    expect(tool).toContain('NON aperta');
    await expect(page.getByRole('button', { name: /Apri comunque/ })).toBeVisible({ timeout: 8000 });
  } finally {
    await ripristina(app);
  }
});

test('assistente sulla pagina: la pagina aperta si sposta da sé sul sito della lista dopo due secondi e mezzo', async ({ app, shell, rete }) => {
  test.setTimeout(60_000);
  await lista(shell, ['blocked.test']);
  const bersaglio = rete.pagina('blocked.test', '/', '<h1>SITO</h1>');
  const ponte = rete.pagina('accorcia.test', '/p', `<h1>Stai lasciando il sito…</h1><script>setTimeout(() => location.replace(${JSON.stringify(bersaglio)}), 2500)</script>`);
  const pagina = rete.pagina('sito.test', '/', '<h1>PAGINA</h1>');
  await shell.evaluate((u) => window.filoShell.tabs.open(u), pagina);
  await expect.poll(async () => (await schede(app)).includes(pagina), { timeout: 8000 }).toBe(true);
  await shell.waitForTimeout(1000);
  // L'assistente vive nel mondo isolato dei content script della pagina web.
  const nellAssistente = (code) => app.evaluate(async ({ BrowserWindow }, c) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const t = w._filoTabs.tabs.find((x) => String(x.url).includes('sito.test'));
    return t.view.webContents.executeJavaScriptInIsolatedWorld(999, [{ code: c }]);
  }, code);
  await nellAssistente('window.SN_SIDEBAR.open(), 1');
  await nellAssistente(`window.__filoSidebarTest.runFiloAction({ type: 'NAVIGA', url: ${JSON.stringify(ponte)} })`);
  await shell.waitForTimeout(5000);
  expect((await schede(app)).filter((u) => u.includes('blocked.test'))).toEqual([]);
  const ultima = await nellAssistente('(() => { const l = document.querySelectorAll(".sn-sidebar-log"); return l.length ? l[l.length - 1].textContent : ""; })()');
  expect(ultima).toContain('fra i siti bloccati');
});
