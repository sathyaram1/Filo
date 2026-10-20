// LEGGI_PAGINA dalla rete (#553): la pagina scaricata torna come testo, a pezzi dichiarati, e la rete locale resta chiusa.
// Il server di prova sta su 127.0.0.1, che il download vero rifiuta: qui lo si sostituisce, tranne nella prova che lo verifica.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PR = require(join(ROOT, 'src', 'main', 'services', 'pageRead.js'));
const { safeFetch } = require(join(ROOT, 'src', 'main', 'services', 'safe-fetch.js'));

const PAGINE = new Map();
let richieste = 0;
const server = createServer((req, res) => {
  richieste++;
  const p = PAGINE.get(req.url);
  if (!p) { res.writeHead(404, { 'Content-Type': 'text/html' }); res.end('<h1>no</h1>'); return; }
  if (p.redirect) { res.writeHead(302, { Location: p.redirect }); res.end(); return; }
  res.writeHead(p.stato || 200, { 'Content-Type': p.tipo || 'text/html; charset=utf-8' });
  res.end(p.corpo);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const ORIGINE = `http://127.0.0.1:${server.address().port}`;
after(() => new Promise((r) => server.close(r)));

const verso = (percorso, pagina) => { PAGINE.set(percorso, pagina); return `${ORIGINE}${percorso}`; };
const conRete = async (fn) => {
  PR._dip.scarica = (url, opts) => fetch(url, opts);
  PR._cache.clear();
  try { return await fn(); } finally { PR._dip.scarica = safeFetch; }
};

test('una pagina scaricata torna col suo testo leggibile e il suo titolo', async () => {
  const url = verso('/listino', {
    corpo: '<html><head><title>Listino</title></head><body><nav><a href="/">MENU</a></nav><main><h1>Prezzi</h1>'
      + '<p>Il modello Lampo costa 0,07 dollari per milione di token in ingresso, secondo il listino ufficiale di oggi.</p>'
      + '<p>Il modello Kappa costa 0,95 dollari per milione di token in ingresso e quattro in uscita, più caro ma migliore.</p>'
      + '</main></body></html>',
  });
  const r = await conRete(() => PR.leggiPagina(url));
  assert.equal(r.ok, true);
  assert.equal(r.fonte, 'rete');
  assert.equal(r.titolo, 'Listino');
  assert.ok(r.testo.includes('0,07 dollari'));
  assert.ok(!r.testo.includes('MENU'));
  assert.equal(r.troncata, false);
  assert.equal(r.da, 0);
  assert.equal(r.fino, r.totale);
});

test('senza sostituzione, un indirizzo della rete locale non si scarica, e lo dice', async () => {
  const url = verso('/segreto', { corpo: '<p>ROUTER_ADMIN</p>' });
  const prima = richieste;
  const r = await PR.leggiPagina(url);
  assert.equal(r.ok, false);
  assert.equal(r.errore, 'rete-locale');
  assert.equal(r.dettaglio, 'indirizzo della rete locale');
  assert.equal(r.testo, '');
  assert.equal(richieste, prima, 'nessuna richiesta è partita verso la rete locale');
});

test('schemi che non sono pagine web e indirizzi senza senso si rifiutano prima di partire', async () => {
  for (const [u, errore] of [['file:///etc/passwd', 'schema'], ['javascript:alert(1)', 'schema'], ['filo://dashboard/', 'schema'],
    ['', 'indirizzo'], ['   ', 'indirizzo'], ['non è un indirizzo', 'indirizzo']]) {
    const r = await PR.leggiPagina(u);
    assert.equal(r.ok, false, u);
    assert.equal(r.errore, errore, u);
  }
  assert.equal(PR.normalizzaUrl('esempio.it/pagina').url, 'https://esempio.it/pagina');
  assert.equal(PR.normalizzaUrl('<https://esempio.it/a#sez>').url, 'https://esempio.it/a');
  assert.equal(PR.normalizzaUrl('https://utente:pw@esempio.it/').url, 'https://esempio.it/');
});

test('una pagina più lunga del tetto si legge a pezzi: il primo lo dichiara, il seguito riparte da lì', async () => {
  const riga = (i) => `Riga ${i}: ${'testo di riempimento '.repeat(8).trim()}`;
  const righe = Array.from({ length: 900 }, (_, i) => riga(i));
  const url = verso('/lunga', { corpo: `<html><body><main>${righe.map((r) => `<p>${r}</p>`).join('')}<p>ULTIMA_RIGA</p></main></body></html>` });
  await conRete(async () => {
    const a = await PR.leggiPagina(url);
    assert.equal(a.ok, true);
    assert.equal(a.troncata, true);
    assert.ok(a.testo.length <= PR.MAX_TEXT_CHARS);
    assert.ok(a.totale > PR.MAX_TEXT_CHARS);
    assert.equal(a.fino, a.testo.length);
    assert.ok(!a.testo.includes('ULTIMA_RIGA'));
    const prima = richieste;
    let da = a.fino;
    let ultimo = a;
    const letti = [a.testo];
    while (ultimo.troncata) {
      ultimo = await PR.leggiPagina(url, { da });
      assert.equal(ultimo.da, da, 'il seguito comincia dove era finito il pezzo prima');
      letti.push(ultimo.testo);
      da = ultimo.fino;
    }
    assert.ok(ultimo.testo.includes('ULTIMA_RIGA'));
    assert.equal(richieste, prima, 'il seguito non riscarica la pagina');
    const tutto = letti.join('');
    for (const r of [riga(0), riga(450), riga(899)]) assert.ok(tutto.includes(r), 'nessuna riga persa fra un pezzo e l\'altro');
    const oltre = await PR.leggiPagina(url, { da: ultimo.totale + 50 });
    assert.equal(oltre.ok, true);
    assert.equal(oltre.testo, '');
    assert.equal(oltre.da, oltre.totale);
  });
});

test('gli errori del sito arrivano col loro stato e una frase comprensibile', async () => {
  const vietata = verso('/vietata', { stato: 403, corpo: 'no' });
  await conRete(async () => {
    const r = await PR.leggiPagina(vietata);
    assert.equal(r.ok, false);
    assert.equal(r.errore, 'http');
    assert.equal(r.stato, 403);
    assert.equal(r.dettaglio, 'il sito non si lascia leggere (403)');
    const n = await PR.leggiPagina(`${ORIGINE}/mai-esistita`);
    assert.equal(n.stato, 404);
    assert.equal(n.dettaglio, 'la pagina non esiste (404)');
  });
});

test('testo semplice, JSON e codifiche diverse da UTF-8 si leggono', async () => {
  const txt = verso('/note.txt', { tipo: 'text/plain; charset=utf-8', corpo: 'Orario: 9–18\r\nChiuso la domenica' });
  const json = verso('/dati.json', { tipo: 'application/json', corpo: '{"prezzo": 42}' });
  const latin = verso('/vecchia', { tipo: 'text/html; charset=iso-8859-1', corpo: Buffer.from('<p>Caff\xe8 a 1,20 \x80</p>', 'latin1') });
  const meta = verso('/meta', { tipo: 'text/html', corpo: Buffer.from('<html><head><meta charset="windows-1252"></head><body><p>Perch\xe9 \x93cos\xec\x94</p></body></html>', 'latin1') });
  await conRete(async () => {
    assert.equal((await PR.leggiPagina(txt)).testo, 'Orario: 9–18\nChiuso la domenica');
    assert.equal((await PR.leggiPagina(json)).testo, '{"prezzo": 42}');
    assert.ok((await PR.leggiPagina(latin)).testo.includes('Caffè a 1,20'));
    assert.ok((await PR.leggiPagina(meta)).testo.includes('Perché “così”'));
  });
});

test('un PDF pubblicato sul web si legge come un documento', async () => {
  const pdf = readFileSync(join(ROOT, 'tests', 'fixtures', 'documenti', 'documento-con-testo.pdf'));
  const url = verso('/rapporto.pdf', { tipo: 'application/pdf', corpo: pdf });
  const r = await conRete(() => PR.leggiPagina(url));
  assert.equal(r.ok, true);
  assert.equal(r.tipo, 'application/pdf');
  assert.equal(r.titolo, 'rapporto.pdf');
  assert.ok(r.testo.length > 20);
});

test('un file che non è testo non finisce nel contesto come spazzatura', async () => {
  const url = verso('/foto.png', { tipo: 'image/png', corpo: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]) });
  const r = await conRete(() => PR.leggiPagina(url));
  assert.equal(r.ok, false);
  assert.equal(r.errore, 'tipo');
  assert.equal(r.dettaglio, 'è un file image/png, non una pagina da leggere');
});

