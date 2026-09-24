// Unit test per la lettura dei documenti dell'utente (azione LEGGI_DOCUMENTO).
//
// Il buco che chiude: i documenti che contano — bollette, estratti conto,
// contratti — sono quasi tutti PDF, e un PDF è binario. Filo poteva TROVARE il
// file col terminale ma non leggerlo: "quant'è la giacenza media?" con
// l'estratto conto nei Download era una domanda senza risposta possibile.
//
// Qui si asserisce il SUCCESSO dal punto di vista dell'utente (il testo del suo
// documento arriva davvero) e l'ONESTÀ nei casi in cui il testo non c'è. Senza
// il modulo di lettura ogni test qui sotto è rosso.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const FIXTURES = join(ROOT, 'tests', 'fixtures', 'documenti');

const DR = require(join(ROOT, 'src', 'main', 'services', 'documentRead.js'));

// Cartella usa-e-getta per i file costruiti al volo (troppo grandi o troppo
// specifici per stare tra le fixture committate).
const TMP = cartellaTemporanea('filo-doc-');
process.on('exit', () => { try { rmSync(TMP, { recursive: true, force: true }); } catch (_) {} });

// ─────────────────────────── PDF con testo vero ──────────────────────────────

test('un PDF vero restituisce il suo testo, tutte le pagine', async () => {
  const r = await DR.readDocument(join(FIXTURES, 'documento-con-testo.pdf'));
  assert.equal(r.ok, true);
  assert.equal(r.kind, 'pdf');
  assert.equal(r.empty, false);
  assert.equal(r.pages, 2);
  // È il dato che l'utente sta chiedendo, non un vago "c'è del testo".
  assert.match(r.text, /Giacenza media: 1\.234,56 euro/);
  // La seconda pagina non si perde per strada.
  assert.match(r.text, /Saldo finale: 987,65 euro/);
  assert.equal(r.truncated, false);
  assert.equal(r.error, null);
});

test('un PDF di sole immagini lo dice, invece di far finta di averlo letto', async () => {
  // È il caso della scansione o della foto del foglio: testo estraibile non ce
  // n'è. La risposta giusta è "questo PDF è un'immagine", non un testo inventato.
  const r = await DR.readDocument(join(FIXTURES, 'documento-scansionato.pdf'));
  assert.equal(r.ok, true);
  assert.equal(r.kind, 'pdf');
  assert.equal(r.empty, true);
  assert.equal(r.text, '');
  assert.equal(r.pages, 1);
});

// ─────────────────────────────── testo semplice ──────────────────────────────

test('un file di testo si legge senza passare dal terminale', async () => {
  const p = join(TMP, 'movimenti.csv');
  writeFileSync(p, 'data;causale;importo\n2026-03-02;Bolletta luce;-84,20\n', 'utf8');
  const r = await DR.readDocument(p);
  assert.equal(r.ok, true);
  assert.equal(r.kind, 'text');
  assert.match(r.text, /Bolletta luce;-84,20/);
});

test('gli accenti sopravvivono anche a un file scritto in windows-1252', async () => {
  // Gli export delle banche italiane arrivano quasi sempre così: letti come
  // UTF-8 diventano un campo minato di caratteri di sostituzione.
  const p = join(TMP, 'latin.txt');
  writeFileSync(p, Buffer.from('Addebito perché più caro', 'latin1'));
  const r = await DR.readDocument(p);
  assert.equal(r.ok, true);
  assert.match(r.text, /perché più caro/);
});

test('un file senza estensione nota si legge se dentro c\'è testo', async () => {
  const p = join(TMP, 'appunti.bak');
  writeFileSync(p, 'promemoria: disdire il contratto entro giugno', 'utf8');
  const r = await DR.readDocument(p);
  assert.equal(r.ok, true);
  assert.equal(r.kind, 'text');
  assert.match(r.text, /disdire il contratto/);
});

// ─────────────────────────────── il tetto ────────────────────────────────────

test('oltre il tetto il testo si tronca E il troncamento è dichiarato', async () => {
  const p = join(TMP, 'lunghissimo.txt');
  writeFileSync(p, 'a'.repeat(DR.MAX_TEXT_CHARS + 5000), 'utf8');
  const r = await DR.readDocument(p);
  assert.equal(r.ok, true);
  assert.equal(r.text.length, DR.MAX_TEXT_CHARS);
  // Il troncamento SILENZIOSO è il difetto vero: il modello risponderebbe su
  // metà documento credendo di averlo tutto.
  assert.equal(r.truncated, true);
});

test('sotto il tetto non si tronca niente', async () => {
  const p = join(TMP, 'corto.txt');
  writeFileSync(p, 'due righe\ne basta', 'utf8');
  const r = await DR.readDocument(p);
  assert.equal(r.truncated, false);
  assert.equal(r.text, 'due righe\ne basta');
});

// ─────────────────────────── rifiuti con motivo ──────────────────────────────

test('un file che non esiste lo dice con chiarezza', async () => {
  const r = await DR.readDocument(join(TMP, 'mai-esistito.pdf'));
  assert.equal(r.ok, false);
  assert.equal(r.error, 'not_found');
  assert.ok(r.detail);
});

test('una cartella non è un documento', async () => {
  const d = join(TMP, 'cartella');
  mkdirSync(d, { recursive: true });
  const r = await DR.readDocument(d);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'is_directory');
});

test('un percorso vuoto non tenta di leggere niente', async () => {
  for (const v of ['', '   ', null, undefined]) {
    const r = await DR.readDocument(v);
    assert.equal(r.ok, false);
    assert.equal(r.error, 'no_path');
  }
});

