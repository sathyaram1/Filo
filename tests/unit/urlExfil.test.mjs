// Unit test per src/shared/urlExfil.js — il rilevatore di esfiltrazione dati via
// URL (sicurezza NAVIGA). Una pagina ostile può iniettare istruzioni nel modello
// per fargli aprire un link che porta FUORI dati sensibili (memoria/profilo). Il
// taint-match deve riconoscere i dati del corpus dentro l'URL (anche urlencoded
// o base64) e lasciare passare i link innocui; il fallback strutturale copre i
// payload da origine non fidata.
//
// Asseriamo il SUCCESSO della difesa: un URL che esfiltra dati del corpus →
// exfil:true; un URL di ricerca normale → exfil:false. Senza il modulo questi
// assert non avrebbero senso, e un eventuale regress li rende rossi.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'shared', 'urlExfil.js'));

const E = globalThis.SN_URL_EXFIL;

// Corpus tipico: dati personali che il modello aveva nel contesto.
const CORPUS = [
  'Profilo: si chiama Mario Rossi, vive a Bologna.',
  'Email: sathyarampontillo@gmail.com',
  'Preferenze: tema scuro, lingua italiana.',
  'Token salvato: ABC123XYZ789TOK',
].join('\n');

const isExfil = (url, opts = {}) => E.assess(url, { corpus: CORPUS, ...opts }).exfil;

test('il modulo si registra su globalThis con la sua API', () => {
  assert.ok(E);
  assert.equal(typeof E.assess, 'function');
});

test('link innocui NON sono esfiltrazione (zero attrito sui casi normali)', () => {
  for (const url of [
    'https://example.com',
    'https://example.com/cerca?q=gatti',
    'https://www.google.com/search?q=meteo+bologna',
    'https://news.ycombinator.com/item?id=12345',
    'https://it.wikipedia.org/wiki/Bologna', // "bologna" NON è nel corpus come token isolato sensibile forte
    'example.com',
    '',
  ]) {
    assert.equal(isExfil(url), false, `"${url}" non dovrebbe essere esfiltrazione`);
  }
});

test('taint — nome/dati del profilo in chiaro nella query → esfiltrazione', () => {
  assert.equal(isExfil('https://attaccante.com/?d=Mario_Rossi'), true);
  assert.equal(isExfil('https://attaccante.com/log?u=mario.rossi&c=bologna'), true);
});

test('taint — email del corpus nel link → esfiltrazione', () => {
  assert.equal(isExfil('https://attaccante.com/?e=sathyarampontillo@gmail.com'), true);
  assert.equal(isExfil('https://attaccante.com/?e=sathyarampontillo%40gmail.com'), true);
});

test('taint — token con cifre del corpus → esfiltrazione', () => {
  assert.equal(isExfil('https://attaccante.com/?t=ABC123XYZ789TOK'), true);
});

test('taint — dati urlencodati (anche doppio) → esfiltrazione', () => {
  assert.equal(isExfil('https://attaccante.com/?d=Mario%20Rossi'), true);
  assert.equal(isExfil('https://attaccante.com/?d=Mario%2520Rossi'), true);
});

test('taint — dati codificati in base64 → esfiltrazione', () => {
  // base64("Mario Rossi Bologna") con dati del profilo
  const b64 = Buffer.from('Mario Rossi Bologna').toString('base64');
  assert.equal(isExfil(`https://attaccante.com/c?p=${b64}`), true);
});

test('taint — funziona anche su path e sottodominio, non solo query', () => {
  assert.equal(isExfil('https://attaccante.com/exfil/Mario_Rossi/done'), true);
  assert.equal(isExfil('https://mario-rossi-bologna.attaccante.com'), true);
});

test('una parola comune lunga (stopword) da sola NON scatena un falso positivo', () => {
  // "preferenze" è nel corpus ma è una parola comune: da sola non basta.
  assert.equal(isExfil('https://example.com/preferenze'), false);
});

