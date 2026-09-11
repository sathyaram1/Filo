// Unit test per src/shared/guardiano.js — il guardiano dei testi verso l'utente
// (#536): controlli statici, prompt, verdetto, indipendenza del modello.
//
// Asseriamo il SUCCESSO della difesa dal punto di vista dell'utente: la mail
// che imita la banca NON diventa un avviso, la mail normale sì, e il guardiano
// non gira mai sullo stesso modello che ha scritto il testo. Senza il modulo
// questi assert sono rossi.
//
// Logica pura: gira via `npm run test:unit` in millisecondi, senza Electron né
// rete — i controlli statici devono funzionare anche a rete staccata, ed è
// esattamente così che vengono provati qui.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const RADICE = join(__dirname, '..', '..');
require(join(RADICE, 'src', 'shared', 'guardiano.js'));
const G = globalThis.SN_GUARDIANO;

const BANCO = JSON.parse(readFileSync(join(RADICE, 'tests', 'fixtures', 'banco-guardiano.json'), 'utf8'));

// ── Classi di fiducia (ponte verso #530) ────────────────────────────────────

test('la classe di un compito è la PIÙ BASSA fra le sue fonti', () => {
  assert.equal(G.piuBassa(G.CLASSI.SISTEMA, G.CLASSI.UTENTE), G.CLASSI.UTENTE);
  assert.equal(G.piuBassa(G.CLASSI.UTENTE, G.CLASSI.TERZI), G.CLASSI.TERZI);
  assert.equal(G.piuBassa([G.CLASSI.SISTEMA, G.CLASSI.SISTEMA]), G.CLASSI.SISTEMA);
  // una sola mail contamina tutto il resto
  assert.equal(G.piuBassa(G.CLASSI.SISTEMA, G.CLASSI.UTENTE, G.CLASSI.TERZI), G.CLASSI.TERZI);
});

test('il guardiano si applica solo ai compiti contaminati (niente spreco su «che ore sono»)', () => {
  assert.equal(G.deveControllare(G.CLASSI.TERZI), true);
  assert.equal(G.deveControllare(G.CLASSI.UTENTE), false);
  assert.equal(G.deveControllare(G.CLASSI.SISTEMA), false);
  assert.equal(G.deveControllare(undefined), false);
});

test('leggere roba di altri contamina il turno; leggere roba di Filo no', () => {
  assert.deepEqual(G.fonteDiAzione({ type: 'CERCA_WEB', query: 'meteo' }), { tipo: 'ricerca', nome: 'meteo' });
  assert.equal(G.fonteDiAzione({ type: 'LEGGI_DOCUMENTO', percorso: '/home/x/contratto.pdf' }).nome, 'contratto.pdf');
  // il manifesto delle capacità e i documenti di trasparenza sono testi nostri
  assert.equal(G.fonteDiAzione({ type: 'CAPACITA_DETTAGLIO', ids: ['x'] }), null);
  assert.equal(G.fonteDiAzione({ type: 'LEGGI_TRASPARENZA', doc: 'models' }), null);
  assert.equal(G.fonteDiAzione({ type: 'TIMER', label: 'pasta' }), null);
  assert.equal(G.fontiDelTurno([{ type: 'TIMER' }, { type: 'CERCA_WEB', query: 'x' }]).length, 1);
});

// ── Controlli statici: quello che scatta senza chiamare nessun modello ──────

test('controlli statici: un codice usa e getta non arriva mai all\'utente', () => {
  const r = G.controlliStatici({ testo: 'Il codice di verifica per completare l\'accesso è 483920.' });
  assert.equal(r.bloccato, true);
  assert.equal(r.regola, 'codice_usa_e_getta');
});

