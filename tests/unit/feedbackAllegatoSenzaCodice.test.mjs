// Un allegato caricato senza codice di scarico non si registra come riuscito.
// Verifica #583, giro 8.
//
// IL CASO CHE L'HA FATTA NASCERE
//   Le regole del deposito negano il `get`: chi passa da lì non scarica niente,
//   e l'unica chiave di un allegato è il codice di scarico che il deposito
//   rilascia al caricamento e che finisce nel link (`?alt=media&token=…`).
//   Firebase lo valuta PRIMA delle regole, quindi il link col codice continua a
//   funzionare mentre il solo indirizzo no.
//
//   Il caricamento però costruiva il link anche quando quel codice non tornava,
//   semplicemente omettendolo: finché il file era aperto a chiunque, il link
//   senza codice funzionava lo stesso e nessuno si accorgeva di niente. Con il
//   `get` negato quello stesso link non apre più niente — nemmeno al main di
//   chi i feedback li lavora, che è l'unico che quegli allegati li deve vedere.
//   Sarebbe un allegato perso in silenzio: il feedback arriva, la fotografia
//   che spiegava il problema no, e lo si scopre settimane dopo aprendo il
//   feedback e trovando un buco.
//
//   Quindi il caricamento rifiuta e lo dice. I due chiamanti dentro `submit`
//   raccolgono già l'errore in `failed`, e chi invia si ritrova il nome del
//   file fra quelli non caricati: può riprovare, o mandare il feedback senza.
//
// Senza il fix è ROSSO: il link si costruiva lo stesso, senza codice.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const require = createRequire(import.meta.url);
// #602 - nel deposito non entra piu niente in chiaro: `uploadImage` controlla
// che i byte siano un ciphertext prima di toccare la rete, quindi qui la
// cifratura va caricata come la carica l'app (loader.js) e i finti allegati
// vanno sigillati davvero.
require(join(ROOT, 'src', 'shared', 'feedbackPublicKey.js'));
require(join(ROOT, 'src', 'shared', 'feedbackCrypto.js'));
require(join(ROOT, 'src', 'shared', 'feedback.js'));

const FB = globalThis.SN_FEEDBACK;

// Il deposito visto dal caricamento: risponde 200 e torna i metadati che gli
// diciamo di tornare.
function deposito(metadati) {
  return async () => ({
    ok: true,
    status: 200,
    json: async () => metadati,
    text: async () => JSON.stringify(metadati),
  });
}

// Un allegato come quelli veri: cifrato, perche' e' l'unica forma in cui il
// caricamento lo accetta.
function blobFinto() {
  return FB.sealForUpload(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }));
}

test('col codice di scarico il link lo porta, ed è quello che apre il file', async () => {
  const vecchio = globalThis.fetch;
  globalThis.fetch = deposito({ downloadTokens: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' });
  try {
    const u = await FB.uploadImage(await blobFinto());
    assert.match(u.url, /[?&]alt=media(&|$)/);
    assert.match(u.url, /[&?]token=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee(&|$)/);
  } finally { globalThis.fetch = vecchio; }
});

test('il codice di scarico può arrivare dentro `metadata`, ed è lo stesso', async () => {
  const vecchio = globalThis.fetch;
  globalThis.fetch = deposito({ metadata: { downloadTokens: '11111111-2222-3333-4444-555555555555' } });
  try {
    const u = await FB.uploadImage(await blobFinto());
    assert.match(u.url, /[&?]token=11111111-2222-3333-4444-555555555555(&|$)/);
  } finally { globalThis.fetch = vecchio; }
});

test('senza codice di scarico il caricamento rifiuta invece di consegnare un link morto', async () => {
  const vecchio = globalThis.fetch;
  globalThis.fetch = deposito({ name: 'feedback/1700000000000_x.png' });
  try {
    await assert.rejects(
      async () => FB.uploadImage(await blobFinto()),
      (e) => {
        // Il messaggio deve dire cosa manca: chi lo legge nei log deve capire
        // che il file c'è ma non si riaprirà, non che "l'upload è fallito".
        assert.match(String(e.message), /codice di scarico/i);
        return true;
      },
    );
  } finally { globalThis.fetch = vecchio; }
});

test('un codice vuoto vale come assente: nessun link senza chiave', async () => {
  const vecchio = globalThis.fetch;
  globalThis.fetch = deposito({ downloadTokens: '' });
  try {
    await assert.rejects(async () => FB.uploadImage(await blobFinto()), /codice di scarico/i);
  } finally { globalThis.fetch = vecchio; }
});
