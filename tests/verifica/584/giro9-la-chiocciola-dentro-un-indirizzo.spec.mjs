// #584, nono giro — RILIEVO: il soprannome con la chiocciola esce ancora,
// nella forma in cui compare quasi sempre.
//
// L'ottavo giro aveva trovato che `@mariorossi` spariva dall'indirizzo e
// restava nell'etichetta di un pulsante, e la correzione l'ha tolto anche di
// lì. Ma solo quando la chiocciola APRE la parola: preceduta da inizio riga,
// spazio o virgoletta.
//
// Il nome degli elementi toccati che Filo pubblica non è un'etichetta: è il
// selettore con cui l'assistente indica l'elemento, e un link a un profilo si
// indica con l'indirizzo che ci porta — `a[href="/@mariorossi"]`. Lì davanti
// alla chiocciola c'è una barra, e il soprannome esce intero. Stessa cosa fra
// parentesi, che è come mezzo mondo scrive il soprannome accanto al nome
// («Mario Rossi (@mariorossi)»), e nella frase dell'intento quando cita
// l'indirizzo.
//
// Conta perché un soprannome è spesso lo stesso su più siti: due percorsi che
// lo contengono sono della stessa persona e per di più le danno un nome. È la
// ricucitura che questo lavoro è andato a chiudere.
//
// Le prove fissano il comportamento di OGGI e sono marcate RILIEVO.

import { test, expect } from '../../fixtures/electron.mjs';

test('RILIEVO: dentro un indirizzo il soprannome esce intero, ed è la forma normale di un selettore', async ({ app }) => {
  const r = await app.evaluate(async () => {
    const S = globalThis.SN_PATHS_SAFETY;
    return {
      href: S._internal.redactSelector('a[href="/@mariorossi"]'),
      hrefIntero: S._internal.redactSelector('a[href="https://www.youtube.com/@mariorossi"]'),
      parentesi: S._internal.redactSelector('[aria-label="Mario Rossi (@mariorossi)"]'),
      cancelletto: S._internal.redactSelector('#@mariorossi'),
      intento: S._internal.sanitizeIntent('aprire il profilo /@mariorossi e scrivergli'),
    };
  });
  expect(r.href).toContain('@mariorossi');
  expect(r.hrefIntero).toContain('@mariorossi');
  expect(r.parentesi).toContain('@mariorossi');
  expect(r.cancelletto).toContain('@mariorossi');
  expect(r.intento).toContain('@mariorossi');
});

test('mentre la porta che l’ottavo giro ha chiuso regge: dopo uno spazio o una virgoletta sparisce', async ({ app }) => {
  const r = await app.evaluate(async () => {
    const S = globalThis.SN_PATHS_SAFETY;
    return {
      etichetta: S._internal.redactSelector('[aria-label="Profilo di @mariorossi"]'),
      attributo: S._internal.redactSelector('[data-user="@mariorossi"]'),
      indirizzo: S._internal.normalizedPath('https://www.youtube.com/@mariorossi/video'),
      classe: S._internal.redactSelector('.\\@sm\\:flex > button'),
    };
  });
  expect(r.etichetta).toBe('[aria-label="Profilo di [ID]"]');
  expect(r.attributo).toBe('[data-user="[ID]"]');
  expect(r.indirizzo).toBe('/[ID]/video');
  // e un nome di classe con la chiocciola protetta non è un soprannome
  expect(r.classe).toContain('@sm');
});

test('RILIEVO: e sul cammino vero il soprannome arriva fino alla coda di partenza', async ({ app }) => {
  const voce = await app.evaluate(async () => {
    const C = globalThis.SN_PATHS_COLLECTOR;
    const P = globalThis.SN_PATHS;
    C._reset(); C._setAuto(false); C._setSorteggio(() => 0.5);
    const vero = P.submit;
    P.submit = async () => ({ id: 'mai' });
    await C.collectAndSave({
      session: {
        rawUrl: 'https://social-esempio.it/esplora',
        rawSteps: [{ selector: 'a[href="/@mariorossi"]', action: 'click' }],
        rawUserMessages: ['aprimi quel profilo'],
        success: true,
      },
      invokeAI: async ({ action }) => (action === 'help_intent_guess'
        ? { text: 'aprire un profilo dalla pagina esplora' }
        : { text: '{"ok": true}' }),
    });
    const coda = C._peek();
    P.submit = vero;
    C._reset();
    return coda[coda.length - 1] || null;
  });
  expect(voce).not.toBeNull();
  expect(JSON.stringify(voce.steps)).toContain('@mariorossi');
});