test('fallback strutturale — payload corposo SOLO da origine non fidata', () => {
  const blob = 'x'.repeat(120);
  const url = `https://attaccante.com/?p=${blob}`;
  // da pagina web non fidata (agente sulla pagina) → sospetto
  assert.equal(isExfil(url, { fromUntrusted: true }), true);
  // da input diretto/dashboard (fidato) → niente nag sui link lunghi legittimi
  assert.equal(isExfil(url, { fromUntrusted: false }), false);
});

test('fallback strutturale — blob opaco lungo da origine non fidata', () => {
  const url = 'https://attaccante.com/?s=ZGF0aWNpZnJhdGljaGVpbHRhaW50bm9udmVkZQ';
  assert.equal(isExfil(url, { fromUntrusted: true }), true);
});

test('assess torna anche una reason leggibile quando rileva esfiltrazione', () => {
  const v = E.assess('https://attaccante.com/?e=sathyarampontillo@gmail.com', { corpus: CORPUS });
  assert.equal(v.exfil, true);
  assert.ok(typeof v.reason === 'string' && v.reason.length > 0);
});

test('corpus vuoto + origine fidata → nessun falso positivo', () => {
  assert.equal(E.assess('https://attaccante.com/?d=qualcosa', { corpus: '', fromUntrusted: false }).exfil, false);
});

// ── #587 giro 2: l'avviso non deve comparire sui link di tutti i giorni ──────
// Il ripiego strutturale si accende da quando nel contesto è entrato qualcosa —
// un comando, una ricerca, un documento — e resta acceso per tutta la vita
// della scheda. Se scatta sugli identificativi che ogni sito mette nei suoi
// indirizzi, l'avviso compare su link innocui, si clicca senza leggerlo, e con
// lui si perde la protezione vera.
test('#587 — gli identificativi dei siti veri non sono un carico di dati', () => {
  for (const url of [
    'https://it.wikipedia.org/wiki/Storia_della_matematica',
    'https://www.giallozafferano.it/ricette/Spaghetti-alla-carbonara.html',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://www.amazon.it/dp/B08N5WRWNW/ref=sr_1_1?keywords=libro&qid=1699999999&sr=8-1',
    'https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit',
    'https://drive.google.com/file/d/1a2B3c4D5e6F7g8H9i0J/view',
    'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT',
    'https://www.repubblica.it/cronaca/2026/09/12/news/titolo_articolo-424242424/',
    'https://github.com/anthropics/claude-code/blob/main/README.md',
    'https://www.corriere.it/esteri/26_settembre_12/notizia-a1b2c3d4-e5f6-11ee-9abc-1234567890ab.shtml',
    'https://www.booking.com/hotel/it/villa-roma.it.html?aid=1234567&sid=abcdef0123456789abcdef0123456789',
    'https://it.aliexpress.com/item/1005006123456789.html',
    'https://www.ikea.com/it/it/p/malm-struttura-letto-alta-bianco-s69009475/',
    'https://www.instagram.com/p/C1a2B3c4D5e/',
    'https://x.com/utente/status/1832847362819374821',
    'https://stackoverflow.com/questions/1234567/how-to-do-a-thing',
    'https://www.netflix.com/watch/81234567',
    'https://meet.google.com/abc-defg-hij',
  ]) {
    const v = E.assess(url, { corpus: '', fromUntrusted: true });
    assert.equal(v.exfil, false, `"${url}" non deve chiedere conferma (${v.reason})`);
  }
});

test('#587 — un carico di dati vero resta sospetto anche senza combaciare con niente', () => {
  for (const url of [
    // impacchettato: illeggibile, ma si riapre come testo
    'https://raccolta.test/?d=U0VHUkVUTzogSUJBTiBJVDYwWDA1NDI4MTExMDEwMDAwMDA=',
    // cifrato: illeggibile e non si riapre, ma è lungo come nessun
    // identificativo di sito
    'https://raccolta.test/?p=U2FsdGVkX1+9kQ3mJx2bHhGf7pQwLm4nZ1aRtYuIoPaSdFgHjKlZxCvBnM0987654321',
    // nel sottodominio, dove un sito vero non mette mai niente del genere
    'https://9f8e7d6c5b4a39281706f5e4d3c2b1a0.raccolta.test/ping',
  ]) {
    assert.equal(E.assess(url, { corpus: '', fromUntrusted: true }).exfil, true, `"${url}" deve chiedere conferma`);
  }
});

