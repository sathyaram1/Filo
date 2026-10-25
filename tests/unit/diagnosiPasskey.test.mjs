// La diagnostica delle passkey (#1608): il riassunto nel mondo della pagina non porta mai gli id, con «ibrido» Chromium
// riceve hybrid in più senza che la pagina veda cambiare i suoi oggetti, spenta non entra niente; il main tiene solo la
// forma attesa di ciò che la pagina gli manda.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const P = require('../../src/preload/diagnosi-passkey.js');
const M = require('../../src/main/services/diagnosiPasskey.js');

// Il corpo gira in un contesto suo, come nella pagina: se usasse qualcosa del modulo, qui non lo troverebbe.
function monta(modo, { get, create, capacita } = {}) {
  const eventi = [];
  class CustomEvent { constructor(tipo, init) { this.type = tipo; this.detail = init && init.detail; } }
  const window = { CustomEvent, EventTarget: { prototype: { dispatchEvent(e) { eventi.push(e); return true; } } } };
  const ctx = vm.createContext({ window, navigator: { userAgentData: { brands: [{ brand: 'Chromium', version: '152' }] } } });
  const applica = vm.runInContext(P.buildPasskeyCorpo(modo), ctx);
  const ricevute = [];
  const w = {
    CredentialsContainer: { prototype: {
      get(o) { ricevute.push(o); return get ? get(o) : Promise.resolve({ authenticatorAttachment: 'cross-platform' }); },
      create(o) { ricevute.push(o); return create ? create(o) : Promise.resolve({ authenticatorAttachment: 'platform', response: { getTransports: () => ['internal', 'hybrid'] } }); },
    } },
    PublicKeyCredential: {
      getClientCapabilities() { return Promise.resolve(capacita || { hybridTransport: true, userVerifyingPlatformAuthenticator: false, nonBooleano: 'x' }); },
      isUserVerifyingPlatformAuthenticatorAvailable() { return Promise.resolve(true); },
    },
  };
  applica(w);
  const registri = () => eventi.filter((e) => e.type === P.EVENTO_PASSKEY).map((e) => JSON.parse(e.detail));
  const cc = { get: (o) => w.CredentialsContainer.prototype.get.call({}, o), create: (o) => w.CredentialsContainer.prototype.create.call({}, o) };
  return { w, cc, ricevute, registri };
}
const attesa = () => new Promise((r) => setTimeout(r, 0));
const id = (n, b = 0xab) => new Uint8Array(n).fill(b);

test('la variabile: vuota o «no» spegne, «ibrido» aggiunge il trasporto, il resto registra soltanto', () => {
  for (const v of [undefined, null, '', '  ', '0', 'no', 'OFF', 'false']) assert.equal(P.modoDiagnosiPasskey(v), null, String(v));
  assert.deepEqual(P.modoDiagnosiPasskey('1'), { ibrido: false });
  assert.deepEqual(P.modoDiagnosiPasskey('registra'), { ibrido: false });
  assert.deepEqual(P.modoDiagnosiPasskey(' Ibrido '), { ibrido: true });
  assert.deepEqual(P.modoDiagnosiPasskey('hybrid'), { ibrido: true });
});

test('solo registro: Chromium riceve gli oggetti della pagina, il riassunto ha lunghezze e trasporti e mai gli id', async () => {
  const { cc, ricevute, registri } = monta({ ibrido: false });
  const opzioni = { mediation: 'optional', publicKey: { challenge: id(32), rpId: 'google.com', userVerification: 'preferred', timeout: 60000,
    hints: ['hybrid'], extensions: { appid: 'x' }, allowCredentials: [
      { type: 'public-key', id: id(16), transports: ['internal'] },
      { type: 'public-key', id: id(65) },
    ] } };
  const r = await cc.get(opzioni);
  assert.equal(r.authenticatorAttachment, 'cross-platform');
  assert.equal(ricevute[0], opzioni);
  await attesa();
  const [rec] = registri();
  assert.equal(rec.tipo, 'get');
  assert.equal(rec.rpId, 'google.com');
  assert.equal(rec.mediazione, 'optional');
  assert.equal(rec.verifica, 'preferred');
  assert.deepEqual(rec.suggerimenti, ['hybrid']);
  assert.deepEqual(rec.estensioni, ['appid']);
  assert.equal(rec.quante, 2);
  assert.deepEqual(rec.credenziali, [{ lunghezzaId: 16, trasporti: ['internal'] }, { lunghezzaId: 65 }]);
  assert.equal(rec.esito, 'ok');
  assert.equal(rec.usato, 'cross-platform');
  assert.equal(rec.marchi, 'Chromium 152');
  assert.ok(Number.isFinite(rec.ms));
  // I byte degli id (0xab = 171) e la sfida non compaiono da nessuna parte.
  const testo = JSON.stringify(registri());
  assert.ok(!/"\d+":171/.test(testo), testo);
  assert.ok(!/"id"/.test(testo), testo);
});

