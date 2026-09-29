// Safe Browsing per prefissi d'impronta (#813): a Google escono solo prefissi di 4 byte, il confronto si fa qui.
// Rete sempre finta: nessuna prova chiama il Google vero. Regole in src/main/services/safebrowse/gsb.js e net.js.

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
const SB = require('../../src/main/services/safebrowse/index.js');
const gsb = require('../../src/main/services/safebrowse/gsb.js');

const fetchVero = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = fetchVero;
  SB._gsbLookup.clear();
  SB.configure({ gsbKey: '', enableNetwork: false, enableSandbox: false });
});

const sha = (s) => crypto.createHash('sha256').update(s).digest();

// Servizio finto: risponde come hashes.search v5 e annota ogni richiesta così com'è partita.
// `elenco`: espressione → tipo, oppure coppie [impronta completa, tipo].
function servizioFinto({ elenco = {}, cacheDuration = '300s', guasto = null, dettagli = null } = {}) {
  const voci = Array.isArray(elenco) ? elenco : Object.entries(elenco).map(([expr, tipo]) => [sha(expr), tipo]);
  const richieste = [];
  globalThis.fetch = async (url, opts) => {
    richieste.push({ url: String(url), opts: JSON.stringify(opts || {}) });
    if (guasto === 'offline') throw new TypeError('fetch failed');
    if (typeof guasto === 'number') return { ok: false, status: guasto, json: async () => ({}) };
    const chiesti = new URL(String(url)).searchParams.getAll('hashPrefixes');
    const fullHashes = [];
    for (const [full, threatType] of voci) {
      if (!chiesti.includes(full.subarray(0, 4).toString('base64'))) continue;
      fullHashes.push({ fullHash: full.toString('base64'), fullHashDetails: dettagli || [{ threatType }] });
    }
    return { ok: true, status: 200, json: async () => ({ fullHashes, cacheDuration }) };
  };
  return richieste;
}

function accendi(chiave = 'chiave-finta') {
  SB.configure({ gsbKey: chiave, enableNetwork: false, enableSandbox: false });
}

async function finoA(cond, ms = 2000) {
  const fine = Date.now() + ms;
  while (Date.now() < fine) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 5));
  }
  return cond();
}

// Verdetto dopo che la verifica in rete si è chiusa (onUpdate parte solo se il verdetto cambia).
async function verdettoDopoRete(url, richieste) {
  const prima = richieste.length;
  let aggiornato = null;
  const primo = SB.analyze(url, {}, (v) => { aggiornato = v; });
  await finoA(() => aggiornato || (richieste.length > prima && SB._gsbLookup.peek(url) !== undefined));
  await new Promise((r) => setTimeout(r, 20));
  return aggiornato || SB.checkSync(url) || primo;
}

