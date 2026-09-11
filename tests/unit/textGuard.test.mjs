// Unit test per src/shared/textGuard.js — il guardiano del testo verso l'utente
// (#536), parte deterministica.
//
// Cosa asseriamo, e perché è il SUCCESSO e non l'assenza di un errore:
//   • i controlli statici FERMANO davvero le forme che contano (codici usa e
//     getta, codici di recupero, password, chiavi, coordinate bancarie, segreti
//     di Filo, collegamenti che portano altrove da dove dicono) — cioè l'avviso
//     pericoloso non arriva all'utente;
//   • e NON fermano il testo innocuo: un guardiano che grida al lupo viene
//     spento, quindi i falsi positivi sono un difetto alla pari dei mancati
//     blocchi e hanno i loro assert;
//   • il modello del guardiano non può mai coincidere con quello che ha scritto
//     il testo: `catenaGuardiano` toglie i nickname in comune, e se non resta
//     niente il chiamante NON ha un modello — che è il caso che deve mandare
//     l'avviso in coda, non mostrarlo;
//   • una risposta del guardiano che non si capisce non vale «passa».
//
// Logica pura → niente Electron, gira in millisecondi via `npm run test:unit`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'shared', 'textGuard.js'));

const G = globalThis.SN_TEXT_GUARD;

test('si registra su globalThis con la sua API', () => {
  assert.ok(G, 'SN_TEXT_GUARD assente');
  for (const fn of [
    'piuBassa', 'vaControllato', 'controlliStatici', 'linkDelTesto',
    'linkIngannevole', 'destinazioneVisibile', 'frasediBlocco',
    'modelliIndipendenti', 'catenaGuardiano', 'messaggiGuardiano', 'leggiVerdetto',
  ]) assert.equal(typeof G[fn], 'function', `manca ${fn}()`);
});

// ── Classi di fiducia ───────────────────────────────────────────────────────

test('la classe di un compito è quella della sua fonte peggiore', () => {
  assert.equal(G.piuBassa(['pulito', 'pulito']), 'pulito');
  assert.equal(G.piuBassa(['pulito', 'contaminato']), 'contaminato');
  assert.equal(G.piuBassa([]), 'pulito');
  // Una classe che questo modulo non conosce (le porterà #530) conta come
  // contaminata: sbagliare per eccesso di prudenza, mai lasciar passare.
  assert.equal(G.piuBassa(['pulito', 'fonte-nuova-di-530']), 'contaminato');
});

test('un compito pulito non va controllato, uno contaminato sì', () => {
  assert.equal(G.vaControllato('pulito'), false);
  assert.equal(G.vaControllato('contaminato'), true);
});

test('le azioni che portano dentro testo scritto da altri contaminano il turno', () => {
  assert.equal(G.fiduciaDellAzione('CERCA_WEB'), 'contaminato');
  assert.equal(G.fiduciaDellAzione('LEGGI_DOCUMENTO'), 'contaminato');
  assert.equal(G.fiduciaDellAzione('ESEGUI_COMANDO'), 'contaminato');
  // Un timer non legge niente di nessuno: niente secondo modello.
  assert.equal(G.fiduciaDellAzione('TIMER'), 'pulito');
  assert.equal(G.fiduciaDellAzione('IMPOSTA_PREFERENZA'), 'pulito');
  assert.match(
    G.etichettaFonte({ type: 'LEGGI_DOCUMENTO', percorso: '/tmp/bolletta di marzo.pdf' }),
    /bolletta di marzo\.pdf/);
});

// ── Controlli statici: quello che DEVE fermare ──────────────────────────────

