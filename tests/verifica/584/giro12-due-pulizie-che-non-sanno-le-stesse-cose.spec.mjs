// #584, dodicesimo giro — RILIEVO: nello STESSO documento due campi vengono
// ripuliti da due regole diverse, e la stessa cosa esce da una e non dall'altra.
//
// Queste prove FISSANO IL COMPORTAMENTO DI OGGI: diventeranno rosse quando le
// due pulizie conosceranno le stesse forme, ed e' giusto che sia chi corregge
// ad aggiornare l'attesa.
//
// Il pattern del repo (patterns/anonimo-si-guarda-campo-per-campo.md) lo dice
// con parole sue: «Una pulizia sola, usata da tutti i campi… Due pulizie
// separate divergono al primo ritocco». Qui hanno divergiuto.

import { test, expect } from '../../fixtures/electron.mjs';

async function tutti(app, casi) {
  return app.evaluate(async ({ app: _a }, casi) => {
    const S = globalThis.SN_PATHS_SAFETY;
    return casi.map((c) => ({
      dentroIndirizzo: S._internal.redigiPercorso(c.percorso, c.host || 'sito.it'),
      dentroElemento: S._internal.redactSelector(c.elemento),
      dentroIntento: S._internal.sanitizeIntent(c.intento),
    }));
  }, casi);
}

test('RILIEVO: un numero di cinque cifre sparisce dall’indirizzo e resta nel nome dell’elemento e nella frase', async ({ app }) => {
  const [r] = await tutti(app, [{
    percorso: '/ordini/12345',
    elemento: '[aria-label="Ordine 12345"]',
    intento: "aprire l'ordine 12345",
  }]);
  // Nell'indirizzo il numero diventa un segnaposto…
  expect(r.dentroIndirizzo).toBe('/ordini/[NUMERO]');
  // …e negli altri due campi dello STESSO documento esce intero: la regola
  // delle cifre attaccate, la' dove viene usata, parte da sei.
  expect(r.dentroElemento).toContain('12345');
  expect(r.dentroIntento).toContain('12345');
});

test('e a sei cifre le tre risposte coincidono: e’ la soglia a divergere, non l’intenzione', async ({ app }) => {
  const [r] = await tutti(app, [{
    percorso: '/ordini/847362',
    elemento: '[aria-label="Ordine 847362"]',
    intento: "aprire l'ordine 847362",
  }]);
  expect(r.dentroIndirizzo).toBe('/ordini/[NUMERO]');
  expect(r.dentroElemento).not.toContain('847362');
  expect(r.dentroIntento).not.toContain('847362');
});

test('RILIEVO: lo stesso indirizzo esce ripulito come pagina di partenza e intero dentro il nome dell’elemento', async ({ app }) => {
  const [r] = await tutti(app, [{
    percorso: '/u/mario.rossi/ordini/847362',
    elemento: 'a[href="/u/mario.rossi/ordini/847362"]',
    intento: 'aprire il profilo /u/mario.rossi',
  }]);
  // È l'esempio scritto nel pattern del repo: come pagina di partenza funziona.
  expect(r.dentroIndirizzo).toBe('/u/[ID]/ordini/[NUMERO]');
  // Lo stesso identico indirizzo, un campo piu' in la', tiene il nome: la
  // macchina che affetta gli indirizzi non viene chiamata la' dentro.
  expect(r.dentroElemento).toContain('mario.rossi');
  expect(r.dentroIntento).toContain('mario.rossi');
});

test('RILIEVO: le altre forme comuni di indirizzo con un nome dentro, nel nome dell’elemento', async ({ app }) => {
  const casi = [
    { percorso: '/utenti/12345/mario-rossi', elemento: 'a[href="/utenti/12345/mario-rossi"]', intento: 'x' },
    { percorso: '/user/mariorossi', elemento: 'a[href="/user/mariorossi"]', intento: 'x' },
    { percorso: '/in/mario-rossi', elemento: 'a[href="/in/mario-rossi"]', intento: 'x' },
  ];
  const out = await tutti(app, casi);
  out.forEach((r) => {
    // L'indirizzo: chiuso.
    expect(r.dentroIndirizzo).not.toMatch(/mario|rossi/i);
    // Il nome dell'elemento: aperto.
    expect(r.dentroElemento).toMatch(/mario|rossi/i);
  });
});

test('e sul cammino vero il nome arriva fino alla coda da cui il percorso parte', async ({ app }) => {
  const coda = await app.evaluate(async () => {
    const C = globalThis.SN_PATHS_COLLECTOR;
    const P = globalThis.SN_PATHS;
    C._reset(); C._setAuto(false); C._setSorteggio(() => 0);
    const vero = P.submit;
    P.submit = async () => ({ id: 'mai' });
    await C.collectAndSave({
      session: {
        rawUrl: 'https://sito.it/u/mario.rossi/ordini/847362',
        rawSteps: [{ selector: 'a[href="/u/mario.rossi/ordini/847362"]', action: 'click' }],
        rawUserMessages: ['dove trovo i miei ordini?'],
        success: true,
      },
      invokeAI: async ({ action }) => (action === 'help_intent_guess'
        ? { text: 'aprire i propri ordini' }
        : { text: '{"ok": true}' }),
    });
    const c = C._peek();
    P.submit = vero;
    C._reset();
    return c;
  });
  expect(coda.length).toBe(1);
  // La pagina di partenza e' pulita…
  expect(coda[0].initialUrl).not.toContain('mario.rossi');
  // …e lo stesso indirizzo dentro il passo no.
  expect(JSON.stringify(coda[0].steps)).toContain('mario.rossi');
});
