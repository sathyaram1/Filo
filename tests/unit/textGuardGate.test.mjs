// Sentinella: il PUNTO DI PASSAGGIO UNICO degli avvisi (#536).
//
// Il guardiano vale quanto vale la porta: se una superficie qualunque può
// scrivere una notifica per conto suo, il controllo è decorativo. Questo test
// legge il codice VERO e diventa rosso se:
//
//   1. qualcuno chiama `addNotification` fuori da textGuardian.js — cioè apre
//      una seconda porta verso la colonna degli avvisi;
//   2. il guardiano perde il suo posto nella risposta della chat (un turno che
//      ha letto roba scritta da altri deve passare da `controllaTesto`);
//   3. la funzione «guardiano» sparisce dal censimento dei modelli, dalle
//      etichette o dal raggruppamento dei crediti — cioè diventa un modello
//      scelto dal codice, invisibile e non cambiabile;
//   4. il consumo del guardiano non finisce più sotto la voce crediti
//      «Controlli di sicurezza».
//
// È una sentinella di codice, non di comportamento: il comportamento lo provano
// textGuard.test.mjs, textGuardian.test.mjs e lo spec Playwright del guardiano.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';
import { readFileSync, readdirSync, statSync } from 'node:fs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const SRC = join(ROOT, 'src');

// I soli file autorizzati a scrivere una notifica: chi la definisce, e il
// guardiano. Aggiungerne uno qui è una decisione, non una svista.
const PORTE_AMMESSE = new Set([
  join('shared', 'filoMemory.js'),           // la definizione
  join('main', 'services', 'textGuardian.js'), // il punto di passaggio
]);

function fileSotto(dir, ext = ['.js', '.mjs']) {
  const out = [];
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) out.push(...fileSotto(p, ext));
    else if (ext.some((e) => nome.endsWith(e))) out.push(p);
  }
  return out;
}

