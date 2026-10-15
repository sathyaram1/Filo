// Sentinella: in un feedback anonimo `images` e `files` portano solo URL del deposito di Filo (#597).
// Il server scarica quegli URL per ogni feedback; con la sola forma «lista di al più 5» chi segnala sceglieva
// dove il server andava a bussare. Il motore vero: tests/rules/feedback-allegati-motore-vero.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

import '../../src/shared/feedback.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
// `FIRESTORE_RULES_FILE` punta la sentinella alle regole di prima, per vederla rossa.
const RULES = readFileSync(process.env.FIRESTORE_RULES_FILE || join(ROOT, 'firestore.rules'), 'utf8');
// Via i commenti ma non lo `//` di `https://` dentro l'espressione.
const VIVO = RULES.replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const FB = globalThis.SN_FEEDBACK;

function corpoFunzione(nome) {
  const i = VIVO.indexOf(`function ${nome}(`);
  assert.notEqual(i, -1, `manca la funzione ${nome} nelle regole`);
  const apertura = VIVO.indexOf('{', i);
  let liv = 0;
  for (let j = apertura; j < VIVO.length; j++) {
    if (VIVO[j] === '{') liv++;
    else if (VIVO[j] === '}' && --liv === 0) return VIVO.slice(apertura + 1, j);
  }
  assert.fail(`funzione ${nome} senza chiusura`);
}

function createAnonima() {
  const inizio = VIVO.indexOf('match /feedback/{doc}');
  assert.ok(inizio >= 0, 'manca il match di /feedback');
  const blocco = VIVO.slice(inizio, VIVO.indexOf('match /', inizio + 1));
  const anonima = blocco.split(/allow create:/).slice(1).find((c) => c.includes('hasOnly') && c.includes("'images'"));
  assert.ok(anonima, 'manca la create anonima di /feedback con images fra le chiavi ammesse');
  return anonima.slice(0, anonima.indexOf(';'));
}

function regexAllegato() {
  const m = /u\.matches\('([^']+)'\)/.exec(corpoFunzione('allegatoDelDeposito'));
  assert.ok(m, 'allegatoDelDeposito non confronta l’URL con un’espressione');
  return new RegExp(m[1]);
}

/** L'URL che l'app scrive davvero nel documento: quello che torna da uploadImage. */
async function urlDellApp(tipo) {
  const prima = { fetch: globalThis.fetch, crypto: globalThis.SN_FEEDBACK_CRYPTO };
  globalThis.SN_FEEDBACK_CRYPTO = { isEncryptedBytes: () => true };
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ downloadTokens: randomUUID() }) });
  try {
    return (await FB.uploadImage(new Blob([new Uint8Array(200)], { type: tipo }))).url;
  } finally {
    globalThis.fetch = prima.fetch;
    globalThis.SN_FEEDBACK_CRYPTO = prima.crypto;
  }
}

const BASE = 'https://firebasestorage.googleapis.com/v0/b/filo-8b9cb.firebasestorage.app/o/';
const NOME = `feedback%2F1788891497000_${'3f2a1b0c-1111-4222-8333-444455556666'}.png`;
const BUONO = `${BASE}${NOME}?alt=media&token=0b5c3a7e-9d1f-4c2a-8e6b-1a2b3c4d5e6f`;

test('l’URL che l’app scrive per un allegato passa le regole', async () => {
  const re = regexAllegato();
  for (const tipo of ['image/png', 'image/jpeg', 'image/webp', 'application/octet-stream', 'application/pdf', '']) {
    for (let i = 0; i < 20; i++) {
      const url = await urlDellApp(tipo);
      assert.ok(re.test(url), `le regole rifiuterebbero un allegato caricato dall’app: ${url}`);
    }
  }
  // La forma dei ritrovamenti dell'agente esploratore (tests/agent/feedback.mjs): nome con etichetta.
  const etichettato = `${BASE}${encodeURIComponent(FB.attachmentPath('image/png', 'agent'))}?alt=media&token=${randomUUID()}`;
  assert.ok(re.test(etichettato), `le regole rifiuterebbero un ritrovamento dell’agente: ${etichettato}`);
  assert.ok(re.test(BUONO));
});