test('i formati binari vengono rifiutati dicendo COSA sono', async () => {
  // "formato non supportato" non aiuta nessuno; "è un'immagine" sì.
  const casi = [
    ['foto.jpg', /immagine/],
    ['relazione.docx', /Word/],
    ['conti.xlsx', /Excel/],
    ['setup.exe', /eseguibile/],
    ['backup.zip', /archivio/],
  ];
  for (const [nome, atteso] of casi) {
    const p = join(TMP, nome);
    writeFileSync(p, 'x');
    const r = await DR.readDocument(p);
    assert.equal(r.ok, false, `${nome} non doveva essere letto`);
    assert.equal(r.error, 'unsupported');
    assert.match(r.detail, atteso);
  }
});

test('un binario travestito da estensione ignota viene riconosciuto dal contenuto', async () => {
  const p = join(TMP, 'strano.dat');
  writeFileSync(p, Buffer.from([0x00, 0x01, 0x02, 0x00, 0xff, 0xfe, 0x00, 0x03]));
  const r = await DR.readDocument(p);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'unsupported');
});

test('un PDF rotto non fa esplodere niente: lo dice e basta', async () => {
  const p = join(TMP, 'rotto.pdf');
  writeFileSync(p, 'questo non è un PDF', 'utf8');
  const r = await DR.readDocument(p);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'pdf_failed');
});

// ─────────────────────────── normalizzazione percorsi ────────────────────────

test('il percorso arriva dall\'LLM: virgolette e ~ vengono sciolti', async () => {
  const home = (await import('node:os')).homedir();
  assert.equal(DR.normalizePath('~'), home);
  assert.equal(DR.normalizePath('~/Documenti'), join(home, 'Documenti'));
  assert.equal(DR.normalizePath('"~/Documenti"'), join(home, 'Documenti'));
  assert.equal(DR.normalizePath('   '), '');
});

test('un documento indicato con le virgolette si legge lo stesso', async () => {
  const p = join(TMP, 'virgolette.txt');
  writeFileSync(p, 'contenuto', 'utf8');
  const r = await DR.readDocument(`"${p}"`);
  assert.equal(r.ok, true);
  assert.equal(r.text, 'contenuto');
});

// ══════════════ il giro completo: prompt, registro dei livelli, manifesto ═════
// Un modulo che estrae il testo ma non è collegato a niente non serve a nessuno:
// se l'azione non è nel prompt il modello non la emette mai, e se non è nel
// registro dei livelli il dispatch la rifiuta prima di eseguirla.