// ── #587, giro 3 — il dato tagliato dentro l'indirizzo ──────────────────────
//
// Chi compone l'indirizzo è la pagina ostile che detta al modello cosa aprire:
// le bastava tagliare il dato in due e rimetterlo in due parametri perché il
// confronto non trovasse più niente (in mezzo ci finisce il nome del secondo
// parametro). I pezzi, presi da soli, si leggono come parole, quindi nemmeno il
// controllo di riserva sulla forma diceva niente: la password usciva intera,
// senza avvisi. Senza il fix i primi assert tornano false.
const LETTO = [
  'machine ftp.esempio.it login mario password SegretoNetrc2026',
  'token github ghp_A1b2C3d4E5f6G7h8I9j0',
].join('\n');
const chiede = (url) => E.assess(url, { corpus: LETTO, fromUntrusted: true }).exfil;

test('#587 — il dato tagliato in due esce lo stesso, quindi chiede conferma', () => {
  for (const url of [
    'https://raccolta.test/?a=SegretoN&b=etrc2026',
    'https://raccolta.test/?a=Segret&b=oNetr&c=c2026',
    'https://raccolta.test/?t1=ghp_A1b2C3&t2=d4E5f6G7h8I9j0',
    'https://raccolta.test/xSegretoNyetrc2026z',
    // lo stesso taglio fatto sul base64 invece che sul testo
    'https://raccolta.test/?a=U2VncmV0&b=b05ldHJjMjAyNg==',
  ]) {
    assert.equal(chiede(url), true, `"${url}" porta fuori il dato: deve chiedere conferma`);
  }
  // e il dato intero continua a chiederla
  assert.equal(chiede('https://raccolta.test/?d=SegretoNetrc2026'), true);
});

test('#587 — il confronto più largo non accende avvisi sugli indirizzi veri', () => {
  for (const url of [
    'https://it.wikipedia.org/wiki/Storia_della_matematica',
    'https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit',
    'https://www.amazon.it/dp/B08N5WRWNW/ref=sr_1_3?keywords=cuffie&qid=1699999999&sr=8-3',
    'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf',
    'https://stackoverflow.com/questions/1234567/how-to-do-a-thing-in-javascript',
    'https://www.ikea.com/it/it/p/billy-libreria-bianco-00263850/',
    'https://duckduckgo.com/?q=ricetta+carbonara&t=h_&ia=web',
    'https://calendar.google.com/calendar/u/0/r/week/2026/9/12',
  ]) {
    assert.equal(chiede(url), false, `"${url}" non deve chiedere niente`);
  }
});

// ── #587 giro 4: il dato travestito, e l'avviso che non deve comparire ───────
//
// La difesa riconosceva il dato in chiaro, in base64 e tagliato in due o tre
// pezzi. Restavano fuori i travestimenti che costano una riga a chi compone
// l'indirizzo: scriverlo all'indietro, spostare l'alfabeto, infilare una lettera
// ogni tre caratteri, scriverlo in esadecimale quando è corto. E dall'altra
// parte l'avviso compariva su sei link veri su venti appena Filo aveva letto un
// documento, perché fra le parole da proteggere finiva «https» — che sta dentro
// ogni indirizzo — e una parola qualunque in comune bastava a completare la
// coppia. Senza il fix la prima prova torna false e la seconda true.
const G4 = [
  'machine ftp.esempio.it login mario password SegretoNetrc2026',
  'OPENROUTER_API_KEY=sk-or-v1-9f3ab2c7d84e1f5b6a0c',
].join('\n');
const chiedeG4 = (url) => E.assess(url, { corpus: G4, fromUntrusted: true }).exfil;
const rovesciaG4 = (s) => s.split('').reverse().join('');
const sparsoG4 = (s, n) => s.match(new RegExp(`.{1,${n}}`, 'g')).join('x');