test('canonicalizzazione: gli esempi ufficiali del protocollo', () => {
  const esempi = [
    ['http://host/%25%32%35', 'http://host/%25'],
    ['http://host/%25%32%35%25%32%35', 'http://host/%25%25'],
    ['http://host/%2525252525252525', 'http://host/%25'],
    ['http://host/asdf%25%32%35asd', 'http://host/asdf%25asd'],
    ['http://host/%%%25%32%35asd%%', 'http://host/%25%25%25asd%25%25'],
    ['http://www.google.com/', 'http://www.google.com/'],
    ['http://%31%36%38%2e%31%38%38%2e%39%39%2e%32%36/%2E%73%65%63%75%72%65/%77%77%77%2E%65%62%61%79%2E%63%6F%6D/', 'http://168.188.99.26/.secure/www.ebay.com/'],
    ['http://195.127.0.11/uploads/%20%20%20%20/.verify/.eBaysecure=updateuserdataxplimnbqmn-xplmvalidateinfoswqpcmlx=hgplmcx/', 'http://195.127.0.11/uploads/%20%20%20%20/.verify/.eBaysecure=updateuserdataxplimnbqmn-xplmvalidateinfoswqpcmlx=hgplmcx/'],
    ['http://host%23.com/%257Ea%2521b%2540c%2523d%2524e%25f%255E00%252611%252A22%252833%252944_55%252B', 'http://host%23.com/~a!b@c%23d$e%25f^00&11*22(33)44_55+'],
    ['http://3279880203/blah', 'http://195.127.0.11/blah'],
    ['http://www.google.com/blah/..', 'http://www.google.com/'],
    ['www.google.com/', 'http://www.google.com/'],
    ['www.google.com', 'http://www.google.com/'],
    ['http://www.evil.com/blah#frag', 'http://www.evil.com/blah'],
    ['http://www.GOOgle.com/', 'http://www.google.com/'],
    ['http://www.google.com.../', 'http://www.google.com/'],
    ['http://www.google.com/foo\tbar\rbaz\n2', 'http://www.google.com/foobarbaz2'],
    ['http://www.google.com/q?', 'http://www.google.com/q?'],
    ['http://www.google.com/q?r?', 'http://www.google.com/q?r?'],
    ['http://www.google.com/q?r?s', 'http://www.google.com/q?r?s'],
    ['http://evil.com/foo#bar#baz', 'http://evil.com/foo'],
    ['http://evil.com/foo;', 'http://evil.com/foo;'],
    ['http://evil.com/foo?bar;', 'http://evil.com/foo?bar;'],
    [Buffer.from('http://\x01\x80.com/', 'latin1'), 'http://%01%80.com/'],
    ['http://notrailingslash.com', 'http://notrailingslash.com/'],
    ['http://www.gotaport.com:1234/', 'http://www.gotaport.com/'],
    ['  http://www.google.com/  ', 'http://www.google.com/'],
    ['http:// leadingspace.com/', 'http://%20leadingspace.com/'],
    ['http://%20leadingspace.com/', 'http://%20leadingspace.com/'],
    ['%20leadingspace.com/', 'http://%20leadingspace.com/'],
    ['https://www.securesite.com/', 'https://www.securesite.com/'],
    ['http://host.com/ab%23cd', 'http://host.com/ab%23cd'],
    ['http://host.com//twoslashes?more//slashes', 'http://host.com/twoslashes?more//slashes'],
    ['http://www.ümlat.com/', 'http://www.xn--mlat-zra.com/'],
    ['http://utente:segreta@www.google.com/', 'http://www.google.com/'],
  ];
  for (const [dentro, fuori] of esempi) assert.equal(gsb.canonicalize(dentro)?.url, fuori, String(dentro));
  for (const senzaHost of ['', '/blah', 'http:///blah', 'about:blank', 'data:text/html,x', 'mailto:a@b.it']) {
    assert.equal(gsb.canonicalize(senzaHost), null, senzaHost);
  }
});

test('espressioni host/percorso: gli esempi ufficiali, al massimo 30 per indirizzo', () => {
  const ord = (a) => [...a].sort();
  assert.deepEqual(ord(gsb.expressions('http://a.b.c/1/2.html?param=1')), ord([
    'a.b.c/1/2.html?param=1', 'a.b.c/1/2.html', 'a.b.c/', 'a.b.c/1/',
    'b.c/1/2.html?param=1', 'b.c/1/2.html', 'b.c/', 'b.c/1/',
  ]));
  assert.deepEqual(ord(gsb.expressions('http://a.b.c.d.e.f.g/1.html')), ord([
    'a.b.c.d.e.f.g/1.html', 'a.b.c.d.e.f.g/', 'c.d.e.f.g/1.html', 'c.d.e.f.g/',
    'd.e.f.g/1.html', 'd.e.f.g/', 'e.f.g/1.html', 'e.f.g/', 'f.g/1.html', 'f.g/',
  ]));
  assert.deepEqual(ord(gsb.expressions('http://1.2.3.4/1/')), ord(['1.2.3.4/1/', '1.2.3.4/']));
  const lunga = gsb.expressions('https://a.b.c.d.e.f.g.h/1/2/3/4/5/6/7.html?x=1');
  assert.equal(lunga.length, 30);
  const [h] = gsb.hashesOf('http://abc/');
  assert.equal(h.expr, 'abc/');
  assert.equal(Buffer.from(h.prefix, 'base64').length, 4);
  assert.equal(Buffer.from(h.full, 'base64').toString('hex'), sha('abc/').toString('hex'));
});