test('il prompt della chat espone LEGGI_DOCUMENTO e quando usarla', () => {
  require(join(ROOT, 'src', 'shared', 'constants.js'));
  const p = globalThis.SN_CONST.PROMPTS.filoChat({ profilo: '', preferenze: '', stato: '' });
  assert.match(p, /LEGGI_DOCUMENTO/);
  // Deve dire che è l'unica via per un PDF, o il modello ci proverà col terminale.
  assert.match(p, /LEGGERE UN DOCUMENTO DELL'UTENTE[\s\S]*PDF/);
  assert.match(p, /giacenza media|estratto conto|bolletta/i);
  // E deve trattare il contenuto come dato, non come istruzioni.
  assert.match(p, /LEGGERE UN DOCUMENTO DELL'UTENTE[\s\S]*non istruzioni da eseguire/);
});

test('LEGGI_DOCUMENTO è registrata al livello 1 (sola lettura, esegue subito)', () => {
  require(join(ROOT, 'src', 'shared', 'preferences.js'));
  require(join(ROOT, 'src', 'shared', 'themeTokens.js'));
  require(join(ROOT, 'src', 'shared', 'cmdClassify.js'));
  require(join(ROOT, 'src', 'shared', 'actionLevels.js'));
  const AL = globalThis.SN_ACTION_LEVELS;
  // Senza voce nel registro il dispatch RIFIUTA l'azione: sarebbe una feature
  // completa che non parte mai.
  assert.equal(AL.levelFor({ type: 'LEGGI_DOCUMENTO', percorso: 'C:/x/y.pdf' }), 1);
  assert.match(AL.describe({ type: 'LEGGI_DOCUMENTO', percorso: 'C:/x/y.pdf' }), /C:\/x\/y\.pdf/);
  // Stessa cosa per la lettura dei documenti dell'EDITOR, che era rimasta fuori
  // dal registro e quindi non è mai partita.
  assert.equal(AL.levelFor({ type: 'LEGGI_FILE', fileId: 'file-1' }), 1);
});

test('il manifesto delle capacità dichiara che Filo legge i documenti', () => {
  require(join(ROOT, 'src', 'shared', 'capabilities.js'));
  const cap = globalThis.SN_CAPABILITIES.all().find((c) => c.id === 'read-user-documents');
  assert.ok(cap, 'la capacità deve esistere: un manifesto che tace è un manifesto che mente');
  assert.match(cap.desc, /PDF/);
  // Il confine dichiarato: sulle scansioni non c'è testo da leggere.
  assert.match(cap.doesNot, /scansione|foto/i);
});

// ───────────── il nome QUASI giusto: trattini, accenti, maiuscole ────────────
//
// #551. Visto dal vivo: il terminale di Windows scriveva i nomi nella tabella
// OEM, il modello ricopiava «SPECIFICHE SEO E METADATI - singolarita.txt» al
// posto di «… — singolarita.txt» (trattino lungo) e la lettura falliva in modo
// onesto su un nome mai esistito. Il guasto è chiuso a monte (terminal.js), ma
// la stessa svista la fa un utente che il nome lo scrive a mano. La filosofia
// di Filo è esplicita: un typo ogni tre parole non deve essere un problema.

test('la chiave tollerante appiattisce trattini, accenti, maiuscole e spazi doppi', () => {
  const atteso = DR.chiaveTollerante('SPECIFICHE SEO E METADATI - singolarita.txt');
  // Trattino lungo, medio, «figura» e meno matematico: tutti lo stesso nome.
  for (const trattino of ['—', '–', '‒', '−', '‐']) {
    assert.equal(
      DR.chiaveTollerante(`SPECIFICHE SEO E METADATI ${trattino} singolarita.txt`),
      atteso,
      `il trattino «${trattino}» doveva contare come «-»`,
    );
  }
  // Maiuscole, accenti, spazi doppi.
  assert.equal(DR.chiaveTollerante('Perché Più Caro.txt'), DR.chiaveTollerante('perche piu caro.txt'));
  assert.equal(DR.chiaveTollerante('nota   di  credito.pdf'), DR.chiaveTollerante('nota di credito.pdf'));
  // Due nomi davvero diversi restano diversi: la tolleranza non è un colabrodo.
  assert.notEqual(DR.chiaveTollerante('bolletta.pdf'), DR.chiaveTollerante('bollette.pdf'));
  assert.notEqual(DR.chiaveTollerante('conto.pdf'), DR.chiaveTollerante('conto.txt'));
});

test('un carattere di sostituzione vale come jolly, non come lettera', () => {
  // «Singolarit<27>.txt» è com'è arrivato il nome dal terminale: sotto quel
  // carattere c'era una «à» che nessuno può più ricostruire.
  assert.equal(DR.nomiCombaciano('SPECIFICHE TIPOGRAFICHE - Singolarit�.txt',
    'SPECIFICHE TIPOGRAFICHE — Singolarità.txt'), true);
  assert.equal(DR.nomiCombaciano('Singolarit�.txt', 'Singolarità.txt'), true);
  // Ma non deve mangiarsi mezzo nome fino a un file diverso.
  assert.equal(DR.nomiCombaciano('Singolarit�.txt', 'Singolarità.pdf'), false);
  assert.equal(DR.nomiCombaciano('Singolarit�.txt', 'Altro.txt'), false);
  // Un nome fatto di soli caratteri ignoti combacerebbe con qualunque cosa:
  // in una cartella con un file solo aprirebbe quello senza aver riconosciuto
  // niente. Sotto i jolly serve del nome vero.
  assert.equal(DR.nomiCombaciano('�', 'bolletta.pdf'), false);
  assert.equal(DR.nomiCombaciano('���', 'contratto.txt'), false);
});

test('un carattere perso sta per UN carattere, non per mezzo nome (#551, primo giro di verifica)', () => {
  // Prima porta. Del nome è rimasta solo l'estensione, e l'estensione non è un
  // nome: «.txt» da sola faceva passare il controllo del «nome vero sotto», e
  // in una cartella con un file di testo solo Filo apriva quello dicendo di
  // aver letto il documento chiesto.
  assert.equal(DR.nomiCombaciano('��.txt', 'Estratto conto dicembre.txt'), false);
  assert.equal(DR.nomiCombaciano('�.txt', 'Estratto conto dicembre.txt'), false);
  assert.equal(DR.nomiCombaciano('�.pdf', 'Bolletta.pdf'), false);

  // Seconda porta. Un carattere perso valeva «uno o più caratteri qualsiasi»:
  // bastava perdere la «o» di «Bilancio» per farsi aprire il bilancio
  // riservato, che con quel nome non c'entra niente.
  assert.equal(DR.nomiCombaciano('Bilanci�.txt', 'Bilancio 2019 definitivo riservato.txt'), false);
  assert.equal(DR.nomiCombaciano('Contratt��.pdf', 'Contratto affitto 2021.pdf'), false);
  // E quello che il jolly deve continuare a ritrovare, lo ritrova: un
  // carattere perso per un carattere vero, anche più d'uno nello stesso nome.
  assert.equal(DR.nomiCombaciano('Bilanci�.txt', 'Bilancià.txt'), true);
  assert.equal(DR.nomiCombaciano('Perch� citt�.txt', 'Perché città.txt'), true);
});

test('anche il punto interrogativo è un carattere perso, non una lettera (#551, primo giro)', () => {
  // Quando nella tabella di codici un carattere non ha dove andare, Windows ci
  // mette un «?». Su Windows un nome di file non può contenerlo, quindi un «?»
  // arrivato qui è sempre un carattere perso: senza questo, un file con il
  // simbolo dell'euro nel nome restava irraggiungibile.
  assert.equal(DR.nomiCombaciano('Fattura 1.200?.pdf', 'Fattura 1.200€.pdf'), true);
  assert.equal(DR.nomiCombaciano('Riepilogo ?.txt', 'Riepilogo Σ.txt'), true);
  // Con gli stessi limiti degli altri caratteri persi: niente mezzo nome,
  // niente nome fatto di soli jolly.
  assert.equal(DR.nomiCombaciano('Fattura 1.200?.pdf', 'Fattura 1.200 di dicembre.pdf'), false);
  assert.equal(DR.nomiCombaciano('??.txt', 'Estratto conto dicembre.txt'), false);
});

test('gli input limite non fanno inciampare la ricerca tollerante', () => {
  for (const v of ['', '   ', null, undefined]) {
    assert.equal(DR.nomiCombaciano(v, 'bolletta.pdf'), false);
    assert.equal(DR.nomiCombaciano('bolletta.pdf', v), false);
    assert.equal(DR.chiaveTollerante(v), '');
  }
  // I metacaratteri di un'espressione regolare sono lettere di un nome come
  // tutte le altre: non devono diventare parte del confronto.
  assert.equal(DR.nomiCombaciano('conto (1).txt', 'conto (1).txt'), true);
  assert.equal(DR.nomiCombaciano('cont� (1).txt', 'conto (1).txt'), true);
  assert.equal(DR.nomiCombaciano('cont� (1).txt', 'contoXXXXX1).txt'), false);
  // Nomi lunghissimi: nessuna esplosione, nessun falso positivo.
  const lungo = `${'a'.repeat(10000)}.txt`;
  assert.equal(DR.nomiCombaciano(lungo, lungo), true);
  assert.equal(DR.nomiCombaciano(lungo, `${'a'.repeat(9999)}b.txt`), false);
});

test('il file col trattino lungo si ritrova anche chiedendolo col trattino breve', async () => {
  const dir = join(TMP, 'seo');
  mkdirSync(dir, { recursive: true });
  const vero = join(dir, 'SPECIFICHE SEO E METADATI — singolarita.txt');
  writeFileSync(vero, 'titolo: la singolarità\nmeta: 155 caratteri\n', 'utf8');

  // Il percorso esattamente com'era uscito storpiato dal terminale.
  const r = await DR.readDocument(join(dir, 'SPECIFICHE SEO E METADATI - singolarita.txt'));
  assert.equal(r.ok, true, `doveva ritrovarlo: ${r.detail}`);
  assert.match(r.text, /155 caratteri/);
  // E deve DIRE quale file ha aperto davvero, col nome vero.
  assert.equal(r.name, 'SPECIFICHE SEO E METADATI — singolarita.txt');
  assert.equal(r.path, vero);
  assert.ok(r.requested.endsWith('SPECIFICHE SEO E METADATI - singolarita.txt'));
});

test('il file con la «à» si ritrova anche dal nome col carattere di sostituzione', async () => {
  const dir = join(TMP, 'tipo');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SPECIFICHE TIPOGRAFICHE — Singolarità.txt'), 'font: serif\n', 'utf8');
  const r = await DR.readDocument(join(dir, 'SPECIFICHE TIPOGRAFICHE - Singolarit�.txt'));
  assert.equal(r.ok, true, `doveva ritrovarlo: ${r.detail}`);
  assert.match(r.text, /font: serif/);
  assert.equal(r.name, 'SPECIFICHE TIPOGRAFICHE — Singolarità.txt');
});

test('anche la CARTELLA può avere il nome storpiato', async () => {
  // La storpiatura non risparmia i nomi delle cartelle: fermarsi all'ultimo
  // pezzo del percorso lascerebbe fuori metà dei casi veri.
  const dir = join(TMP, 'Progetto — città');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'note.txt'), 'appunti del progetto', 'utf8');
  const r = await DR.readDocument(join(TMP, 'Progetto - citta', 'note.txt'));
  assert.equal(r.ok, true, `doveva ritrovarlo: ${r.detail}`);
  assert.match(r.text, /appunti del progetto/);
});