test('un URL che non è un oggetto del deposito di Filo non passa', () => {
  const re = regexAllegato();
  const fuori = [
    'https://esempio.invalid/x.png',
    'http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token',
    'http://localhost:8080/x.png',
    'data:image/png;base64,iVBORw0KGgo=',
    'file:///etc/passwd',
    '',
    BUONO.replace('https:', 'http:'),
    // Un altro deposito ospitato da Google, anche con un nome che comincia come il nostro.
    BUONO.replace('filo-8b9cb.firebasestorage.app', 'bucket-di-un-estraneo.appspot.com'),
    BUONO.replace('filo-8b9cb.firebasestorage.app', 'filo-8b9cb.firebasestorage.app.estraneo'),
    BUONO.replace('/o/', '/o/x/'),
    // Host che fingono.
    BUONO.replace('firebasestorage.googleapis.com', 'firebasestorage.googleapis.com.evil.invalid'),
    BUONO.replace('firebasestorage.googleapis.com', 'firebasestorage.googleapis.com@evil.invalid'),
    BUONO.replace('firebasestorage.googleapis.com', 'FirebaseStorage.googleapis.com'),
    // La risalita: `..` normalizzato dalla fetch porterebbe a un altro deposito sullo stesso host.
    `${BASE}feedback%2F..%2F..%2F..%2Fb%2Festraneo%2Fo%2Fx.png?alt=media&token=t`,
    `${BASE}${NOME}/../../../../estraneo/o/x.png?alt=media&token=t`,
    `${BASE}..%2F${NOME}?alt=media&token=t`,
    // Fuori dalla cartella dei feedback, o con un nome senza il segreto.
    `${BASE}altro%2F1788891497000_3f2a1b0c-1111-4222-8333-444455556666.png?alt=media&token=t`,
    `${BASE}feedback%2Fscreenshot.png?alt=media&token=t`,
    `${BASE}feedback%2F${NOME.slice('feedback%2F'.length)}`,
    // Coda che aggiunge parametri, frammenti o una seconda riga.
    `${BUONO}&redirect=https://evil.invalid`,
    `${BUONO}#https://evil.invalid`,
    `${BUONO}\nhttps://evil.invalid/x.png`,
    // La forma diretta di Google Storage: l'app non la scrive mai alla nascita.
    'https://storage.googleapis.com/filo-8b9cb.firebasestorage.app/feedback/1788891497000_3f2a1b0c-1111-4222-8333-444455556666.png',
  ];
  for (const url of fuori) assert.ok(!re.test(url), `le regole accetterebbero: ${JSON.stringify(url)}`);
});

test('allegatoDelDeposito vuole una stringa prima di confrontarla', () => {
  assert.match(corpoFunzione('allegatoDelDeposito'), /^\s*return u is string\s*&&/);
});

test('ogni posto della lista è controllato, fino al tetto', () => {
  for (const [nome, posto] of [
    ['immaginiDelDeposito', (i) => `allegatoDelDeposito(l[${i}])`],
    ['fileDelDeposito', (i) => `(l[${i}] is map && allegatoDelDeposito(l[${i}].get('url', '')))`],
  ]) {
    const corpo = corpoFunzione(nome);
    assert.match(corpo, /^\s*return l is list && l\.size\(\) <= \d+/, `${nome}: manca la forma della lista`);
    const tetto = Number(/l\.size\(\) <= (\d+)/.exec(corpo)[1]);
    assert.ok(tetto >= 1, `${nome}: tetto ${tetto}`);
    for (let i = 0; i < tetto; i++) {
      assert.ok(corpo.includes(`(l.size() < ${i + 1} || ${posto(i)})`),
        `${nome}: il posto ${i} della lista non è controllato (un URL qualunque passerebbe lì)`);
    }
  }
});

test('la create anonima passa images e files dal controllo del deposito', () => {
  const c = createAnonima();
  assert.ok(c.includes("immaginiDelDeposito(request.resource.data.get('images', []))"), 'images senza controllo del deposito');
  assert.ok(c.includes("fileDelDeposito(request.resource.data.get('files', []))"), 'files senza controllo del deposito');
});

test('nessun ramo di update fa entrare images o files dopo la nascita', () => {
  const inizio = VIVO.indexOf('match /feedback/{doc}');
  const blocco = VIVO.slice(inizio, VIVO.indexOf('match /', inizio + 1));
  for (const ramo of blocco.split(/allow update:/).slice(1)) {
    const testo = ramo.slice(0, ramo.indexOf(';'));
    assert.ok(!/'images'|'files'/.test(testo), `un update ammette images o files: ${testo.slice(0, 160)}`);
  }
});