test('una scheda aperta sulla stessa pagina si riconosce a meno di www, barra finale e frammento', () => {
  const k = PR.chiaveConfronto;
  assert.equal(k('https://www.esempio.it/a/'), k('http://esempio.it/a#x'));
  assert.notEqual(k('https://esempio.it/a?p=1'), k('https://esempio.it/a?p=2'));
  assert.equal(k('filo://dashboard/'), '');
});

test('il taglio non spezza un\'emoji', () => {
  const testo = `${'a'.repeat(PR.MAX_TEXT_CHARS - 1)}😀resto`;
  const p = PR.porzione(testo, 0);
  assert.ok(!/[\ud800-\udbff]$/.test(p.testo));
  assert.equal(PR.porzione(testo, p.fino).testo.startsWith('😀'), true);
});

// #553, giro 12: il tetto si sceglieva dall'etichetta, e un PDF servito come file generico finiva tagliato a 5 MB.
test('un PDF oltre i 5 MB servito come file generico non si rifiuta come «oltre i 25 MB»', async () => {
  const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(6 * 1024 * 1024, 32)]);
  const url = verso('/download?id=42', { tipo: 'application/octet-stream', corpo: pdf });
  const r = await conRete(() => PR.leggiPagina(url));
  assert.notEqual(r.errore, 'troppo-grande');
  assert.ok(!String(r.dettaglio).includes('25 MB'), r.dettaglio);
});

