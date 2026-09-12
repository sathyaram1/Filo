// Permessi chiesti dai siti (#586): la regola pura + le sentinelle che tengono
// il gestore attaccato a OGNI sessione.
//
// Il difetto che questi controlli impediscono di riaprire: senza un gestore
// Electron CONCEDE, quindi un sito qualunque accendeva fotocamera e microfono,
// leggeva posizione e appunti e mandava notifiche senza che comparisse niente.
// La difesa regge solo se vale su tutte le sessioni — quella di default e le
// partizioni effimere (incognito, jar per-sito, schede proxate, sandbox) — e
// quelle nascono in posti diversi del codice.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RADICE = join(__dirname, '..', '..');
const require_ = createRequire(import.meta.url);

// Il modulo condiviso è un IIFE che si registra su globalThis.
require_(join(RADICE, 'src', 'shared', 'permessiSiti.js'));
const P = globalThis.SN_PERMESSI_SITI;

// ─── la regola ──────────────────────────────────────────────────────────────

test('i permessi sensibili NON sono innocui, e un permesso mai visto nemmeno', () => {
  for (const p of ['media', 'geolocation', 'notifications', 'clipboard-read', 'display-capture']) {
    assert.equal(P.innocuo(p), false, `${p} non può passare in silenzio`);
  }
  // La lista è fatta di ciò che è innocuo: un permesso nuovo di una versione
  // futura di Chromium nasce chiuso.
  assert.equal(P.innocuo('quantum-teleport'), false);
  assert.equal(P.innocuo(''), false);
  assert.equal(P.innocuo('fullscreen'), true);
  assert.equal(P.innocuo('clipboard-sanitized-write'), true);
});

test('fotocamera e microfono si ricordano separati', () => {
  assert.deepEqual(P.chiaviRichieste('media', { mediaTypes: ['video'] }), ['fotocamera']);
  assert.deepEqual(P.chiaviRichieste('media', { mediaTypes: ['audio'] }), ['microfono']);
  assert.deepEqual(
    P.chiaviRichieste('media', { mediaTypes: ['audio', 'video'] }).slice().sort(),
    ['fotocamera', 'microfono'],
  );
  // Controllo sincrono: arriva `mediaType` al singolare.
  assert.deepEqual(P.chiaviRichieste('media', { mediaType: 'video' }), ['fotocamera']);
  // Tipo non dichiarato: si chiede il massimo che potrebbe aprire, non il minimo.
  assert.deepEqual(
    P.chiaviRichieste('media', {}).slice().sort(),
    ['fotocamera', 'microfono'],
  );
  assert.deepEqual(P.chiaviRichieste('geolocation', {}), ['posizione']);
  assert.deepEqual(P.chiaviRichieste('notifications', {}), ['notifiche']);
  assert.deepEqual(P.chiaviRichieste('clipboard-read', {}), ['appunti']);
  assert.deepEqual(P.chiaviRichieste('display-capture', {}), ['schermo']);
  // Permesso sconosciuto: chiave propria, così la risposta resta sua.
  assert.deepEqual(P.chiaviRichieste('serial', {}), ['serial']);
});

test('origine: solo il web passa dal permesso, le superfici di Filo no', () => {
  assert.equal(P.origineDi('https://esempio.it/pagina?x=1'), 'https://esempio.it');
  assert.equal(P.origineDi('http://127.0.0.1:8080/a'), 'http://127.0.0.1:8080');
  // Porta e schema fanno origine: due porte dello stesso host non si prestano
  // il permesso.
  assert.notEqual(P.origineDi('http://127.0.0.1:8080/a'), P.origineDi('http://127.0.0.1:9090/a'));
  for (const url of ['filo://newtab/', 'data:text/html,<p>', 'blob:https://a.b/x', 'file:///C/x', '', null]) {
    assert.equal(P.origineDi(url), null, `${url} non è un'origine web`);
  }
  assert.equal(P.interno('filo://security/security.html'), true);
  assert.equal(P.interno('devtools://devtools/x'), true);
  assert.equal(P.interno('https://esempio.it'), false);
});