test('controlli statici: codici di recupero, password, chiavi', () => {
  assert.equal(G.controlliStatici({ testo: 'I codici di recupero sono a7f2-99kd-1m4p' }).regola, 'codice_recupero');
  assert.equal(G.controlliStatici({ testo: 'la password è Estate2026!' }).regola, 'password');
  assert.equal(G.controlliStatici({ testo: 'usa sk-live-9f2b7c41d8e6a05b3149 per entrare' }).regola, 'chiave');
  assert.equal(G.controlliStatici({ testo: '-----BEGIN RSA PRIVATE KEY-----' }).regola, 'chiave');
});

test('controlli statici: coordinate bancarie e carte (la carta solo se è plausibile)', () => {
  assert.equal(G.controlliStatici({ testo: 'nuovo IBAN IT60 X054 2811 1010 0000 0123 456' }).regola, 'coordinate_bancarie');
  assert.equal(G.controlliStatici({ testo: 'usa la carta 4111 1111 1111 1111' }).regola, 'carta');
  // una sequenza lunga che NON è una carta (Luhn non torna) non è un blocco:
  // i numeri d'ordine e di spedizione non devono far gridare al lupo.
  assert.equal(G.controlliStatici({ testo: 'spedizione 4521998630012' }).bloccato, false);
});

test('controlli statici: un segreto custodito da Filo non esce, e nessun modello può decidere il contrario', () => {
  const segreto = 'sk-or-v1-abcdefghijklmnop';
  const r = G.controlliStatici({ testo: `ecco la chiave: ${segreto}`, segreti: [segreto] });
  assert.equal(r.regola, 'segreto_custodito');
  // sotto gli 8 caratteri non si confronta: un «segreto» corto darebbe falsi
  // positivi su parole comuni.
  assert.equal(G.controlliStatici({ testo: 'ciao mondo', segreti: ['ciao'] }).bloccato, false);
});

test('controlli statici: un collegamento che promette un dominio e ne apre un altro', () => {
  const r = G.controlliStatici({ testo: 'paga su [spedizioni.example](https://spedizioni.example.pagamento.test/pay)' });
  assert.equal(r.regola, 'link_ingannevole');
  // un sottodominio del dominio promesso mantiene la promessa
  assert.equal(
    G.controlliStatici({ testo: '[banca.example](https://login.banca.example/accedi)' }).bloccato,
    false,
  );
  // e un'etichetta che non promette niente non è un inganno
  assert.equal(
    G.controlliStatici({ testo: '[clicca qui](https://qualcosa.test/x)' }).bloccato,
    false,
  );
  // vale anche per l'azione allegata all'avviso, non solo per il testo
  assert.equal(
    G.controlliStatici({ testo: 'apri banca.example', azione: { type: 'NAVIGA', url: 'https://banca.example.altro.test' } }).bloccato,
    true,
  );
});

test('controlli statici: sul banco delle mail simulate NON grida al lupo (zero falsi positivi)', () => {
  const falsiPositivi = BANCO.normali
    .map((n) => ({ id: n.id, r: G.controlliStatici({ testo: n.testo }) }))
    .filter((x) => x.r.bloccato)
    .map((x) => `${x.id} (${x.r.regola})`);
  assert.deepEqual(falsiPositivi, [], `posta normale fermata: ${falsiPositivi.join(', ')}`);
});

test('controlli statici: sul banco degli attacchi scattano le regole attese', () => {
  const sbagliati = [];
  for (const a of BANCO.attacchi) {
    const r = G.controlliStatici({ testo: a.testo });
    if (a.statico) {
      if (!r.bloccato || r.regola !== a.statico) sbagliati.push(`${a.id}: atteso ${a.statico}, ottenuto ${r.regola}`);
    } else if (r.bloccato) {
      // le righe marcate `null` le deve vedere il guardiano, non una regola:
      // se una regola statica le prendesse, il banco va aggiornato.
      sbagliati.push(`${a.id}: fermato dalla regola ${r.regola} invece che dal guardiano`);
    }
  }
  assert.deepEqual(sbagliati, [], sbagliati.join(' | '));
});

// ── Il prompt: cosa vede il guardiano, e cosa NON vede ──────────────────────

