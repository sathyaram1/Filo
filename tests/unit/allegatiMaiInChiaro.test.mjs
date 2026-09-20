// #602 — nel deposito degli allegati non entra niente in chiaro.
//
// IL CASO CHE L'HA FATTA NASCERE
//   La cifratura degli allegati era una cortesia: se la chiave pubblica non era
//   caricata, o se l'operazione andava storta, l'app scriveva una riga nella
//   console e caricava il file COM'ERA. Il deposito si legge col codice di
//   scarico che sta nel collegamento, e quel collegamento gira: un allegato
//   caricato in chiaro lo legge chiunque se lo sia portato via. Cioè il momento
//   in cui la protezione si rompe era esattamente il momento in cui smetteva di
//   esserci, in silenzio, senza che chi manda lo sapesse.
//
//   E la chiave pubblica NON era caricata in un punto preciso: la pagina dei
//   feedback, l'unica che carica da sola nel deposito (gli allegati dei
//   COMMENTI, dove finiscono le schermate e i log del lavoro). Lì il ripiego
//   scattava sempre, e ogni allegato di un commento saliva in chiaro.
//
// COSA ASSERISCE (senza il fix è ROSSO in ogni caso)
//   · senza cifratura l'invio si RIFIUTA, e si rifiuta PRIMA di toccare la rete
//     (niente parte davvero, non «parte tutto tranne il testo»);
//   · il rifiuto porta una frase che dice cosa è mancato e che non è partito
//     niente;
//   · gli allegati dei COMMENTI salgono cifrati come quelli della segnalazione,
//     e chi ha la chiave privata li rilegge identici all'originale;
//   · `uploadImage` — l'unico punto che scrive nel deposito — rifiuta byte che
//     non siano un ciphertext, da qualunque chiamante arrivino.
//
// Gira senza Electron, in millisecondi.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const require = createRequire(import.meta.url);

require(join(ROOT, 'src', 'shared', 'feedbackPublicKey.js'));
const CRYPTO = require(join(ROOT, 'src', 'shared', 'feedbackCrypto.js'));
require(join(ROOT, 'src', 'shared', 'feedback.js'));
const FB = globalThis.SN_FEEDBACK;

// ── Attrezzi ────────────────────────────────────────────────────────────────

// Coppia ECDH P-256 di prova: la pubblica per cifrare, la privata per rileggere
// ciò che è finito nel deposito (nell'app quella privata ce l'ha solo l'owner).
async function coppiaDiProva() {
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pubRaw = new Uint8Array(await webcrypto.subtle.exportKey('raw', pair.publicKey));
  const privPkcs8 = new Uint8Array(await webcrypto.subtle.exportKey('pkcs8', pair.privateKey));
  const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return { pub: b64url(pubRaw), priv: Buffer.from(privPkcs8).toString('base64') };
}

// Il deposito e il database visti dall'invio: registrano ogni corpo caricato e
// rispondono come risponderebbe Firebase.
function installaRete() {
  const caricati = [];  // corpi POST verso il deposito
  const documenti = []; // corpi POST verso Firestore
  const prev = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('uploadType=media')) {
      caricati.push(opts.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({ downloadTokens: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }),
        text: async () => '',
      };
    }
    if (u.includes('/counters/')) {
      if (opts && opts.method === 'PATCH') return { ok: true, status: 200, json: async () => ({}) };
      return {
        ok: true,
        status: 200,
        json: async () => ({ fields: { value: { integerValue: '5' } }, updateTime: '2026-09-01T00:00:00Z' }),
      };
    }
    documenti.push(JSON.parse(opts.body || '{}'));
    return {
      ok: true,
      status: 200,
      json: async () => ({ name: 'projects/p/databases/(default)/documents/feedback/DOC_1' }),
      text: async () => '',
    };
  };
  return {
    caricati,
    documenti,
    tocchi: () => caricati.length + documenti.length,
    restore() { globalThis.fetch = prev; },
  };
}

// Spegne la cifratura come se l'app fosse messa male: `motivo` sceglie quale
// dei due modi (chiave pubblica assente, oppure modulo di cifratura assente).
function senzaCifratura(modo, corpo) {
  const pub = globalThis.SN_FEEDBACK_PUBKEY;
  const mod = globalThis.SN_FEEDBACK_CRYPTO;
  if (modo === 'senza-chiave') globalThis.SN_FEEDBACK_PUBKEY = null;
  else delete globalThis.SN_FEEDBACK_CRYPTO;
  return Promise.resolve()
    .then(corpo)
    .finally(() => {
      globalThis.SN_FEEDBACK_PUBKEY = pub;
      globalThis.SN_FEEDBACK_CRYPTO = mod;
    });
}

const PNG_FINTO = 'data:image/png;base64,' + Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).toString('base64');

function blobDiTesto(testo, tipo = 'text/plain') {
  return new Blob([new TextEncoder().encode(testo)], { type: tipo });
}

// ── La cifratura indisponibile ferma l'invio, e lo ferma prima della rete ────