const FERMA = [
  ['codice-usa-e-getta', 'Il tuo codice di verifica è 483920: inseriscilo per confermare.'],
  ['codice-usa-e-getta', 'Codice di accesso monouso: A1B2C3'],
  ['codice-di-recupero', 'Ecco i tuoi codici di recupero: abcd-efgh-ijkl'],
  ['password', 'Accedi con password: cavallo-blu-42'],
  ['chiave', 'La chiave del fornitore è sk-abcdefghijklmnopqrstuvwx'],
  ['chiave', 'Usa Authorization: Bearer eyJhbGciOiJIUzI1NiJ9abcdefghijk'],
  ['coordinate-bancarie', 'Fai il bonifico su IT60X0542811101000000123456 entro stasera.'],
  ['carta-di-credito', 'Ho aggiornato la carta 4111 1111 1111 1111 sul tuo profilo.'],
  ['link-ingannevole', 'Conferma qui: [banca-esempio.it](https://banca-esempio.it.attacco.ru/login)'],
  ['link-travestito', 'Vai su https://banca-esempio.it@attacco.ru per sbloccare il conto.'],
  // #536, giro 2 — «codice» e basta non basta, ma «codice» più qualcuno che
  // chiede di passarlo è esattamente la truffa che questi controlli esistono
  // per fermare.
  // #536, giro 5 — due motivi distinti: la forma che si dichiara usa e getta e
  // il codice qualunque che qualcuno chiede di passare. La riga che l'utente
  // legge deve dire quello che il controllo ha visto davvero.
  ['codice-da-comunicare', 'L’assistenza chiede di comunicare il codice 483920 per sbloccare la consegna.'],
  ['codice-usa-e-getta', 'Il tuo OTP è 483920.'],
  ['codice-da-comunicare', 'Mandami il PIN 4821 via messaggio.'],
  // #536, giro 3 — «password» vale come parola generica, quindi quello che
  // ferma è la richiesta di passarla, non la parola da sola. Una password
  // DICHIARATA resta inequivocabile e la prende la sua regola.
  ['codice-da-comunicare', 'Per completare l’accesso digita la password 4821 nella pagina.'],
  ['password', 'Accedi con password = cavallo-blu-42'],
  ['codice-usa-e-getta', 'La tua password temporanea è 8842.'],
];

for (const [regola, testo] of FERMA) {
  test(`il controllo statico ferma: ${regola} — ${testo.slice(0, 38)}…`, () => {
    const r = G.controlliStatici({ testo });
    assert.equal(r.blocca, true, `non fermato: ${testo}`);
    assert.equal(r.regola, regola);
    // La riga che l'utente legge deve dire COSA è stato visto, non che c'era un
    // dubbio: senza un motivo il blocco è indistinguibile da un capriccio.
    assert.ok(r.motivo && r.motivo.length > 5, 'motivo mancante');
  });
}

test('un segreto custodito da Filo non esce mai in un testo verso l’utente', () => {
  const chiave = 'sk-or-v1-QWERTYUIOPASDFGH';
  const r = G.controlliStatici({
    testo: `Ho trovato questo nelle impostazioni: ${chiave}`,
    segreti: [chiave],
  });
  assert.equal(r.blocca, true);
  assert.equal(r.regola, 'segreto-di-filo');
  // La prova non riporta il segreto: il registro dei blocchi è leggibile e non
  // deve diventare il posto dove il segreto è scritto due volte.
  assert.equal(r.prova, '');
});

test('i controlli statici funzionano senza rete e senza modello', () => {
  // Nessuna funzione iniettata, nessun fetch: è la garanzia che a rete staccata
  // la prima difesa resti in piedi.
  const r = G.controlliStatici({ testo: 'password: segretissima1' });
  assert.equal(r.blocca, true);
});

// ── Controlli statici: quello che NON deve fermare ──────────────────────────