test('la memoria concede solo ciò che è stato davvero concesso', () => {
  let m = P.conScelta({}, 'https://esempio.it/qualcosa', ['microfono'], 'allow');
  assert.equal(P.decisione(m, 'https://esempio.it', ['microfono']), 'allow');
  // Il sì al microfono non è un sì alla fotocamera: la richiesta doppia torna a
  // chiedere.
  assert.equal(P.decisione(m, 'https://esempio.it', ['microfono', 'fotocamera']), null);
  // Un altro sito non eredita niente.
  assert.equal(P.decisione(m, 'https://altro.it', ['microfono']), null);

  m = P.conScelta(m, 'https://esempio.it', ['fotocamera'], 'deny');
  assert.equal(P.decisione(m, 'https://esempio.it', ['microfono', 'fotocamera']), 'deny');

  // Si toglie ciò che si è dato (invariante UX), voce per voce o tutto il sito.
  const senzaFoto = P.senza(m, 'https://esempio.it', 'fotocamera');
  assert.equal(P.decisione(senzaFoto, 'https://esempio.it', ['fotocamera']), null);
  assert.equal(P.decisione(senzaFoto, 'https://esempio.it', ['microfono']), 'allow');
  assert.deepEqual(P.senza(m, 'https://esempio.it'), {});

  // Le funzioni non modificano la mappa che ricevono.
  assert.equal(P.decisione(m, 'https://esempio.it', ['fotocamera']), 'deny');
});

test('la mappa che arriva dallo storage viene ripulita senza buttare via il resto', () => {
  const sporca = {
    'https://buono.it': { fotocamera: 'allow', posizione: 'forse', '': 'deny' },
    'non-una-origine': { fotocamera: 'allow' },
    'https://vuoto.it': {},
    'https://rotto.it': 'allow',
  };
  const pulita = P.normalizza(sporca);
  assert.deepEqual(pulita, { 'https://buono.it': { fotocamera: 'allow' } });
  assert.deepEqual(P.normalizza(null), {});
  assert.deepEqual(P.normalizza('niente'), {});
});

test('le etichette sono frasi da leggere, anche per un permesso sconosciuto', () => {
  assert.equal(P.etichetta('fotocamera'), 'usare la fotocamera');
  assert.equal(P.etichettaRichiesta(['fotocamera', 'microfono']), 'usare la fotocamera e il microfono');
  assert.equal(P.nome('posizione'), 'Posizione');
});

// La domanda diceva «vuole usare «screen-wake-lock»»: chi la legge non sa cosa
// sta per dare, e la risposta più probabile è a caso (#586, giro 4). Il nome
// tecnico non sparisce, cambia posto.
test('la domanda non mostra mai il nome tecnico del permesso', () => {
  for (const ignoto of ['quantum-teleport', 'screen-capture-2', 'qualcosa-di-nuovo']) {
    assert.doesNotMatch(P.etichetta(ignoto), new RegExp(ignoto),
      'il nome tecnico non deve finire nella frase che l\'utente legge');
    assert.match(P.etichetta(ignoto), /Filo non conosce/);
    // Nelle Impostazioni invece serve, per distinguere due sconosciuti dello
    // stesso sito: lì sta dopo le parole in italiano.
    assert.match(P.nome(ignoto), new RegExp(ignoto));
    assert.deepEqual(P.tecnici(['fotocamera', ignoto]), [ignoto]);
  }
  assert.deepEqual(P.tecnici(['fotocamera', 'microfono', 'schermo', 'posizione']), []);
  assert.equal(P.ignoto('fotocamera'), false);
  assert.equal(P.ignoto('sensors'), false, 'i sensori di movimento adesso hanno un nome in italiano');
  assert.equal(P.ignoto('local-fonts'), false, 'i caratteri installati adesso hanno un nome in italiano');
});

