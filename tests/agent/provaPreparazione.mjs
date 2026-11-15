// Il Filo su cui gira la prova da utente (tests/agent/prova.mjs, #2507): quello di un utente normale, acceso coi
// modelli di prova e senza il benvenuto, in tutti e due i modi. Spento, ogni funzione che passa da un modello fallisce
// per questo e non per il lavoro provato. Prova: tests/prova-da-utente.spec.mjs.

import { createRequire } from 'node:module';
import * as d from './driver.mjs';

const require = createRequire(import.meta.url);

/** Accende Filo con la chiave OpenRouter `chiave` e i modelli di prova (tests/fixtures/testModels.js), poi apre la home. */
export async function preparaFilo(app, shell, chiave) {
  require('../../src/shared/constants.js');
  require('../fixtures/testModels.js');
  const { registry, models } = globalThis.SN_TEST_MODELS;
  await app.evaluate(async (_e, { chiave, registry, models }) => {
    await chrome.storage.local.set({ filo_onboarding: { done: true } });
    await SN_STORAGE.updateSettings({ useDefaultModels: false, apiKeys: { openrouter: chiave }, models, modelRegistry: registry });
  }, { chiave, registry, models });
  // La home del primo avvio può ancora caricare: la navigazione allora si interrompe (did-fail-load -3) e va ripetuta.
  const suHome = () => app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)?._filoTabs;
    const wc = tm?.tabs?.find((t) => t.id === tm.activeId)?.view?.webContents;
    return Boolean(wc && !wc.isDestroyed() && wc.getURL().startsWith('filo://newtab') && !wc.isLoading());
  });
  for (let tentativo = 0; tentativo < 3; tentativo++) {
    await d.navigate(app, shell, 'filo://newtab/');
    for (const fine = Date.now() + 4000; Date.now() < fine; await d.sleep(200)) if (await suHome()) return;
  }
}
