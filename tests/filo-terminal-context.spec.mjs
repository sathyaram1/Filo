// #163/#164 — l'assistente e i suoi comandi da terminale:
//
//   1) cwd PERSISTENTE e coerente: un `cd` dell'assistente resta valido per il
//      comando successivo (un `pwd` dopo riflette la cartella), e il percorso
//      che il main riporta è quello reale; la barra della home lo rispecchia.
//   2) OUTPUT nel contesto: l'output di un comando eseguito in un turno RIENTRA
//      nel contesto del modello, così nel turno successivo l'assistente dimostra
//      di conoscerlo (prima rispondeva "non ho ancora l'output").
//
// Entrambe asseriscono il SUCCESSO della feature, non l'assenza di un errore.

import { test, expect } from './fixtures/electron.mjs';
import path from 'node:path';
import fs from 'node:fs';
import { percorsoCanonico, cartellaTemporanea } from './helpers/percorsi.mjs';

const NEWTAB = 'filo://newtab/';

const execAction = (app, action, opts) =>
  app.evaluate((_electron, { action, opts }) =>
    globalThis.SN_EXECUTE_FILO_ACTION(action, opts), { action, opts });

const confirmAction = (page, action) =>
  page.evaluate(async (a) =>
    chrome.runtime.sendMessage({ type: 'filo_confirm_action', action: a }), action);

const enableTerminal = (page) =>
  confirmAction(page, { type: 'IMPOSTA_PREFERENZA', chiave: 'terminale', valore: 'on' });

// Percorso canonico: su alcuni sistemi os.tmpdir() è un symlink (es. /tmp →
// /private/tmp su macOS) e su Windows con un nome utente che contiene uno
// spazio è la forma abbreviata 8.3 (AGENTI~1). La shell riporta comunque il
// percorso vero, quindi si confrontano le forme canoniche di entrambi i lati.
const real = percorsoCanonico;

test('#1 cwd dell’assistente: un cd persiste, il pwd successivo lo riflette', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);
  await enableTerminal(page);

  const base = cartellaTemporanea('filo-ctx-');
  fs.mkdirSync(path.join(base, 'sub'));

  // Entra nella cartella base (path assoluto): il main cattura la cwd risultante.
  const cdBase = await execAction(app, { type: 'ESEGUI_COMANDO', comando: `cd "${base}"` });
  expect(cdBase.executed).toBe(true);
  expect(real(cdBase.output.cwd)).toBe(base);

  // Un `cd` RELATIVO in una sottocartella: persiste rispetto al precedente.
  const cdSub = await execAction(app, { type: 'ESEGUI_COMANDO', comando: 'cd sub' });
  expect(cdSub.executed).toBe(true);
  expect(real(cdSub.output.cwd)).toBe(path.join(base, 'sub'));

  // Il `pwd` successivo riflette davvero la sottocartella (cwd persistita).
  const pwd = await execAction(app, { type: 'ESEGUI_COMANDO', comando: 'pwd' });
  expect(pwd.executed).toBe(true);
  expect(real(pwd.output.stdout.trim())).toBe(path.join(base, 'sub'));
  // …e il percorso riportato coincide con la cartella reale.
  expect(real(pwd.output.cwd)).toBe(path.join(base, 'sub'));

  try { fs.rmSync(base, { recursive: true, force: true }); } catch (_) {}
});

test('#1 UI: la barra del percorso si aggiorna con la cartella reale del comando', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  await enableTerminal(page);

  const shown = await page.evaluate(() => {
    window.__filoDashActions.applyCommandCwd([
      { type: 'ESEGUI_COMANDO', _output: { command: 'cd sub', cwd: '/tmp/filo-shown/sub', code: 0 } },
    ]);
    return {
      cwd: window.__filoDashActions.getCwd(),
      bar: document.getElementById('dashDir').textContent,
    };
  });
  expect(shown.cwd).toBe('/tmp/filo-shown/sub');
  expect(shown.bar).toBe('/tmp/filo-shown/sub');
});

test('#2 l’output di un comando rientra nel contesto del modello al turno dopo', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);
  await enableTerminal(page);

  const captured = await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    // Config deterministica con chiave presente: handleAIRequest non deve
    // fermarsi su "API key mancante" prima di costruire i messages.
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    // Stub del provider: cattura i messages costruiti e ritorna un JSON valido.
    const captured = {};
    const orig = globalThis.SN_PROVIDERS.completeWithFallback;
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      captured.messages = messages;
      return {
        text: JSON.stringify({ text: 'ok', actions: [] }),
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
      };
    };
    try {
      // Turno precedente: l'assistente ha eseguito `ls` e ne ha ricevuto l'output.
      const threadHistory = [
        { role: 'user', text: 'esegui ls' },
        {
          role: 'filo', text: 'Ecco il contenuto.',
          actions: [{
            type: 'ESEGUI_COMANDO', comando: 'ls',
            _output: { command: 'ls', stdout: 'PINCOPALLINO_SENTINELLA.txt\n', stderr: '', code: 0 },
          }],
        },
      ];
      // Turno successivo: l'utente chiede cosa ha trovato.
      await globalThis.SN_HANDLE_FILO_CHAT({ userMessage: 'cosa hai trovato?', threadHistory });
    } finally {
      globalThis.SN_PROVIDERS.completeWithFallback = orig;
    }
    const joined = (captured.messages || [])
      .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
      .join('\n');
    return joined;
  });

  // Successo: l'output del comando del turno prima è arrivato al modello.
  expect(captured).toContain('PINCOPALLINO_SENTINELLA.txt');
});