test('nessuna superficie scrive una notifica saltando il guardiano', () => {
  const colpevoli = [];
  for (const p of fileSotto(SRC)) {
    const rel = relative(SRC, p);
    if (PORTE_AMMESSE.has(rel)) continue;
    const testo = readFileSync(p, 'utf8');
    // Le righe di commento non contano: la regola si spiega, e spiegarla non è
    // aprirla.
    for (const [i, riga] of testo.split('\n').entries()) {
      const senzaCommento = riga.replace(/^\s*(\/\/|\*|\/\*).*$/, '');
      if (/\baddNotification\s*\(/.test(senzaCommento)) {
        colpevoli.push(`${rel.split(sep).join('/')}:${i + 1}`);
      }
    }
  }
  assert.deepEqual(colpevoli, [],
    'questi punti scrivono una notifica senza passare dal guardiano (#536): '
    + colpevoli.join(', '));
});

test('la risposta della chat passa dal guardiano quando il turno è contaminato', () => {
  const h = readFileSync(join(SRC, 'main', 'services', 'handlers.js'), 'utf8');
  assert.match(h, /vaControllato\(fiduciaTurno\)/,
    'la chat non controlla più la fiducia del turno prima di rispondere');
  assert.match(h, /controllaTesto\(/,
    'la risposta della chat non passa più dal guardiano');
  assert.match(h, /haPortatoTestoDiAltri\(/,
    'nessuno segna più il turno come contaminato quando un’azione legge roba di altri');
  // #536, giro 7: il marchio si accendeva solo se l'azione era RIUSCITA, e
  // bastava un comando finito male (o interrotto perché ci metteva troppo) per
  // portare dentro le parole di un estraneo lasciando il turno pulito. La
  // domanda giusta è se l'azione ha prodotto un'uscita, non se è andata bene.
  assert.ok(!/if \(res\.executed && !res\.rejected\) \{/.test(h),
    'la contaminazione del turno dipende di nuovo dal buon esito dell’azione');
});

test('il guardiano gira su un modello impostabile, mai scelto dal codice', () => {
  require(join(ROOT, 'src', 'shared', 'constants.js'));
  require(join(ROOT, 'src', 'shared', 'modelUsage.js'));
  const C = globalThis.SN_CONST;
  const U = globalThis.SN_MODEL_USAGE;
  const azione = C.ACTIONS.GUARD_TEXT;
  assert.ok(azione, 'ACTIONS.GUARD_TEXT non esiste');

  const voce = U.ENTRIES.find((e) => e.ref === azione);
  assert.ok(voce, 'il guardiano non è nel censimento dei punti in cui Filo usa un modello');
  assert.notEqual(voce.from, 'code', 'il modello del guardiano non deve essere deciso dal codice');

  assert.ok(C.ACTION_LABELS[azione], 'il guardiano non ha un’etichetta leggibile');
  assert.equal(C.creditUsageGroup(azione), 'Controlli di sicurezza',
    'il consumo del guardiano deve comparire sotto «Controlli di sicurezza»');
  assert.ok(azione in C.DEFAULT_SETTINGS.models,
    'il guardiano non ha una casella fra i modelli impostabili');
});

test('il registro dei blocchi ha i suoi messaggi, e non sono aperti alle pagine web', () => {
  require(join(ROOT, 'src', 'shared', 'messages.js'));
  const { MSG } = globalThis.SN_MSG;
  assert.ok(MSG.FILO_GET_GUARD_BLOCKS && MSG.FILO_CLEAR_GUARD_BLOCKS);
  const h = readFileSync(join(SRC, 'main', 'services', 'handlers', 'filo.js'), 'utf8');
  // Il testo fermato è quello che qualcuno ha scritto per ingannare: non torna
  // a una pagina web che lo chiede.
  const blocco = h.slice(h.indexOf('FILO_GET_GUARD_BLOCKS'));
  assert.match(blocco.slice(0, 400), /isFilo\(origin\)/,
    'il registro dei blocchi è leggibile da una pagina web');
});

// ── Le porte richiuse al giro 1 di verifica (#536) ──────────────────────────

test('la fiducia del turno guarda anche quello che è ancora in conversazione', () => {
  const h = readFileSync(join(SRC, 'main', 'services', 'handlers.js'), 'utf8');
  assert.match(h, /fontiContaminantiInContesto\(/,
    'la chat torna a considerare pulito un messaggio nato da una pagina letta prima');
  // La funzione deve contare sulle azioni che hanno DAVVERO prodotto
  // un'osservazione: sono quelle il cui contenuto rientra nel contesto.
  const corpo = h.slice(h.indexOf('function fontiContaminantiInContesto'));
  assert.match(corpo.slice(0, 800), /_output/,
    'la contaminazione non è più legata al contenuto che rientra nel contesto');
});

test('gli avvisi non si leggono, né si tolgono, da una pagina web', () => {
  const f = readFileSync(join(SRC, 'main', 'services', 'handlers', 'filo.js'), 'utf8');
  for (const msg of ['FILO_GET_NOTIFICATIONS', 'FILO_DISMISS_NOTIFICATION']) {
    const blocco = f.slice(f.indexOf(`MSG.${msg}`));
    assert.match(blocco.slice(0, 300), /isFilo\(origin\)/,
      `${msg} è aperto alle pagine web: gli avvisi sono roba dell'utente`);
  }
});

// ── Quello che un turno lascia scritto per DOPO (giro 4) ────────────────────
//
// Il guardiano sorveglia il testo che compare adesso, e un elenco di campi che
// un turno contaminato lascia scritti perché parlino più tardi. Finché
// quell'elenco si teneva a mano restavano fuori l'appunto, la regola fissata
// nella memoria di Filo e lo stile con cui Filo scrive: il testo di un estraneo
// entrava nello stato di Filo e usciva, con la voce di Filo, in conversazioni
// pulite dove il secondo modello non gira nemmeno.

test('ogni azione dice cosa lascia scritto: l’elenco copre il registro intero', () => {
  require(join(ROOT, 'src', 'shared', 'themeTokens.js'));
  require(join(ROOT, 'src', 'shared', 'preferences.js'));
  require(join(ROOT, 'src', 'shared', 'actionLevels.js'));
  require(join(ROOT, 'src', 'shared', 'textGuard.js'));
  const azioni = Object.keys(globalThis.SN_ACTION_LEVELS.REGISTRY);
  const tabella = globalThis.SN_TEXT_GUARD.CAMPI_SORVEGLIATI;
  const mancanti = azioni.filter((t) => !Object.prototype.hasOwnProperty.call(tabella, t));
  assert.deepEqual(mancanti, [],
    'queste azioni non dicono quali parole lasciano scritte per dopo (#536): ' + mancanti.join(', '));
  const inventate = Object.keys(tabella).filter((t) => !azioni.includes(t));
  assert.deepEqual(inventate, [],
    'queste voci non corrispondono a nessuna azione vera: ' + inventate.join(', '));
});

test('la regola fissata in memoria, l’appunto e lo stile di Filo sono sorvegliati', () => {
  require(join(ROOT, 'src', 'shared', 'textGuard.js'));
  const G = globalThis.SN_TEXT_GUARD;
  const lezione = G.campiDaSorvegliare({ type: 'SALVA_LEZIONE', testo: 'una regola' });
  assert.deepEqual(lezione.campi.map((c) => c.nome), ['testo']);
  assert.equal(lezione.seFermato, 'annulla', 'una regola senza regola non va fissata lo stesso');
  const appunto = G.campiDaSorvegliare({ type: 'SALVA_APPUNTO', testo: 'ciao', contesto: 'banca' });
  assert.deepEqual(appunto.campi.map((c) => c.nome), ['testo', 'contesto']);
  const stile = G.campiDaSorvegliare({ type: 'IMPOSTA_PREFERENZA', chiave: 'stile_agente', valore: 'asciutto' });
  assert.deepEqual(stile.campi.map((c) => c.nome), ['valore']);
  assert.equal(stile.soloSeTestoLibero, true, 'un «tema: scuro» non deve pagare un secondo modello');
  // Un'azione che il registro non conosce non è «niente da sorvegliare».
  const ignota = G.campiDaSorvegliare({ type: 'AZIONE_NUOVA', frase: 'parole' });
  assert.deepEqual(ignota.campi.map((c) => c.nome), ['frase']);
  assert.equal(ignota.seFermato, 'annulla');
});

test('una preferenza a testo libero lo dichiara, altrimenti nessuno la sorveglia', () => {
  require(join(ROOT, 'src', 'shared', 'themeTokens.js'));
  require(join(ROOT, 'src', 'shared', 'preferences.js'));
  const P = globalThis.SN_PREF;
  // La sonda: una stringa che nessun setter può produrre da sé. Se riesce ad
  // arrivare INTERA dentro l'impostazione, quel valore è testo libero, e dopo
  // una pagina avvelenata lo sceglie la pagina. Da lì in poi va DECISO se quel
  // testo sono parole che l'utente leggerà (`testoLibero: true`, e allora passa
  // dal guardiano) oppure no (`testoLibero: false`, dichiarato, come per una
  // chiave di accesso che nessuno legge e che ogni controllo fermerebbe). Quello
  // che non si può fare è non decidere: è così che «stile dell'agente», cioè le
  // istruzioni di ogni conversazione futura, è rimasto fuori per tre giri.
  const SONDA = 'zqxsonda-testo-libero-536';
  const scoperte = [];
  for (const setter of P.PREF_SETTERS) {
    let built = null;
    try { built = setter.build(SONDA); } catch (_) { built = null; }
    if (!built) continue;
    if (!JSON.stringify(built.partial || {}).includes(SONDA)) continue;
    if (typeof built.testoLibero !== 'boolean') scoperte.push(setter.keys[0]);
  }
  assert.deepEqual(scoperte, [],
    'queste preferenze scrivono testo libero e non dicono se il guardiano deve guardarlo (#536): '
    + scoperte.join(', '));
});

test('il collegamento dentro un avviso ha un colore suo anche sul tema scuro', () => {
  const css = readFileSync(join(SRC, 'pages', 'dashboard', 'dashboard.css'), 'utf8');
  assert.match(css, /\.dash-live-link[\s\S]{0,200}color:\s*var\(--dash-link\)/,
    'il collegamento di un avviso non usa più il colore dedicato');
  const scuro = css.slice(css.indexOf('[data-sn-theme="dark"]'));
  assert.match(scuro.slice(0, 600), /--dash-link:/,
    'sul tema scuro il collegamento torna blu scuro su fondo scuro');
});

// #536 — dalla bolla di una risposta fermata si arriva a quello che è stato
// fermato, con lo stesso pulsante della colonna degli avvisi. Le due strade
// portano allo stesso posto e devono comportarsi allo stesso modo: prima in
// chat c'era solo una frase che diceva di cercarsi la sezione nelle Preferenze.
test('dalla bolla in chat si apre quello che è stato fermato, come dalla colonna', () => {
  const js = readFileSync(join(SRC, 'pages', 'dashboard', 'dashboard.js'), 'utf8');
  assert.match(js, /function bottoneVediBlocco\(/,
    'il pulsante non è più uno solo per le due strade');
  assert.match(js, /r\.guardBlockId[\s\S]{0,160}bottoneVediBlocco/,
    'la bolla della chat non porta più al registro degli avvisi fermati');
  const css = readFileSync(join(SRC, 'pages', 'dashboard', 'dashboard.css'), 'utf8');
  assert.match(css, /\.dash-bubble-vedi[\s\S]{0,300}color:\s*var\(--dash-link\)/,
    'il pulsante nella bolla non usa il colore dei collegamenti, che è l’unico definito nei due temi');
});

// #536 — le fonti che sporcano un compito stanno in UNA tabella sola, e le
// superfici che costruiscono un contesto la chiedono a lei. Finché ognuna
// teneva il suo elenco, i documenti dell'editor sporcavano il saluto della
// nuova scheda e non la chat, che quegli stessi documenti li legge per intero.
test('chat e home chiedono alla stessa tabella cosa, nel contesto, l’ha scritto un estraneo', () => {
  const h = readFileSync(join(SRC, 'main', 'services', 'handlers.js'), 'utf8');
  const G = globalThis.SN_TEXT_GUARD;
  const usi = h.match(/fontiDegliIngredienti\(/g) || [];
  assert.ok(usi.length >= 2,
    'una delle due superfici si è rifatta il suo elenco di fonti contaminate');
  assert.ok(G.FONTE_AZIONE.LEGGI_FILE && G.vaControllato(G.FONTE_AZIONE.LEGGI_FILE.fiducia),
    'leggere un documento dell’editor non sporca il compito: un PDF sul disco sì, e il testo è lo stesso');
  assert.ok(G.fontiDegliIngredienti({ documenti: ['- [f1] Appunti: …'] }).length,
    'un documento nel contesto non conta come roba scritta da altri');
  assert.equal(G.fontiDegliIngredienti({ documenti: [], pagineSalvate: [] }).length, 0,
    'senza documenti né pagine salvate il contesto è pulito: il controllo non deve diventare una tassa');
});