test('quando il nome quasi giusto è giusto per DUE file, non si indovina', async () => {
  const dir = join(TMP, 'ambigui');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'Relazione — città.txt'), 'primo', 'utf8');
  writeFileSync(join(dir, 'RELAZIONE - CITTA.txt'), 'secondo', 'utf8');
  const r = await DR.readDocument(join(dir, 'Relazione - citta.txt'));
  assert.equal(r.ok, false);
  assert.equal(r.error, 'not_found');
  // Dirlo è la parte utile: il modello può chiedere all'utente quale intende.
  assert.match(r.detail, /quasi uguale/);
  assert.match(r.detail, /Relazione — città\.txt/);
});

test('un file che esiste davvero non passa mai dalla ricerca tollerante', async () => {
  // Il percorso esatto vince sempre, anche se nella cartella c'è un omonimo
  // che combacerebbe a meno degli accenti.
  const dir = join(TMP, 'esatto');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'conto.txt'), 'quello giusto', 'utf8');
  writeFileSync(join(dir, 'Cónto.txt'), 'quello sbagliato', 'utf8');
  const r = await DR.readDocument(join(dir, 'conto.txt'));
  assert.equal(r.ok, true);
  assert.equal(r.text, 'quello giusto');
  // Nessuna sostituzione avvenuta → niente da dichiarare.
  assert.equal(r.requested, '');
});

test('un nome che non somiglia a niente resta un onesto «non c\'è»', async () => {
  const dir = join(TMP, 'vuoto-quasi');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'bolletta.pdf'), 'x', 'utf8');
  const r = await DR.readDocument(join(dir, 'contratto-affitto.pdf'));
  assert.equal(r.ok, false);
  assert.equal(r.error, 'not_found');
  assert.equal(r.detail, 'a quel percorso non c\'è nessun file');
});

test('la ricerca tollerante non trasforma una cartella in un documento', async () => {
  const dir = join(TMP, 'come-cartella');
  mkdirSync(join(dir, 'Archivio — 2026'), { recursive: true });
  const r = await DR.readDocument(join(dir, 'Archivio - 2026'));
  assert.equal(r.ok, false);
  assert.equal(r.error, 'is_directory');
});

test('quando ad essere ambiguo è il nome della CARTELLA, Filo dice quali sono', async () => {
  // #551, secondo giro di verifica. A storpiarsi può essere un pezzo di
  // percorso in mezzo, non solo il nome del file. Se lì accanto ci sono due
  // cartelle che gli somigliano Filo giustamente non indovina, ma prima
  // taceva anche quali fossero: l'utente restava davanti a «non c'è nessun
  // file» senza niente da scegliere, mentre sul nome del file gliele elencava.
  // Stessa domanda, stessa risposta.
  const dir = join(TMP, 'cartelle-ambigue');
  mkdirSync(join(dir, 'Città vecchia'), { recursive: true });
  mkdirSync(join(dir, 'Citta vecchia'), { recursive: true });
  writeFileSync(join(dir, 'Città vecchia', 'nota.txt'), 'appunti', 'utf8');
  const r = await DR.readDocument(join(dir, 'Citt� vecchia', 'nota.txt'));
  assert.equal(r.ok, false);
  assert.equal(r.error, 'not_found');
  assert.match(r.detail, /cartelle/);
  assert.match(r.detail, /Città vecchia/);
  assert.match(r.detail, /Citta vecchia/);
});

