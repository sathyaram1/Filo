// ESPLORAZIONE (temporanea, non è una prova): che cosa risponde Filo a una
// richiesta che arriva con l'indirizzo di un sito.
import { test, expect } from '../../fixtures/electron.mjs';

test('sweep: cosa ottiene una pagina web chiedendo', async ({ app, shell, openTab, testServer }) => {
  await shell.evaluate(() => window.filoShell.message({
    type: 'update_settings',
    settings: { apiKeys: { openrouter: 'sk-SEGRETO-589-G2' }, proxy: { datacenter: 'socks5://u:PWD589G2@gate.example.com:7000' } },
  }));
  const web = await testServer.openReady(openTab, '<h1>sito</h1>');
  const url = web.url();

  const tipi = [
    'auth_status', 'get_history', 'get_clipboard_history', 'get_saved_pages', 'get_costs',
    'filo_get_memory', 'filo_get_state', 'export_data', 'get_archived_tabs', 'get_categories',
    'defaults_get', 'wallet_state', 'get_credits', 'automation_get', 'automation_caps_get',
    'get_feedback_rewards', 'redteam_state', 'support_models_get', 'default_models_list',
    'merge_approvals_get', 'worker_log_get', 'routine_log_get', 'safebrowse_get', 'get_update_recap',
    'filo_get_notifications', 'filo_get_timers', 'decks_list', 'cookies_config', 'tts_voices',
  ];
  const out = await app.evaluate(async ({}, { pageUrl, tipi: t }) => {
    const H = globalThis.__filoHandlers;
    const res = {};
    for (const tipo of t) {
      try {
        const r = await H.handleMessage({ type: tipo }, { url: pageUrl, tab: { url: pageUrl } });
        res[tipo] = JSON.stringify(r ?? null).slice(0, 600);
      } catch (e) { res[tipo] = 'ERRORE ' + String(e).slice(0, 200); }
    }
    return res;
  }, { pageUrl: url, tipi });

  for (const [k, v] of Object.entries(out)) console.log('>>>', k, '=', v);
  expect(true).toBe(true);
});
