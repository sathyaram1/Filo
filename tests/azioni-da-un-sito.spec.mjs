// #589 — dalla pagina di un sito si chiedono solo le azioni della barra d'aiuto (il
// feedback): preferenze, memoria e terminale no, nemmeno confermandole da sé. I messaggi
// partono dal mondo isolato dei content script. Regola: src/main/services/impostazioniPerOrigine.js.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/electron.mjs';
import { cartellaTemporanea } from './helpers/percorsi.mjs';

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
  const chiesta = await manda({ type: 'filo_run_action', action });
  const confermata = await manda({ type: 'filo_confirm_action', action });
  return { chiesta, confermata };
}

const impostazioni = async (shell) => (await shell.evaluate(() => window.filoShell.message({ type: 'get_settings' }))).settings;

test('un sito non si conferma da solo le preferenze che Filo chiede di confermare', async ({ shell, app, openTab, testServer }) => {
  await shell.evaluate(() => window.filoShell.message({
    type: 'update_settings', settings: { monthlyLimitEur: 5, apiKeys: { openrouter: 'sk-or-v1-DELL-UTENTE' } },
  }));
  const web = await testServer.openReady(openTab, '<h1>sito qualunque</h1>');
  const manda = dalSito(app, new URL(web.url()).host);

  const tetto = await chiediEConferma(manda, { type: 'IMPOSTA_PREFERENZA', chiave: 'limite_spesa', valore: '9999' });
  await chiediEConferma(manda, { type: 'IMPOSTA_PREFERENZA', chiave: 'chiave_openrouter', valore: 'sk-or-v1-DEL-SITO' });
  await chiediEConferma(manda, { type: 'IMPOSTA_PREFERENZA', chiave: 'modalita_terminale', valore: 'true' });
  expect(tetto.chiesta?.needsConfirm, 'al sito non si apre nemmeno la domanda di conferma').toBeFalsy();
  expect(tetto.confermata?.executed).toBe(false);

  const s = await impostazioni(shell);
  expect(Number(s.monthlyLimitEur), 'il sito ha alzato da solo il tetto di spesa').toBe(5);
  expect(s.apiKeys?.openrouter, 'il sito ha messo la sua chiave al posto di quella dell\'utente').toBe('sk-or-v1-DELL-UTENTE');
  expect(s.terminal?.enabled === true, 'il sito ha acceso da solo la modalità terminale').toBe(false);
});

test('un sito non fa eseguire comandi sul computer dell\'utente, nemmeno col terminale acceso', async ({ shell, app, openTab, testServer }) => {
  await shell.evaluate(() => window.filoShell.message({ type: 'update_settings', settings: { terminal: { enabled: true } } }));
  const segno = join(cartellaTemporanea('filo-589-azioni-'), 'scritto-dal-sito.txt');
  const web = await testServer.openReady(openTab, '<h1>sito qualunque</h1>');
  const manda = dalSito(app, new URL(web.url()).host);

  const esito = await chiediEConferma(manda, { type: 'ESEGUI_COMANDO', comando: `echo sito > "${segno}"` });
  await new Promise((r) => setTimeout(r, 500));
  expect(esito.confermata?.executed === true, 'il comando chiesto e confermato dal sito è stato eseguito').toBe(false);
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

// La strada legittima resta aperta: la barra d'aiuto di un sito propone un
// feedback, l'utente conferma, il feedback parte.
test('dalla barra d\'aiuto di un sito il feedback chiesto e confermato parte ancora', async ({ app, openTab, testServer }) => {
  await app.evaluate(() => {
    globalThis.__fb589 = [];
    globalThis.SN_FEEDBACK.submit = async (p) => { globalThis.__fb589.push(p); return { id: 'fb-589' }; };
  });
  const web = await testServer.openReady(openTab, '<h1>sito qualunque</h1>');
  const manda = dalSito(app, new URL(web.url()).host);
  const action = { type: 'INVIA_FEEDBACK', testo: 'Il menu non si apre su questo sito', titolo: 'Menu' };

  const { chiesta, confermata } = await chiediEConferma(manda, action);
  expect(chiesta?.needsConfirm, 'il feedback chiede conferma all\'utente').toBe(2);
  expect(confermata?.executed, 'il feedback confermato deve partire').toBe(true);
  expect(await app.evaluate(() => globalThis.__fb589.length)).toBe(1);
});

// «Apri il link in una nuova scheda» della barra d'aiuto passa per l'azione che
// apre una pagina: da un sito vale per gli indirizzi web, non per le pagine di Filo.
test('dalla barra d\'aiuto di un sito «apri il link» apre la scheda, ma non una pagina di Filo', async ({ app, openTab, testServer }) => {
  const destinazione = testServer.html('<h1>pagina di destinazione</h1>');
  const web = await testServer.openReady(openTab, `<h1>sito</h1><a id="l" href="${destinazione}">vai</a>`);
  const host = new URL(web.url()).host;
  const indirizzi = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
    .find((w) => w._filoTabs)._filoTabs.tabs.map((t) => String(t.url || '')));
  const barra = (codice) => app.evaluate(async ({ BrowserWindow }, { h, codice, mondo }) => {
    const tab = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.tabs.find((t) => String(t.url || '').includes(h));
    return tab.view.webContents.executeJavaScriptInIsolatedWorld(mondo, [{ code: codice }]);
  }, { h: host, codice, mondo: MONDO_CONTENT_SCRIPT });

  const aperto = await barra(`globalThis.__filoSidebarTest.runPageAction({ op: 'open_link', selector: '#l' })`);
  await expect.poll(indirizzi, { timeout: 8000 }).toContain(destinazione);
  expect(aperto, 'la barra scrive «apri link in nuova scheda: non riuscita»').toBe(true);

  const prima = (await indirizzi()).length;
  const manda = dalSito(app, host);
  const esito = await manda({ type: 'filo_run_action', action: { type: 'NAVIGA', url: 'filo://options/options.html' } });
  expect(esito?.executed === true, 'un sito ha aperto una pagina di Filo').toBe(false);
  expect((await indirizzi()).length).toBe(prima);
});
