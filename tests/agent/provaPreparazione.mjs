// Il Filo su cui gira la prova da utente (tests/agent/prova.mjs, #2507): quello di un utente normale già accolto, acceso
// coi modelli di prova, in tutti e due i modi. Spento, ogni funzione che passa da un modello fallisce per questo e non
// per il lavoro provato. Prova: tests/prova-da-utente-filo.spec.mjs.

import { createRequire } from 'node:module';
import * as d from './driver.mjs';
import { paginaDellaScheda } from '../helpers/schede.mjs';

const require = createRequire(import.meta.url);

// L'accoglienza la dà l'interruttore che l'archivio legge da sé: una copia della sua forma qui resterebbe indietro, e la
// richiesta di chi prova finirebbe nell'intervista di benvenuto. Node nel main non segue il proxy da solo: senza, nel
// contenitore la chat non arriva al fornitore.
export const ENV_PROVA = Object.freeze({ FILO_TEST_ACCOLTO: '1', NODE_USE_ENV_PROXY: '1' });

export function apriFiloPerLaProva() {
  return d.launchFilo({ userDataPrefix: 'filo-prova-', extraEnv: ENV_PROVA });
}

// Larghe: sotto carico la prima home ci ha messo più di dieci secondi, e passarle sopra la lasciava senza la sua Page.
const ATTESA_HOME_MS = 45_000;

/** Accende Filo con la chiave OpenRouter `chiave` e i modelli di prova (tests/fixtures/testModels.js), poi ricarica la home. */
export async function preparaFilo(app, shell, chiave) {
  require('../../src/shared/constants.js');
  require('../fixtures/testModels.js');
  const { registry, models } = globalThis.SN_TEST_MODELS;
  // Ricaricare mentre la prima home carica la interrompe, e la Page di Playwright di quella scheda resta con l'indirizzo
  // vuoto: chi la cerca per indirizzo non la trova più (#2550). Prima si aspetta che sia finita.
  const scheda = await app.evaluate(({ BrowserWindow }, ms) => new Promise((ok, no) => {
    const fine = Date.now() + ms;
    const guarda = () => {
      const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)?._filoTabs;
      const tab = tm?.tabs?.find((t) => t.id === tm.activeId);
      const wc = tab?.view?.webContents;
      if (wc && !wc.isDestroyed() && !wc.isLoading() && wc.getURL().startsWith('filo://newtab')) return ok(tab.id);
      if (Date.now() > fine) return no(new Error(`la prima home non ha finito di caricare in ${ms / 1000} s (${wc ? wc.getURL() || 'senza indirizzo' : 'nessuna scheda'})`));
      setTimeout(guarda, 100);
    };
    guarda();
  }), ATTESA_HOME_MS);
  await app.evaluate(async (_e, { chiave, registry, models }) => {
    await SN_STORAGE.updateSettings({ useDefaultModels: false, apiKeys: { openrouter: chiave }, models, modelRegistry: registry });
  }, { chiave, registry, models });
  // La home già aperta ha deciso le sue carte senza chiave: ricaricata, parte da Filo acceso.
  await app.evaluate(({ BrowserWindow }, { scheda, ms }) => new Promise((ok, no) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)?._filoTabs;
    const wc = tm?.tabs?.find((t) => t.id === scheda)?.view?.webContents;
    if (!wc || wc.isDestroyed()) return no(new Error('la scheda della home si è chiusa durante la preparazione'));
    const tetto = setTimeout(() => no(new Error(`la home ricaricata non ha finito in ${ms / 1000} s`)), ms);
    wc.once('did-finish-load', () => { clearTimeout(tetto); ok(); });
    wc.reload();
  }), { scheda, ms: ATTESA_HOME_MS });
  for (const fine = Date.now() + ATTESA_HOME_MS; ; await d.sleep(100)) {
    if (await paginaDellaScheda(app, scheda, (p) => p.url().startsWith('filo://newtab'))) return;
    if (Date.now() > fine) throw new Error('la home ricaricata non ha la sua pagina per chi la pilota');
  }
}
