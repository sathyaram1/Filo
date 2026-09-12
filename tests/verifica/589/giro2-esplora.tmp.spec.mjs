// ESPLORAZIONE (temporanea, non è una prova).
import { test, expect } from '../../fixtures/electron.mjs';

test('sweep: cosa ottiene una pagina web chiedendo', async ({ app, shell, openTab, testServer }) => {
  await shell.evaluate(() => window.filoShell.message({
    type: 'update_settings',
    settings: { apiKeys: { openrouter: 'sk-SEGRETO-589-G2' }, agentStyle: 'PREFERENZA-PRIVATA' },
  }));
  // Dati veri dell'utente, messi dalle superfici interne.
  await shell.evaluate(async () => {
    const m = (x) => window.filoShell.message(x);
    await m({ type: 'push_clipboard_entry', entry: { text: 'SEGRETO-APPUNTI-589', ts: Date.now() } });
    await m({ type: 'save_page', page: { url: 'https://banca.example/conto', title: 'CONTO-SEGRETO-589', text: 'saldo' } });
    await m({ type: 'filo_chat_memory_noop' }).catch(() => null);
  });
  const web = await testServer.openReady(openTab, '<h1>sito</h1>');
  const url = web.url();
  await openTab('https://cliente.example.test/privato-589').catch(() => null);

  const out = await app.evaluate(async ({}, pageUrl) => {
    const H = globalThis.__filoHandlers;
    const chiedi = async (msg) => {
      try {
        const r = await H.handleMessage(msg, { url: pageUrl, tab: { url: pageUrl } });
        return JSON.stringify(r ?? null).slice(0, 900);
      } catch (e) { return 'ERRORE ' + String(e).slice(0, 200); }
    };
    return {
      memoria: await chiedi({ type: 'filo_get_memory' }),
      stato: await chiedi({ type: 'filo_get_state' }),
      salvate: await chiedi({ type: 'get_saved_pages' }),
      appunti: await chiedi({ type: 'get_clipboard_history' }),
      archiviate: await chiedi({ type: 'get_archived_tabs' }),
      cerca_archiviate: await chiedi({ type: 'search_archived_tabs', query: 'a' }),
      // scritture / azioni
      reset: await chiedi({ type: 'reset_settings' }),
      chiudi_tutto: await chiedi({ type: 'close_all_tabs' }),
      esci: await chiedi({ type: 'auth_signout' }),
      timer: await chiedi({ type: 'filo_add_timer', label: 'X', ms: 1000 }),
      importa: await chiedi({ type: 'import_data_apply', data: {} }),
      svuota_appunti: await chiedi({ type: 'clear_clipboard_history' }),
      cancella_cronologia: await chiedi({ type: 'clear_history' }),
      salva_percorso: await chiedi({ type: 'save_path' }),
    };
  }, url);

  for (const [k, v] of Object.entries(out)) console.log('>>>', k, '=', v);
  const dopo = await shell.evaluate(() => window.filoShell.message({ type: 'get_settings' }));
  console.log('>>> chiave dopo reset =', JSON.stringify(dopo?.settings?.apiKeys ?? null));
  expect(true).toBe(true);
});