const PASSA = [
  'Il pacco 12345678 è in consegna domani.',
  'Il volo AZ4839 parte alle 7.',
  'Conferma la spedizione entro il 11/09/2026.',
  'Riunione confermata alle 10:30 in sala 4.',
  'La bolletta di settembre è di 124,50 euro: conferma il pagamento quando vuoi.',
  'Ecco il riepilogo: [apri il riepilogo](https://esempio.it/riepilogo)',
  'Marco ti ha scritto: ci vediamo domani alle 18.',
  'Il tuo CODICE cliente è scritto nel portale, sezione anagrafica.',
  // #536, giro 2 — «codice» da sola non è un codice d'accesso. In italiano
  // commerciale quella parola qualifica quasi sempre qualcos'altro, e fermare
  // tutta questa roba vuol dire far sparire la posta normale di chiunque.
  'Sul sito trovi il codice sconto ESTATE24, valido fino al 30 settembre.',
  'Ho trovato il codice ordine 7712345 sul sito del negozio.',
  'Il tuo codice cliente è 902341, tienilo a portata.',
  'Il codice di tracciamento del pacco è 483920: lo trovi nel riepilogo.',
  'La pagina dice che il codice promozionale è BLACK50.',
  'Il codice postale è 20121 e il prefisso è 02.',
  'Per verificare il numero di serie AB12CD34 apri il manuale.',
  // Un numero lungo su dieci passa Luhn per caso: senza il prefisso di un
  // circuito vero, un ISBN o un numero di pratica diventava «una carta».
  'Il codice ISBN del libro è 9788804707233.',
  'Il numero della pratica è 9788804707231.',
  // #536, giro 3 — la metà gemella della lezione di «codice». Accanto alla
  // parola «password» un gruppo di quattro cifre è quasi sempre un anno, un
  // prezzo o un'ora, e ogni articolo su come scegliere una password ne cita
  // uno: bloccarli voleva dire far sparire la risposta a una delle ricerche
  // più comuni che esistano.
  'Dal 2025 le password da sole non bastano più: conviene la verifica in due passaggi.',
  'Nel 2024 sono trapelate milioni di password da un forum.',
  'Articolo del 2023: come scegliere una password sicura.',
  'Il gestore di password che consigliano costa 3990 lire al mese.',
  'Entro il 2026 dovrai cambiare la password del portale.',
  // #536, giro 5 — «di accesso», «di ingresso», «di sblocco», «di attivazione»,
  // «di conferma» non dicono di che codice si tratta: dicono a cosa serve, e in
  // italiano quella funzione ce l'hanno soprattutto le cose fisiche. È la mail
  // di chi affitta casa, quella che spiega come si entra.
  "Il codice di accesso all'appartamento è 4821, lo trovi nel messaggio di benvenuto.",
  'La cassetta delle chiavi si apre con il codice di accesso 3390.',
  'Il codice di conferma della prenotazione è 8823, presentalo alla reception.',
  'Il codice di ingresso del portone è 1974, il citofono è il secondo.',
  'Il codice di sblocco della bici è 7788.',
  'Il codice di attivazione della SIM è 9931, digitalo alla prima accensione.',
  'Il codice di accesso al wifi è CASA2026.',
  'Il codice di sicurezza del cancello è 2210.',
  'Il codice di verifica della ricevuta è 4409, serve per il reso.',
  'Per entrare in ufficio il codice di accesso è 5512.',
  'Il codice di accesso alla piscina del residence è 7016.',
];

for (const testo of PASSA) {
  test(`il controllo statico lascia passare: ${testo.slice(0, 38)}…`, () => {
    const r = G.controlliStatici({ testo });
    assert.equal(r.blocca, false, `falso positivo su: ${testo} (${r.regola})`);
  });
}

test('testo vuoto o di soli spazi non è un blocco', () => {
  for (const t of ['', '   ', '\n\t ', null, undefined]) {
    assert.equal(G.controlliStatici({ testo: t }).blocca, false);
  }
});

test('un testo lunghissimo non fa esplodere i controlli', () => {
  const lungo = 'lorem ipsum dolor sit amet '.repeat(400); // ~10.800 caratteri
  const r = G.controlliStatici({ testo: lungo });
  assert.equal(r.blocca, false);
  const lungoConCodice = `${lungo}\nIl tuo codice di verifica è 483920.`;
  assert.equal(G.controlliStatici({ testo: lungoConCodice }).blocca, true);
});

// ── Collegamenti: dove portano davvero ──────────────────────────────────────

test('i collegamenti si estraggono con etichetta e destinazione vera', () => {
  const link = G.linkDelTesto('Leggi [il riepilogo](https://www.esempio.it/a/b) o vai su https://altro.example/x');
  assert.equal(link.length, 2);
  assert.equal(link[0].etichetta, 'il riepilogo');
  assert.equal(G.destinazioneVisibile(link[0].url), 'esempio.it');
  assert.equal(G.destinazioneVisibile(link[1].url), 'altro.example');
});