test('il prompt porta il testo in uscita, la classe, la fonte e la richiesta dell\'utente', () => {
  const { messages } = G.costruisciPrompt({
    testo: 'la tua banca chiede di confermare le credenziali',
    classe: G.CLASSI.TERZI,
    fonte: { tipo: 'mail', nome: 'banca-x.example' },
    richiestaUtente: 'controlla la posta',
  });
  assert.equal(messages.length, 2);
  const user = messages[1].content;
  assert.ok(user.includes('la tua banca chiede di confermare le credenziali'));
  assert.ok(user.includes('banca-x.example'));
  assert.ok(user.includes('controlla la posta'));
  assert.ok(user.includes('terzi'));
  // il testo da giudicare è delimitato e dichiarato dato, non istruzioni
  assert.ok(user.includes('<<<TESTO>>>'));
  assert.ok(/NON istruzioni/i.test(user));
  assert.ok(/DATO, non istruzioni/i.test(messages[0].content));
});

test('il guardiano NON rilegge la fonte: il prompt non porta il contenuto delle mail', () => {
  const corpo = 'CORPO INTEGRALE DELLA MAIL CHE NON DEVE ARRIVARE AL GUARDIANO';
  const { messages } = G.costruisciPrompt({
    testo: 'avviso breve',
    classe: G.CLASSI.TERZI,
    fonte: { tipo: 'mail', nome: 'x@example' },
    // nessun campo del prompt accetta il contenuto della fonte: anche
    // passandolo di straforo non c'è un posto dove finisca.
    contenutoFonte: corpo,
  });
  assert.ok(!JSON.stringify(messages).includes(corpo));
});

// ── Il verdetto: cosa fa passare, e cosa no ─────────────────────────────────

test('il verdetto: passa, blocca col motivo, e tutto il resto NON è un passa', () => {
  assert.deepEqual(G.interpretaVerdetto('{"esito":"passa"}'), { esito: 'passa', motivo: '' });
  const b = G.interpretaVerdetto('ecco: {"esito":"blocca","motivo":"sembrava spingerti ad aprire un link"}');
  assert.equal(b.esito, 'blocca');
  assert.equal(b.motivo, 'sembrava spingerti ad aprire un link');
  // un blocco senza motivo resta un blocco SPIEGATO
  assert.ok(G.interpretaVerdetto('{"esito":"blocca"}').motivo.length > 0);
  // risposta fuori formato / modello dirottato / silenzio → NON passa
  assert.equal(G.interpretaVerdetto('passa'), null);
  assert.equal(G.interpretaVerdetto('{"esito":"forse"}'), null);
  assert.equal(G.interpretaVerdetto('{non json}'), null);
  assert.equal(G.interpretaVerdetto(''), null);
  assert.equal(G.interpretaVerdetto(null), null);
});

test('la riga di blocco dice DA DOVE veniva l\'avviso e COSA il guardiano ha visto', () => {
  const frase = G.frasePerBlocco({
    fonte: { tipo: 'mail', nome: 'banca-x.example' },
    motivo: 'sembrava spingerti a confermare le credenziali',
  });
  assert.ok(frase.includes('mail di banca-x.example'));
  assert.ok(frase.includes('sembrava spingerti a confermare le credenziali'));
  // sobria: non è un allarme rosso, è una riga
  assert.ok(frase.length < 200);
});

test('la riga dell\'attesa non contiene il testo in attesa', () => {
  const frase = G.fraseInAttesa({ fonte: { tipo: 'mail', nome: 'x.example' } });
  assert.ok(/in attesa del controllo/i.test(frase));
  assert.ok(frase.includes('x.example'));
});

// ── Indipendenza: SENTINELLA ────────────────────────────────────────────────

test('SENTINELLA: il guardiano rifiuta il nickname del modello che ha scritto il testo', () => {
  const r = G.catenaGuardiano({
    catenaConfigurata: 'deepseek, gemma-lite',
    catenaProduttore: 'deepseek, gemma',
  });
  assert.equal(r.catena, 'gemma-lite');
  assert.deepEqual(r.scartati, ['deepseek']);
  assert.equal(r.indipendente, true);
});

