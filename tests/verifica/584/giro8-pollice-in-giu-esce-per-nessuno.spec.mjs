// #584, ottavo giro — il pollice in giù pubblica, e non lo legge nessuno.
//
// La riga sotto «Ha funzionato?» dice: «Rispondendo condividi i passi di questo
// percorso con chi userà Filo su questo sito». È l'unico punto in cui l'utente
// lo legge mentre sceglie, e vale per tutte e due le risposte: il pollice in
// giù manda lo stesso documento del pollice in su — sito, pagina di partenza,
// frase dell'intento, sequenza dei clic — con un solo campo diverso.
//
// Ma dall'altra parte quel documento non arriva a nessuno: chi legge chiede al
// server i soli percorsi riusciti, e quelli bocciati li scarta anche in casa.
// Restano nella raccolta pubblica, dove le regole lasciano leggere chiunque
// nomini il sito, e non servono a nessun utente di Filo.
//
// Queste prove fissano il comportamento di oggi (marcate RILIEVO dove è il
// rilievo): il documento parte, e la lettura non lo rende mai.

import { test, expect } from '../../fixtures/electron.mjs';

async function raccogli(app, success) {
  return app.evaluate(async ({ app: _a }, { success }) => {
    const C = globalThis.SN_PATHS_COLLECTOR;
    const P = globalThis.SN_PATHS;
    C._reset();
    C._setAuto(false);
    C._setSorteggio(() => 0.5);
    const submitVero = P.submit;
    P.submit = async () => ({ id: 'mai' });
    const r = await C.collectAndSave({
      session: {
        rawUrl: 'https://negozio-esempio.it/account/ordini',
        rawSteps: [{ selector: '[aria-label="I miei ordini"]', action: 'click' }],
        rawUserMessages: ['dove trovo i miei ordini?'],
        success,
      },
      invokeAI: async ({ action }) => (action === 'help_intent_guess'
        ? { text: 'aprire la pagina degli ordini' }
        : { text: '{"ok": true}' }),
    });
    const coda = C._peek();
    P.submit = submitVero;
    C._reset();
    return { r, coda };
  }, { success });
}

test('RILIEVO: il pollice in giù mette in coda lo stesso documento del pollice in su', async ({ app }) => {
  const su = await raccogli(app, true);
  const giu = await raccogli(app, false);

  expect(su.r.saved, 'il pollice in su pubblica').toBe(true);
  expect(giu.r.saved, 'e anche il pollice in giù').toBe(true);

  // La coda vive sul disco fra una prova e l'altra: l'ultima voce è quella
  // appena accodata.
  const a = su.coda[su.coda.length - 1];
  const b = giu.coda[giu.coda.length - 1];
  // Stesso sito, stessa pagina di partenza, stessa frase, stessi passi: cambia
  // solo l'esito. Quello che esce dal computer di chi naviga è identico.
  expect(b.domain).toBe(a.domain);
  expect(b.initialUrl).toBe(a.initialUrl);
  expect(b.intent).toBe(a.intent);
  expect(JSON.stringify(b.steps)).toBe(JSON.stringify(a.steps));
  expect(a.success).toBe(true);
  expect(b.success).toBe(false);
});

test('RILIEVO: e dall\'altra parte il percorso bocciato non arriva a nessun utente di Filo', async ({ app }) => {
  const r = await app.evaluate(async () => {
    const P = globalThis.SN_PATHS;
    // La domanda che il client fa davvero al server.
    const corpo = P._internal.corpoQuery({ limit: 50, onlySuccess: true });
    return {
      filtro: JSON.stringify(corpo.structuredQuery.where || null),
      // e com'è chiamata dall'assistente: solo i riusciti.
      firma: String(globalThis.SN_PATHS.listByDomain).includes('onlySuccess = true'),
    };
  });
  expect(r.filtro, 'la richiesta chiede success == true').toContain('success');
  expect(r.filtro).toContain('EQUAL');
  expect(r.firma, 'e il valore di serie è «solo i riusciti»').toBe(true);
});

test('la porta chiusa che regge: nel documento non c\'è niente che dica chi è stato', async ({ app }) => {
  const { coda } = await raccogli(app, false);
  const voce = coda[coda.length - 1];
  const campi = Object.keys(voce).sort();
  // Nella voce di coda ci stanno solo i campi del documento più gli orari
  // locali che servono alla coda: nessun identificativo, nessun user agent.
  expect(campi).toEqual(['accodatoIl', 'domain', 'id', 'initialUrl', 'intent', 'nonPrimaDi', 'steps', 'success']);
  const testo = JSON.stringify(voce).toLowerCase();
  expect(testo).not.toContain('clientid');
  expect(testo).not.toContain('useragent');
});