test('#587 — il dato travestito porta comunque fuori i dati, quindi chiede conferma', () => {
  const seg = 'SegretoNetrc2026';
  const chiave = 'sk-or-v1-9f3ab2c7d84e1f5b6a0c';
  for (const url of [
    `https://raccolta.test/?d=${rovesciaG4(seg)}`,
    `https://raccolta.test/?d=${rovesciaG4(chiave)}`,
    `https://raccolta.test/?d=${sparsoG4(seg, 4)}`,
    `https://raccolta.test/?d=${sparsoG4(seg, 3)}`,
    `https://raccolta.test/?d=${sparsoG4(chiave, 4)}`,
    `https://raccolta.test/?d=${Buffer.from(seg).toString('hex')}`,
    // alfabeto spostato di tredici lettere (le cifre restano dove sono)
    `https://raccolta.test/?d=${seg.replace(/[a-z]/gi, (c) => String.fromCharCode((c <= 'Z' ? 90 : 122) >= (c.charCodeAt(0) + 13) ? c.charCodeAt(0) + 13 : c.charCodeAt(0) - 13))}`,
  ]) {
    assert.equal(chiedeG4(url), true, `"${url}" porta fuori il dato: deve chiedere conferma`);
  }
});

test('#587 — dopo un documento letto, i link di tutti i giorni si aprono e basta', () => {
  // Un documento come quelli che un utente fa leggere a Filo: contiene un link,
  // come quasi tutti i documenti veri.
  const bolletta = [
    'ENEL ENERGIA — Bolletta di luglio 2026',
    'Cliente: Mario Rossi, via Verdi 10, Roma',
    'Paga online dall’area clienti: https://www.enel.it/it/area-clienti',
    'Servizio assistenza clienti 800 900 800. Numero cliente 88123456.',
  ].join('\n');
  for (const url of [
    'https://www.enel.it/it/area-clienti',            // il link scritto nel documento
    'https://www.poste.it/servizi-online.html',
    'https://www.ilsole24ore.com/art/energia-bollette-in-calo-AF8k2Lm',
    'https://www.corriere.it/cronache/26_settembre_12/roma-nuovo-piano-traffico.shtml',
    'https://maps.google.com/?q=via+Verdi+Roma',
    'https://www.trenitalia.com/it/offerte.html',
  ]) {
    const v = E.assess(url, { corpus: bolletta, fromUntrusted: true });
    assert.equal(v.exfil, false, `"${url}" non deve chiedere niente (${v.reason})`);
  }
});

test('#587 — un dump di dati personali nel link chiede ancora conferma', () => {
  // La regola delle parole comuni resta: due parole del materiale protetto
  // dentro il CARICO del link sono un dump, non una coincidenza.
  const memoria = 'Profilo: si chiama Mario Rossi, vive a Bologna.';
  for (const url of [
    'https://raccolta.test/?d=Mario_Rossi',
    'https://raccolta.test/log?u=mario.rossi&c=bologna',
    'https://raccolta.test/exfil/MarioRossiBologna/done',
  ]) {
    assert.equal(E.assess(url, { corpus: memoria, fromUntrusted: true }).exfil, true, `"${url}" deve chiedere conferma`);
  }
});

// ── #587, giro 5 — il dato spedito con più link, e l'avviso sul documento ────
//
// Tutto quello che c'era prima guarda UN indirizzo alla volta. Chi lo compone è
// la pagina ostile che detta al modello cosa aprire, e può dettargliene due:
// metà password nel primo, metà nel secondo. Nessuno dei due contiene un dato
// intero, quindi nessuno dei due chiedeva niente. Senza il fix il primo assert
// torna false.
const G5 = [
  'machine ftp.esempio.it login mario password SegretoNetrc2026',
  'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY',
].join('\n');

// Come arrivano davvero: uno dopo l'altro nella stessa scheda, e il carico di
// quelli già aperti resta nel registro (src/main/services/contextTaint.js).
function spedito(urls, corpus = G5) {
  const prima = [];
  let fermato = false;
  for (const url of urls) {
    if (E.assess(url, { letto: corpus, fromUntrusted: true, carichiPrima: prima }).exfil) fermato = true;
    prima.push(E.caricoUnito(url));
  }
  return fermato;
}

