// Un errore passeggero o ambiguo del servizio dei token non distrugge sessione, identità o portafoglio (#1085):
// si esce, o si dichiara persa l'identità, solo coi quattro rifiuti definitivi di securetoken; un file che non
// si decifra si mette da parte e, se c'è un portafoglio, non nasce un'identità nuova al suo posto.
// Electron e rete sono finti (safeStorage con una chiave che si può cambiare, fetch scritto qui); il disco è vero.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Module from 'node:module';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const userData = cartellaTemporanea('filo-guasti-accesso-');

// La chiave del portachiavi: cambiarla è il «profilo ricreato» o il portachiavi sbagliato su Linux.
const portachiavi = { chiave: 'A', disponibile: true };
const electronFinto = {
  app: { getPath: () => userData },
  safeStorage: {
    isEncryptionAvailable: () => portachiavi.disponibile,
    encryptString: (s) => Buffer.from(`${portachiavi.chiave}|${s}`, 'utf8'),
    decryptString: (b) => {
      const t = Buffer.from(b).toString('utf8');
      if (!t.startsWith(`${portachiavi.chiave}|`)) throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.');
      return t.slice(2);
    },
  },
};
const caricaOriginale = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return electronFinto;
  return caricaOriginale.call(this, request, parent, isMain);
};

const AUTH = join(__dirname, '..', '..', 'src', 'main', 'auth');
const guasti = require(join(AUTH, 'guastiAccesso.js'));
const store = require(join(AUTH, 'token-store.js'));
const google = require(join(AUTH, 'google-auth.js'));
const anon = require(join(AUTH, 'anon-auth.js'));
const wallet = require(join(AUTH, 'wallet-store.js'));

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const rifiuto = (message, status = 400) => json(status, { error: { code: status, message, status: 'INVALID_ARGUMENT' } });
const CHIAVE_API_RIFIUTATA = () => rifiuto('API key not valid. Please pass a valid API key.');
const RINNOVATO = () => json(200, { id_token: 'id-nuovo', refresh_token: 'rt-1', expires_in: '3600', user_id: 'uid-1' });

// Risposte del servizio dei token, una per chiamata; signUp conta a parte.
let risposte = [];
let chiamate = { token: 0, signUp: 0 };
globalThis.fetch = async (url) => {
  if (/accounts:signUp/.test(String(url))) {
    chiamate.signUp += 1;
    return json(200, { idToken: 'anon-nuovo', refreshToken: `rt-nuovo-${chiamate.signUp}`, expiresIn: '3600', localId: `uid-nuovo-${chiamate.signUp}` });
  }
  chiamate.token += 1;
  const r = risposte.shift();
  if (!r) throw new Error('fetch failed');
  return r();
};

const file = (nome) => join(userData, nome);
const messiDaParte = (nome, etichetta) => readdirSync(userData).filter((n) => n.startsWith(`${nome}.${etichetta}`));

function svuota() {
  for (const n of readdirSync(userData)) rmSync(join(userData, n), { force: true });
}

beforeEach(() => {
  svuota();
  portachiavi.chiave = 'A';
  portachiavi.disponibile = true;
  risposte = [];
  chiamate = { token: 0, signUp: 0 };
  google.signOut();
  anon._reset();
});

// ─── Classificazione ──────────────────────────────────────────────────────────

test('solo i quattro rifiuti di securetoken sono definitivi, anche col «: spiegazione» in coda', () => {
  for (const m of ['INVALID_REFRESH_TOKEN', 'TOKEN_EXPIRED', 'USER_DISABLED', 'USER_NOT_FOUND', 'TOKEN_EXPIRED : the user must sign in again']) {
    assert.equal(guasti.rinnovoRifiutato(JSON.stringify({ error: { message: m } })), true, m);
  }
  for (const t of [
    JSON.stringify({ error: { message: 'API key not valid. Please pass a valid API key.' } }),
    JSON.stringify({ error: { message: 'QUOTA_EXCEEDED' } }),
    JSON.stringify({ error: { message: 'TOO_MANY_ATTEMPTS_TRY_LATER' } }),
    '<html><body>403 Forbidden</body></html>',
    '', 'null', '{"error":"INVALID_REFRESH_TOKEN"}',
  ]) assert.equal(guasti.rinnovoRifiutato(t), false, t);
});