test('verso il servizio escono solo prefissi di 4 byte: mai indirizzo, sito, percorso o parametri', async () => {
  const richieste = servizioFinto();
  accendi();
  const url = 'https://account.banca-rossi-813.it/reimposta/password?token=SEGRETO4242&email=mario.rossi%40posta.it#passo2';
  await verdettoDopoRete(url, richieste);
  assert.equal(richieste.length, 1);
  for (const r of richieste) {
    const u = new URL(r.url);
    assert.equal(u.origin + u.pathname, 'https://safebrowsing.googleapis.com/v5/hashes:search');
    assert.deepEqual([...new Set(u.searchParams.keys())].sort(), ['alt', 'hashPrefixes', 'key']);
    for (const p of u.searchParams.getAll('hashPrefixes')) assert.equal(Buffer.from(p, 'base64').length, 4);
    for (const inChiaro of ['banca-rossi', '813', 'account', 'reimposta', 'password', 'SEGRETO4242', 'token', 'mario', 'posta', 'passo2']) {
      assert.ok(!(r.url + r.opts).includes(inChiaro), `«${inChiaro}» è uscito verso il servizio`);
    }
  }
});

test('l\'impronta completa di un indirizzo in lista dà «pericoloso» con la categoria; il solo prefisso in comune resta pulito', async () => {
  const listato = 'https://www.ricette-nonna-813.it/pagamento/conferma.html';
  const quasi = sha('www.ricette-nonna-813.it/pagamento/conferma.html');
  quasi[31] ^= 0xff;
  let richieste = servizioFinto({ elenco: { 'www.ricette-nonna-813.it/pagamento/conferma.html': 'SOCIAL_ENGINEERING' } });
  accendi();
  const v = await verdettoDopoRete(listato, richieste);
  assert.equal(v.level, 'pericoloso');
  assert.deepEqual(v.reasons, ['gsb_phishing']);
  assert.match(v.message.body, /phishing/);

  SB._gsbLookup.clear();
  richieste = servizioFinto({ elenco: [[quasi, 'MALWARE']] });
  const w = await verdettoDopoRete(listato, richieste);
  assert.equal(richieste.length, 1);
  assert.equal(w.level, 'safe');
  assert.deepEqual(SB._gsbLookup.peek(listato), { listed: false });
});

test('le categorie di oggi: malware, software indesiderato; i dettagli da non applicare a una pagina si ignorano', async () => {
  const casi = [
    ['MALWARE', 'malware'], ['UNWANTED_SOFTWARE', 'unwanted'], ['POTENTIALLY_HARMFUL_APPLICATION', 'malware'],
  ];
  for (const [tipo, categoria] of casi) {
    SB._gsbLookup.clear();
    const richieste = servizioFinto({ elenco: { 'scarica-813.it/': tipo } });
    accendi();
    const v = await verdettoDopoRete('https://scarica-813.it/', richieste);
    assert.equal(v.level, 'pericoloso', tipo);
    assert.equal(v.gsb.category, categoria, tipo);
  }
  for (const dettagli of [[{ threatType: 'MALWARE', attributes: ['CANARY'] }], [{ threatType: 'MALWARE', attributes: ['FRAME_ONLY'] }], [{ threatType: 'NUOVO_TIPO' }]]) {
    SB._gsbLookup.clear();
    const richieste = servizioFinto({ elenco: { 'scarica-813.it/': 'MALWARE' }, dettagli });
    accendi();
    const v = await verdettoDopoRete('https://scarica-813.it/', richieste);
    assert.equal(v.level, 'safe', JSON.stringify(dettagli));
  }
});