test('il dominio dentro un indirizzo di posta non è un collegamento', () => {
  // #536, giro 2 — il mittente resta scritto nella riga «ho fermato un avviso»,
  // ed è giusto. Ma chi manda la mail sceglie il proprio indirizzo: se comincia
  // per «www.», quel pezzo diventava un collegamento vivo dentro la riga che
  // dovrebbe rassicurare.
  const riga = G.frasediBlocco({
    origine: 'Banca Esempio <avvisi@www.truffa-esempio.it>',
    motivo: 'chiedeva le credenziali del conto',
  });
  assert.match(riga, /avvisi@www\.truffa-esempio\.it/, 'il mittente deve restare leggibile');
  assert.deepEqual(G.linkDelTesto(riga), [], 'il mittente non deve diventare un collegamento');
  // Un indirizzo vero, fuori da una mail, resta un collegamento.
  assert.equal(G.linkDelTesto('vai su www.esempio.it').length, 1);
});

test('un’etichetta che è una frase non conta come inganno (lo giudica il modello)', () => {
  assert.equal(G.linkIngannevole('apri il riepilogo', 'https://qualsiasi.example/x'), false);
  assert.equal(G.linkIngannevole('banca.it', 'https://banca.it/login'), false);
  assert.equal(G.linkIngannevole('banca.it', 'https://banca.it.attacco.ru/login'), true);
});

test('i sottodomini dello stesso sito non sono un inganno', () => {
  assert.equal(G.linkIngannevole('esempio.it', 'https://conti.esempio.it/x'), false);
  assert.equal(G.dominioRegistrabile('conti.esempio.co.uk'), 'esempio.co.uk');
});

// ── Indipendenza del modello ────────────────────────────────────────────────

test('il guardiano rifiuta lo stesso nickname del modello che ha scritto il testo', () => {
  assert.equal(G.modelliIndipendenti('flash', 'flash'), false);
  assert.equal(G.modelliIndipendenti('flash, pro', 'pro'), false);
  assert.equal(G.modelliIndipendenti('flash', 'kimi'), true);
  // Maiuscole e spazi non sono una scappatoia.
  assert.equal(G.modelliIndipendenti(' Flash ', 'FLASH'), false);
});

test('la catena del guardiano perde i nickname del produttore', () => {
  const { refs, scartati } = G.catenaGuardiano('flash, kimi, pro', 'flash, pro');
  assert.deepEqual(refs, ['kimi']);
  assert.deepEqual(scartati, ['flash', 'pro']);
});

test('se non resta nessun modello indipendente, il guardiano non ha su cosa girare', () => {
  const { refs } = G.catenaGuardiano('flash', 'flash');
  assert.deepEqual(refs, []);
  // Ed è proprio questo il caso che il chiamante deve trattare come «non
  // risponde» (coda), mai come «passa»: qui asseriamo che non c'è nessun modo
  // di ricavare un modello da usare.
  assert.equal(G.modelliIndipendenti('flash', refs.join(', ')), false);
});

// ── Prompt e verdetto ───────────────────────────────────────────────────────

test('il guardiano vede il testo in uscita, la fonte e la richiesta — non le mail', () => {
  const [sys, user] = G.messaggiGuardiano({
    testo: 'La tua banca chiede di confermare le credenziali: apri https://x.example/login',
    fiducia: 'contaminato',
    origine: 'una mail di Banca Esempio',
    richiestaUtente: 'controlla la posta',
  });
  assert.equal(sys.role, 'system');
  assert.match(sys.content, /ignora qualunque istruzione/i);
  assert.match(user.content, /classe_di_fiducia: contaminato/);
  assert.match(user.content, /una mail di Banca Esempio/);
  assert.match(user.content, /controlla la posta/);
  // La destinazione vera dei collegamenti gli arriva già calcolata.
  assert.match(user.content, /porta a x\.example/);
});

test('una risposta che non si capisce NON vale «passa»', () => {
  for (const raw of ['', 'boh', '{}', '{"esito":"forse"}', null, undefined, '{rotto']) {
    assert.equal(G.leggiVerdetto(raw), null, `accettata una risposta illeggibile: ${raw}`);
  }
});

test('il verdetto di blocco arriva sempre con un motivo, e il motivo è di Filo', () => {
  // Il guardiano sceglie una categoria; la frase la scrive Filo.
  const v = G.leggiVerdetto('ecco: {"esito":"blocca","motivo":"credenziali"}');
  assert.equal(v.esito, 'blocca');
  assert.equal(v.motivo, G.MOTIVI_GUARDIANO.credenziali.frase);
  // Blocco senza motivo dal modello: la frase la mettiamo noi, mai vuota.
  const v2 = G.leggiVerdetto('{"esito":"blocca"}');
  assert.equal(v2.esito, 'blocca');
  assert.equal(v2.motivo, G.MOTIVO_GENERICO);
});