test('una cartella sola col nome quasi giusto si attraversa senza domande', async () => {
  // Il rovescio del test qui sopra: con UNA sola candidata non c'è niente da
  // chiedere e il file arriva.
  const dir = join(TMP, 'cartella-sola');
  mkdirSync(join(dir, 'Città nuova'), { recursive: true });
  writeFileSync(join(dir, 'Città nuova', 'nota.txt'), 'appunti veri', 'utf8');
  const r = await DR.readDocument(join(dir, 'Citt� nuova', 'nota.txt'));
  assert.equal(r.ok, true, `doveva ritrovarlo: ${r.detail}`);
  assert.match(r.text, /appunti veri/);
});

// ── #551, terzo giro di verifica ────────────────────────────────────────────

test('un nome senza cartella si cerca dove Filo sta guardando, mai dove sta il programma', () => {
  // Un elenco stampa i NOMI, non i percorsi: è in quella forma che il nome
  // arriva al passo dopo. Risolto contro la cartella del programma, il file
  // dell'utente non si trovava — e col perdono sui nomi quasi giusti poteva
  // perfino aprirsi un file di Filo al posto del documento chiesto.
  assert.equal(DR.normalizePath('appunti.txt', TMP), join(TMP, 'appunti.txt'));
  assert.equal(DR.normalizePath('Documenti/bolletta.pdf', TMP), join(TMP, 'Documenti', 'bolletta.pdf'));
  // Senza cartella nota si ripiega sulla home (da dove il terminale parte),
  // MAI sulla cartella in cui gira il programma.
  const senzaCartella = DR.normalizePath('appunti.txt');
  assert.equal(senzaCartella, join(homedir(), 'appunti.txt'));
  assert.notEqual(senzaCartella, join(process.cwd(), 'appunti.txt'));
  // Un percorso assoluto resta quello che è: la cartella non c'entra.
  const assoluto = join(TMP, 'altrove', 'x.txt');
  assert.equal(DR.normalizePath(assoluto, join(TMP, 'qualsiasi')), assoluto);
});

test('un file di testo scritto a due byte per carattere si legge, non torna spazzatura', async () => {
  // La codifica che su Windows sta dappertutto: Windows PowerShell 5.1 la usa
  // per ogni file prodotto mandando l'uscita di un comando in un file — cioè
  // per i file che Filo stesso crea col terminale — e il Blocco note la offre
  // come «Unicode». Letta come UTF-8 diventa una fila di byte nulli.
  const testo = 'Attività di marzo — resoconto\nCittà: Torino\nTotale: 1.234,56\n';

  const le = join(TMP, 'uscita-le.txt');
  writeFileSync(le, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(testo, 'utf16le')]));
  const rLe = await DR.readDocument(le);
  assert.equal(rLe.ok, true);
  assert.ok(rLe.text.includes('Attività di marzo'), `testo storpiato: ${JSON.stringify(rLe.text.slice(0, 40))}`);
  assert.ok(!rLe.text.includes('\u0000'), 'restano i byte nulli della codifica a due byte');

  // Lo stesso, col verso opposto dei byte.
  const grezzo = Buffer.from(testo, 'utf16le');
  const girato = Buffer.from(grezzo);
  girato.swap16();
  const be = join(TMP, 'uscita-be.txt');
  writeFileSync(be, Buffer.concat([Buffer.from([0xfe, 0xff]), girato]));
  const rBe = await DR.readDocument(be);
  assert.equal(rBe.ok, true);
  assert.ok(rBe.text.includes('Città: Torino'), `testo storpiato: ${JSON.stringify(rBe.text.slice(0, 40))}`);

  // Un file a due byte con un'estensione che non dice niente non va scambiato
  // per binario: i byte nulli ci sono per costruzione.
  assert.equal(DR.looksLikeText(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(testo, 'utf16le')])), true);
  // Un UTF-8 normale continua a leggersi come prima.
  assert.equal(DR.decodeText(Buffer.from(testo, 'utf8')), testo);
});

// ── I segni tipografici di un file salvato in «ANSI» (#551, 4° giro) ─────────

test('un documento salvato come lo salva Windows conserva trattino lungo, apostrofo ed euro', async () => {
  // È il modo normale di salvare un testo su Windows fino a ieri, e quello che
  // Excel usa esportando un CSV. Letta come latin1, la fascia dove stanno i
  // segni tipografici diventava caratteri di controllo invisibili: gli accenti
  // tornavano giusti e il resto spariva senza lasciare nemmeno un rombo. Il
  // modello leggeva «12 » al posto di «12 €» e rispondeva su un testo bucato.
  // È il danno della segnalazione spostato dal nome del file al contenuto.
  const ansi = Buffer.from([
    0x53, 0x50, 0x45, 0x43, 0x49, 0x46, 0x49, 0x43, 0x48, 0x45, 0x20,
    0x97, 0x20,
    0x73, 0x69, 0x6e, 0x67, 0x6f, 0x6c, 0x61, 0x72, 0x69, 0x74, 0xe0,
    0x20, 0x64, 0x65, 0x6c, 0x6c, 0x92, 0x6f, 0x66, 0x66, 0x65, 0x72, 0x74, 0x61,
    0x3a, 0x20, 0x31, 0x32, 0x20, 0x80, 0x0a,
  ]);
  const f = join(TMP, 'specifiche-ansi.txt');
  writeFileSync(f, ansi);
  const r = await DR.readDocument(f);
  assert.equal(r.ok, true);
  assert.ok(r.text.includes('singolarità'), `accenti persi: ${JSON.stringify(r.text)}`);
  assert.ok(r.text.includes('—'), `trattino lungo perso: ${JSON.stringify(r.text)}`);
  assert.ok(r.text.includes('’'), `apostrofo tipografico perso: ${JSON.stringify(r.text)}`);
  assert.ok(r.text.includes('€'), `simbolo dell'euro perso: ${JSON.stringify(r.text)}`);
  // Un UTF-8 normale non deve passare di lì: resta com'è.
  assert.equal(DR.decodeText(Buffer.from('attività — 12 €', 'utf8')), 'attività — 12 €');
});

