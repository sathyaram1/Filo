// Unit test per src/shared/chatErrors.js (SN_CHAT_ERRORS) — #360.
//
// La chat non è un log: nessun messaggio grezzo di eccezione deve poter finire
// in una bolla. Questi test fissano le due garanzie: (a) il testo mostrato non
// contiene mai il messaggio tecnico, (b) dice cosa non ha funzionato e cosa fare.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../src/shared/chatErrors.js');
const CE = globalThis.SN_CHAT_ERRORS;

const SCRY = { dataSource: 'Scryfall (l\'archivio delle carte)' };

test('SN_CHAT_ERRORS si registra con friendly/sentence/isTransientNetwork/actionFailure', () => {
  assert.ok(CE);
  for (const fn of ['friendly', 'sentence', 'isTransientNetwork', 'actionFailure']) {
    assert.equal(typeof CE[fn], 'function', `manca ${fn}`);
  }
});

// ── Guasto di rete ────────────────────────────────────────────────────────────

test('"fetch failed" non arriva mai all\'utente: diventa una frase su rete e riprova', () => {
  const out = CE.friendly(new TypeError('fetch failed'));
  assert.ok(!/fetch failed/i.test(out), `il messaggio grezzo è passato: ${out}`);
  assert.match(out, /rete/i);
  assert.match(out, /connessione/i);
  assert.match(out, /riprova/i);
});

test('"Failed to fetch" (renderer Chromium) è un guasto di rete, non un errore generico', () => {
  // Le pagine filo:// (bacheca, feedback) girano nel renderer: senza rete il
  // `fetch` lancia "TypeError: Failed to fetch" (con TO), non "fetch failed".
  // Deve comunque diventare la frase su connessione + riprova.
  const e = new TypeError('Failed to fetch');
  assert.equal(CE.isTransientNetwork(e), true);
  const out = CE.friendly(e);
  assert.ok(!/failed to fetch/i.test(out), `il messaggio grezzo è passato: ${out}`);
  assert.match(out, /connessione/i);
  assert.match(out, /riprova/i);
});

test('un timeout di rete (fetch abortita dal nostro timeout) è un guasto di rete', () => {
  // list() rilancia "firestore list: timeout di rete" quando la fetch supera il
  // limite: la parola "timeout" lo fa riconoscere come guasto passeggero.
  const e = new Error('firestore list: timeout di rete');
  assert.equal(CE.isTransientNetwork(e), true);
  assert.match(CE.friendly(e), /connessione/i);
});

test('il motivo vero nella `cause` viene riconosciuto come guasto di rete', () => {
  const e = new TypeError('fetch failed');
  e.cause = Object.assign(new Error('getaddrinfo ENOTFOUND openrouter.ai'), { code: 'ENOTFOUND' });
  assert.equal(CE.isTransientNetwork(e), true);
  assert.match(CE.friendly(e), /rete/i);
});

test('guasti di rete passeggeri riconosciuti per codice', () => {
  for (const code of ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENETUNREACH', 'ECONNREFUSED']) {
    assert.equal(CE.isTransientNetwork(Object.assign(new Error('boom'), { code })), true, code);
  }
});

test('una risposta HTTP non è un guasto di rete (ritentarla non servirebbe)', () => {
  assert.equal(CE.isTransientNetwork(Object.assign(new Error('OpenRouter 400: Bad Request'), { status: 400, provider: 'openrouter' })), false);
  // Nemmeno un 504: c'è una risposta, la gestisce il ramo HTTP.
  assert.equal(CE.isTransientNetwork(Object.assign(new Error('Gemini 504'), { status: 504, provider: 'gemini' })), false);
});

test('un annullamento nostro non è un guasto: non va ritentato', () => {
  const e = new Error('The operation was aborted');
  e.name = 'AbortError';
  assert.equal(CE.isTransientNetwork(e), false);
});

// ── Errori del servizio AI ────────────────────────────────────────────────────

test('401 del provider → invito a controllare la chiave, senza codici', () => {
  const e = Object.assign(new Error('OpenRouter 401: Unauthorized'), { status: 401, provider: 'openrouter' });
  const out = CE.friendly(e);
  assert.ok(!/401/.test(out), out);
  assert.ok(!/OpenRouter/i.test(out), out);
  assert.match(out, /chiave/i);
});

test('429/5xx del provider → sovraccarico, riprova più tardi', () => {
  for (const st of [429, 500, 503]) {
    const e = Object.assign(new Error(`Gemini ${st}: nope`), { status: st, provider: 'gemini' });
    const out = CE.friendly(e);
    assert.ok(!new RegExp(String(st)).test(out), out);
    assert.match(out, /servizio AI/i);
    assert.match(out, /riprova/i);
  }
});

test('400 del provider riconosciuto anche senza marcatore strutturato', () => {
  const out = CE.friendly(new Error('OpenRouter 400: invalid model'));
  assert.ok(!/400/.test(out), out);
  assert.match(out, /modello/i);
});

// ── Errori applicativi già scritti per l'utente ───────────────────────────────

