// #584, undicesimo giro — RILIEVO: chi decide se CHIEDERE e chi decide se
// SPEDIRE non guardano il nome del sito con la stessa regola.
//
// Il settimo giro aveva chiuso la promessa che non si avvera: il riquadrino
// «Ha funzionato?» non compare più dove non si raccoglie niente, e la domanda
// la fa una porta sola (`raccoglibile`). Il nono giro aveva chiuso la stessa
// asimmetria dall'altra parte: chi legge e chi salva decidono il nome del sito
// con la stessa regola.
//
// Ne resta una terza, fra `raccoglibile` e la pulizia che spedisce.
// `raccoglibile` guarda il protocollo e i siti che non sono di nessuno;
// `sanitizeDomain`, che il client applica prima di spedire e che il server
// riapplica, guarda in più la FORMA del nome. Un nome di host con un trattino
// basso dentro, o che comincia con un trattino, passa la prima e non la
// seconda: il riquadro promette, si pagano due modelli, il percorso entra in
// coda e non partirà mai.
//
// Seconda porta, più rara, della stessa famiglia: la forma assoluta del nome
// (il punto finale). Lì il nome del sito viene normalizzato dappertutto tranne
// che nel confronto con l'elenco dei siti dove il nome utente è il primo pezzo
// dell'indirizzo, e il nome utente arriva intero ai due modelli e alla coda sul
// disco. Il documento pubblicato lo perde, perché la pulizia che spedisce rifà
// il lavoro col nome già normalizzato.
//
// Marcate RILIEVO: fissano il comportamento di oggi e diventeranno rosse quando
// le due porte daranno la stessa risposta.

import { test, expect } from '../../fixtures/electron.mjs';

test('RILIEVO: da un sito col trattino basso nel nome il riquadro promette, e il percorso non partirà mai', async ({ app }) => {
  const esito = await app.evaluate(async () => {
    const C = globalThis.SN_PATHS_COLLECTOR;
    const S = globalThis.SN_PATHS_SAFETY;
    const P = globalThis.SN_PATHS;
    C._reset(); C._setAuto(false); C._setSorteggio(() => 0.5);
    const url = 'https://mio_sito.it/clienti/ordini';
    // 1. la porta che disegna il riquadrino: da qui si raccoglie?
    const porta = await C.raccoglibile(url);
    // 2. il cammino vero: due modelli e la coda
    let modelli = 0;
    const vero = P.submit;
    P.submit = async () => ({ id: 'mai' });
    const r = await C.collectAndSave({
      session: {
        rawUrl: url,
        rawSteps: [{ selector: '[aria-label="I miei ordini"]', action: 'click' }],
        rawUserMessages: ['dove sono i miei ordini?'],
        success: true,
      },
      invokeAI: async ({ action }) => {
        modelli += 1;
        return action === 'help_intent_guess' ? { text: 'trovare gli ordini' } : { text: '{"ok": true}' };
      },
    });
    const coda = C._peek();
    P.submit = vero;
    // 3. e quello che la spedizione ne farebbe
    const spedibile = S.sanitizeSubmission({
      domain: 'mio_sito.it',
      initialUrl: '/clienti/ordini',
      intent: 'trovare gli ordini',
      steps: [{ selector: 'ordini', action: 'click' }],
      success: true,
    });
    C._reset();
    return { porta, modelli, salvato: r, inCoda: coda.length, spedibile };
  });

  // Il riquadro promette: «Rispondendo condividi i passi di questo percorso…»
  expect(esito.porta.ok).toBe(true);
  // Si pagano due modelli e il percorso entra in coda…
  expect(esito.modelli).toBe(2);
  expect(esito.salvato.saved).toBe(true);
  expect(esito.inCoda).toBe(1);
  // …ma da lì non esce: la pulizia che spedisce rifiuta quel nome.
  expect(esito.spedibile.ok).toBe(false);
  expect(esito.spedibile.reason).toBe('dominio non valido');
});

test('RILIEVO: e lo stesso con un nome che comincia con un trattino', async ({ app }) => {
  const esito = await app.evaluate(async () => {
    const C = globalThis.SN_PATHS_COLLECTOR;
    const S = globalThis.SN_PATHS_SAFETY;
    const porta = await C.raccoglibile('https://-sito-esempio.it/clienti/ordini');
    const spedibile = S.sanitizeSubmission({
      domain: '-sito-esempio.it',
      initialUrl: '/clienti/ordini',
      intent: 'trovare gli ordini',
      steps: [{ selector: 'ordini', action: 'click' }],
      success: true,
    });
    return { porta, spedibile };
  });
  expect(esito.porta.ok).toBe(true);
  expect(esito.spedibile.ok).toBe(false);
});

test('mentre i siti che non sono di nessuno restano chiusi da tutte e due le porte', async ({ app }) => {
  const r = await app.evaluate(async () => {
    const C = globalThis.SN_PATHS_COLLECTOR;
    const out = {};
    for (const u of [
      'https://localhost:3000/admin',
      'https://app.localhost:3000/admin',
      'https://progetto-rossi.test/clienti/fatture',
      'https://nas-rossi.local/foto',
      'https://192.168.1.1/setup',
      'filo://options/',
      'https://intranet.corp/area',
    ]) out[u] = (await C.raccoglibile(u)).ok;
    return out;
  });
  for (const [u, ok] of Object.entries(r)) expect(`${u} -> ${ok}`).toBe(`${u} -> false`);
});

test('RILIEVO: col punto finale nel nome del sito il nome utente arriva intero ai due modelli e alla coda', async ({ app }) => {
  const esito = await app.evaluate(async () => {
    const C = globalThis.SN_PATHS_COLLECTOR;
    const S = globalThis.SN_PATHS_SAFETY;
    const P = globalThis.SN_PATHS;
    C._reset(); C._setAuto(false); C._setSorteggio(() => 0.5);
    const url = 'https://github.com./mariorossi/progetto';
    const visti = [];
    const vero = P.submit;
    P.submit = async () => ({ id: 'mai' });
    await C.collectAndSave({
      session: {
        rawUrl: url,
        rawSteps: [{ selector: 'Issues', action: 'click' }],
        rawUserMessages: ['dove sono le segnalazioni?'],
        success: true,
      },
      invokeAI: async ({ action, payload }) => {
        visti.push({ action, initialUrl: payload.initialUrl, domain: payload.domain });
        return action === 'help_intent_guess' ? { text: 'aprire le segnalazioni' } : { text: '{"ok": true}' };
      },
    });
    const coda = C._peek();
    P.submit = vero;
    const pubblicato = S.sanitizeSubmission({
      domain: coda[0].domain,
      initialUrl: coda[0].initialUrl,
      intent: coda[0].intent,
      steps: coda[0].steps,
      success: true,
    });
    C._reset();
    return { visti, coda, pubblicato };
  });

  // Ai due modelli, e sul disco, il nome utente c'è.
  for (const v of esito.visti) expect(v.initialUrl).toBe('/mariorossi/progetto');
  expect(esito.coda[0].initialUrl).toBe('/mariorossi/progetto');
  // Nel documento che il server scriverebbe non c'è più: la pulizia che
  // spedisce rifà il lavoro col nome del sito già normalizzato.
  expect(esito.pubblicato.ok).toBe(true);
  expect(esito.pubblicato.doc.initialUrl).toBe('/[ID]/progetto');
});