test('un indirizzo in lista su un sito per il resto pulito fa scattare l\'avviso anche dopo una pagina pulita dello stesso sito', async () => {
  const richieste = servizioFinto({ elenco: { 'www.giornale-813.it/archivio/trappola.html': 'SOCIAL_ENGINEERING' } });
  accendi();
  const pulita = await verdettoDopoRete('https://www.giornale-813.it/notizie/oggi.html', richieste);
  assert.equal(pulita.level, 'safe');
  const primaDellaTrappola = richieste.length;

  const trappola = await verdettoDopoRete('https://www.giornale-813.it/archivio/trappola.html', richieste);
  assert.equal(trappola.level, 'pericoloso');
  assert.equal(trappola.gsb.category, 'phishing');
  // Chiede solo i prefissi che non ha già: quelli del sito sono in cache.
  const nuovi = new URL(richieste[primaDellaTrappola].url).searchParams.getAll('hashPrefixes');
  const delSito = gsb.hashesOf('https://www.giornale-813.it/').map((h) => h.prefix);
  assert.ok(nuovi.length > 0 && nuovi.every((p) => !delSito.includes(p)));
});

test('senza chiave non parte niente e in cache non si scrive niente', async () => {
  const richieste = servizioFinto({ elenco: { 'senza-chiave-813.it/': 'MALWARE' } });
  SB.configure({ gsbKey: () => '', enableNetwork: false, enableSandbox: false });
  const v = SB.analyze('https://senza-chiave-813.it/', {}, () => {});
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(v.level, 'safe');
  assert.equal(richieste.length, 0);
  assert.equal(SB._gsbLookup._cache.size, 0);
  assert.equal(SB.activeProviders().gsb, false);
});

test('offline o con un errore del servizio: il resto lavora, e l\'errore non resta come «pulito»', async () => {
  for (const guasto of ['offline', 503]) {
    SB._gsbLookup.clear();
    const url = `https://negozio-${guasto}-813.it/carrello`;
    let richieste = servizioFinto({ guasto });
    accendi();
    const v = SB.analyze(url, {}, () => {});
    assert.equal(v.level, 'safe');
    await finoA(() => richieste.length > 0);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(SB._gsbLookup.peek(url), undefined, String(guasto));
    assert.equal(SB._gsbLookup._cache.size, 0, String(guasto));

    richieste = servizioFinto({ elenco: { [`negozio-${guasto}-813.it/carrello`]: 'SOCIAL_ENGINEERING' } });
    const dopo = await verdettoDopoRete(url, richieste);
    assert.equal(richieste.length, 1, String(guasto));
    assert.equal(dopo.level, 'pericoloso', String(guasto));
  }
});

// Verifica di #813, giro 3: il verdetto del sito aspettava la risposta per il resto dell'indirizzo, e senza Google non arrivava.
test('un sito già riconosciuto in lista resta segnalato sulle sue altre pagine: subito, con Google giù, senza chiave', async () => {
  let richieste = servizioFinto({ elenco: { 'esca-intera-813.it/': 'SOCIAL_ENGINEERING' } });
  accendi();
  assert.equal((await verdettoDopoRete('https://esca-intera-813.it/accedi', richieste)).level, 'pericoloso');

  for (const guasto of ['offline', 503]) {
    richieste = servizioFinto({ guasto });
    const url = `https://esca-intera-813.it/conferma-${guasto}`;
    const subito = SB.analyze(url, {}, () => {});
    assert.equal(subito.level, 'pericoloso', String(guasto));
    assert.equal(subito.gsb.category, 'phishing', String(guasto));
    assert.deepEqual(await SB._gsbLookup.check(url), { listed: true, category: 'phishing', threatType: 'SOCIAL_ENGINEERING', partial: true }, String(guasto));
  }

  SB.configure({ gsbKey: () => '', enableNetwork: false, enableSandbox: false });
  assert.equal(SB.analyze('https://esca-intera-813.it/carta', {}, () => {}).level, 'pericoloso');
  assert.equal(SB.checkSync('https://esca-intera-813.it/fine').level, 'pericoloso');
});

// Il lookup da solo, con un orologio finto: i tempi sono quelli che dice Google.
function lookupFinto(risposte) {
  let t = 1_000_000;
  const chiamate = [];
  const L = gsb.createLookup({
    now: () => t,
    search: async (prefissi) => { chiamate.push(prefissi); return risposte(prefissi, chiamate.length); },
  });
  return { L, chiamate, avanza: (ms) => { t += ms; } };
}

