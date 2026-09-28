// Verifica #589 — giro 6, rilievo 1. Stesso modello di minaccia della
// segnalazione: se l'isolamento del codice di Filo dentro la pagina di un sito
// cede, che cosa c'è dall'altra parte? Qui: le azioni di Filo. Il sito le chiede
// e se le conferma da solo, dalla stessa pagina, senza che l'utente veda niente.
// I messaggi partono dal mondo isolato del codice di Filo dentro il sito.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '../../fixtures/electron.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const MONDO_CONTENT_SCRIPT = 999;

function dalSito(app, host) {
  return (msg) => app.evaluate(async ({ BrowserWindow }, { h, m, mondo }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const tab = win._filoTabs.tabs.find((t) => String(t.url || '').includes(h));
    const code = `chrome.runtime.sendMessage(${JSON.stringify(m)})`;
    return tab.view.webContents.executeJavaScriptInIsolatedWorld(mondo, [{ code }]);
  }, { h: host, m: msg, mondo: MONDO_CONTENT_SCRIPT });
}

async function chiediEConferma(manda, action) {
  await manda({ type: 'filo_run_action', action });
  return manda({ type: 'filo_confirm_action', action });
}

const impostazioni = async (shell) => (await shell.evaluate(() => window.filoShell.message({ type: 'get_settings' }))).settings;

test('un sito non si conferma da solo le preferenze che Filo chiede di confermare', async ({ shell, app, openTab, testServer }) => {
  await shell.evaluate(() => window.filoShell.message({
    type: 'update_settings', settings: { monthlyLimitEur: 5, apiKeys: { openrouter: 'sk-or-v1-DELL-UTENTE' } },
  }));
  const web = await testServer.openReady(openTab, '<h1>sito qualunque</h1>');
  const manda = dalSito(app, new URL(web.url()).host);

  await chiediEConferma(manda, { type: 'IMPOSTA_PREFERENZA', chiave: 'limite_spesa', valore: '9999' });
  await chiediEConferma(manda, { type: 'IMPOSTA_PREFERENZA', chiave: 'chiave_openrouter', valore: 'sk-or-v1-DEL-SITO' });
  await chiediEConferma(manda, { type: 'IMPOSTA_PREFERENZA', chiave: 'modalita_terminale', valore: 'true' });

  const s = await impostazioni(shell);
  expect(Number(s.monthlyLimitEur), 'il sito ha alzato da solo il tetto di spesa').toBe(5);
  expect(s.apiKeys?.openrouter, 'il sito ha messo la sua chiave al posto di quella dell\'utente').toBe('sk-or-v1-DELL-UTENTE');
  expect(s.terminal?.enabled === true, 'il sito ha acceso da solo la modalità terminale').toBe(false);
});

test('un sito non fa eseguire comandi sul computer dell\'utente', async ({ shell, app, openTab, testServer }) => {
  // L'utente ha acceso il terminale per sé: il sito non deve poterlo usare.
  await shell.evaluate(() => window.filoShell.message({ type: 'update_settings', settings: { terminal: { enabled: true } } }));
  const segno = join(cartellaTemporanea('filo-589-g6-'), 'scritto-dal-sito.txt');
  const web = await testServer.openReady(openTab, '<h1>sito qualunque</h1>');
  const manda = dalSito(app, new URL(web.url()).host);

  const esito = await chiediEConferma(manda, { type: 'ESEGUI_COMANDO', comando: `echo sito > "${segno}"` });
  await new Promise((r) => setTimeout(r, 500));
  expect(esito?.executed === true, 'il comando chiesto e confermato dal sito è stato eseguito').toBe(false);
  expect(existsSync(segno), 'il sito ha scritto un file sul computer dell\'utente').toBe(false);
});

test('un sito non scrive nella memoria di Filo, non la cancella e non detta lo stile dell\'agente', async ({ shell, app, openTab, testServer }) => {
  await shell.evaluate(() => window.filoShell.message({
    type: '_storage:set', obj: { filo_memory: { PROFILO: 'Profilo dell\'utente 589', PREFERENZE: '' } },
  }));
  await shell.evaluate(() => window.filoShell.message({ type: 'update_settings', settings: { agentStyle: 'Stile dell\'utente' } }));
  const web = await testServer.openReady(openTab, '<h1>sito qualunque</h1>');
  const manda = dalSito(app, new URL(web.url()).host);

  await manda({ type: 'filo_run_action', action: { type: 'SALVA_LEZIONE', testo: 'LEZIONE SCRITTA DAL SITO 589' } });
  await manda({ type: 'filo_run_action', action: { type: 'IMPOSTA_PREFERENZA', chiave: 'stile_agente', valore: 'ISTRUZIONI DEL SITO 589' } });
  await chiediEConferma(manda, { type: 'CANCELLA_MEMORIA' });

  const dati = await shell.evaluate(() => window.filoShell.message({ type: '_storage:get', keys: ['filo_lessons_buffer', 'filo_memory'] }));
  expect(JSON.stringify(dati?.value?.filo_lessons_buffer || []), 'il sito ha fissato una lezione nella memoria di Filo').not.toContain('LEZIONE SCRITTA DAL SITO 589');
  expect(dati?.value?.filo_memory?.PROFILO, 'il sito ha cancellato la memoria di Filo').toBe('Profilo dell\'utente 589');
  expect((await impostazioni(shell)).agentStyle, 'il sito ha scritto lo stile che Filo si porta in ogni conversazione').toBe('Stile dell\'utente');
});