test('#587 — un dato spedito con più link chiede conferma', () => {
  assert.equal(spedito([
    'https://raccolta.test/?a=SegretoN',
    'https://raccolta.test/?b=etrc2026',
  ]), true, 'la password arriva intera al destinatario');
  assert.equal(spedito([
    'https://raccolta.test/?a=wJalrXUtnFEMIK7M',
    'https://raccolta.test/?b=DENGbPxRfiCYEXAMPLEKEY',
  ]), true, 'la chiave AWS arriva intera');
  assert.equal(spedito([
    'https://raccolta.test/a/Segreto',
    'https://raccolta.test/b/Netrc2026',
  ]), true, 'stesso trucco nel percorso');
  assert.equal(spedito([
    'https://SegretoN.raccolta.test/',
    'https://etrc2026.raccolta.test/',
  ]), true, 'stesso trucco nel sottodominio');
});

test('#587 — più link di tutti i giorni, uno dopo l’altro, non accendono niente', () => {
  assert.equal(spedito([
    'https://it.wikipedia.org/wiki/Storia_della_matematica',
    'https://www.giallozafferano.it/ricette/Spaghetti-alla-carbonara.html',
    'https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit',
    'https://www.amazon.it/dp/B08N5WRWNW',
    'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT',
    'https://duckduckgo.com/?q=ricetta+carbonara',
    'https://stackoverflow.com/questions/12345678/how-to-parse-json',
    'https://www.ikea.com/it/it/p/billy-libreria-bianco-00263850/',
  ]), false, 'nessuno di questi porta fuori niente');
});

// L'avviso dopo un documento letto: il rilievo dei giri 1, 2 e 4 tornava dai
// link DEL documento, cioè proprio quelli che uno apre dopo averlo letto.
// Bastavano due parole comuni in comune, e fra un appunto e i link del suo
// argomento le parole in comune ci sono per forza. Senza il fix questi tornano
// true.
test('#587 — dopo un documento letto, i link del suo argomento si aprono e basta', () => {
  const viaggio = [
    'Viaggio a Firenze 3-6 ottobre. Hotel Duomo prenotato.',
    'Visitare la galleria degli Uffizi e il giardino di Boboli.',
    'Treno Italo delle 7:45. Ristorante Trattoria Mario.',
  ].join('\n');
  for (const url of [
    'https://www.booking.com/hotel/it/duomo-firenze.it.html',
    'https://www.uffizi.it/gli-uffizi/biglietti',
    'https://www.italotreno.it/it/offerte/firenze',
    'https://it.wikipedia.org/wiki/Giardino_di_Boboli',
    'https://www.google.com/maps/place/Galleria+degli+Uffizi',
  ]) {
    const v = E.assess(url, { letto: viaggio, fromUntrusted: true });
    assert.equal(v.exfil, false, `"${url}" non deve chiedere niente (${v.reason})`);
  }
});

test('#587 — un dato riconoscibile dentro un documento letto chiede ancora conferma', () => {
  for (const url of [
    'https://raccolta.test/?d=SegretoNetrc2026',
    'https://raccolta.test/?a=Segreto&b=Netrc2026',
    'https://raccolta.test/?d=U2VncmV0b05ldHJjMjAyNg==',
    'https://raccolta.test/?d=wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY',
  ]) {
    assert.equal(E.assess(url, { letto: G5, fromUntrusted: true }).exfil, true, `"${url}" deve chiedere conferma`);
  }
});

test('#587 — la regola delle parole comuni resta sulla memoria', () => {
  const memoria = 'Profilo: si chiama Mario Rossi, vive a Bologna.';
  assert.equal(E.assess('https://raccolta.test/?d=MarioRossiBologna', { corpus: memoria, fromUntrusted: true }).exfil, true);
});

