// #584, settimo giro — quello che resta fuori dalla lista dei «siti che non
// sono di nessuno», e la riga che promette di condividere dove non si condivide.
//
// Il sesto giro ha chiuso il nome del sito con due mosse: i siti che non sono
// di nessuno non si raccolgono affatto (indirizzi numerici, nomi di una parola
// sola, suffissi di rete locale, le pagine interne di Filo), e su tutti gli
// altri decide il modello che giudica, al quale il nome del sito adesso arriva.
//
// Quelle due mosse reggono, e le prove del sesto giro lo dicono. Qui si guarda
// il bordo che è rimasto scoperto: i nomi riservati che NON finiscono in
// `.local` e compagnia, cioè i nomi che per convenzione (RFC 6761 e seguito)
// non esistono e non esisteranno mai su Internet — `.localhost`, `.test`,
// `.invalid`, `.example` — e `.onion`, che è un indirizzo di rete anonima.
// Sono esattamente la stessa famiglia della prima mossa: cartelle pubbliche
// uguali per tutti, nomi che dicono come si chiama la macchina di chi naviga o
// a quale cliente lavora.
//
// GIRATE dopo la correzione di questo stesso giro: la lista adesso conosce i
// nomi riservati (`.localhost`, `.test`, `.invalid`, `.example`) e le reti
// anonime (`.onion`, `.alt`, `.i2p`), e da lì non esce più niente — senza
// spendere nemmeno una chiamata ai modelli, e senza che la lettura tocchi la
// rete.

import { test, expect } from '../../fixtures/electron.mjs';

// Nomi che per convenzione non sono e non saranno mai su Internet. Un percorso
// raccolto qui finisce in una cartella pubblica che ha lo stesso nome sul
// computer di chiunque altro: non c'è niente da indovinare.
const NOMI_RISERVATI = [
  // il modo consigliato di dare un nome a un servizio di prova sulla propria
  // macchina (e il nome che i contenitori si danno da soli)
  'http://app.localhost:3000/admin/utenti',
  // il nome che gli strumenti di sviluppo più diffusi danno al progetto in
  // lavorazione: lì dentro ci sta anche il nome di un cliente
  'http://progetto-rossi.test/clienti/fatture',
  'http://qualcosa.invalid/pannello',
  'https://negozio.example/account/ordini',
  // rete anonima: il nome del sito è il segreto, e i passi dicono cosa ci si fa
  'http://expyuzz4wqqyqhjn.onion/impostazioni',
];

// Il controllo di oggi, quello che la lista riservata non vede.
async function provaRaccolta(app, rawUrl) {
  return app.evaluate(async ({ app: _a }, { rawUrl }) => {
    const C = globalThis.SN_PATHS_COLLECTOR;
    const P = globalThis.SN_PATHS;
    C._reset();
    C._setAuto(false);
    C._setSorteggio(() => 0.5);
    const submitVero = P.submit;
    let spedizioni = 0;
    P.submit = async () => { spedizioni += 1; return { id: 'mai' }; };
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
    P.submit = submitVero;
    C._reset();
    return { r, coda, chiamate, spedizioni };
  }, { rawUrl });
}

for (const rawUrl of NOMI_RISERVATI) {
  test(`da ${rawUrl} non esce nessun percorso, e non si paga nemmeno un modello`, async ({ app }) => {
    const { r, coda, chiamate, spedizioni } = await provaRaccolta(app, rawUrl);
    expect(r.saved, `${rawUrl}: non si raccoglie`).toBe(false);
    expect(r.reason).toMatch(/privato o locale/);
    expect(chiamate, 'ci si ferma prima dei due modelli, che si pagano').toEqual([]);
    expect(coda.length).toBe(0);
    expect(spedizioni).toBe(0);
  });
}

test('e quelle cartelle non si leggono: un percorso messo lì apposta non arriva a nessuno', async ({ app }) => {
  const letti = await app.evaluate(async () => {
    const P = globalThis.SN_PATHS;
    const S = globalThis.SN_PATHS_SAFETY;
    const out = {};
    for (const d of ['app.localhost', 'progetto-rossi.test', 'qualcosa.invalid', 'negozio.example', 'expyuzz4wqqyqhjn.onion']) {
      // `segmentoDominio` è la porta della lettura: se torna il dominio, la
      // richiesta parte verso quella cartella.
      out[d] = { segmento: P._internal.segmentoDominio(d), condivisibile: S.sitoCondivisibile(d) };
    }
    return out;
  });
  for (const [dominio, esito] of Object.entries(letti)) {
    expect(esito.condivisibile, `${dominio}: non è un sito pubblico`).toBe(false);
    expect(esito.segmento, `${dominio}: la lettura non ci va`).toBe('');
  }
});

test('mentre i nomi che la lista conosce restano chiusi, in scrittura e in lettura: la correzione del sesto giro tiene', async ({ app }) => {
  const esito = await app.evaluate(async () => {
    const S = globalThis.SN_PATHS_SAFETY;
    const P = globalThis.SN_PATHS;
    const chiusi = ['localhost', 'options', '192.168.1.1', 'nas-rossi.local', 'portale.intranet', 'pc-ufficio.corp'];
    return chiusi.map((d) => ({ d, condivisibile: S.sitoCondivisibile(d), segmento: P._internal.segmentoDominio(d) }));
  });
  for (const riga of esito) {
    expect(riga.condivisibile, `${riga.d} non si condivide`).toBe(false);
    expect(riga.segmento, `${riga.d} non si legge`).toBe('');
  }
});