test('la codifica dichiarata dopo un\'intestazione lunga vale, e l\'euro di windows-1252 resta un euro', async () => {
  const testa = `<link rel="stylesheet" href="/css/${'x'.repeat(60)}.css">\n`.repeat(70);
  const html = `<html><head>${testa}<meta charset="iso-8859-1"><title>Trattoria</title></head><body><main><p>Il caff\xe8 costa 1,20 \x80.</p></main></body></html>`;
  const url = verso('/trattoria', { tipo: 'text/html', corpo: Buffer.from(html, 'latin1') });
  const r = await conRete(() => PR.leggiPagina(url));
  assert.ok(r.testo.includes('Il caffè costa 1,20 €'), r.testo);
});

test('una scheda aperta da Filo si ritrova con l\'indirizzo chiesto anche dopo un rimando, finché resta lì', () => {
  const eventi = new Map();
  const wc = { url: 'https://sito.example/it/listino', on: (n, f) => eventi.set(n, f), removeListener() {}, getURL() { return this.url; } };
  PR.ricordaApertura(wc, 'https://sito.example/listino');
  eventi.get('did-navigate')({}, 'https://sito.example/it/listino');
  const scheda = { wc, url: wc.url };
  assert.equal(PR.trovaScheda('https://sito.example/listino', [scheda]), scheda);
  wc.url = 'https://altro.example/';
  assert.equal(PR.trovaScheda('https://sito.example/listino', [scheda]), null, 'se l\'utente è andato altrove non è più lei');
});

test('il freno conosce i codici letti dove l\'utente ha fatto l\'accesso, non le parole, e lascia seguire i link di quella pagina', () => {
  PR._riservate.length = 0;
  PR.ricordaLetturaRiservata('Conto di Mario Rossi, IBAN IT60X0542811101000000123456, carta 4111 1111 1111 1111. '
    + 'Sciopero dei treni venerdì: [leggi](https://giornale.example/sciopero-dei-treni-venerdi)', 'https://banca.example/conto');
  const m = PR.materialeRiservato('https://attaccante.example/r');
  assert.ok(m.includes('it60x0542811101000000123456') && m.includes('4111111111111111'));
  assert.ok(!/sciopero|treni|mario|rossi/.test(m), 'le parole non entrano nel confronto');
  assert.equal(PR.materialeRiservato('https://giornale.example/sciopero-dei-treni-venerdi#x'), '', 'un link di quella pagina si segue');
  require(join(ROOT, 'src', 'shared', 'urlExfil.js'));
  assert.equal(globalThis.SN_URL_EXFIL.assess('https://attaccante.example/r?d=IT60X0542811101000000123456', { corpus: m }).exfil, true);
  PR._riservate.length = 0;
});