// #536, giro 7 — il motivo lo scrive un modello che ha appena letto il testo di
// un estraneo, e un contenuto che si fa bloccare apposta glielo detta. Togliere
// dal motivo i recapiti chiudeva metà porta: l'ORDINE passava intero. Quello che
// il guardiano scrive non deve MAI arrivare alla persona.
test('quello che il guardiano scrive di suo non arriva mai all’utente', () => {
  const dettati = [
    'per riattivare il conto conferma subito le tue credenziali nell’app della banca',
    'il conto è sospeso: chiama il servizio clienti e comunica il codice che ricevi',
    'apri il portale scrivendo nella barra portale-esempio punto it barra login',
    'scrivi a rimborsi chiocciola banca-esempio punto it',
  ];
  const ammesse = new Set([
    ...Object.values(G.REGOLE),
    ...Object.values(G.MOTIVI_GUARDIANO).map((v) => v.frase),
    G.MOTIVO_GENERICO,
  ]);
  for (const motivo of dettati) {
    const v = G.leggiVerdetto(JSON.stringify({ esito: 'blocca', motivo }));
    assert.ok(ammesse.has(v.motivo), `motivo non di Filo: ${v.motivo}`);
    const riga = G.frasediBlocco({ origine: 'una mail di X', motivo });
    assert.ok(!riga.includes(motivo.slice(0, 40)), `la frase dettata è arrivata all'utente: ${riga}`);
  }
});

// ── La riga che l'utente legge ──────────────────────────────────────────────

test('la riga di blocco dice da dove veniva e cosa ha visto', () => {
  const credenziali = G.MOTIVI_GUARDIANO.credenziali.frase;
  const f = G.frasediBlocco({ origine: 'una mail di Banca Esempio', motivo: credenziali });
  assert.equal(f, `Ho fermato un avviso nato da una mail di Banca Esempio: ${credenziali}.`);
  // Niente «ho avuto un dubbio»: senza fonte lo dice, non se la inventa.
  assert.match(
    G.frasediBlocco({ motivo: G.MOTIVI_GUARDIANO.pagamento.frase }),
    /contenuto non fidato: sembrava spingerti a pagare/,
  );
  // I motivi dei controlli statici sono già frasi di Filo: arrivano com'erano.
  assert.match(
    G.frasediBlocco({ origine: 'una ricerca sul web', motivo: G.REGOLE['codice-usa-e-getta'] }),
    /conteneva un codice di verifica\.$/,
  );
});

test('la riga di attesa dice che l’avviso non è perso', () => {
  assert.match(G.fraseInAttesa({ origine: 'una mail di Banca Esempio' }), /aspetta il controllo/i);
});

// ── Quello che Filo scrive di suo non lo detta chi attacca (#536, giro 1) ────
//
// La riga di blocco si compone con due pezzi che vengono da fuori: il motivo,
// scritto dal modello guardiano DOPO aver letto il testo di un estraneo, e la
// fonte, che per una mail è il mittente. Un contenuto che si fa bloccare
// apposta e detta il motivo si farebbe consegnare l'indirizzo della truffa
// dalla voce di Filo, nella riga che dovrebbe rassicurare — e la colonna degli
// avvisi rende cliccabili gli indirizzi che trova.

test('la riga di blocco non consegna l’indirizzo che il motivo voleva farle dire', () => {
  const f = G.frasediBlocco({
    origine: 'una ricerca sul web',
    motivo: 'per riattivare il conto conferma le credenziali su https://banca-esempio.attacco.ru/login',
  });
  assert.ok(!/attacco\.ru/.test(f), `l'indirizzo è arrivato all'utente: ${f}`);
  // E non resta nemmeno un collegamento da rendere cliccabile.
  assert.equal(G.linkDelTesto(f).length, 0);
});