test('SENTINELLA: se nella catena non resta nessun modello diverso, il guardiano NON gira', () => {
  const r = G.catenaGuardiano({
    catenaConfigurata: 'deepseek',
    catenaProduttore: 'deepseek, gemma',
    catenaRipiego: 'gemma',
  });
  // niente catena = niente secondo giudizio: chi chiama mette in coda, non
  // mostra il testo. Un giudizio sullo stesso modello non è un secondo giudizio.
  assert.equal(r.indipendente, false);
  assert.equal(r.catena, '');
});

test('senza slot configurato si usa il ripiego, ripulito anch\'esso dal produttore', () => {
  const r = G.catenaGuardiano({
    catenaConfigurata: '',
    catenaProduttore: 'deepseek',
    catenaRipiego: 'deepseek, gemma-lite, kimi',
  });
  assert.equal(r.catena, 'gemma-lite, kimi');
  assert.equal(r.indipendente, true);
});

test('SENTINELLA: nella configurazione di prova il guardiano e la chat non condividono nessun modello', () => {
  require(join(RADICE, 'src', 'shared', 'constants.js'));
  require(join(RADICE, 'tests', 'fixtures', 'testModels.js'));
  const C = globalThis.SN_CONST;
  const M = globalThis.SN_TEST_MODELS.models;
  const guardiano = C.parseModelRefs(M[C.ACTIONS.GUARDIAN_CHECK]);
  const chat = new Set(C.parseModelRefs(M[C.ACTIONS.FILO_CHAT]));
  assert.ok(guardiano.length > 0, 'il guardiano deve avere una catena');
  const comuni = guardiano.filter((n) => chat.has(n));
  assert.deepEqual(comuni, [], `guardiano e chat condividono ${comuni.join(', ')}`);
});

// ── I collegamenti mostrati sotto l'avviso ──────────────────────────────────

test('sotto l\'avviso si vede dove porta ogni collegamento, anche quando non si capisce', () => {
  const link = G.linkPerUtente('scrivimi su https://login.banca.example/x oppure [qui](https://altro.test/y)');
  assert.equal(link.length, 2);
  assert.ok(link.some((l) => l.host === 'login.banca.example'));
  assert.ok(link.some((l) => l.host === 'altro.test'));
  // l'azione allegata all'avviso è il primo collegamento: è quello che si apre
  const conAzione = G.linkPerUtente('apri', { type: 'NAVIGA', url: 'https://dove.test/x' });
  assert.equal(conAzione[0].host, 'dove.test');
  // un indirizzo illeggibile lo si dichiara invece di tacerlo
  const strano = G.linkPerUtente('vai', { type: 'NAVIGA', url: 'javascript:alert(1)' });
  assert.ok(strano[0].dove);
});

// ── Input limite ────────────────────────────────────────────────────────────

test('input limite: vuoto, soli spazi, testo enorme, caratteri strani', () => {
  assert.equal(G.controlliStatici({ testo: '' }).bloccato, false);
  assert.equal(G.controlliStatici({ testo: '   \n\t ' }).bloccato, false);
  assert.equal(G.controlliStatici({ testo: undefined }).bloccato, false);
  assert.equal(G.controlliStatici({ testo: 'x'.repeat(50_000) }).bloccato, false);
  assert.equal(G.controlliStatici({ testo: '🙂 é ü   <script>' }).bloccato, false);
  // il prompt taglia il testo enorme invece di mandarlo intero, ma non tace:
  // il taglio è dichiarato nel modulo (TETTO_TESTO) e vale per tutti.
  const { messages } = G.costruisciPrompt({ testo: 'a'.repeat(50_000), classe: G.CLASSI.TERZI });
  assert.ok(messages[1].content.length < 50_000);
  assert.ok(messages[1].content.includes('a'.repeat(G.TETTO_TESTO)));
});