// Tenere acceso lo schermo mentre va un video, e non farsi buttare via i propri
// dati: nessun browser le domanda, e Filo ci fermava un film con una domanda
// incomprensibile (#586, giro 4).
test('le cose che nessun browser chiede passano senza domanda', () => {
  for (const p of ['screen-wake-lock', 'persistent-storage', 'durable-storage']) {
    assert.equal(P.innocuo(p), true, `${p} non deve fermare chi guarda un video`);
  }
  // I sensori di movimento invece restano una domanda: sono un sensore, che è
  // esattamente la famiglia di cui parla questo feedback. Quello che cambia è
  // che adesso la domanda si legge.
  assert.equal(P.innocuo('sensors'), false);
  assert.equal(P.etichetta('sensors'), 'sentire come muovi e inclini il computer');
});

// Chromium per certi permessi non fa mai la richiesta: chiede solo cosa è già
// stato deciso, e con un no consegna al sito un risultato vuoto. Senza
// richiesta non compariva nessuna pastiglia, quindi nessuna scelta veniva
// registrata, quindi in Impostazioni non c'era niente da ribaltare: si poteva
// solo negare, mai consentire (#586, giro 4).
test('i permessi che arrivano solo dal controllo sono dichiarati', () => {
  assert.equal(P.soloControllo('local-fonts'), true);
  assert.equal(P.soloControllo('media'), false);
  assert.equal(P.soloControllo(''), false);
  for (const p of P.SOLO_CONTROLLO) {
    assert.equal(P.innocuo(p), false, `${p} passa dal controllo, quindi una scelta ci deve stare`);
    assert.equal(P.ignoto(p), false, `${p} deve avere un nome in italiano, o la domanda non si capisce`);
  }
});

// Il cartello che resta acceso mentre un sito può usare qualcosa. Prima c'era
// solo per lo schermo, e il microfono restava aperto senza che niente lo
// dicesse (#586, giro 4).
test('la frase del cartello dice cosa il sito può fare', () => {
  assert.equal(P.frasePotere(['microfono'], false), 'usare il microfono');
  assert.equal(P.frasePotere(['fotocamera', 'microfono'], false), 'usare la fotocamera e il microfono');
  assert.equal(P.frasePotere(['schermo'], false), 'vedere il tuo schermo');
  assert.equal(P.frasePotere(['schermo'], true), 'vedere il tuo schermo e sentire l\'audio del computer');
  assert.equal(P.frasePotere([], false), '');
});

// ─── le sentinelle ──────────────────────────────────────────────────────────

function fileJs(dir, out = []) {
  for (const nome of readdirSync(dir)) {
    if (nome.startsWith('.') || nome === 'node_modules') continue;
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) fileJs(p, out);
    else if (nome.endsWith('.js')) out.push(p);
  }
  return out;
}