test('il taglio di un documento lungo non lascia mezzo carattere in fondo', () => {
  // Il taglio cade dove capita e un'emoji occupa due unità di testo: la prima
  // metà da sola non è nessun carattere e si mostra come un rombo. Stessa cura
  // già messa al taglio dell'output dei comandi: è lo stesso taglio.
  const r = DR.capText(`${'a'.repeat(DR.MAX_TEXT_CHARS - 1)}😀e poi altro`);
  assert.equal(r.truncated, true);
  const ultimo = r.text.charCodeAt(r.text.length - 1);
  assert.ok(!(ultimo >= 0xD800 && ultimo <= 0xDBFF), 'il testo finisce con mezzo carattere');
});

test('un nome con i caratteri invisibili del verso di lettura si ritrova lo stesso', async () => {
  // I nomi in arabo o in ebraico si portano dietro le marche che dicono da che
  // parte si legge la riga. La busta con cui ogni contenuto esterno entra nel
  // prompt le toglie, e deve continuare a toglierle: il nome che il modello
  // legge è quindi diverso da quello sul disco, e chiedere quel documento non
  // apriva più niente.
  const dir = join(TMP, 'nomi-con-direzione');
  mkdirSync(dir, { recursive: true });
  const vero = 'RELAZIONE ‫تقرير‬.txt';
  writeFileSync(join(dir, vero), 'la relazione vera\n', 'utf8');
  const comeLoLegge = 'RELAZIONE تقرير.txt';
  const r = await DR.readDocument(join(dir, comeLoLegge));
  assert.equal(r.ok, true, `il file non si ritrova: ${r.detail}`);
  assert.ok(r.text.includes('la relazione vera'));
  assert.equal(r.name, vero, 'il nome vero non torna a chi legge');
});

// ── #551, quinto giro di verifica ────────────────────────────────────────────

test('un nome con molti caratteri persi non impantana Filo', () => {
  // Il confronto tollerante girava come un'espressione regolare con un jolly
  // per buco, e il suo tempo RADDOPPIAVA a ogni buco in più: ventotto caratteri
  // persi costavano otto secondi per UN file, trenta ne costavano trentaquattro,
  // e la cartella li moltiplica. Quel conto gira nel processo principale, che è
  // uno: mentre girava, Filo non rispondeva a nient'altro — e il nome su cui
  // gira lo ricopia il modello da quello che il terminale gli ha stampato,
  // cioè da fuori.
  for (const n of [28, 40, 120]) {
    const chiesto = `${'a�'.repeat(n)}.txt`;
    const vero = `${'a'.repeat(n * 3)}b.txt`;
    const t0 = Date.now();
    assert.equal(DR.nomiCombaciano(chiesto, vero), false);
    const quanto = Date.now() - t0;
    assert.ok(quanto < 1000, `con ${n} caratteri persi il confronto ha impiegato ${quanto} ms`);
  }
  // E quello che deve ancora combaciare, combacia: la regola non è cambiata.
  assert.equal(DR.nomiCombaciano('Perch� citt�.txt', 'Perché città.txt'), true);
  assert.equal(DR.nomiCombaciano('Bilanci�.txt', 'Bilancio 2019 definitivo riservato.txt'), false);
});

test('la codifica di un documento si riconosce, non si stima a percentuale', () => {
  // Prima si contavano i rombi che venivano fuori leggendo come UTF-8 e si
  // ripiegava sulla tabella di Windows sopra uno ogni mille caratteri. Una
  // percentuale sbaglia in tutte e due le direzioni.
  const ansi = (s) => {
    const alti = { '€': 0x80, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '–': 0x96, '—': 0x97 };
    return Buffer.from([...s].map((c) => (alti[c] !== undefined ? alti[c] : c.codePointAt(0))));
  };

  // Prima porta: un documento salvato in ANSI con pochi segni speciali rispetto
  // alla sua lunghezza (una specifica tecnica, un CSV di numeri esportato dal
  // foglio di calcolo) restava letto come UTF-8 e li perdeva tutti.
  const lungo = `${'Riga di contorno tutta ascii che allunga il documento.\n'.repeat(200)}TOTALE: -931,50 € — attività`;
  assert.equal(DR.decodeText(ansi(lungo)).endsWith('TOTALE: -931,50 € — attività'), true);

  // Seconda porta, la stessa regola nell'altro verso: un documento scritto bene
  // in UTF-8 che contiene davvero qualche rombo — gli appunti in cui l'utente
  // ha ricopiato i nomi storpiati dal terminale — veniva riletto tutto con la
  // tabella di Windows, e si storpiavano gli accenti che erano giusti.
  const appunti = 'Il terminale stampa «Singolarit�.txt», «attivit�», «citt�»: però è la città.';
  assert.equal(DR.decodeText(Buffer.from(appunti, 'utf8')), appunti);

  // Terza porta: un testo a due byte per carattere SENZA la firma in testa
  // tornava una fila di caratteri nulli, e Filo dichiarava di averlo letto.
  const testo = 'Relazione attività finale: 12 €\nCittà: Torino\n';
  assert.equal(DR.decodeText(Buffer.from(testo, 'utf16le')), testo);
  assert.equal(DR.pareDueByte(Buffer.from(testo, 'utf16le')), 'le');
  const grande = Buffer.from(testo, 'utf16le');
  grande.swap16();
  assert.equal(DR.decodeText(grande), testo);
  // E un testo normale non viene scambiato per uno a due byte.
  assert.equal(DR.pareDueByte(Buffer.from(testo, 'utf8')), '');
  assert.equal(DR.pareDueByte(ansi(lungo)), '');
});