test('le risposte, anche negative, restano in cache per la durata indicata da Google, non di più', async () => {
  const { L, chiamate, avanza } = lookupFinto(() => ({ ok: true, matches: [], cacheMs: 300_000 }));
  const url = 'https://www.esempio-813.it/a/b.html';
  assert.deepEqual(await L.check(url), { listed: false });
  assert.deepEqual(L.peek(url), { listed: false });
  avanza(299_000);
  await L.check(url);
  assert.equal(chiamate.length, 1);
  avanza(2_000);
  assert.equal(L.peek(url), undefined);
  await L.check(url);
  assert.equal(chiamate.length, 2);
});

test('durata zero: la risposta decide questa verifica ma non si tiene', async () => {
  const full = sha('zero-813.it/').toString('base64');
  const { L, chiamate } = lookupFinto(() => ({ ok: true, matches: [{ hash: full, threatType: 'MALWARE', category: 'malware' }], cacheMs: 0 }));
  assert.deepEqual(await L.check('https://zero-813.it/'), { listed: true, category: 'malware', threatType: 'MALWARE' });
  assert.equal(L.peek('https://zero-813.it/'), undefined);
  await L.check('https://zero-813.it/');
  assert.equal(chiamate.length, 2);
});

test('due verifiche insieme dello stesso indirizzo fanno una richiesta sola', async () => {
  const { L, chiamate } = lookupFinto(async () => { await new Promise((r) => setTimeout(r, 20)); return { ok: true, matches: [], cacheMs: 60_000 }; });
  const [a, b] = await Promise.all([L.check('https://doppio-813.it/x'), L.check('https://doppio-813.it/x')]);
  assert.deepEqual(a, { listed: false });
  assert.deepEqual(b, { listed: false });
  assert.equal(chiamate.length, 1);
});

test('rifiuti ripetuti del servizio: si aspetta prima di riprovare, e nel frattempo il verdetto resta sconosciuto', async () => {
  const { L, chiamate, avanza } = lookupFinto(() => ({ ok: false, status: 429 }));
  assert.equal(await L.check('https://pausa-813.it/1'), null);
  assert.equal(await L.check('https://pausa-813.it/2'), null);
  assert.equal(await L.check('https://pausa-813.it/3'), null);
  assert.equal(chiamate.length, 2);
  avanza(31 * 60 * 1000);
  await L.check('https://pausa-813.it/4');
  assert.equal(chiamate.length, 3);
});

test('una pagina di un sito già noto come phishing, in lista lei stessa come malware: l\'avviso parte subito e poi dice malware', async () => {
  const richieste = servizioFinto({ elenco: { 'doppia-813.it/': 'SOCIAL_ENGINEERING', 'doppia-813.it/scarica.exe': 'MALWARE' } });
  accendi();
  assert.equal((await verdettoDopoRete('https://doppia-813.it/accedi', richieste)).gsb.category, 'phishing');
  let aggiornato = null;
  const subito = SB.analyze('https://doppia-813.it/scarica.exe', {}, (v) => { aggiornato = v; });
  assert.equal(subito.level, 'pericoloso');
  assert.equal(subito.gsb.category, 'phishing');
  assert.ok(await finoA(() => aggiornato));
  assert.equal(aggiornato.level, 'pericoloso');
  assert.equal(aggiornato.gsb.category, 'malware');
});