test('ogni sessione nasce protetta: nessuno crea una partizione fuori da sessioni.js', () => {
  const MAIN = join(RADICE, 'src', 'main');
  const PORTA = join(MAIN, 'sessioni.js');
  const colpevoli = [];
  for (const p of fileJs(MAIN)) {
    if (p === PORTA) continue;
    const testo = readFileSync(p, 'utf8');
    // Via i commenti: le spiegazioni possono nominare la chiamata.
    const codice = testo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    if (/\.fromPartition\s*\(/.test(codice) || /\.defaultSession\b/.test(codice)) {
      colpevoli.push(relative(RADICE, p));
    }
  }
  assert.deepEqual(
    colpevoli, [],
    'una sessione creata fuori da src/main/sessioni.js nasce SENZA gestore dei permessi: '
    + 'usa sessioneDiPartizione()/sessionePredefinita()',
  );
});

test('il gestore dei permessi è agganciato a session-created, prima di ogni finestra', () => {
  const main = readFileSync(join(RADICE, 'src', 'main', 'main.js'), 'utf8');
  assert.match(
    main, /app\.on\(\s*['"]session-created['"]/,
    'senza questo aggancio una partizione creata da Electron (webPreferences.partition) '
    + 'nascerebbe senza gestore dei permessi',
  );
  // Deve stare PRIMA di whenReady: dopo, le sessioni già create non passerebbero
  // più di lì.
  assert.ok(
    main.indexOf('session-created') < main.indexOf('app.whenReady'),
    'l\'aggancio va registrato prima di app.whenReady()',
  );
});

test('il gestore installa tutti e tre i controlli di Electron, una volta sola', () => {
  const modulo = require_(join(RADICE, 'src', 'main', 'services', 'permessiSito.js'));
  const chiamate = [];
  const finta = {
    setPermissionRequestHandler: (h) => chiamate.push(['request', h]),
    setPermissionCheckHandler: (h) => chiamate.push(['check', h]),
    setDisplayMediaRequestHandler: (h) => chiamate.push(['display', h]),
  };
  modulo.installaSuSessione(finta);
  assert.deepEqual(chiamate.map((c) => c[0]), ['request', 'check', 'display']);
  for (const [, h] of chiamate) assert.equal(typeof h, 'function');
  // Idempotente: una seconda installazione non sostituisce i gestori (Electron
  // tiene un solo gestore per sessione: una seconda registrazione muta la
  // precedente, e quella in piedi ha le richieste in attesa).
  modulo.installaSuSessione(finta);
  assert.equal(chiamate.length, 3);
});

test('senza risposta ricordata il controllo sincrono dice NO, e per filo:// dice sì', () => {
  const modulo = require_(join(RADICE, 'src', 'main', 'services', 'permessiSito.js'));
  modulo._reset();
  const chiamate = [];
  modulo.installaSuSessione({
    setPermissionRequestHandler: () => {},
    setPermissionCheckHandler: (h) => chiamate.push(h),
    setDisplayMediaRequestHandler: () => {},
  });
  const controlla = chiamate[0];
  const wc = { id: 1, isDestroyed: () => false, getURL: () => 'https://esempio.it/x', session: {} };
  assert.equal(controlla(wc, 'media', 'https://esempio.it', { mediaType: 'video' }), false);
  assert.equal(controlla(wc, 'geolocation', 'https://esempio.it', {}), false);
  assert.equal(controlla(wc, 'notifications', 'https://esempio.it', {}), false);
  // Le superfici di Filo e le cose innocue passano.
  assert.equal(controlla(wc, 'media', 'filo://newtab/', { mediaType: 'audio' }), true);
  assert.equal(controlla(wc, 'fullscreen', 'https://esempio.it', {}), true);

  // Con la risposta ricordata (come la rilegge dalle impostazioni) diventa sì —
  // e solo per quel permesso e quel sito.
  modulo.configureFromSettings({
    security: { sitePermissions: { 'https://esempio.it': { fotocamera: 'allow' } } },
  });
  assert.equal(controlla(wc, 'media', 'https://esempio.it', { mediaType: 'video' }), true);
  assert.equal(controlla(wc, 'media', 'https://esempio.it', { mediaType: 'audio' }), false);
  assert.equal(controlla(wc, 'media', 'https://altro.it', { mediaType: 'video' }), false);
  modulo._reset();
});

test('senza nessuno a cui chiedere si NEGA; e la concessione di Filo vale una volta sola', async () => {
  const modulo = require_(join(RADICE, 'src', 'main', 'services', 'permessiSito.js'));
  modulo._reset();
  const wc = { id: 7, isDestroyed: () => false, getURL: () => 'https://esempio.it/x', session: {} };
  const richiesta = { requestingUrl: 'https://esempio.it/x', mediaTypes: ['audio'] };

  // Nessuna finestra a cui mostrare la pastiglia (qui non c'è Electron; nell'app
  // è la finestra isolata del safebrowse): il default è negare, mai concedere.
  assert.equal(await modulo._decidi(wc, 'media', richiesta), false);

  // La dettatura di Filo si annuncia: quella richiesta passa…
  // (`_reset()` prima di ogni annuncio perché una richiesta del sito appena
  // arrivata blocca la concessione: vedi il test sulla corsa qui sotto.)
  modulo._reset();
  assert.equal(modulo.concessioneUnaTantum(wc, 'microfono'), true);
  assert.equal(await modulo._decidi(wc, 'media', richiesta), true);
  // …una volta sola. La seconda è di nuovo una richiesta del sito.
  assert.equal(await modulo._decidi(wc, 'media', richiesta), false);

  // L'annuncio del microfono non apre la fotocamera.
  modulo._reset();
  modulo.concessioneUnaTantum(wc, 'microfono');
  assert.equal(
    await modulo._decidi(wc, 'media', { requestingUrl: 'https://esempio.it/x', mediaTypes: ['audio', 'video'] }),
    false,
  );

  // E non vale per un'altra scheda.
  modulo._reset();
  modulo.concessioneUnaTantum(wc, 'microfono');
  const altra = { id: 8, isDestroyed: () => false, getURL: () => 'https://esempio.it/x', session: {} };
  assert.equal(await modulo._decidi(altra, 'media', richiesta), false);
  modulo._reset();
});

// #586, giro 6 — la concessione che Filo si dà per sé non deve poter finire in
// mano a un sito che sta lì ad aspettarla.
//
// Il danno vero l'ha fatto sugli appunti: un sito che li chiedeva in
// continuazione se li prendeva nel momento in cui l'utente usava l'Incolla di
// Filo, circa una volta su tre. Gli appunti sono usciti del tutto da questa
// strada (li legge il main), e per il microfono, che dalla pagina si deve
// chiedere per forza, resta questa regola: se qualcuno sta già aspettando quella
// cosa in quella scheda, la concessione non si arma.
test('la concessione di Filo non si arma mentre il sito sta chiedendo la stessa cosa', async () => {
  const modulo = require_(join(RADICE, 'src', 'main', 'services', 'permessiSito.js'));
  modulo._reset();
  const wc = { id: 21, isDestroyed: () => false, getURL: () => 'https://esempio.it/x', session: {} };
  const richiesta = { requestingUrl: 'https://esempio.it/x', mediaTypes: ['audio'] };

  // Il sito ha appena chiesto il microfono.
  assert.equal(await modulo._decidi(wc, 'media', richiesta), false);
  // Filo si annuncia un istante dopo: la concessione NON si arma.
  assert.equal(modulo.concessioneUnaTantum(wc, 'microfono'), false);
  // …e infatti la richiesta che segue non passa per la porta di servizio.
  assert.equal(await modulo._decidi(wc, 'media', richiesta), false);

  // Su una scheda dove nessuno sta chiedendo, la concessione si arma come prima.
  const pulita = { id: 22, isDestroyed: () => false, getURL: () => 'https://esempio.it/x', session: {} };
  assert.equal(modulo.concessioneUnaTantum(pulita, 'microfono'), true);
  assert.equal(await modulo._decidi(pulita, 'media', richiesta), true);
  modulo._reset();
});

// #586, giro 6 — un riquadro incorporato scritto dalla pagina (about:blank,
// srcdoc) non ha un indirizzo suo, ma per il browser è lo stesso sito di chi lo
// ospita. Prima veniva negato in silenzio, e non lo sbloccava nemmeno un sì già
// dato alla pagina: si poteva solo negare, mai consentire.
test('un riquadro senza indirizzo suo vale come la pagina che lo ospita', async () => {
  const modulo = require_(join(RADICE, 'src', 'main', 'services', 'permessiSito.js'));
  modulo._reset();
  modulo.configureFromSettings({
    security: { sitePermissions: { 'https://esempio.it': { fotocamera: 'allow' } } },
  });
  const wc = { id: 31, isDestroyed: () => false, getURL: () => 'https://esempio.it/x', session: {} };

  // Il riquadro non ha un indirizzo proprio: conta l'origine che il browser gli
  // attribuisce, e in mancanza quella della pagina.
  for (const dettagli of [
    { requestingUrl: 'about:blank', securityOrigin: 'https://esempio.it', mediaTypes: ['video'] },
    { requestingUrl: 'about:srcdoc', mediaTypes: ['video'] },
    { requestingUrl: '', mediaTypes: ['video'] },
  ]) {
    assert.equal(await modulo._decidi(wc, 'media', dettagli), true);
  }

  // Un'origine davvero opaca resta negata: quella non è lo stesso sito di
  // nessuno.
  const opaco = { id: 32, isDestroyed: () => false, getURL: () => 'data:text/html,x', session: {} };
  assert.equal(
    await modulo._decidi(opaco, 'media', { requestingUrl: 'about:blank', securityOrigin: 'null', mediaTypes: ['video'] }),
    false,
  );
  modulo._reset();
});

test('le impostazioni predefinite partono senza nessuna risposta ricordata', () => {
  const costanti = readFileSync(join(RADICE, 'src', 'shared', 'constants.js'), 'utf8');
  assert.match(costanti, /sitePermissions:\s*\{\s*\}/);
  const storage = readFileSync(join(RADICE, 'src', 'shared', 'storage.js'), 'utf8');
  assert.match(
    storage, /REPLACE_KEYS[^\n]*sitePermissions/,
    'la mappa dei permessi va SOSTITUITA, non fusa: senza, togliere una risposta non la cancella',
  );
});

// ─── la condivisione dello schermo (giro di verifica 1) ─────────────────────
//
// Il difetto che questi controlli impediscono di riaprire: prima di una
// condivisione dello schermo Chromium manda al browser una richiesta
// audio/video con la lista dei tipi VUOTA. Filo la leggeva come "tipo non
// dichiarato" e chiedeva fotocamera più microfono: a chi premeva «condividi lo
// schermo» compariva «vuole usare la fotocamera e il microfono», e il suo
// «Consenti» lasciava quei due sensori concessi per sempre. Da lì il sito li
// accendeva senza che comparisse più niente.

test('la richiesta che precede una condivisione dello schermo non è fotocamera e microfono', () => {
  // Lista dei tipi VUOTA: è il preambolo della cattura schermo.
  assert.equal(P.preamboloSchermo('media', { mediaTypes: [] }), true);
  // Una richiesta vera di webcam o microfono NON lo è.
  assert.equal(P.preamboloSchermo('media', { mediaTypes: ['video'] }), false);
  assert.equal(P.preamboloSchermo('media', { mediaTypes: ['audio', 'video'] }), false);
  // E nemmeno un tipo non dichiarato del tutto (il controllo sincrono).
  assert.equal(P.preamboloSchermo('media', {}), false);
  assert.equal(P.preamboloSchermo('media', { mediaType: 'video' }), false);
  assert.equal(P.preamboloSchermo('geolocation', { mediaTypes: [] }), false);
});

test('lo schermo non si ricorda mai: si richiede ogni volta', () => {
  assert.equal(P.siRicorda(P.CHIAVI.SCHERMO), false);
  for (const k of ['fotocamera', 'microfono', 'posizione', 'notifiche', 'appunti']) {
    assert.equal(P.siRicorda(k), true, `${k} si ricorda`);
  }

  // Un «Consenti» sullo schermo non lascia scritto niente.
  const dopo = P.conScelta({}, 'https://esempio.it', [P.CHIAVI.SCHERMO], 'allow');
  assert.deepEqual(dopo, {});

  // Anche se qualcosa fosse rimasto scritto da una versione precedente, non
  // vale: alla lettura sparisce, e la decisione resta "da chiedere".
  const vecchia = { 'https://esempio.it': { schermo: 'allow', fotocamera: 'allow' } };
  assert.deepEqual(P.normalizza(vecchia), { 'https://esempio.it': { fotocamera: 'allow' } });
  assert.equal(P.decisione(vecchia, 'https://esempio.it', [P.CHIAVI.SCHERMO]), null);
  assert.equal(P.decisione(vecchia, 'https://esempio.it', ['fotocamera']), 'allow');
});

// Il preambolo della cattura schermo (permesso «media» con la lista dei tipi
// VUOTA) non è una richiesta di fotocamera e microfono: è la domanda dello
// SCHERMO, e va fatta lì. Lasciarla passare per far arrivare `getDisplayMedia`
// alla sua domanda apre anche la strada VECCHIA — `getUserMedia` con
// `chromeMediaSource: 'desktop'` — che quella domanda non la incontra mai e si
// prende lo schermo intero, e il suono del computer se lo chiede, in silenzio.
// Le due arrivano identiche: l'unico momento in cui si può chiedere è questo.
test('il preambolo della cattura schermo non concede niente da solo', async () => {
  const modulo = require_(join(RADICE, 'src', 'main', 'services', 'permessiSito.js'));
  modulo._reset();
  const wc = { id: 21, isDestroyed: () => false, getURL: () => 'https://esempio.it/x', session: {} };
  // Qui non c'è nessuna finestra a cui mandare la domanda: una richiesta che
  // nessuno può vedere non può essere concessa.
  assert.equal(
    await modulo._decidi(wc, 'media', { requestingUrl: 'https://esempio.it/x', mediaTypes: [] }),
    false,
    'il preambolo della cattura schermo è stato concesso senza chiedere niente a nessuno',
  );
  // E non ha concesso niente alla webcam.
  assert.equal(
    await modulo._decidi(wc, 'media', { requestingUrl: 'https://esempio.it/x', mediaTypes: ['video'] }),
    false,
  );
  modulo._reset();
});

// I nomi delle cose fra cui scegliere quando si condivide: gli SCHERMI si
// chiamano in italiano (dal sistema arrivano «Entire screen», «Screen 1»), le
// FINESTRE restano col loro titolo, che è come le si riconosce.
test('gli schermi fra cui scegliere hanno un nome in italiano', () => {
  assert.deepEqual(P.nomiDegliSchermi(['screen:0:0', 'window:12:0']), {
    'screen:0:0': 'Tutto lo schermo',
  });
  assert.deepEqual(P.nomiDegliSchermi(['screen:0:0', 'screen:1:0', 'window:12:0']), {
    'screen:0:0': 'Schermo 1',
    'screen:1:0': 'Schermo 2',
  });
  assert.deepEqual(P.nomiDegliSchermi([]), {});
  assert.deepEqual(P.nomiDegliSchermi(null), {});
});

// ─── quello che la shell disegna sotto le schede (giro di verifica 1) ───────
//
// L'area della pagina è una vista nativa composta SOPRA la cornice di Filo. La
// domanda di un permesso nasceva a 50 pixel dal bordo alto, cioè dentro quella
// zona: esisteva nel documento e non la vedeva nessuno, e dopo due minuti la
// richiesta veniva negata da sola.

test('la shell fa scendere la pagina sotto quello che disegna in alto', () => {
  const shell = readFileSync(join(RADICE, 'src', 'renderer', 'shell.js'), 'utf8');
  // Una riserva sola, condivisa: chi chiude non azzera quella di chi resta.
  assert.match(shell, /function riservaTop\(/);
  for (const chi of ['permessi', 'download', 'popup']) {
    assert.match(
      shell, new RegExp(`riservaTop\\('${chi}'`),
      `«${chi}» disegna sotto le schede e deve riservare lo spazio, o finisce dietro la pagina`,
    );
  }
  // La riserva dei permessi si misura sul CONTENITORE, non su un nodo solo:
  // domanda, scelta di cosa condividere e segno della ripresa possono essere
  // lì insieme, e chi resta fuori dalla misura finisce dietro alla pagina.
  assert.match(
    shell, /for \(const n of permHost\.children\)/,
    'la riserva dei permessi deve coprire tutto quello che c\'è nel contenitore',
  );
  const tabs = readFileSync(join(RADICE, 'src', 'main', 'tabs.js'), 'utf8');
  assert.match(tabs, /setTopFloor\s*\(/);
  // La riserva vale ANCHE a tutto schermo: un sito che si prende lo schermo e
  // poi chiede la fotocamera deve far comparire la domanda sopra la pagina.
  assert.match(
    tabs, /Math\.max\(\s*\n?\s*\(this\.contentFullscreen/,
    'il layout deve tenere il pavimento anche a contenuto a tutto schermo',
  );
});

// ─── il conto delle tracce sta sullo stampo, non sull'oggetto (#586, giro 7) ─
//
// Il difetto: avvolgendo la funzione sull'OGGETTO (navigator.mediaDevices), la
// funzione originale restava sullo stampo (MediaDevices.prototype), a portata
// di una riga. Un sito prendeva la prima traccia dalla via normale, così il
// conto non era a zero e la strada dura non partiva, e la seconda dallo stampo:
// tolto il permesso, quella continuava ad ascoltare, senza cartello e senza
// niente da togliere in Impostazioni.

test('la guardia della cattura si mette sullo stampo, e l\'originale non resta raggiungibile', () => {
  const { buildCatturaSicuraSource } = require_(join(RADICE, 'src', 'preload', 'permessi-guard.js'));

  // Un mondo di pagina finto, quanto basta a far girare la sorgente.
  const chiamate = [];
  class MediaDevices {
    getUserMedia(v) { chiamate.push(['gum', v]); return Promise.resolve({ getTracks: () => [] }); }
    getDisplayMedia(v) { chiamate.push(['gdm', v]); return Promise.resolve({ getTracks: () => [] }); }
  }
  const originale = MediaDevices.prototype.getUserMedia;
  const mediaDevices = new MediaDevices();
  const finto = {
    MediaDevices,
    MediaStreamTrack: class { clone() { return this; } },
    MediaStream: class { clone() { return this; } },
    navigator: { mediaDevices },
    document: { addEventListener() {}, dispatchEvent() {} },
    DOMException: class extends Error { constructor(m, n) { super(m); this.name = n; } },
    CustomEvent: class { constructor(t, i) { this.type = t; Object.assign(this, i); } },
  };
  finto.window = finto;
  const vm = require_('node:vm');
  vm.createContext(finto);
  vm.runInContext(buildCatturaSicuraSource(), finto);

  assert.notEqual(
    MediaDevices.prototype.getUserMedia, originale,
    'la funzione dello stampo dev\'essere quella di Filo: lasciando lì l\'originale, un sito se ne '
    + 'prende una traccia che Filo non conta e che la revoca non chiude',
  );
  assert.equal(
    Object.getOwnPropertyDescriptor(mediaDevices, 'getUserMedia'), undefined,
    'la guardia non va messa sull\'oggetto: lì lascia scoperta quella dello stampo',
  );
  assert.notEqual(MediaDevices.prototype.getDisplayMedia, MediaDevices.prototype.constructor.prototype.getUserMedia);

  // Resta scrivibile: le librerie delle videochiamate avvolgono a loro volta il
  // microfono, e un divieto di scrittura le farebbe morire con un errore.
  const d = Object.getOwnPropertyDescriptor(MediaDevices.prototype, 'getUserMedia');
  assert.equal(d.writable, true);
  assert.equal(d.configurable, true);

  // E chiamata dallo stampo con l'oggetto vero, la richiesta arriva comunque
  // alla funzione originale.
  return MediaDevices.prototype.getUserMedia.call(mediaDevices, { audio: true }).then(() => {
    assert.deepEqual(chiamate, [['gum', { audio: true }]]);
  });
});
