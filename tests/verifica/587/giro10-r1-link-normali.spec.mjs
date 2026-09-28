// #587 giro 10, rilievo 1: dopo un comando innocuo i link di tutti i giorni si aprono senza avviso.
import { test, expect } from '../../fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';
const execAction = (app, action, opts) =>
  app.evaluate((_electron, { action, opts }) =>
    globalThis.SN_EXECUTE_FILO_ACTION(action, opts), { action, opts });

// L'elenco della cartella personale: nessun segreto, niente che somigli ai link sotto.
const DOPO_LS = [{
  type: 'ESEGUI_COMANDO', comando: 'ls',
  _output: { command: 'ls', stdout: 'Documenti\nImmagini\nMusica\nScrivania\n', stderr: '', code: 0 },
}];

const NORMALI = [
  'https://it.wikipedia.org/wiki/Storia_della_matematica',
  'https://www.giallozafferano.it/ricette/Spaghetti-alla-Carbonara.html',
  'https://www.corriere.it/economia/consumi/24_settembre_12/prezzi-energia-bollette.shtml',
  'https://duckduckgo.com/?q=orari+treni+milano+torino',
];

for (const url of NORMALI) {
  test(`dopo «elenca i miei file» si apre senza avviso: ${url}`, async ({ app, openTab }) => {
    await openTab(NEWTAB);
    const r = await execAction(app, { type: 'NAVIGA', url }, { contesto: DOPO_LS });
    expect(r.needsConfirm, String(r.describe || '')).toBeFalsy();
    expect(r.executed).toBe(true);
  });
}
