// Feedback WgFpzTW2: "fai in modo che filo possa modificare le impostazioni in
// preferenze su richiesta." Quando l'utente chiede a Filo (chat) di cambiare una
// preferenza, Filo emette l'azione IMPOSTA_PREFERENZA che scrive davvero la
// preferenza. Qui esercitiamo l'esecutore di azioni nel main process e
// asseriamo che la preferenza cambi DAVVERO (non solo che non dia errore).

import { test, expect } from './fixtures/electron.mjs';

// Esegue un'azione di chat nel processo main e ritorna { res, settings }.
async function runAction(app, action) {
  return app.evaluate(async ({ app: electronApp }, act) => {
    const path = require('path');
    const handlers = require(path.join(electronApp.getAppPath(), 'src', 'main', 'services', 'handlers.js'));
    const res = await handlers.executeFiloAction(act);
    const settings = await globalThis.SN_STORAGE.getSettings();
    return { res, settings };
  }, action);
}

test('Filo applica "metti il tema scuro" cambiando davvero il tema', async ({ app }) => {
  const { res, settings } = await runAction(app, { type: 'IMPOSTA_PREFERENZA', chiave: 'tema', valore: 'scuro' });
  expect(res.executed).toBe(true);
  expect(settings.theme).toBe('dark');
});

test('Filo applica più preferenze e preserva i campi annidati vicini', async ({ app }) => {
  // Imposta la shell del terminale, poi attiva la modalità terminale: la
  // seconda azione NON deve azzerare la shell scelta (deepMerge).
  await runAction(app, { type: 'IMPOSTA_PREFERENZA', chiave: 'shell_terminale', valore: 'bash' });
  const { res, settings } = await runAction(app, { type: 'IMPOSTA_PREFERENZA', chiave: 'modalita_terminale', valore: 'attiva' });
  expect(res.executed).toBe(true);
  expect(settings.terminal.enabled).toBe(true);
  expect(settings.terminal.shell).toBe('bash');
});

test('Filo mappa etichette in linguaggio naturale (dimensione testo)', async ({ app }) => {
  const { res, settings } = await runAction(app, { type: 'IMPOSTA_PREFERENZA', chiave: 'dimensione_testo', valore: 'grande' });
  expect(res.executed).toBe(true);
  expect(settings.textScale).toBe(1.1);
});

test('Una preferenza inesistente non viene applicata e non rompe lo stato', async ({ app }) => {
  // Prima fissiamo un tema noto, poi proviamo una chiave fuori whitelist.
  await runAction(app, { type: 'IMPOSTA_PREFERENZA', chiave: 'tema', valore: 'chiaro' });
  const { res, settings } = await runAction(app, { type: 'IMPOSTA_PREFERENZA', chiave: 'apiKey', valore: 'segreto' });
  expect(res.executed).toBe(false);
  expect(settings.theme).toBe('light'); // invariato
  expect(settings.apiKey).toBeUndefined();
});