test('richieste in pausa: un\'impronta in lista già in memoria decide senza rete; senza, il verdetto resta sconosciuto', async () => {
  const full = sha('pausa-sito-813.it/');
  let giu = false;
  const { L, chiamate } = lookupFinto((prefissi) => {
    if (giu) return { ok: false, status: 429 };
    const hit = prefissi.includes(full.subarray(0, 4).toString('base64'));
    return { ok: true, matches: hit ? [{ hash: full.toString('base64'), threatType: 'MALWARE', category: 'malware' }] : [], cacheMs: 600_000 };
  });
  assert.equal((await L.check('https://pausa-sito-813.it/a')).listed, true);
  giu = true;
  await L.check('https://altro-813.it/1');
  await L.check('https://altro-813.it/2');
  const n = chiamate.length;
  const noto = { listed: true, category: 'malware', threatType: 'MALWARE', partial: true };
  assert.deepEqual(await L.check('https://pausa-sito-813.it/b'), noto);
  assert.deepEqual(L.peek('https://pausa-sito-813.it/c'), noto);
  assert.equal(chiamate.length, n);
  assert.equal(await L.check('https://pulito-813.it/x'), null);
  assert.equal(L.peek('https://pulito-813.it/x'), undefined);
});

// Verifica di #813, giro 1: mille livelli di %25 costavano mille passate sull'indirizzo intero, Filo fermo per secondi.
test('un indirizzo lunghissimo costruito apposta: la pagina in lista resta segnalata e il calcolo resta rapido', async () => {
  const lista = sha('lunga-813.it/esca.html');
  const { L } = lookupFinto((prefissi) => ({
    ok: true,
    cacheMs: 60_000,
    matches: prefissi.includes(lista.subarray(0, 4).toString('base64'))
      ? [{ hash: lista.toString('base64'), threatType: 'SOCIAL_ENGINEERING', category: 'phishing' }]
      : [],
  }));
  const ostile = `https://lunga-813.it/esca.html?${'a'.repeat(1_500_000)}%25${'25'.repeat(5000)}`;
  const t = performance.now();
  L.peek(ostile);
  const esito = await L.check(ostile);
  L.peek(ostile);
  assert.ok(performance.now() - t < 1000, `verifica di una pagina: ${Math.round(performance.now() - t)} ms`);
  assert.equal(esito.listed, true);
  assert.equal(esito.category, 'phishing');
  assert.equal(gsb.canonicalize(`http://h/%25${'25'.repeat(5000)}`).url, 'http://h/%25');
});

// Verifica di #813, giro 2: la scheda riporta l'indirizzo col nome utente, e un %2F o %3F lì dentro spostava il sito.
test('nome utente e password nell\'indirizzo non sono il sito: la pagina in lista resta riconosciuta', async () => {
  for (const [dato, atteso] of [
    ['http://www.banca.it%2Faccedi@esca-813.it/entra.html', 'http://esca-813.it/entra.html'],
    ['http://accesso%3Fsicuro@esca-813.it/entra.html', 'http://esca-813.it/entra.html'],
    ['https://utente:pa%2Fss%40word@esca-813.it:8443/entra.html?x=1', 'https://esca-813.it/entra.html?x=1'],
    ['http://esca-813.it/a@b?c@d', 'http://esca-813.it/a@b?c@d'],
  ]) assert.equal(gsb.canonicalize(dato).url, atteso, dato);
  assert.ok(gsb.expressions('http://www.banca.it%2Faccedi@esca-813.it/entra.html').every((e) => e.startsWith('esca-813.it/')));

  const lista = sha('esca-813.it/entra.html');
  const { L } = lookupFinto((prefissi) => ({
    ok: true,
    cacheMs: 60_000,
    matches: prefissi.includes(lista.subarray(0, 4).toString('base64'))
      ? [{ hash: lista.toString('base64'), threatType: 'SOCIAL_ENGINEERING', category: 'phishing' }]
      : [],
  }));
  const esito = await L.check('http://www.banca.it%2Faccedi@esca-813.it/entra.html');
  assert.deepEqual([esito.listed, esito.category], [true, 'phishing']);
});

test('un nome utente o un sito lunghissimi costruiti apposta non fermano il calcolo', () => {
  for (const u of [
    `http://0x${'1'.repeat(1_500_000)}z%2F@esca-813.it/entra.html`,
    `http://0x${'1'.repeat(1_500_000)}z/`,
    `http://${'1.'.repeat(700_000)}x/`,
  ]) {
    const t = performance.now();
    gsb.hashesOf(u);
    assert.ok(performance.now() - t < 1000, `${u.slice(0, 20)}…: ${Math.round(performance.now() - t)} ms`);
  }
});