for (const modo of ['senza-chiave', 'senza-modulo']) {
  test(`cifratura indisponibile (${modo}): l'invio si rifiuta e non tocca la rete`, async () => {
    const rete = installaRete();
    try {
      await senzaCifratura(modo, async () => {
        await assert.rejects(
          () => FB.submit({ text: 'una segnalazione', images: [{ dataUrl: PNG_FINTO }] }),
          (e) => {
            // La frase deve dire DUE cose: che non è partito niente e perché.
            // Senza il perché, chi la legge non sa se riprovare serve a qualcosa.
            assert.match(String(e.message), /non è partito niente/i, `frase: ${e.message}`);
            assert.match(String(e.message), /chiave|cifra/i, `frase: ${e.message}`);
            assert.equal(FB.isEncryptionError(e), true, 'deve essere riconoscibile come errore di cifratura');
            return true;
          },
        );
      });
      // «Nulla è partito» alla lettera: né l'allegato nel deposito né il
      // documento nel database. Il controllo sta PRIMA dei caricamenti apposta.
      assert.equal(rete.tocchi(), 0, 'nessuna chiamata di rete doveva partire');
    } finally { rete.restore(); }
  });
}

test("cifratura indisponibile: nemmeno un allegato di commento sale", async () => {
  const rete = installaRete();
  try {
    await senzaCifratura('senza-chiave', async () => {
      await assert.rejects(
        () => FB.uploadAttachment(blobDiTesto('log del guasto'), 'log.txt'),
        (e) => {
          assert.match(String(e.message), /non è partito niente/i);
          assert.equal(FB.isEncryptionError(e), true);
          return true;
        },
      );
    });
    assert.equal(rete.caricati.length, 0, 'il deposito non doveva ricevere niente');
  } finally { rete.restore(); }
});

test('la cifratura che va storta a metà ferma tutto come se non ci fosse', async () => {
  const rete = installaRete();
  const vera = CRYPTO.encryptBytesForOwner;
  globalThis.SN_FEEDBACK_CRYPTO.encryptBytesForOwner = async () => { throw new Error('boom'); };
  try {
    await assert.rejects(
      () => FB.submit({ text: 'con allegato', images: [{ dataUrl: PNG_FINTO }] }),
      (e) => { assert.equal(FB.isEncryptionError(e), true); return true; },
    );
    assert.equal(rete.caricati.length, 0, 'niente doveva finire nel deposito');
    assert.equal(rete.documenti.length, 0, 'e nessun documento doveva nascere');
  } finally {
    globalThis.SN_FEEDBACK_CRYPTO.encryptBytesForOwner = vera;
    rete.restore();
  }
});

test('una cifratura che restituisce l’originale non inganna il controllo', async () => {
  // Il caso limite che rende il controllo una difesa e non una formalità: se
  // `encryptBytesForOwner` tornasse i byte com'erano, senza questo assert il
  // file partirebbe in chiaro passando per la porta della cifratura.
  const rete = installaRete();
  const vera = CRYPTO.encryptBytesForOwner;
  globalThis.SN_FEEDBACK_CRYPTO.encryptBytesForOwner = async (b) => b;
  try {
    await assert.rejects(
      () => FB.uploadAttachment(blobDiTesto('segreto'), 'nota.txt'),
      (e) => { assert.equal(FB.isEncryptionError(e), true); return true; },
    );
    assert.equal(rete.caricati.length, 0);
  } finally {
    globalThis.SN_FEEDBACK_CRYPTO.encryptBytesForOwner = vera;
    rete.restore();
  }
});

// ── Il deposito rifiuta i byte in chiaro da QUALUNQUE chiamante ──────────────

test('uploadImage rifiuta byte non cifrati: il controllo sta all’imbocco, non nei chiamanti', async () => {
  const rete = installaRete();
  try {
    await assert.rejects(
      () => FB.uploadImage(blobDiTesto('ciao', 'image/png')),
      (e) => {
        assert.equal(FB.isEncryptionError(e), true);
        assert.match(String(e.message), /non è partito niente/i);
        return true;
      },
    );
    assert.equal(rete.caricati.length, 0, 'non deve arrivare al deposito');
  } finally { rete.restore(); }
});

// ── Quello che SALE è cifrato, e chi ha la privata lo rilegge identico ───────

test("l'allegato di un COMMENTO sale cifrato e si rilegge identico con la privata", async () => {
  const { pub, priv } = await coppiaDiProva();
  const rete = installaRete();
  const pubSalvata = globalThis.SN_FEEDBACK_PUBKEY;
  globalThis.SN_FEEDBACK_PUBKEY = pub;
  const testo = 'log del guasto: riga che non deve finire in chiaro nel deposito';
  try {
    const att = await FB.uploadAttachment(blobDiTesto(testo), 'log.txt');

    // Quello che la dashboard salva nella conversazione descrive il file VERO,
    // non l'involucro cifrato: è così che sa se mostrare un'immagine o un
    // collegamento, e con che tipo riaprirlo dopo averlo decifrato.
    assert.equal(att.kind, 'file');
    assert.equal(att.type, 'text/plain');
    assert.equal(att.name, 'log.txt');

    assert.equal(rete.caricati.length, 1, 'un caricamento solo');
    const saliti = new Uint8Array(await rete.caricati[0].arrayBuffer());
    assert.ok(CRYPTO.isEncryptedBytes(saliti), 'i byte caricati devono essere un ciphertext');
    const inChiaro = new TextDecoder().decode(Buffer.from(saliti));
    assert.ok(!inChiaro.includes('log del guasto'), 'il testo non deve comparire nel deposito');

    // E quello che l'owner riapre dalla dashboard è ESATTAMENTE l'originale.
    const riletti = await CRYPTO.decryptBytes(saliti, priv);
    assert.equal(new TextDecoder().decode(riletti), testo);
  } finally {
    globalThis.SN_FEEDBACK_PUBKEY = pubSalvata;
    rete.restore();
  }
});