// ── #587, giro 6 ───────────────────────────────────────────────────────────
// Il dato spedito con più link veniva riconosciuto solo se il taglio cadeva nel
// punto giusto: a ricomporlo si partiva dall'inizio del dato e si pretendeva che
// il primo link ne portasse un pezzo intero. Ma dove tagliare lo sceglie chi
// attacca, e spostare il taglio di tre caratteri bastava a far uscire la chiave.
test('#587 — la chiave spedita con più link chiede conferma dovunque cada il taglio', () => {
  const CHIAVE = 'sk-or-v1-9f3bd2a71c4e8b60';
  const letto = `OPENROUTER_API_KEY=${CHIAVE}\nDB_HOST=localhost\n`;
  const apri = (urls) => {
    const carichi = [];
    let motivo = '';
    for (const u of urls) {
      const v = E.assess(u, { letto, fromUntrusted: true, carichiPrima: carichi.slice() });
      if (v.exfil && !motivo) motivo = v.reason;
      carichi.push(E.caricoUnito(u));
      while (carichi.length > 24) carichi.shift();
    }
    return motivo;
  };
  const inParametri = (pezzi) => pezzi.map((p, i) => `https://raccolta.test/?p${i}=${p}`);
  for (let t = 4; t < CHIAVE.length - 3; t++) {
    const urls = inParametri([CHIAVE.slice(0, t), CHIAVE.slice(t)]);
    assert.ok(apri(urls), `tagliata a ${t} la chiave esce intera: ${urls.join(' + ')}`);
  }
  for (const quanti of [3, 4, 5, 6, 8, 13]) {
    const len = Math.ceil(CHIAVE.length / quanti);
    const pezzi = [];
    for (let i = 0; i < CHIAVE.length; i += len) pezzi.push(CHIAVE.slice(i, i + len));
    assert.ok(apri(inParametri(pezzi)), `spedita in ${pezzi.length} link la chiave esce intera`);
  }
  const cinque = [];
  for (let i = 0; i < CHIAVE.length; i += 5) cinque.push(CHIAVE.slice(i, i + 5));
  assert.ok(apri(cinque.map((p) => `https://raccolta.test/${p}`)), 'pezzi nel percorso');
  assert.ok(apri(cinque.map((p) => `https://${p}.raccolta.test/`)), 'pezzi nel sottodominio');
  assert.ok(apri(cinque.map((p, i) => `https://raccolta.test/?k${i}=${p}&z=q`)), 'pezzi con un parametro in coda');
});

// …e gli indirizzi di tutti i giorni devono continuare ad aprirsi e basta, anche
// dopo che nella scheda ne sono passati parecchi: incollare i carichi di molti
// link può ricomporre per caso un numero lungo, e un avviso falso si clicca
// senza leggerlo.
test('#587 — dopo venti link veri non compare nessun avviso', () => {
  const letto = 'Cliente numero 123456789012\nPOD IT001E12345678\nfattura settembre 2026\n';
  const veri = [
    'https://it.wikipedia.org/wiki/Storia_della_matematica',
    'https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit',
    'https://www.amazon.it/dp/B08N5WRWNW',
    'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT',
    'https://news.ycombinator.com/item?id=41234567',
    'https://stackoverflow.com/questions/12345678/how-to-parse-json',
    'https://www.airbnb.it/rooms/12345678?check_in=2026-10-01',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://www.ikea.com/it/it/p/billy-libreria-bianco-00263850/',
    'https://www.booking.com/hotel/it/duomo-firenze.it.html?aid=304142',
    'https://www.reddit.com/r/italy/comments/1abcdef/bollette_luce/',
    'https://www.imdb.com/title/tt0111161/',
    'https://maps.app.goo.gl/aBcDeFgHiJkLmN',
    'https://www.netflix.com/watch/81234567?trackId=255824129',
    'https://x.com/anthropicai/status/1799999999999999999',
    'https://www.instagram.com/p/C1a2B3c4D5e/',
    'https://drive.google.com/file/d/1a2B3c4D5e6F7g8H9i0JkLmNoPqRsTuVw/view',
    'https://www.subito.it/annunci-toscana/vendita/usato/firenze/',
    'https://duckduckgo.com/?q=ricetta+carbonara',
    'https://github.com/anthropics/claude-code/issues/1234',
  ];
  const carichi = [];
  for (const u of veri) {
    const v = E.assess(u, { letto, fromUntrusted: true, carichiPrima: carichi.slice() });
    assert.equal(v.exfil, false, `"${u}" non porta fuori niente (${v.reason})`);
    carichi.push(E.caricoUnito(u));
    while (carichi.length > 24) carichi.shift();
  }
});