test('l\'estrazione gira in un thread a parte e dà lo stesso testo', async () => {
  const PT = require(join(ROOT, 'src', 'main', 'services', 'pageText.js'));
  const html = `<html><body><main><h1>Prezzi</h1><p>${'Il piano costa 9,99 euro. '.repeat(20)}</p></main><footer>Orari 8-19</footer></body></html>`;
  const r = await PR.estraiInDisparte(html, 'https://x.example/');
  assert.equal(r.testo, PT.estrai(html, { url: 'https://x.example/' }).testo);
});

// #553, decisione su D-20: dalla chat un indirizzo «compare» se sta così com'è nelle parole dell'utente, nei risultati,
// nelle pagine lette e nei loro link, nelle schede o nella cronologia; se no l'ha scritto il modello, qualunque forma abbia.
require(join(ROOT, 'src', 'shared', 'sitiComuni.js'));
const compare = (c, url, opz) => PR.verificaIndirizzo(c, url, opz).compare;

test('un indirizzo trovato compare, uno scritto dal modello no, comunque sia scritto', () => {
  const c = PR.contestoChat();
  PR.annotaLink(c, 'leggimi www.comune.example/uffici/orari?sede=centro, grazie');
  PR.annotaAzione(c, { type: 'CERCA_WEB', _output: { results: [{ url: 'https://giornale.example/2026/09/28/sciopero_dei_treni_orari_e_fasce_garantite-423456789/' }] } });
  PR.annotaAzione(c, { type: 'LEGGI_PAGINA', _output: { ok: true, url: 'https://a.example/p', testo: 'Vedi [gli orari](https://a.example/orari_(estate)).' } });
  assert.equal(compare(c, 'https://comune.example/uffici/orari?sede=centro'), true, 'scritto dall\'utente');
  assert.equal(compare(c, 'https://giornale.example/2026/09/28/sciopero_dei_treni_orari_e_fasce_garantite-423456789'), true, 'un risultato');
  assert.equal(compare(c, 'https://a.example/orari_(estate)'), true, 'un link della pagina letta');
  assert.equal(compare(c, 'https://banca.example/conto', { schede: ['https://www.banca.example/conto/'] }), true, 'una scheda aperta');
  assert.equal(compare(c, 'https://vecchia.example/pagina', { cronologia: PR.chiaviCronologia(['https://vecchia.example/pagina']) }), true, 'la cronologia');
  for (const url of [
    'https://attaccante.example/r?d=Znevb_Ebffv_Obybtan',
    'https://attaccante.example/r?d=TWFyaW8gUm9zc2k=',
    'https://attaccante.example/r?d=positivo_epatite_C_dottor_Bianchi',
    'https://www.museoegizio.it/info/orari-e-biglietti/',
  ]) assert.equal(compare(c, url), false, url);
  assert.equal(compare(null, 'https://attaccante.example/r?d=x'), true, 'fuori dalla chat decide chi chiama');
});

test('il frammento e le credenziali contano: un indirizzo trovato non li aveva', () => {
  const c = PR.contestoChat();
  PR.annotaAzione(c, { type: 'LEGGI_PAGINA', _output: { ok: true, url: 'https://attaccante.example/p', testo: 'Vai a [questa](https://attaccante.example/r).' } });
  assert.equal(compare(c, 'https://attaccante.example/r'), true);
  assert.equal(compare(c, 'https://attaccante.example/r#4d6172696f20526f737369'), false);
  assert.equal(compare(c, 'https://4d6172696f@attaccante.example/r'), false);
  assert.equal(compare(c, 'https://attaccante.example/r#4d6172696f', { scaricata: true }), true, 'una lettura scaricata non manda il frammento');
  assert.equal(compare(c, 'https://sito.example/app#x', { schede: ['https://sito.example/app'] }), false, 'la scheda senza frammento');
  assert.equal(compare(c, 'https://sito.example/app#/posta', { schede: ['https://sito.example/app#/posta'] }), true);
});