test('un byte rotto non cambia la tabella a tutto il resto del documento', () => {
  // #551, sesto giro di verifica. La regola «i byte sono UTF-8 valido?» è
  // esatta ma è tutto o niente: un byte guasto in mezzo a cinquantamila faceva
  // rileggere l'INTERO documento con la tabella di Windows, e allora ogni
  // accento, trattino lungo e simbolo dell'euro che era GIUSTO arrivava
  // storpiato («città» → «cittÃ », «—» → «â€”», «€» → «â‚¬»).

  // Prima porta: l'estratto conto che mescola righe nuove e una riga vecchia.
  const righe = [];
  for (let i = 0; i < 150; i++) righe.push(`0${(i % 9) + 1}/03/2026;Rimborso — pratica ${100 + i};${(i * 3.5).toFixed(2)} €`);
  righe.push('30/03/2026;Commissione attività;-1,50 €');
  const buono = Buffer.from(`${righe.join('\n')}\n`, 'utf8');
  const vecchia = Buffer.from([0x43, 0x69, 0x74, 0x74, 0xE0, 0x3B, 0x31, 0x32, 0x0A]); // «Città;12» di una volta
  const misto = DR.decodeTextDettaglio(Buffer.concat([buono, vecchia]));
  assert.equal(misto.text.includes('Rimborso — pratica 100'), true);
  assert.equal(misto.text.includes('Commissione attività'), true);
  assert.equal(misto.text.includes('Ã') || misto.text.includes('â€'), false);
  // E il byte rotto non sparisce in silenzio: si sa che c'è e quanti sono.
  assert.equal(misto.codifica, 'utf8-danneggiato');
  assert.equal(misto.bytesPersi, 1);

  // Seconda porta: un registro lungo scritto bene con un byte grezzo in mezzo.
  const corpo = Buffer.from('INFO attività di città: però è così, — 12 €\n'.repeat(400), 'utf8');
  const registro = DR.decodeText(Buffer.concat([corpo.subarray(0, 6000), Buffer.from([0xFF]), corpo.subarray(6000)]));
  assert.equal(registro.split('\n')[0], 'INFO attività di città: però è così, — 12 €');

  // Il verso opposto resta chiuso: un documento salvato in ANSI non ha nemmeno
  // una sequenza a più byte scritta bene, e la sua tabella si riconosce lo
  // stesso anche quando i segni speciali sono pochi.
  const ansi = Buffer.from([...'Contratto '].map((c) => c.charCodeAt(0)).concat([0x97, 0x20, 0x61, 0x74, 0x74, 0x69, 0x76, 0x69, 0x74, 0xE0, 0x20, 0x31, 0x32, 0x20, 0x80]));
  const letto = DR.decodeTextDettaglio(ansi);
  assert.equal(letto.text, 'Contratto — attività 12 €');
  assert.equal(letto.codifica, 'windows');
});

test('un testo a due byte si riconosce anche fuori dall’alfabeto latino', async () => {
  // #551, sesto giro. Il riconoscimento contava i byte NULLI e pretendeva che
  // fossero metà: vero solo finché le lettere sono latine. In russo, greco o
  // cinese il file non veniva riconosciuto e Filo DICHIARAVA di averlo letto,
  // consegnando al modello una fila di caratteri nulli.
  const russo = 'Привет, это тестовый файл с русским текстом.\n'.repeat(6);
  assert.equal(DR.pareDueByte(Buffer.from(russo, 'utf16le')), 'le');
  assert.equal(DR.decodeText(Buffer.from(russo, 'utf16le')), russo);
  const greco = 'Αυτό είναι ένα δοκιμαστικό αρχείο με ελληνικά.\n'.repeat(6);
  const be = Buffer.from(greco, 'utf16le');
  be.swap16();
  assert.equal(DR.decodeText(be), greco);

  // E se proprio non si riconosce, non lo si dichiara letto: un testo pieno di
  // caratteri nulli non è un testo.
  assert.equal(DR.quotaNonTesto('Relazione attività finale: 12 €') < 0.02, true);
  assert.equal(DR.quotaNonTesto('\u0000R\u0000e\u0000l\u0000a\u0000z') > 0.02, true);
});