test("anche un'immagine allegata a un commento sale cifrata", async () => {
  const { pub, priv } = await coppiaDiProva();
  const rete = installaRete();
  const pubSalvata = globalThis.SN_FEEDBACK_PUBKEY;
  globalThis.SN_FEEDBACK_PUBKEY = pub;
  const pixel = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 42]);
  try {
    const att = await FB.uploadAttachment(new Blob([pixel], { type: 'image/png' }), 'schermata.png');
    assert.equal(att.kind, 'img', 'una schermata resta una schermata per la dashboard');
    assert.equal(att.type, 'image/png');

    const saliti = new Uint8Array(await rete.caricati[0].arrayBuffer());
    assert.ok(CRYPTO.isEncryptedBytes(saliti));
    assert.deepEqual(Array.from(await CRYPTO.decryptBytes(saliti, priv)), Array.from(pixel));
  } finally {
    globalThis.SN_FEEDBACK_PUBKEY = pubSalvata;
    rete.restore();
  }
});

test('gli allegati della segnalazione salgono cifrati come quelli dei commenti', async () => {
  const { pub, priv } = await coppiaDiProva();
  const rete = installaRete();
  const pubSalvata = globalThis.SN_FEEDBACK_PUBKEY;
  globalThis.SN_FEEDBACK_PUBKEY = pub;
  try {
    const r = await FB.submit({
      text: 'con una schermata',
      images: [{ dataUrl: PNG_FINTO }],
      files: [{ name: 'note.txt', type: 'text/plain', dataUrl: 'data:text/plain;base64,' + Buffer.from('riservato').toString('base64') }],
    });
    assert.equal(r.failed.length, 0, `nessun allegato doveva fallire: ${JSON.stringify(r.failed)}`);
    assert.equal(rete.caricati.length, 2);
    for (const corpo of rete.caricati) {
      const byte = new Uint8Array(await corpo.arrayBuffer());
      assert.ok(CRYPTO.isEncryptedBytes(byte), 'ogni allegato deve salire cifrato');
    }
    const note = await CRYPTO.decryptBytes(new Uint8Array(await rete.caricati[1].arrayBuffer()), priv);
    assert.equal(new TextDecoder().decode(note), 'riservato');
  } finally {
    globalThis.SN_FEEDBACK_PUBKEY = pubSalvata;
    rete.restore();
  }
});

// ── La pagina che carica da sola deve avere la cifratura sotto mano ──────────

test('la pagina dei feedback carica la cifratura: è lei a caricare nel deposito', async () => {
  // Sentinella. Gli allegati dei commenti li carica il codice della PAGINA
  // (`SN_FEEDBACK.uploadAttachment`), non il main: senza questi due script in
  // pagina `SN_FEEDBACK_CRYPTO` lì non esiste, ed è per questo che per mesi
  // quegli allegati sono saliti in chiaro. Ora il caricamento si fermerebbe
  // invece di ripiegare — ma fermarsi non è la cura: la cura è averla.
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(join(ROOT, 'src', 'pages', 'feedback', 'feedback.html'), 'utf8');
  assert.match(html, /shared\/feedbackPublicKey\.js/, 'manca la chiave pubblica nella pagina dei feedback');
  assert.match(html, /shared\/feedbackCrypto\.js/, 'manca il modulo di cifratura nella pagina dei feedback');
});

test('ogni punto che carica nel deposito passa dalla cifratura', async () => {
  // Sentinella sulle STRADE, non sul singolo caso: chiudere la porta segnalata
  // per ultima è già costato dei giri interi altrove. Chi apre una POST verso
  // il deposito deve stare in un file che la cifratura la usa davvero.
  const { readFileSync } = await import('node:fs');
  const sorgenti = [
    join(ROOT, 'src', 'shared', 'feedback.js'),
    join(ROOT, 'tests', 'agent', 'feedback.mjs'),
  ];
  for (const f of sorgenti) {
    const src = readFileSync(f, 'utf8');
    assert.match(src, /uploadType=media/, `${f} doveva essere un punto di caricamento`);
    assert.match(
      src,
      /encryptBytesForOwner|sealForUpload|assertSealed/,
      `${f} carica nel deposito senza passare dalla cifratura`,
    );
  }
});