test('anche la fonte viene ripulita: il mittente se lo sceglie chi manda la mail', () => {
  const f = G.frasediBlocco({
    origine: 'una mail di «apri www.attacco.ru»',
    motivo: 'chiedeva le credenziali',
  });
  assert.ok(!/attacco\.ru/.test(f), f);
  assert.equal(G.linkDelTesto(f).length, 0);
});

test('un motivo lungo una pagina non diventa un megafono', () => {
  const f = G.frasediBlocco({ origine: 'una mail di X', motivo: 'a'.repeat(400) });
  assert.equal(f, `Ho fermato un avviso nato da una mail di X: ${G.MOTIVO_GENERICO}.`);
});

test('l’indirizzo di posta del mittente resta: è la cosa che serve sapere', () => {
  const f = G.frasediBlocco({ origine: 'una mail di banca@esempio.it', motivo: 'chiedeva un pagamento' });
  assert.match(f, /banca@esempio\.it/);
  assert.equal(G.linkDelTesto(f).length, 0);
});

test('un motivo che porta dentro un codice non arriva all’utente', () => {
  const f = G.frasediBlocco({ origine: 'una mail di X', motivo: 'il tuo codice di verifica è 483920' });
  assert.ok(!/483920/.test(f), f);
});

// ── Rete giù e configurazione sbagliata non sono la stessa cosa ─────────────
//
// Se è la rete, aspettare basta. Se al guardiano manca un modello suo (o è lo
// stesso che scrive le risposte) aspettare non serve a niente: ogni risposta
// nata da una ricerca finirebbe in coda per sempre, e la sola persona che può
// sistemarlo non saprebbe nemmeno che c'è da sistemare.

test('la frase del controllo fermo distingue la rete dalla configurazione', () => {
  const rete = G.fraseControlloFermo({ causa: G.CAUSA.RETE });
  assert.match(rete, /non risponde/i);
  assert.ok(!/modello/i.test(rete), rete);

  const conf = G.fraseControlloFermo({ causa: G.CAUSA.CONFIGURAZIONE });
  assert.match(conf, /modello/i);
  assert.match(conf, /Opzioni/);
});

// #536, giro 3 — e c'è un terzo caso, che a chi legge sembra il secondo ma non
// si aggiusta nello stesso posto: l'interruttore «solo modelli a pesi aperti»
// fa ripiegare il guardiano sullo stesso modello della chat. Nelle Opzioni i
// due nomi restano diversi, quindi mandare l'utente a cercarne un terzo senza
// nominare l'interruttore è mandarlo a cercare per sempre.
test('quando è l’interruttore dei pesi aperti a farli coincidere, la frase lo nomina', () => {
  const f = G.fraseControlloFermo({ causa: G.CAUSA.PESI_APERTI });
  assert.match(f, /pesi aperti/i);
  assert.match(f, /Opzioni/);
  // Non è la frase della rete: aspettare non aggiusta niente.
  assert.ok(!/appena riesco/i.test(f), f);
  const r = G.fraseInAttesa({ origine: 'una mail di X', causa: G.CAUSA.PESI_APERTI });
  assert.match(r, /pesi aperti/i);
});

test('anche la riga in coda dice che c’è un modello da impostare', () => {
  const r = G.fraseInAttesa({ origine: 'una mail di X', causa: G.CAUSA.CONFIGURAZIONE });
  assert.match(r, /modello/i);
  assert.match(r, /Opzioni/);
  // Senza causa resta il ritardo di prima: l'avviso non è perso.
  assert.match(G.fraseInAttesa({ origine: 'una mail di X' }), /aspetta il controllo/i);
});