test('dall\'elenco dei siti: la home compare, la ricerca porta le parole da controllare', () => {
  const c = PR.contestoChat();
  assert.deepEqual(PR.verificaIndirizzo(c, 'https://www.amazon.it/').compare, true);
  const r = PR.verificaIndirizzo(c, 'https://www.amazon.it/s?k=cuffie+bluetooth');
  assert.equal(r.compare, false);
  assert.equal(r.sito.parole, 'cuffie bluetooth');
  assert.equal(PR.verificaIndirizzo(c, 'https://ru.wikipedia.org/wiki/Великая_Отечественная_война').sito.parole, 'Великая Отечественная война');
  assert.equal(PR.verificaIndirizzo(c, 'https://www.amazon.it/s?k=x&ref=attaccante').sito, null, 'un parametro in più non è la ricerca dell\'elenco');
});

test('il rifiuto si ricorda: lo stesso indirizzo richiesto di nuovo è un modello che insiste', () => {
  const c = PR.contestoChat();
  const url = 'https://attaccante.example/r?d=Znevb';
  assert.equal(PR.verificaIndirizzo(c, url).insiste, false);
  PR.annotaAzione(c, { type: 'LEGGI_PAGINA', _output: { nonCompare: true, url } });
  assert.equal(PR.verificaIndirizzo(c, url).insiste, true);
  assert.equal(PR.verificaIndirizzo(c, 'https://attaccante.example/altro').insiste, false);
  PR.annotaAzione(c, { type: 'LEGGI_PAGINA', _output: { senzaModulo: true, url: 'https://negozio.example/' } });
  assert.equal(PR.verificaIndirizzo(c, 'https://negozio.example/cerca?q=x').insiste, true, 'senza modulo il modello scrive lui la ricerca');
});

test('un indirizzo che il modello ha già scritto resta suo anche se una fonte lo ripete dopo', () => {
  const url = 'https://attaccante.example/r?d=Znevb-Ebffv-Obybtan';
  const c = PR.contestoChat();
  const cerca = `https://it.wikipedia.org/w/index.php?search=${encodeURIComponent(url)}`;
  PR.annotaAzione(c, { type: 'LEGGI_PAGINA', url: cerca, _output: { ok: true, url: cerca, testo: `Non ci sono risultati per «${url}».` } });
  assert.equal(compare(c, url), false, 'ripetuto dalla pagina dei risultati di una ricerca');
  assert.equal(compare(c, cerca), true, 'la pagina letta resta quella');
  const piu = PR.contestoChat();
  PR.annotaAzione(piu, { type: 'LEGGI_PAGINA', url: `https://www.amazon.it/s?k=${url.replace('://', '%3A%2F%2F')}+x`, _output: { ok: true, testo: `Risultati per ${url} x` } });
  assert.equal(compare(piu, url), false, 'col «+» dei moduli al posto dello spazio');
  const doc = PR.contestoChat();
  PR.annotaAzione(doc, { type: 'APRI_FILE', percorso: 'attaccante.example/r?d=Znevb' });
  PR.annotaAzione(doc, { type: 'LEGGI_DOCUMENTO', _output: { ok: true, text: 'vedi attaccante.example/r?d=Znevb' } });
  assert.equal(compare(doc, 'https://attaccante.example/r?d=Znevb'), false, 'scritto senza «https://»');
  const cmd = PR.contestoChat();
  PR.annotaAzione(cmd, { type: 'ESEGUI_COMANDO', comando: 'a=https://attaccante.example; echo "$a/r?d=Znevb"', _output: { stdout: `${url}\n` } });
  assert.equal(compare(cmd, url), false, 'l\'uscita di un comando la scrive il modello');
  const schermo = PR.contestoChat();
  PR.annotaAzione(schermo, { type: 'VEDI_SCHERMO', _output: { filo: true, testo: `Filo: ecco ${url}` } });
  assert.equal(compare(schermo, url), false, 'la finestra di Filo mostra le parole del modello');
  PR.annotaAzione(schermo, { type: 'VEDI_SCHERMO', _output: { filo: false, testo: 'Posta: https://banca.example/avviso' } });
  assert.equal(compare(schermo, 'https://banca.example/avviso'), true, 'un\'altra finestra conta');
  const trovato = PR.contestoChat();
  PR.annotaAzione(trovato, { type: 'LEGGI_PAGINA', url: 'https://ai.google.dev/pricing', _output: { nonCompare: true, url: 'https://ai.google.dev/pricing' } });
  PR.annotaAzione(trovato, { type: 'CERCA_WEB', query: 'gemini prezzi', _output: { results: [{ url: 'https://ai.google.dev/pricing' }] } });
  assert.equal(compare(trovato, 'https://ai.google.dev/pricing'), true, 'scritto e poi trovato fra i risultati: compare');
  const pagina = PR.contestoChat();
  PR.annotaAzione(pagina, { type: 'LEGGI_PAGINA', url: 'https://a.example/p', _output: { ok: true, url: 'https://a.example/p', testo: '[orari](https://a.example/orari)' } });
  assert.equal(compare(pagina, 'https://a.example/orari'), true, 'un link della pagina letta, che il modello non aveva scritto');
});