test('«ibrido»: hybrid in più dove i trasporti ci sono e non lo hanno, il resto della richiesta arriva uguale', async () => {
  const { cc, ricevute, registri } = monta({ ibrido: true });
  const segnale = { aborted: false };
  const senza = { type: 'public-key', id: id(16), transports: ['internal'] };
  const giaIbrida = { type: 'public-key', id: id(16), transports: ['hybrid', 'internal'] };
  const vuota = { type: 'public-key', id: id(16) };
  const chiavetta = { type: 'public-key', id: id(48), transports: ['usb', 'nfc'] };
  const opzioni = { mediation: 'required', signal: segnale, publicKey: { challenge: id(32), rpId: 'google.com', allowCredentials: [senza, giaIbrida, vuota, chiavetta] } };
  await cc.get(opzioni);
  const inviate = ricevute[0];
  assert.notEqual(inviate, opzioni);
  assert.equal(inviate.mediation, 'required');
  assert.equal(inviate.signal, segnale);
  assert.equal(inviate.publicKey.rpId, 'google.com');
  assert.equal(inviate.publicKey.challenge, opzioni.publicKey.challenge);
  const [a, b, c, d] = inviate.publicKey.allowCredentials;
  assert.deepEqual([...a.transports], ['internal', 'hybrid']);
  assert.equal(a.id, senza.id);
  assert.equal(a.type, 'public-key');
  assert.equal(b, giaIbrida);
  assert.equal(c, vuota);
  assert.deepEqual([...d.transports], ['usb', 'nfc', 'hybrid']);
  // Gli oggetti della pagina restano com'erano.
  assert.deepEqual(senza.transports, ['internal']);
  assert.equal(opzioni.publicKey.allowCredentials[0], senza);
  await attesa();
  const [rec] = registri();
  assert.deepEqual(rec.credenziali, [
    { lunghezzaId: 16, trasporti: ['internal', 'hybrid'], aggiunto: true },
    { lunghezzaId: 16, trasporti: ['hybrid', 'internal'] },
    { lunghezzaId: 16 },
    { lunghezzaId: 48, trasporti: ['usb', 'nfc', 'hybrid'], aggiunto: true },
  ]);
});

test('create: le credenziali escluse prendono hybrid come quelle ammesse, e il riassunto dice cosa chiede il sito', async () => {
  const { cc, ricevute, registri } = monta({ ibrido: true });
  const esclusa = { type: 'public-key', id: id(20), transports: ['internal'] };
  await cc.create({ publicKey: { rp: { id: 'example.com', name: 'Es' }, user: { id: id(8, 0xcd), name: 'utente@example.com', displayName: 'Utente' },
    challenge: id(32), pubKeyCredParams: [{ type: 'public-key', alg: -7 }], attestation: 'none',
    authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'required', userVerification: 'required' },
    excludeCredentials: [esclusa] } });
  assert.deepEqual([...ricevute[0].publicKey.excludeCredentials[0].transports], ['internal', 'hybrid']);
  assert.equal(ricevute[0].publicKey.user.name, 'utente@example.com');
  await attesa();
  const [rec] = registri();
  assert.equal(rec.tipo, 'create');
  assert.equal(rec.rpId, 'example.com');
  assert.equal(rec.collegamento, 'platform');
  assert.equal(rec.residente, 'required');
  assert.equal(rec.verifica, 'required');
  assert.equal(rec.attestazione, 'none');
  assert.deepEqual(rec.trasportiRisposta, ['internal', 'hybrid']);
  assert.ok(!/utente@example\.com|Utente|205/.test(JSON.stringify(rec)), 'né il nome né l\'id dell\'utente');
});