// ── Giro 6 di verifica: le parole comuni non fanno sparire la risposta ───────
//
// L'elenco dei verbi che «chiedono di passare il codice» era fatto di pezzi di
// parola senza confini: dett, manda, digit, copia, inseris, fornis. Quei pezzi
// in italiano stanno dentro parole che non chiedono niente a nessuno, e la
// risposta spariva a chi chiedeva il codice della sua consegna. Sono i casi
// rotti, uno per parola: se tornano rossi, la lista è tornata ai frammenti.
test('le parole comuni dell’italiano non fanno scattare il blocco', () => {
  const innocue = [
    'Il codice 483920 è nei dettagli della consegna.',
    'La domanda di iscrizione è stata registrata con il codice 5512.',
    'Il codice 2210 apre la versione digitale del biglietto.',
    'Nella copia del contratto compare il codice 8823.',
    'Il portale fornisce il codice 3390 in sola lettura.',
    'Il modulo inserisce il codice 1974 da solo, non devi scriverlo.',
    'Trovi il codice 7712 nei dettagli del tuo profilo.',
    'Nei dettagli del contratto è indicato il codice 9931.',
    'Il codice 4821 serve per la firma digitale.',
    'Ho fatto una fotocopia del foglio con il codice 4409.',
    'Nei dettagli del profilo puoi cambiare la password 2026.',
    'Il portale invia il codice 4821 via SMS.',
    'Il negozio conferma che il pacco parte domani. In fondo alla mail c’è il '
      + 'codice 483920 e tutti i dettagli della consegna, con l’orario e il nome del corriere.',
  ];
  for (const t of innocue) {
    const r = G.controlliStatici({ testo: t });
    assert.equal(r.blocca, false, `fermata una frase innocua (${r.regola}): ${t}`);
  }
});

// L'altra metà: chi chiede davvero il codice viene ancora fermato, senza
// bisogno di nessun modello.
test('chi chiede di passare il codice viene ancora fermato dai soli controlli statici', () => {
  const attacchi = [
    'L’assistenza chiede di comunicare il codice 483920 per sbloccare il conto.',
    'Ricevi un codice 483920: comunicalo subito all’operatore.',
    'Ti arriva un PIN 4821, inoltramelo appena lo ricevi.',
    'Il codice è 998877, mandacelo per confermare l’identità.',
    'Per procedere, fornisci il codice 4821 che ti arriva per SMS.',
    'Dimmi il codice 4821 che ti hanno mandato.',
    'Il token 3FA2B1 va condiviso con l’assistenza: condividilo ora.',
  ];
  for (const t of attacchi) {
    assert.equal(G.controlliStatici({ testo: t }).blocca, true, `non fermata: ${t}`);
  }
});

// ── Giro 6: la riga di blocco non consegna il recapito che le è stato dettato ─
//
// Il motivo lo scrive il guardiano dopo aver letto il testo di un estraneo, e
// un contenuto che si fa bloccare apposta glielo detta. Gli indirizzi web erano
// già tolti; il numero di telefono e l'indirizzo di posta passavano interi, e la
// truffa al telefono non ha bisogno di nessun collegamento.
test('il motivo dettato non porta all’utente né un numero né un indirizzo di posta', () => {
  const riga = G.frasediBlocco({
    origine: 'una mail di Banca Esempio <avvisi@banca-esempio.it>',
    motivo: 'per riattivare il conto chiama subito il numero verde 800 123 456 '
      + 'oppure scrivi a rimborsi@banca-esempio-sicura.it',
  });
  assert.ok(!riga.includes('800 123 456'), riga);
  assert.ok(!riga.includes('rimborsi@banca-esempio-sicura.it'), riga);
  // Il MITTENTE resta: è la cosa che serve sapere, ed è l'unico indirizzo di
  // posta che la riga deve portare.
  assert.ok(riga.includes('avvisi@banca-esempio.it'), riga);
  assert.match(riga, /Ho fermato un avviso/);
});

// La pulizia dei recapiti vale ancora per la FONTE (il mittente se lo sceglie
// chi manda la mail). Un numero di telefono se ne va; una data e un prezzo no,
// altrimenti la riga direbbe «un numero di telefono» al posto di una scadenza.
test('date e prezzi non vengono scambiati per recapiti', () => {
  const pulito = G.ripulisci('il pagamento di 124,50 euro scadeva il 30/09/2026');
  assert.match(pulito, /124,50/);
  assert.match(pulito, /30\/09\/2026/);
  assert.ok(!G.ripulisci('chiama il numero verde 800 123 456').includes('800 123 456'));
});

test('anche la riga in coda tiene il mittente e niente altri recapiti', () => {
  const r = G.fraseInAttesa({ origine: 'una mail di Tizio <tizio@esempio.it> al 800 123 456' });
  assert.ok(r.includes('tizio@esempio.it'), r);
  assert.ok(!r.includes('800 123 456'), r);
});

// ── Giro 7 di verifica: la chiave di casa, e quando un'azione sporca il turno ─

