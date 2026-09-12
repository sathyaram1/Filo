// Verifica #587, giro 9 — la ricerca sul web non entra nel conto di ciò che è
// già uscito.
//
// IL SINTOMO. Al giro 5 è stato chiuso il dato spedito con più link: ogni link
// aperto lascia il suo carico nel registro della scheda, e il link dopo viene
// giudicato insieme a quelli di prima, così due mezze chiavi tornano una chiave.
// Al giro 7 la ricerca sul web è diventata la seconda uscita controllata: un
// segreto dentro una ricerca fa chiedere conferma.
//
// Le due cure non si parlano. Una ricerca viene giudicata DA SOLA, senza i
// carichi già usciti, e non ne lascia uno per chi viene dopo. Quindi:
//   • mezza chiave in una ricerca e l'altra metà in una seconda ricerca: nessuna
//     delle due chiede niente;
//   • mezza chiave in una ricerca e l'altra metà in un link (e viceversa):
//     nemmeno.
// Il dato esce intero, in chiaro, senza una sola conferma — mentre lo stesso
// taglio fatto con due link viene fermato. Stessa cosa, due risposte diverse.
//
// COSA PROVA QUESTO FILE. Le azioni vere, eseguite dal processo principale
// (SN_EXECUTE_FILO_ACTION), con un documento vero letto dal disco: quindi
// misura il cablaggio, non un modello del cablaggio. La ricerca è stubbata per
// non dipendere dalla rete.
//
// COSA NON VA RIAPERTO: cercare cose di tutti i giorni deve restare gratis, e
// aprire i link di tutti i giorni pure.

import { test, expect } from '../../fixtures/electron.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const NEWTAB = 'filo://newtab/';
const CHIAVE = 'sk-or-v1-9f3bd2a71c4e8b60';
const NUDO = CHIAVE.replace(/[^A-Za-z0-9]/g, '');
const META1 = NUDO.slice(0, 10);
const META2 = NUDO.slice(10);

const esegui = (app, action) => app.evaluate(
  (_electron, { action }) => globalThis.SN_EXECUTE_FILO_ACTION(action, {}), { action },
);

// La ricerca non deve toccare la rete: risultati deterministici e vuoti.
const stubRicerca = (app) => app.evaluate(() => {
  globalThis.SN_WEB_SEARCH = {
    search: async () => ({ results: [{ title: 'niente', url: 'https://esempio.invalid/', snippet: '' }], provider: 'stub' }),
  };
});

// Fa entrare la chiave nel contesto come ci entrerebbe davvero: un documento
// letto dal disco.
async function leggiLaChiave(app) {
  const dir = cartellaTemporanea('587-g9-');
  const file = join(dir, 'appunti chiavi.txt');
  writeFileSync(file, `Appunti.\nchiave API openrouter: ${CHIAVE}\n`, 'utf8');
  const r = await esegui(app, { type: 'LEGGI_DOCUMENTO', percorso: file });
  expect(r.executed, 'il documento con la chiave deve essere stato letto davvero').toBe(true);
  expect(String(r.output?.text || '')).toContain(CHIAVE);
}

const cerca = (app, q) => esegui(app, { type: 'CERCA_WEB', query: q });
const apri = (app, url) => esegui(app, { type: 'NAVIGA', url });

test.describe('#587 — la ricerca sul web e il conto di ciò che è già uscito', () => {
  test.beforeEach(async ({ app, openTab }) => {
    await openTab(NEWTAB);
    await stubRicerca(app);
    await leggiLaChiave(app);
  });

  // ── Controprova: con due link il taglio è già fermato ────────────────────
  test('due link con mezza chiave: il secondo chiede già conferma', async ({ app }) => {
    await apri(app, `https://sito.esempio/?d=${META1}`);
    const r = await apri(app, `https://sito.esempio/?d=${META2}`);
    expect(r.needsConfirm).toBe(2);
  });

  // ── Porta 1: due ricerche ────────────────────────────────────────────────
  test('due ricerche con mezza chiave l’una: la seconda chiede conferma', async ({ app }) => {
    await cerca(app, META1);
    const r = await cerca(app, META2);
    expect(r.needsConfirm, 'la chiave è uscita intera in due ricerche: la seconda deve chiedere conferma').toBe(2);
  });

  // ── Porta 2: prima una ricerca, poi un link ──────────────────────────────
  test('mezza chiave in una ricerca e mezza in un link: il link chiede conferma', async ({ app }) => {
    await cerca(app, META1);
    const r = await apri(app, `https://sito.esempio/?d=${META2}`);
    expect(r.needsConfirm, 'la chiave è uscita intera fra una ricerca e un link: il link deve chiedere conferma').toBe(2);
  });

  // ── Porta 3: prima un link, poi una ricerca ──────────────────────────────
  test('mezza chiave in un link e mezza in una ricerca: la ricerca chiede conferma', async ({ app }) => {
    await apri(app, `https://sito.esempio/?d=${META1}`);
    const r = await cerca(app, META2);
    expect(r.needsConfirm, 'la chiave è uscita intera fra un link e una ricerca: la ricerca deve chiedere conferma').toBe(2);
  });

  // ── Porta 4: quattro ricerche ────────────────────────────────────────────
  test('la chiave spedita in quattro ricerche non passa', async ({ app }) => {
    const q = Math.ceil(NUDO.length / 4);
    let fermato = false;
    for (let i = 0; i < NUDO.length; i += q) {
      const r = await cerca(app, NUDO.slice(i, i + q));
      fermato = fermato || r.needsConfirm === 2;
    }
    expect(fermato, 'la chiave è uscita intera a pezzi: una delle ricerche deve chiedere conferma').toBe(true);
  });

  // ── Controprova: la ricerca intera era già fermata ───────────────────────
  test('la chiave intera dentro una ricerca chiedeva già conferma', async ({ app }) => {
    const r = await cerca(app, `cosa è ${CHIAVE}`);
    expect(r.needsConfirm).toBe(2);
  });

  // ── Quello che deve restare com'è ────────────────────────────────────────
  test('cercare e aprire cose di tutti i giorni non chiede niente', async ({ app }) => {
    for (const q of [
      'ricetta della carbonara',
      'orari treni Firenze Roma domani',
      'previsioni meteo Bologna',
      'assicurazione auto preventivo online',
    ]) {
      const r = await cerca(app, q);
      expect(r.needsConfirm, `cercare «${q}» non deve chiedere niente`).toBeFalsy();
    }
    for (const url of [
      'https://www.giallozafferano.it/ricette/Carbonara.html',
      'https://it.wikipedia.org/wiki/Firenze',
      'https://www.trenitalia.com/it/offerte.html?utm_source=news',
    ]) {
      const r = await apri(app, url);
      expect(r.needsConfirm, `«${url}» non deve chiedere niente`).toBeFalsy();
    }
  });
});