test('un no di Chromium arriva alla pagina com\'era e il registro lo dice col nome', async () => {
  const errore = Object.assign(new Error('The operation either timed out or was not allowed.'), { name: 'NotAllowedError' });
  const { cc, registri } = monta({ ibrido: false }, { get: () => Promise.reject(errore) });
  await assert.rejects(cc.get({ publicKey: { challenge: id(32), allowCredentials: [] } }), (e) => e === errore);
  await attesa();
  const [rec] = registri();
  assert.equal(rec.esito, 'errore');
  assert.equal(rec.errore, 'NotAllowedError');
  assert.match(rec.messaggio, /not allowed/);
  assert.equal(rec.quante, 0);
});

test('chi non chiede una passkey, o la chiede con oggetti che si rompono a leggerli, non si accorge di niente', async () => {
  const { cc, ricevute, registri } = monta({ ibrido: true });
  const password = { password: true, mediation: 'silent' };
  await cc.get(password);
  assert.equal(ricevute[0], password);
  await cc.get();
  const rotta = { publicKey: { challenge: id(32), get allowCredentials() { throw new Error('no'); } } };
  await cc.get(rotta);
  assert.equal(ricevute[2], rotta);
  const strana = { publicKey: { challenge: id(32), allowCredentials: [null, 'x', { transports: 'internal' }] } };
  await cc.get(strana);
  assert.equal(ricevute[3], strana, 'niente da completare: la richiesta resta quella');
  await attesa();
  assert.deepEqual(registri().map((r) => r.tipo), ['get', 'get']);
});

test('le domande del sito sulle capacità: cosa ha chiesto e la risposta, solo i sì e i no', async () => {
  const { w, registri } = monta({ ibrido: false });
  assert.equal((await w.PublicKeyCredential.getClientCapabilities()).hybridTransport, true);
  assert.equal(await w.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(), true);
  await attesa();
  assert.deepEqual(registri().map((r) => [r.nome, r.risposta]), [
    ['getClientCapabilities', { hybridTransport: true, userVerifyingPlatformAuthenticator: false }],
    ['isUserVerifyingPlatformAuthenticatorAvailable', true],
  ]);
});

test('il main tiene solo la forma attesa, tagliata, e della pagina solo origine e percorso', () => {
  assert.equal(M.pulisci('non json'), null);
  assert.equal(M.pulisci('[1]'), null);
  assert.equal(M.pulisci('{"rpId":"x"}'), null, 'senza tipo non è una riga');
  const r = M.pulisci(JSON.stringify({
    tipo: 'get', rpId: 'g'.repeat(999), segreto: 'via', ms: 12, quante: 'tre',
    credenziali: [{ lunghezzaId: 16, trasporti: ['internal', 7], aggiunto: true, id: 'AAAA' }, { lunghezzaId: 'x' }],
    risposta: { hybridTransport: true, altro: 'no' }, suggerimenti: 'hybrid',
  }));
  assert.equal(r.rpId.length, 255);
  assert.equal(r.segreto, undefined);
  assert.equal(r.ms, 12);
  assert.equal(r.quante, undefined);
  assert.equal(r.suggerimenti, undefined);
  assert.deepEqual(r.credenziali, [{ lunghezzaId: 16, trasporti: ['internal', '7'], aggiunto: true }, { lunghezzaId: null, trasporti: null }]);
  assert.deepEqual(r.risposta, { hybridTransport: true });
  assert.equal(M.paginaDi('https://accounts.google.com/v3/signin/challenge/pk?TL=segreto#x'), 'https://accounts.google.com/v3/signin/challenge/pk');
  assert.equal(M.paginaDi('non un indirizzo'), '');
});

test('nel preload il corpo e l\'ascolto entrano solo con la variabile accesa', () => {
  const s = readFileSync(join(ROOT, 'src', 'preload', 'page-preload.js'), 'utf8');
  const i = s.indexOf('passkey.buildPasskeyCorpo(');
  assert.ok(i > 0, 'page-preload.js non mette più il corpo della diagnostica');
  const prima = s.slice(s.lastIndexOf('\n    if (', i), i);
  assert.match(prima, /if \(modoPasskey && /, 'il corpo deve stare dentro il controllo della variabile');
  assert.match(s, /modoDiagnosiPasskey\(process\.env\[passkey\.VARIABILE_PASSKEY\]\)/);
});