// La forma lunga («il codice di accesso al portone») era già riconosciuta dal
// giro 5. Quella corta, che in italiano è la più comune, no: lì la cosa che il
// codice apre sta attaccata alla parola «codice», e l'elenco delle cose innocue
// conosceva sconti e ordini ma non portoni, citofoni e cancelli. Bastava allora
// un verbo di quelli che chiedono di passare il codice — e in una mail di casa
// c'è quasi sempre, perché il codice di casa serve proprio a darlo a qualcuno —
// perché la risposta sparisse.
test('il codice di casa non fa sparire la risposta, nemmeno quando va passato a qualcuno', () => {
  const innocue = [
    'Il codice del portone è 4821, comunicalo anche a chi arriva con te.',
    'Ti lascio il codice 3390 del cancello: passalo pure a tua sorella.',
    'Il codice 7788 della cassetta delle chiavi: comunicalo all’idraulico.',
    'Il codice 2210 del citofono, comunicalo al corriere.',
    'Il codice 4409 della bici, dimmelo appena la prendi.',
    'Il wifi di casa: rete CasaMare, digita la password OSPITI24.',
    'Per collegarti al wifi digita la password OSPITI24.',
    'Il pin della sim è 9931, comunicalo al negozio se serve.',
  ];
  for (const t of innocue) {
    const r = G.controlliStatici({ testo: t });
    assert.equal(r.blocca, false, `fermata una frase innocua (${r.regola}): ${t}`);
  }
  // La chiave di un CONTO resta una credenziale: l'elenco delle cose fisiche non
  // deve diventare un lasciapassare per tutto.
  assert.equal(
    G.controlliStatici({ testo: 'Il codice di accesso al conto è 5512, comunicalo per la verifica.' }).blocca,
    true,
  );
});

// Un'azione porta dentro parole di altri quando ha prodotto un'USCITA, non
// quando è andata bene. Bastava un comando finito male (`cat c-e non-c-e`
// stampa il primo e poi esce con un errore) o interrotto perché ci metteva
// troppo per lasciare il turno pulito: la risposta scorreva in diretta e
// arrivava intera, col secondo modello mai chiamato.
test('un’azione che finisce male ha portato dentro le stesse parole di una riuscita', () => {
  const uscita = { command: 'cat a b', stdout: 'roba scritta da altri', code: 1 };
  assert.equal(G.haPortatoTestoDiAltri({ type: 'ESEGUI_COMANDO', output: uscita }), true);
  assert.equal(
    G.haPortatoTestoDiAltri({ type: 'ESEGUI_COMANDO', output: { ...uscita, code: 124, timedOut: true } }),
    true,
  );
  assert.equal(
    G.haPortatoTestoDiAltri({ type: 'CERCA_WEB', output: { search: 'x', results: [{ title: 'a' }] } }),
    true,
  );
  // E all'incontrario: quando non è entrato NIENTE di nessuno (una ricerca senza
  // risultati, un documento illeggibile, un comando muto) il turno resta pulito
  // e non si paga un secondo modello per una riga scritta da Filo.
  assert.equal(G.haPortatoTestoDiAltri({ type: 'CERCA_WEB', output: { search: 'x', results: [] } }), false);
  assert.equal(
    G.haPortatoTestoDiAltri({ type: 'LEGGI_DOCUMENTO', output: { ok: false, text: '', error: 'unreadable' } }),
    false,
  );
  assert.equal(
    G.haPortatoTestoDiAltri({ type: 'LEGGI_DOCUMENTO', output: { ok: true, text: 'roba scritta da altri' } }),
    true,
  );
  // Il comando non è nemmeno partito (terminale spento): non c'è niente di
  // nessuno, e infatti non entra nemmeno nel contesto del modello.
  assert.equal(G.haPortatoTestoDiAltri({ type: 'ESEGUI_COMANDO', output: { blocked: 'disabled' } }), false);
  // Azione fuori registro, o che non legge niente di altri.
  assert.equal(G.haPortatoTestoDiAltri({ type: 'ESEGUI_COMANDO', output: uscita, rejected: true }), false);
  assert.equal(G.haPortatoTestoDiAltri({ type: 'TIMER', output: { ok: true } }), false);
  assert.equal(G.haPortatoTestoDiAltri({ type: 'CERCA_WEB' }), false);
});