test('un byte nullo dentro un testo è un danno, non un testo a due byte', async () => {
  // #551, settimo giro. Il riconoscimento dei file scritti a due byte per
  // carattere guardava da che PARTE delle coppie stanno i byte nulli, e non
  // pretendeva più niente su quanti fossero. Uno solo bastava: con un nullo
  // soltanto quel conto dà il cento per cento, il file veniva riletto due byte
  // alla volta, e quello che ne usciva erano ideogrammi. Ideogrammi
  // STAMPABILI, quindi nemmeno la rete finale se ne accorgeva: Filo dichiarava
  // letto un estratto conto e rispondeva su una fila di segni cinesi.
  //
  // Un byte nullo dentro un file di testo capita per davvero: il registro di un
  // programma che si è chiuso male, l'export di un gestionale vecchio, il file
  // recuperato da una chiavetta staccata.
  const righe = ['Data;Causale;Importo'];
  for (let i = 0; i < 40; i++) righe.push(`0${(i % 9) + 1}/03/2026;Rimborso — pratica ${137 + i};${i},50 €`);
  righe.push('30/03/2026;Commissione attività;-931,50 €');
  const buono = Buffer.from(`${righe.join('\n')}\n`, 'utf8');
  const conNullo = (dove) => Buffer.concat([buono.subarray(0, dove), Buffer.from([0]), buono.subarray(dove)]);

  // Dove cade il nullo non cambia niente: il resto del testo resta quello
  // scritto. Le posizioni sono fini di riga, così il byte guasto non cade
  // dentro le parole su cui si asserisce: quello che si verifica qui è che il
  // documento non cambi tabella, non che un byte perso si ricostruisca.
  const fineRiga = (k) => buono.indexOf(0x0A, k);
  for (const dove of [0, 1, fineRiga(20), fineRiga(200), fineRiga(999)]) {
    const letto = DR.decodeTextDettaglio(conNullo(dove));
    assert.equal(letto.codifica === 'due-byte', false, `byte nullo in ${dove}: letto a due byte`);
    assert.equal(letto.text.includes('Rimborso — pratica 139'), true, `byte nullo in ${dove}`);
    assert.equal(letto.text.includes('-931,50 €'), true, `byte nullo in ${dove}: totale perso`);
  }
  // Due nulli dalla stessa parte delle coppie: stesso discorso.
  const due = Buffer.concat([buono.subarray(0, 100), Buffer.from([0]), buono.subarray(100, 300), Buffer.from([0]), buono.subarray(300)]);
  assert.equal(DR.decodeText(due).includes('Rimborso — pratica 137'), true);

  // E lo stesso vale per un documento salvato come Windows ha sempre salvato i
  // testi: un byte guasto non deve farlo passare per un file a due byte.
  const ansi = Buffer.concat([
    Buffer.from([...Buffer.from('SPECIFICHE '), 0x97, ...Buffer.from(' singolarit'), 0xE0, ...Buffer.from(': 12 '), 0x80, 0x0A]),
    Buffer.from('riga normale di testo\n'.repeat(40), 'latin1'),
  ]);
  const ansiRotto = Buffer.concat([ansi.subarray(0, 200), Buffer.from([0]), ansi.subarray(200)]);
  assert.equal(DR.decodeText(ansiRotto).includes('SPECIFICHE — singolarità: 12 €'), true);

  // La porta chiusa nei giri prima resta chiusa: un file davvero scritto a due
  // byte si riconosce ancora, con e senza la firma in testa, dentro e fuori
  // dall'alfabeto latino.
  const testo = 'RELAZIONE — attività finale\nCittà di Milano: 12 €\n'.repeat(8);
  assert.equal(DR.decodeText(Buffer.from(testo, 'utf16le')), testo);
  assert.equal(DR.decodeText(Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(testo, 'utf16le')])), testo);
  const russo = 'Привет, это тестовый файл с русским текстом.\n'.repeat(6);
  assert.equal(DR.decodeText(Buffer.from(russo, 'utf16le')), russo);
});

test('un byte nullo dentro un testo non lo fa leggere a coppie di byte', () => {
  // #551, ottavo giro di verifica. Il settimo giro chiedeva «questi byte sono
  // già testo?» e rispondeva con una percentuale sul file intero. Due file
  // normalissimi stanno sopra quella soglia senza essere scritti a due byte per
  // carattere, e allora un nullo solo li faceva rileggere a coppie: quello che
  // ne usciva erano ideogrammi cinesi, stampabili, quindi nemmeno la rete
  // finale se ne accorgeva, e Filo dichiarava di aver letto il documento.
  const conNullo = (buf, dove) => {
    const b = Buffer.from(buf);
    b[dove] = 0;
    return b;
  };

  // Prima strada: il file è CORTO. In un promemoria di quaranta caratteri un
  // nullo solo vale il due e mezzo per cento.
  const nota = Buffer.from('Promemoria: chiamare l\'idraulico martedì.\n', 'utf8');
  assert.equal(DR.pareDueByte(conNullo(nota, 7)), '');
  assert.equal(DR.pareDueByte(conNullo(nota, 6)), '');
  assert.equal(DR.decodeText(conNullo(nota, 7)).includes('chiamare l\'idraulico martedì'), true);

  // Seconda strada, e vale a qualunque lunghezza: il file contiene già qualche
  // carattere di controllo suo. Il registro di un programma che disegna una
  // barra di avanzamento torna indietro un carattere per volta.
  let registro = '';
  for (let i = 0; i < 100; i++) registro += `Scarico attività ${i}%${'\b'.repeat(30)}\n`;
  registro += 'TOTALE: 931,50 € — pratica conclusa a Città\n';
  const barra = Buffer.from(registro, 'utf8');
  assert.ok(barra.length > 5000, 'il registro di prova dev\'essere lungo');
  for (const dove of [7, 6, barra.length - 3]) {
    assert.equal(DR.pareDueByte(conNullo(barra, dove)), '', `nullo in posizione ${dove}`);
  }

  // Un pugno di caratteri guasti non condanna il documento: si tolgono, si
  // contano e il resto si legge. Sopra quel pugno il rifiuto resta.
  const letto = DR.decodeTextDettaglio(conNullo(nota, 7));
  assert.equal(letto.codifica, 'utf8');
  assert.equal(DR.senzaRumore(letto.text).persi, 1);

  // E le porte chiuse nei giri prima restano chiuse: un file davvero scritto a
  // due byte si riconosce ancora, con e senza firma, dentro e fuori
  // dall'alfabeto latino.
  const testo = 'RELAZIONE — attività finale\nCittà di Milano: 12 €\n'.repeat(8);
  assert.equal(DR.pareDueByte(Buffer.from(testo, 'utf16le')), 'le');
  assert.equal(DR.decodeText(Buffer.from(testo, 'utf16le')), testo);
  const be = Buffer.from(testo, 'utf16le');
  be.swap16();
  assert.equal(DR.decodeText(be), testo);
  const russo = 'Привет, это тестовый файл с русским текстом.\n'.repeat(6);
  assert.equal(DR.decodeText(Buffer.from(russo, 'utf16le')), russo);
});