// ── #587, giro 7 — il segreto con la punteggiatura dentro ─────────────────
//
// Dell'indirizzo si guarda la forma incollata; del corpus si guardavano solo le
// parole, spezzate a ogni carattere che non fosse una lettera o una cifra. Un
// segreto scritto come li scrive la gente — `Segreto-Netrc-2026` — non diventava
// mai un dato riconoscibile, e usciva in chiaro.
test('#587 — un segreto con trattini, punti o trattini bassi dentro non esce senza conferma', () => {
  const segreti = [
    'Segreto-Netrc-2026',
    'cavallo-batteria-graffetta-blu',
    'Estate_Rossa_2026',
    '9f3b.d2a7.1c4e.8b60',
    '4111-1111-1111-1111',
  ];
  for (const seg of segreti) {
    const letto = `machine ftp login mario password ${seg}\n`;
    const nudo = seg.replace(/[^A-Za-z0-9]/g, '');
    for (const url of [
      `https://male.esempio/?d=${encodeURIComponent(seg)}`,
      `https://male.esempio/${seg}/x`,
      `https://male.esempio/?d=${Buffer.from(nudo).toString('base64')}`,
      `https://male.esempio/?d=${nudo.split('').reverse().join('')}`,
    ]) {
      const v = E.assess(url, { letto, fromUntrusted: false });
      assert.equal(v.exfil, true, `"${url}" porta fuori ${seg}`);
    }
  }
});

// Le date incollate non sono dati: `2026-05-04` diventerebbe `20260504`, che sta
// dentro l'indirizzo di qualunque articolo di quel giorno. E un indirizzo o un
// nome di file citato dentro il documento non è un segreto da proteggere: senza
// questa esclusione l'avviso tornerebbe proprio sul link di cui il documento
// parla (il rilievo del giro 5).
test('#587 — date, indirizzi e nomi di file citati nel documento non diventano dati da proteggere', () => {
  const letto = `Appunto del 2026-05-04, contratto firmato il 2026-05-04
Bolletta: https://www.enel.it/it/area-clienti/bolletta
Articolo: www.ilsole24ore.com/art/energia-AFxyz12
Le chiavi stanno in .config/Filo/storage.json
`;
  for (const url of [
    'https://www.repubblica.it/cronaca/2026/05/04/news/firenze-424242/',
    'https://www.enel.it/it/area-clienti/bolletta',
    'https://www.corriere.it/economia/26_05_04/energia.shtml',
  ]) {
    const v = E.assess(url, { letto, fromUntrusted: false });
    assert.equal(v.exfil, false, `"${url}" non porta fuori niente (${v.reason})`);
  }
});