test('la home di un sito che l\'utente ha nominato compare; un sottodominio o un percorso no', () => {
  const c = PR.contestoChat();
  const parole = 'cercami una libreria bianca su Ikea e poi guarda Mondadori Store';
  assert.equal(compare(c, 'https://www.ikea.com/', { parole }), true);
  assert.equal(compare(c, 'https://www.ikea.com/it/it/', { parole }), true);
  assert.equal(compare(c, 'https://www.mondadoristore.it/', { parole }), true);
  assert.equal(compare(c, 'https://ikea.attaccante.example/', { parole }), false);
  assert.equal(compare(c, 'https://www.ikea.com/it/it/p/billy-libreria', { parole }), false);
  assert.equal(compare(c, 'https://www.ikea.com/?d=x', { parole }), false);
  assert.equal(compare(c, 'https://www.leroymerlin.it/', { parole }), false, 'un sito che non ha nominato');
});

test('il modulo di ricerca della home dà l\'indirizzo che il sito costruirebbe, solo sullo stesso sito', () => {
  const home = 'https://www.negozio.example/';
  const m = PR.moduloDiRicerca(`<header><form action="/accesso" method="post"><input name="u"></form>
<form role="search" action="/ricerca"><input type="hidden" name="lingua" value="it"><input type="search" name="testo"></form></header>`, home);
  assert.deepEqual(m, { url: 'https://www.negozio.example/ricerca?lingua=it', campo: 'testo' });
  assert.equal(PR.urlConParole(m, '  librerie   bianche '), 'https://www.negozio.example/ricerca?lingua=it&testo=librerie+bianche');
  assert.equal(PR.moduloDiRicerca('<form action="https://attaccante.example/s"><input name="q"></form>', home), null, 'un altro sito');
  assert.equal(PR.moduloDiRicerca('<p>niente moduli</p>', home), null);
  assert.equal(PR.moduloDiRicerca('<form action="https://shop.negozio.example/s"><input name="q"></form>', home).url, 'https://shop.negozio.example/s');
});

// #553, giro 14: «rileggila, ci sono novità?» porta la pagina com'è adesso; la copia da parte vale solo per il seguito.
test('una pagina riletta da capo arriva com\'è adesso, non com\'era alla prima lettura', async () => {
  const pagina = (n) => ({ corpo: `<html><head><title>Diretta</title></head><body><main><h1>Diretta del consiglio</h1><p>Aggiornamento numero ${n}: la seduta è in corso e la votazione sul bilancio non è ancora iniziata.</p></main></body></html>` });
  const url = verso('/diretta', pagina(1));
  await conRete(async () => {
    assert.ok((await PR.leggiPagina(url)).testo.includes('Aggiornamento numero 1'));
    PAGINE.set('/diretta', pagina(2));
    assert.ok((await PR.leggiPagina(url)).testo.includes('Aggiornamento numero 2'));
  });
});