test('l\'errore del servizio non raggiungibile non porta lo stato nel testo: un 403 del proxy non diventa «non sei amministratore» in Gestione', () => {
  const { permissionDeniedHelp } = require(join(__dirname, '..', '..', 'src', 'main', 'services', 'feedbackError.js'));
  for (const status of [400, 403, 407, 429, 500, 503]) {
    const e = guasti.nonRaggiungibile(status);
    assert.equal(e.code, 'servizio_non_raggiungibile');
    assert.equal(e.httpStatus, status);
    assert.equal(/\d{3}/.test(e.message), false, `HTTP ${status}`);
    assert.equal(permissionDeniedHelp(e.message, { email: 'owner@prova.test' }, { serverAdmin: null }), e.message, `HTTP ${status}`);
  }
});

test('mettere da parte non sovrascrive mai un file già messo da parte', () => {
  writeFileSync(file('x.bin'), 'uno');
  assert.ok(guasti.metteDaParte(file('x.bin'), 'prev'));
  writeFileSync(file('x.bin'), 'due');
  assert.ok(guasti.metteDaParte(file('x.bin'), 'prev'));
  assert.deepEqual(messiDaParte('x.bin', 'prev').sort(), ['x.bin.prev', 'x.bin.prev-2']);
  assert.equal(guasti.metteDaParte(file('x.bin'), 'prev'), null, 'niente da mettere da parte');
});

// ─── Accesso Google ───────────────────────────────────────────────────────────

function accedi(email = 'chi@prova.test') {
  store.save({ refreshToken: 'rt-google', email, name: 'Chi', picture: '' });
  google.restore();
  assert.equal(google.isSignedIn(), true);
  assert.ok(existsSync(file('auth.bin')));
}

for (const [nome, risposta] of [
  ['503', () => json(503, { error: { code: 503, message: 'Service Unavailable' } })],
  ['429', () => rifiuto('TOO_MANY_ATTEMPTS_TRY_LATER', 429)],
  ['un proxy che risponde 403 in HTML', () => new Response('<html>Forbidden</html>', { status: 403 })],
  ['un proxy che chiede credenziali (407)', () => new Response('Proxy Authentication Required', { status: 407 })],
  ['la chiave API del progetto rifiutata (400)', CHIAVE_API_RIFIUTATA],
]) {
  test(`accesso Google: ${nome} lascia la sessione e auth.bin, e il tentativo dopo riesce`, async () => {
    accedi();
    risposte = [risposta, RINNOVATO];
    await assert.rejects(google.getIdToken(), (e) => e.code === 'servizio_non_raggiungibile');
    assert.equal(google.isSignedIn(), true, 'ancora dentro');
    assert.ok(existsSync(file('auth.bin')), 'auth.bin non è stato cancellato');
    assert.deepEqual(store.load()?.refreshToken, 'rt-google');
    assert.equal(await google.getIdToken(), 'id-nuovo', 'tornato il servizio, il token arriva');
  });
}

test('accesso Google: il refresh token rifiutato chiude la sessione, e l\'owner resta riconosciuto come caduto', async () => {
  accedi('sathyarampontillo@gmail.com');
  assert.equal(google.isAdmin(), true);
  risposte = [() => rifiuto('INVALID_REFRESH_TOKEN')];
  await assert.rejects(google.getIdToken(), /refresh sessione fallito/);
  assert.equal(google.isSignedIn(), false);
  assert.equal(existsSync(file('auth.bin')), false);
  assert.equal(google.accessoOwnerCaduto(), true);
});

test('accesso Google: anche TOKEN_EXPIRED, USER_DISABLED e USER_NOT_FOUND chiudono', async () => {
  for (const m of ['TOKEN_EXPIRED', 'USER_DISABLED', 'USER_NOT_FOUND']) {
    accedi();
    risposte = [() => rifiuto(m)];
    await assert.rejects(google.getIdToken());
    assert.equal(google.isSignedIn(), false, m);
  }
});

test('accesso Google: un auth.bin che non si decifra si mette da parte, non si cancella', () => {
  accedi();
  google.signOut();
  writeFileSync(file('auth.bin'), electronFinto.safeStorage.encryptString(JSON.stringify({ refreshToken: 'rt-vecchio' })));
  portachiavi.chiave = 'B';
  google.restore();
  assert.equal(google.isSignedIn(), false);
  assert.equal(existsSync(file('auth.bin')), false);
  assert.equal(messiDaParte('auth.bin', 'illeggibile-').length, 1);
});

