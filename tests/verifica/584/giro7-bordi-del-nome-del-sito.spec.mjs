// #584, settimo giro — i bordi rimasti scoperti attorno ai «siti che non sono
// di nessuno», oltre ai nomi riservati che stanno nell'altro file del giro.
//
// Il sesto giro ha deciso che da certi indirizzi non si raccoglie niente,
// perché il nome del sito non si può ripulire (è anche la cartella pubblica in
// cui il documento finisce) e su un indirizzo privato quel nome dice come si
// chiama la macchina di chi naviga o per chi lavora. La lista guarda tre cose:
// gli indirizzi numerici, i nomi di una parola sola, e l'ultimo pezzo del nome
// quando è uno dei suffissi di rete locale.
//
// Qui si guardano due bordi:
//
//   1. `.alt`, il suffisso che sta accanto a `.onion` per le reti anonime, non
//      è nella lista (i nomi riservati veri e propri — `.localhost`, `.test`,
//      `.invalid`, `.example`, `.onion` — stanno nell'altro file);
//   2. il PUNTO FINALE. Un nome di host può finire con un punto (`localhost.`
//      è lo stesso host di `localhost`, scritto nella forma assoluta, e i
//      browser lo accettano). Con quel punto in fondo il nome «contiene un
//      punto» e l'ultimo pezzo è vuoto, quindi la lista non lo riconosce più:
//      `localhost.` passa la porta che `localhost` non passa. Il percorso si
//      paga i due modelli, entra in coda, e lì resta: la pulizia che rifà il
//      server rifiuta un nome che finisce col punto, quindi quell'invio non
//      riesce mai e il percorso si butta trenta giorni dopo.
//
// GIRATE dopo la correzione di questo stesso giro: `.alt` (con `.onion` e
// `.i2p`) sta nella lista, e il punto finale si toglie prima di ogni controllo,
// in scrittura come in lettura.

import { test, expect } from '../../fixtures/electron.mjs';

async function provaRaccolta(app, rawUrl) {
  return app.evaluate(async ({ app: _a }, { rawUrl }) => {
    const C = globalThis.SN_PATHS_COLLECTOR;
    C._reset();
    C._setAuto(false);
    C._setSorteggio(() => 0.5);
    const chiamate = [];
    const r = await C.collectAndSave({
      session: {
        rawUrl,
        rawSteps: [{ selector: '[aria-label="Avanzate"]', action: 'click' }],
        rawUserMessages: ['dove sono le impostazioni avanzate?'],
        success: true,
      },
      invokeAI: async ({ action }) => {
        chiamate.push(action);
        return action === 'help_intent_guess'
          ? { text: 'aprire le impostazioni avanzate' }
          : { text: '{"ok": true}' };
      },
    });
    const coda = C._peek();
    C._reset();
    return { r, coda, chiamate };
  }, { rawUrl });
}

test('«.alt», il suffisso delle reti anonime accanto a .onion, adesso è fra i nomi che non si condividono', async ({ app }) => {
  for (const u of ['http://qualcosa.alt/impostazioni', 'http://qualcosa.i2p/impostazioni']) {
    const { r, coda, chiamate } = await provaRaccolta(app, u);
    expect(r.saved, `${u}: non si raccoglie`).toBe(false);
    expect(chiamate, 'e non costa nemmeno una chiamata').toEqual([]);
    expect(coda.length).toBe(0);
  }
});

test('col punto finale «localhost.» è lo stesso host, e adesso è chiuso come «localhost»', async ({ app }) => {
  for (const u of ['http://localhost:3000/admin/utenti', 'http://localhost.:3000/admin/utenti']) {
    const { r, coda, chiamate } = await provaRaccolta(app, u);
    expect(r.saved, `${u}: non si raccoglie`).toBe(false);
    expect(chiamate, 'e non costa nemmeno una chiamata').toEqual([]);
    expect(coda.length).toBe(0);
  }
});

test('e su un sito vero il punto finale non fa più finire il percorso in una cartella che resterebbe vuota', async ({ app }) => {
  const esito = await app.evaluate(async () => {
    const S = globalThis.SN_PATHS_SAFETY;
    const pulito = S.sanitizeSubmission({
      domain: 'negoziofelice.it.',
      initialUrl: '/account/ordini',
      intent: 'vedere gli ordini passati',
      steps: [{ selector: '[aria-label="I miei ordini"]', action: 'click' }],
      success: true,
    });
    return { ok: pulito.ok, dominio: (pulito.doc && pulito.doc.domain) || '', reason: pulito.reason || '' };
  });
  expect(esito.ok).toBe(true);
  expect(esito.dominio, 'la stessa cartella del sito, non una nuova').toBe('negoziofelice.it');
});

test('e in lettura vale lo stesso: quelle cartelle non si aprono, e il sito vero si apre una volta sola', async ({ app }) => {
  const letti = await app.evaluate(async () => {
    const P = globalThis.SN_PATHS;
    const S = globalThis.SN_PATHS_SAFETY;
    const out = {};
    for (const d of ['localhost.', 'nas-rossi.local.', 'qualcosa.alt', 'qualcosa.i2p', 'negoziofelice.it.']) {
      out[d] = { segmento: P._internal.segmentoDominio(d), condivisibile: S.sitoCondivisibile(d) };
    }
    return out;
  });
  for (const d of ['localhost.', 'nas-rossi.local.', 'qualcosa.alt', 'qualcosa.i2p']) {
    expect(letti[d].condivisibile, `${d}: non è un sito pubblico`).toBe(false);
    expect(letti[d].segmento, `${d}: la lettura non ci va`).toBe('');
  }
  expect(letti['negoziofelice.it.'].condivisibile).toBe(true);
  expect(letti['negoziofelice.it.'].segmento, 'e il punto finale non apre una seconda cartella').toBe('negoziofelice.it');
});

test('gli indirizzi numerici restano chiusi in ogni forma, anche quelle abbreviate: quella porta tiene', async ({ app }) => {
  const esiti = await app.evaluate(async () => {
    const S = globalThis.SN_PATHS_SAFETY;
    const forme = ['http://127.0.0.1/a', 'http://127.1/a', 'http://0x7f.0.0.1/a',
      'http://2130706433/a', 'http://[::1]/a', 'http://10.0.0.5/a', 'http://192.168.1.1/a'];
    return forme.map((u) => {
      let host = '';
      try { host = new URL(u).hostname.toLowerCase(); } catch (_) { host = ''; }
      return { u, host, condivisibile: S.sitoCondivisibile(host) };
    });
  });
  for (const riga of esiti) {
    expect(riga.condivisibile, `${riga.u} (host ${riga.host}) non si condivide`).toBe(false);
  }
});