test('NO_API_KEY / LIMIT_REACHED passano invariati (sono già messaggi per l\'utente)', () => {
  const e1 = Object.assign(new Error('Limite di spesa raggiunto per questo mese.'), { code: 'LIMIT_REACHED' });
  assert.equal(CE.friendly(e1), 'Limite di spesa raggiunto per questo mese.');
  const e2 = Object.assign(new Error('Nessuna chiave API configurata.'), { code: 'NO_API_KEY' });
  assert.equal(CE.friendly(e2), 'Nessuna chiave API configurata.');
});

// ── Errore HTTP "nudo": attribuzione all'archivio esterno ─────────────────────

test('con dataSource un HTTP nudo è attribuito a quell\'archivio (chat dei mazzi)', () => {
  const out = CE.friendly(Object.assign(new Error('http 503'), { status: 503 }), SCRY);
  assert.match(out, /Scryfall/);
  assert.match(out, /riprova/i);
  assert.ok(!/503/.test(out), out);
});

test('senza dataSource un HTTP nudo NON viene attribuito a nessuno per caso', () => {
  const out = CE.friendly(Object.assign(new Error('http 503'), { status: 503 }));
  assert.ok(!/Scryfall/i.test(out), out);
  assert.ok(!/503/.test(out), out);
  assert.match(out, /riprova/i);
});

// ── Ripiego generico ──────────────────────────────────────────────────────────

test('un errore tecnico qualunque diventa una frase generica, non lo stack', () => {
  const out = CE.friendly(new Error("Cannot read properties of undefined (reading 'map')"));
  assert.ok(!/undefined/.test(out), out);
  assert.match(out, /riprova/i);
});

test('nessun host con gli strumenti per il modello scelto: dice di cambiare modello, non «riprova»', () => {
  const e = new Error('OpenRouter 404: {"error":{"message":"No endpoints found that support tool use","code":404}}');
  e.status = 404;
  e.provider = 'openrouter';
  const out = CE.friendly(e);
  assert.match(out, /strumenti/);
  assert.match(out, /Modelli predefiniti/);
  assert.ok(!/riprova tra qualche minuto/i.test(out), out);
});

test('sentence(): stessa frase con l\'iniziale maiuscola, per la bolla da sola', () => {
  const clause = CE.friendly(new TypeError('fetch failed'));
  const sentence = CE.sentence(new TypeError('fetch failed'));
  assert.equal(sentence.slice(1), clause.slice(1));
  assert.equal(sentence[0], clause[0].toUpperCase());
});

// ── #590: perché un'azione di Filo non è riuscita ─────────────────────────────
//
// Le stesse parole per TUTTE le chat: la chat della home lo diceva già, quella
// che si apre sopra una pagina web diceva solo "non riuscita" e il nome del
// sito bloccato arrivava soltanto dalla notifica.

test('actionFailure(): la lista dei siti bloccati dice QUALE sito', () => {
  assert.equal(CE.actionFailure({ blocked: 'site', host: 'esempio.test' }), 'sito bloccato: esempio.test');
  // Senza host la frase resta sensata invece di finire con due punti nel vuoto.
  assert.equal(CE.actionFailure({ blocked: 'site' }), 'sito bloccato');
});

test('actionFailure(): gli altri motivi che il main conosce', () => {
  assert.equal(CE.actionFailure({ blocked: 'scheme' }), 'indirizzo non ammesso');
  assert.equal(CE.actionFailure({ blocked: 'address' }), 'indirizzo non valido');
  assert.equal(CE.actionFailure({ restyle: 'no-page' }), 'nessuna pagina web aperta');
  assert.equal(CE.actionFailure({ found: false }), 'non trovato');
  assert.equal(CE.actionFailure({ ok: false, detail: 'il file è vuoto' }), 'il file è vuoto');
  assert.equal(CE.actionFailure({ error: 'rotto' }), 'rotto');
});

test('actionFailure(): motivo ignoto → stringa vuota, e chi chiama resta sul generico', () => {
  for (const v of [undefined, null, '', 0, 'testo', {}, { ok: true }]) {
    assert.equal(CE.actionFailure(v), '', `nessun motivo per ${JSON.stringify(v)}`);
  }
});

// #590 (quarto giro) — il nome del sito fermato, come l'utente lo scriverebbe.
// La notifica in basso a destra lo chiama già col suo nome; la riga in chat lo
// chiamava "xn--80aswg.xn--p1ai". Due posti che nominano lo stesso sito nello
// stesso istante devono chiamarlo uguale.
test('#590: in chat il sito bloccato si chiama col suo nome, non in punycode', () => {
  // Il nome leggibile lo sa SN_URL_NAV, che nelle pagine e nei content script
  // viene caricato prima di questo modulo.
  require('../../src/shared/urlNav.js');
  assert.equal(
    CE.actionFailure({ blocked: 'site', host: 'xn--80aswg.xn--p1ai' }),
    'sito bloccato: сайт.рф',
  );
  assert.equal(
    CE.actionFailure({ blocked: 'site', host: 'esempio.com' }),
    'sito bloccato: esempio.com',
  );
  assert.equal(CE.actionFailure({ blocked: 'site' }), 'sito bloccato');
});