test('accesso Google: tornato il portachiavi di sempre, la sessione messa da parte riparte da sola', () => {
  accedi();
  google.signOut();
  writeFileSync(file('auth.bin'), electronFinto.safeStorage.encryptString(JSON.stringify({ refreshToken: 'rt-vecchio', email: 'chi@prova.test' })));
  portachiavi.chiave = 'B';
  google.restore();
  assert.equal(google.isSignedIn(), false, 'col portachiavi sbagliato si è fuori');
  portachiavi.chiave = 'A';
  google.restore();
  assert.equal(google.isSignedIn(), true);
  assert.equal(store.load()?.refreshToken, 'rt-vecchio');
  assert.equal(messiDaParte('auth.bin', 'illeggibile-').length, 0, 'il file è tornato al suo posto');
});

test('accesso Google: un portachiavi che va e viene, con un accesso rifatto in mezzo, non nasconde la sessione buona', () => {
  writeFileSync(file('auth.bin'), electronFinto.safeStorage.encryptString(JSON.stringify({ refreshToken: 'rt-buono' })));
  portachiavi.chiave = 'B';
  assert.equal(store.load(), null);
  store.save({ refreshToken: 'rt-col-portachiavi-sbagliato' });
  portachiavi.chiave = 'A';
  assert.equal(store.load()?.refreshToken, 'rt-buono', 'la copia più recente non si legge, quella prima sì');
  assert.ok(existsSync(file('auth.bin')));
});

test('accesso Google: chi esce apposta non rientra quando torna il portachiavi', () => {
  writeFileSync(file('auth.bin'), electronFinto.safeStorage.encryptString(JSON.stringify({ refreshToken: 'rt-vecchio' })));
  portachiavi.chiave = 'B';
  google.restore();
  google.signOut();
  portachiavi.chiave = 'A';
  google.restore();
  assert.equal(google.isSignedIn(), false);
  assert.equal(messiDaParte('auth.bin', 'illeggibile-').length, 0);
});

// ─── Identità dell'installazione ──────────────────────────────────────────────

function identitaSuDisco(refreshToken = 'rt-1') {
  writeFileSync(file('identity.bin'), electronFinto.safeStorage.encryptString(JSON.stringify({ refreshToken, uid: 'uid-1' })));
}
function portafoglioSuDisco() {
  writeFileSync(file('wallet.bin'), electronFinto.safeStorage.encryptString(JSON.stringify({ key: 'sk-or-v1-personale', pseudonym: 'p' })));
}

for (const [nome, risposta] of [
  ['la chiave API ruotata (400 «API key not valid»)', CHIAVE_API_RIFIUTATA],
  ['un 503', () => json(503, {})],
  ['un 429', () => rifiuto('TOO_MANY_ATTEMPTS_TRY_LATER', 429)],
  ['un proxy che risponde 403', () => new Response('<html>Forbidden</html>', { status: 403 })],
]) {
  test(`identità: ${nome} non la dichiara persa, il file resta, e il tentativo dopo riesce`, async () => {
    identitaSuDisco();
    portafoglioSuDisco();
    assert.equal(anon.restore(), true);
    risposte = [risposta, RINNOVATO];
    await assert.rejects(anon.getIdToken(), (e) => e.code === 'servizio_non_raggiungibile');
    assert.equal(anon.isLost(), false);
    assert.ok(existsSync(file('identity.bin')));
    assert.equal(await anon.getIdToken(), 'id-nuovo');
    assert.equal(chiamate.signUp, 0, 'nessuna identità nuova');
  });
}

test('identità: il token revocato la dichiara persa, ma non cancella file né ne crea un\'altra da sola', async () => {
  identitaSuDisco();
  portafoglioSuDisco();
  anon.restore();
  risposte = [() => rifiuto('INVALID_REFRESH_TOKEN')];
  await assert.rejects(anon.getIdToken(), (e) => e.code === 'identity_lost');
  assert.equal(anon.isLost(), true);
  await assert.rejects(anon.getIdToken(), (e) => e.code === 'identity_lost');
  assert.ok(existsSync(file('identity.bin')));
  assert.ok(existsSync(file('wallet.bin')));
  assert.equal(chiamate.signUp, 0);

  // Ricominciare (dopo il sì dell'utente): i file di prima restano accanto, e solo allora nasce un'identità nuova.
  anon.resetIdentity();
  wallet.metteDaParte();
  assert.ok(existsSync(file('identity.bin.prev')));
  assert.ok(existsSync(file('wallet.bin.prev')));
  assert.equal(await anon.getIdToken(), 'anon-nuovo');
  assert.equal(chiamate.signUp, 1);
});

