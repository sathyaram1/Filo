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

test('il verdetto di blocco arriva sempre con un motivo', () => {
  const v = G.leggiVerdetto('ecco: {"esito":"blocca","motivo":"chiedeva il PIN della carta"}');
  assert.equal(v.esito, 'blocca');
  assert.equal(v.motivo, 'chiedeva il PIN della carta');
  // Blocco senza motivo dal modello: la frase la mettiamo noi, mai vuota.
  const v2 = G.leggiVerdetto('{"esito":"blocca"}');
  assert.equal(v2.esito, 'blocca');
  assert.ok(v2.motivo.length > 5);
});

// ── La riga che l'utente legge ──────────────────────────────────────────────

test('la riga di blocco dice da dove veniva e cosa ha visto', () => {
  const f = G.frasediBlocco({ origine: 'una mail di Banca Esempio', motivo: 'chiedeva le tue credenziali' });
  assert.equal(f, 'Ho fermato un avviso nato da una mail di Banca Esempio: chiedeva le tue credenziali.');
  // Niente «ho avuto un dubbio»: senza fonte lo dice, non se la inventa.
  assert.match(G.frasediBlocco({ motivo: 'chiedeva un pagamento' }), /contenuto non fidato: chiedeva un pagamento\./);
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
  assert.match(f, /un indirizzo/);
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

test('un motivo lungo una pagina si butta intero, non si taglia a metà', () => {
  const f = G.frasediBlocco({ origine: 'una mail di X', motivo: 'a'.repeat(400) });
  assert.equal(f, 'Ho fermato un avviso nato da una mail di X.');
});

test('l’indirizzo di posta del mittente resta: è la cosa che serve sapere', () => {
  const f = G.frasediBlocco({ origine: 'una mail di banca@esempio.it', motivo: 'chiedeva un pagamento' });
  assert.match(f, /banca@esempio\.it/);
  assert.equal(G.linkDelTesto(f).length, 0);
});

test('un motivo che dopo la pulizia fa ancora scattare un controllo statico si butta', () => {
  const f = G.frasediBlocco({ origine: 'una mail di X', motivo: 'il tuo codice di verifica è 483920' });
  assert.equal(f, 'Ho fermato un avviso nato da una mail di X.');
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

test('anche la riga in coda dice che c’è un modello da impostare', () => {
  const r = G.fraseInAttesa({ origine: 'una mail di X', causa: G.CAUSA.CONFIGURAZIONE });
  assert.match(r, /modello/i);
  assert.match(r, /Opzioni/);
  // Senza causa resta il ritardo di prima: l'avviso non è perso.
  assert.match(G.fraseInAttesa({ origine: 'una mail di X' }), /aspetta il controllo/i);
});
