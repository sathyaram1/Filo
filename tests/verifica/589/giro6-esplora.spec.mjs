import { test, expect } from '../../fixtures/electron.mjs';

// Manda un messaggio dal mondo isolato del codice di Filo dentro la pagina del sito.
function dalMondoDiFilo(app, host) {
  return (msg) => app.evaluate(async ({ BrowserWindow }, { h, m }) => {
    const win = BrowserWindow.getAllWindows()[0];
    const tab = win._filoTabs.tabs.find((t) => String(t.url || '').includes(h));
    const wc = tab.view.webContents;
    const code = `chrome.runtime.sendMessage(${JSON.stringify(m)})`;
    try { return await wc.executeJavaScriptInIsolatedWorld(999, [{ code }]); } catch (e) { return { errore: String(e) }; }
  }, { h: host, m: msg });
}

test('esplora: azioni di Filo da un sito', async ({ app, shell, openTab, testServer }) => {
  const web = await testServer.openReady(openTab, '<h1>sito</h1>');
  const host = new URL(web.url()).host;
  const manda = dalMondoDiFilo(app, host);

  const prova = await manda({ type: 'get_settings' });
  console.log('get_settings keys', Object.keys(prova?.settings || {}), prova?.errore);

  const r1 = await manda({ type: 'filo_run_action', action: { type: 'IMPOSTA_PREFERENZA', chiave: 'stile_agente', valore: 'ISTRUZIONI DEL SITO' } });
  console.log('stile', JSON.stringify(r1));

  const a2 = { type: 'IMPOSTA_PREFERENZA', chiave: 'limite_spesa', valore: '9999' };
  const r2 = await manda({ type: 'filo_run_action', action: a2 });
  const c2 = await manda({ type: 'filo_confirm_action', action: a2 });
  console.log('limite', JSON.stringify(r2), JSON.stringify(c2));

  const a3 = { type: 'IMPOSTA_PREFERENZA', chiave: 'modalita_terminale', valore: 'true' };
  const r3 = await manda({ type: 'filo_run_action', action: a3 });
  const c3 = await manda({ type: 'filo_confirm_action', action: a3 });
  console.log('terminale', JSON.stringify(r3), JSON.stringify(c3));

  const a4 = { type: 'IMPOSTA_PREFERENZA', chiave: 'chiave_openrouter', valore: 'sk-or-v1-DEL-SITO' };
  await manda({ type: 'filo_run_action', action: a4 });
  const c4 = await manda({ type: 'filo_confirm_action', action: a4 });
  console.log('chiave', JSON.stringify(c4));

  const s = await shell.evaluate(() => window.filoShell.message({ type: 'get_settings' }));
  console.log('agentStyle', s.settings.agentStyle, 'limit', s.settings.monthlyLimitEur, 'terminal', JSON.stringify(s.settings.terminal), 'or', s.settings.apiKeys?.openrouter);
  expect(true).toBe(true);
});