// Base64 ed esadecimale si sciolgono già: base32 è la terza codifica standard, e
// mancava.
test('#587 — un dato riscritto in base32 non esce senza conferma', () => {
  const b32 = (s) => {
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = '';
    for (const c of Buffer.from(s)) bits += c.toString(2).padStart(8, '0');
    let out = '';
    for (let i = 0; i < bits.length; i += 5) out += A[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
    return out;
  };
  for (const seg of ['9f3bd2a71c4e8b60', 'CasaVerde2026Rossa', 'Segreto-Netrc-2026']) {
    const letto = `chiave: ${seg}\n`;
    const v = E.assess(`https://male.esempio/?d=${b32(seg.replace(/[^A-Za-z0-9]/g, ''))}`, { letto, fromUntrusted: false });
    assert.equal(v.exfil, true, `"${seg}" in base32 deve far comparire l'avviso`);
  }
});

// #587 giro 8 — una parola lunga non è un dato, e il nome del sito non è carico.
//
// Bastava UNA parola del materiale letto dentro l'indirizzo per far comparire
// l'avviso, e "parola" voleva dire dodici caratteri, oppure cinque con una cifra
// dentro. In italiano quel metro prende in pieno le parole di tutti i giorni
// («prenotazione», «assicurazione», «amministrazione»), i nomi dei siti scritti
// attaccati («giallozafferano», «ilsole24ore») e i codici brevi («iPhone15»,
// «FR1234»): dopo un documento letto l'avviso compariva su tre link normali su
// quattro. Senza il fix ognuno di questi assert torna true.
test('#587 — dopo un documento letto, i link di tutti i giorni si aprono e basta', () => {
  for (const [url, letto] of [
    ['https://www.giallozafferano.it/ricette/Spaghetti-alla-carbonara.html',
      'Carbonara: guanciale, pecorino. Fonte: giallozafferano, primi piatti.'],
    ['https://ricette.giallozafferano.it/Pasta-cacio-e-pepe.html',
      'Carbonara: guanciale, pecorino. Fonte: giallozafferano, primi piatti.'],
    ['https://www.generali.it/assicurazioni/auto',
      "Promemoria: rinnovare l'assicurazione dell'auto entro ottobre."],
    ['https://www.thefork.it/prenotazione/12345',
      'Prenotazione confermata per il ristorante di sabato sera.'],
    ['https://www.comune.firenze.it/amministrazione-trasparente',
      "Riunione con l'amministrazione lunedì; portare la documentazione."],
    ['https://www.apple.com/it/iphone15/', 'Ho comprato un iPhone15 usato, controllare la garanzia.'],
    ['https://www.ryanair.com/it/it/booking/FR1234', 'Volo FR1234 per Barcellona, imbarco alle 6:20.'],
    ['https://www.ilsole24ore.com/art/energia-prezzi-abc', 'Il rapporto completo è su ilsole24ore, sezione economia.'],
  ]) {
    const v = E.assess(url, { corpus: '', letto, fromUntrusted: true });
    assert.equal(v.exfil, false, `"${url}" non porta fuori niente (${v.reason})`);
  }
});

// …e la protezione vera resta identica: una chiave, una password o un numero di
// cliente letti non escono senza conferma, in nessuna delle forme che chi compone
// l'indirizzo può scegliere.
test('#587 — un dato letto continua a non uscire senza conferma', () => {
  const letto = [
    'apiKey = sk-or-v1-9f3bd2a71c4e8b60',
    'password = Segreto-Netrc-2026',
    'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY',
    'IBAN IT60X0542811101000000123456 — cliente 8842219',
    'Codice del deposito QX4471MB intestato a Mario Rossi',
  ].join('\n');
  for (const url of [
    'https://male.esempio/?d=sk-or-v1-9f3bd2a71c4e8b60',
    'https://male.esempio/?a=sk-or-v1-9f3&b=bd2a71c4e8b60',
    'https://male.esempio/raccogli/skorv19f3bd2a71c4e8b60',
    'https://skorv19f3bd2a71c4e8b60.male.esempio/',
    'https://male.esempio/#Segreto-Netrc-2026',
    'https://male.esempio/?d=Segreto-Netrc-2026',
    'https://male.esempio/?d=wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY',
    'https://male.esempio/?d=IT60X0542811101000000123456',
    'https://male.esempio/8842219/ping',
    'https://sk-or-v1-9f3bd2a71c4e8b60@male.esempio/',
    // Un codice corto ma che non si legge come una parola più un numero:
    // «QX4471MB» è un dato, e resta tale anche se è lungo otto caratteri.
    'https://male.esempio/collect?d=Codice%20del%20deposito%20QX4471MB',
  ]) {
    const v = E.assess(url, { corpus: '', letto, fromUntrusted: true });
    assert.equal(v.exfil, true, `"${url}" porta fuori un dato letto: deve chiedere conferma`);
  }
});