test('identità: un file rovinato con un portafoglio su disco si rinomina, e nessuna identità nuova', async () => {
  writeFileSync(file('identity.bin'), Buffer.from([0, 1, 2, 3, 250]));
  portafoglioSuDisco();
  assert.equal(anon.restore(), false);
  assert.equal(existsSync(file('identity.bin')), false);
  assert.equal(messiDaParte('identity.bin', 'illeggibile-').length, 1);
  assert.equal(anon.isUnreadable(), true);
  await assert.rejects(anon.getIdToken(), (e) => e.code === 'identity_unreadable');
  assert.equal(chiamate.signUp, 0);
  assert.ok(existsSync(file('wallet.bin')), 'il portafoglio non si tocca');
});

test('identità: tornata la chiave del sistema, all\'avvio dopo l\'identità messa da parte riparte da sola', async () => {
  identitaSuDisco('rt-1');
  portafoglioSuDisco();
  portachiavi.chiave = 'B';
  assert.equal(anon.restore(), false);
  await assert.rejects(anon.getIdToken(), (e) => e.code === 'identity_unreadable');

  portachiavi.chiave = 'A';
  anon._reset();
  assert.equal(anon.restore(), true);
  assert.ok(existsSync(file('identity.bin')));
  assert.equal(messiDaParte('identity.bin', 'illeggibile-').length, 0);
  risposte = [RINNOVATO];
  assert.equal(await anon.getIdToken(), 'id-nuovo');
  assert.equal(chiamate.signUp, 0);
});

test('identità: una copia più recente scritta con la chiave sbagliata non nasconde quella buona messa da parte prima', () => {
  identitaSuDisco('rt-buono');
  portafoglioSuDisco();
  const buona = file('identity.bin.illeggibile-2026-01-01T00-00-00-000Z');
  writeFileSync(buona, readFileSync(file('identity.bin')));
  portachiavi.chiave = 'B';
  writeFileSync(file('identity.bin.illeggibile-2026-02-01T00-00-00-000Z'), electronFinto.safeStorage.encryptString(JSON.stringify({ refreshToken: 'rt-sbagliato' })));
  rmSync(file('identity.bin'));
  portachiavi.chiave = 'A';
  assert.equal(anon.restore(), true);
  assert.deepEqual(anon.segreti(), ['rt-buono']);
  assert.equal(existsSync(buona), false, 'tornata al suo posto');
  assert.ok(existsSync(file('identity.bin')));
});

test('identità: senza cifratura del sistema e con un portafoglio su disco non ne nasce una nuova', async () => {
  identitaSuDisco();
  portafoglioSuDisco();
  portachiavi.disponibile = false;
  assert.equal(anon.restore(), false);
  await assert.rejects(anon.getIdToken(), (e) => e.code === 'identity_unreadable');
  assert.equal(chiamate.signUp, 0);
  assert.ok(existsSync(file('identity.bin')), 'il file non si tocca: non si sa nemmeno se è leggibile');

  // Il portachiavi si sblocca dopo l'avvio: la richiesta dopo ritrova l'identità di prima.
  portachiavi.disponibile = true;
  risposte = [RINNOVATO];
  assert.equal(await anon.getIdToken(), 'id-nuovo');
  assert.equal(chiamate.signUp, 0);
});

test('identità: un file rovinato senza portafoglio si mette da parte e ne nasce una nuova', async () => {
  writeFileSync(file('identity.bin'), Buffer.from('rotto'));
  anon.restore();
  assert.equal(await anon.getIdToken(), 'anon-nuovo');
  assert.equal(chiamate.signUp, 1);
  assert.equal(messiDaParte('identity.bin', 'illeggibile-').length, 1);
  assert.ok(existsSync(file('identity.bin')), 'quella nuova è salvata');
});
