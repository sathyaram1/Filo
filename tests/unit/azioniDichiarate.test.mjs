// #517 — «Azione raccontata a parole e mai eseguita: fallimento muto».
//
// Il feedback: nei turni di prosecuzione il modello a volte scrive «Ti ho messo
// una sveglia alle 19:00» senza aver chiamato nessuno strumento. Il testo arriva
// all'utente, la sveglia no. Qui si prova la parte deterministica del presidio
// (src/shared/azioniDichiarate.js): riconoscere la dichiarazione, NON scattare
// quando l'azione c'è davvero, e non gridare al lupo su una frase qualunque.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../src/shared/actionTools.js');
require('../../src/shared/azioniDichiarate.js');
const AD = globalThis.SN_AZIONI_DICHIARATE;
const Tools = globalThis.SN_ACTION_TOOLS;

const ids = (list) => list.map((f) => f.id).sort();

test('il caso del feedback: la sveglia raccontata e mai chiamata', () => {
  const testo = 'Ti ho messo una sveglia alle 19:00 per ognuna di quelle notti, così non te ne dimentichi.';
  const trovati = AD.rileva(testo, []);
  assert.deepEqual(ids(trovati), ['sveglia']);
  // La frase torna intera: al modello serve sapere cosa rimangiarsi, all'utente
  // cosa credeva fatto.
  assert.match(trovati[0].frase, /Ti ho messo una sveglia alle 19:00/);
  assert.ok(trovati[0].tipi.includes('SVEGLIA'));
});

test('con l\'azione nel turno non scatta niente', () => {
  // Lo stato è quello di FINE turno: la sveglia che l'azione ha appena
  // creato c'è già, ed è lei la prova (giro 5).
  const testo = 'Ti ho messo una sveglia alle 19:00, buonanotte!';
  assert.deepEqual(AD.rileva(testo, [{ type: 'SVEGLIA', time: '19:00' }], { orariSveglie: ['19:00'] }), []);
});

test('l\'ora nominata è la prova, non il fatto che una SVEGLIA sia partita', () => {
  // Giro 5. Filo ha messo la sveglia delle 7 e racconta di averne messa una
  // alle 19: l'azione c'è, la sveglia delle 19 no. Bastava un'azione di
  // quella specie, ovunque nella conversazione, perché nessuno dicesse niente.
  const stato = { orariSveglie: ['07:00'] };
  assert.deepEqual(ids(AD.rileva('Ti ho messo la sveglia alle 19:00 per stasera.', new Set(['SVEGLIA']), stato)), ['sveglia']);
  assert.deepEqual(ids(AD.rileva('Te l\'ho messa alle 19.', new Set(['SVEGLIA']), stato)), ['senza-nome']);
  // E due sveglie raccontate non le regge una sola: servono tutte e due.
  assert.deepEqual(
    ids(AD.rileva('Ti ho messo la sveglia alle 19 e quella alle 21.', [{ type: 'SVEGLIA' }], { orariSveglie: ['19:00'] })),
    ['sveglia'],
  );
  assert.deepEqual(
    AD.rileva('Ti ho messo la sveglia alle 19 e quella alle 21.', [{ type: 'SVEGLIA' }], { orariSveglie: ['19:00', '21:00'] }),
    [],
  );
  // Chi sposta o cancella resta fuori: dopo «te l'ho cancellata alle 19»
  // quell'ora NON deve esistere, e pretenderla sarebbe l'accusa al contrario.
  assert.deepEqual(AD.rileva('Te l\'ho cancellata alle 19.', [{ type: 'CANCELLA_SVEGLIA' }], { orariSveglie: [] }), []);
});

test('una parolina fra «ho» e il participio non nasconde la dichiarazione', () => {
  // Giro 5: «ti ho GIÀ messo la sveglia alle 19» è la risposta tipica di un
  // turno di prosecuzione, ed era muta.
  for (const frase of [
    'Ti ho già messo la sveglia alle 19.',
    'Ho appena impostato la sveglia alle 19:00.',
    'Ti ho anche messo la sveglia alle 19.',
  ]) assert.deepEqual(ids(AD.rileva(frase, [])), ['sveglia'], frase);
  assert.deepEqual(ids(AD.rileva('Ho già mandato la segnalazione agli sviluppatori.', [])), ['segnalazione']);
  assert.deepEqual(ids(AD.rileva('Te l\'ho già messa alle 19.', [])), ['senza-nome']);
  assert.deepEqual(ids(AD.rileva('Gliel\'ho messa alle 19.', [])), ['senza-nome']);
});

test('una dichiarazione chiusa da una domanda resta una dichiarazione', () => {
  // Giro 5: la virgola staccava la proposizione prima, non quella dopo, e
  // «va bene?» in coda zittiva tutto.
  assert.deepEqual(ids(AD.rileva('Ti ho messo la sveglia alle 19, va bene?', [])), ['sveglia']);
  assert.deepEqual(ids(AD.rileva('Ho mandato la segnalazione agli sviluppatori, ok?', [])), ['segnalazione']);
  // Una domanda vera resta una domanda.
  assert.deepEqual(AD.rileva('Ho aperto la pagina giusta?', []), []);
  assert.deepEqual(AD.rileva('Ho aperto la pagina giusta, o mi sono sbagliato?', []), []);
});

test('l\'ora si legge anche quando non è scritta con «alle»', () => {
  const stato = { orariSveglie: ['19:00', '07:30'] };
  for (const frase of [
    'Ti ho messo la sveglia per le 19.',
    'Ti ho messo la sveglia per le ore 19.',
    'La sveglia delle 19 te l\'ho messa ieri.',
    'Ti ho messo la sveglia alle 7 e mezza.',
    'Ti ho messo la sveglia alle sette e mezza.',
  ]) assert.deepEqual(AD.rileva(frase, new Set(), stato), [], frase);
  // Un'ora che non esiste resta una dichiarazione da verificare.
  assert.deepEqual(ids(AD.rileva('Ti ho messo la sveglia per le 22.', new Set(), stato)), ['sveglia']);
});

test('scatta anche quando l\'azione del turno è di un\'altra famiglia', () => {
  // Ha cercato sul web e poi ha DETTO di aver messo la sveglia: la ricerca non
  // regge la sveglia.
  const testo = 'Domani piove alle 18. Ti ho impostato la sveglia alle 19:00.';
  assert.deepEqual(ids(AD.rileva(testo, [{ type: 'CERCA_WEB' }])), ['sveglia']);
});

test('le altre famiglie: timer, appunto, apertura, comando, impostazione, segnalazione', () => {
  const casi = [
    ['Ho avviato il timer da dieci minuti.', 'timer', 'TIMER'],
    ['Ho salvato l\'appunto con la lista della spesa.', 'appunto', 'SALVA_APPUNTO'],
    ['Ho aperto la pagina di Wikipedia in una nuova scheda.', 'apertura', 'NAVIGA'],
    ['Ho eseguito il comando e non ha stampato niente.', 'comando', 'ESEGUI_COMANDO'],
    ['Ho messo il tema scuro come mi hai chiesto.', 'impostazione', 'IMPOSTA_PREFERENZA'],
    ['Ho inviato la segnalazione agli sviluppatori.', 'segnalazione', 'INVIA_FEEDBACK'],
    ['Ho tolto la sveglia della palestra.', 'sveglia-tolta', 'CANCELLA_SVEGLIA'],
    ['Ho spostato la sveglia delle 7 alle 8.', 'sveglia-spostata', 'MODIFICA_SVEGLIA'],
    ['Ho letto il documento: la giacenza media è 3.200 euro.', 'lettura', 'LEGGI_DOCUMENTO'],
    ['Ho cancellato la memoria come mi avevi chiesto.', 'memoria-cancellata', 'CANCELLA_MEMORIA'],
  ];
  for (const [testo, id, tipo] of casi) {
    const trovati = AD.rileva(testo, []);
    assert.ok(trovati.some((f) => f.id === id), `non riconosciuto: ${testo}`);
    // E con l'azione giusta nel turno tace.
    assert.ok(
      !AD.rileva(testo, [{ type: tipo }]).some((f) => f.id === id),
      `scatta anche con l'azione ${tipo}: ${testo}`,
    );
  }
});

test('una negazione non è una dichiarazione', () => {
  const frasi = [
    'Non ho messo nessuna sveglia: dimmi tu a che ora.',
    'Non sono riuscito a salvare l\'appunto, il file era bloccato.',
    'Non ho aperto niente perché non ho capito quale link intendevi.',
    'Non ho ancora eseguito il comando: vuoi che lo lanci?',
  ];
  for (const f of frasi) assert.deepEqual(AD.rileva(f, []), [], f);
});

test('una domanda o un\'ipotesi non è una dichiarazione', () => {
  const frasi = [
    'Ho aperto la pagina giusta?',
    'Se ho aperto la pagina sbagliata dimmelo.',
    'Vuoi che ti metta una sveglia alle 19:00?',
    'Posso mettere una sveglia alle 19:00, dimmi solo se la vuoi ripetuta.',
  ];
  for (const f of frasi) assert.deepEqual(AD.rileva(f, []), [], f);
});

test('una constatazione dello STATO non è una rivendicazione', () => {
  // I processi attivi arrivano al modello nello STATO: dirne uno non vuol dire
  // averlo appena creato, e un participio da solo non basta a far scattare
  // niente.
  const frasi = [
    'La sveglia delle 7 è già impostata, ne vuoi un\'altra?',
    'Hai due timer in corso: pasta e forno.',
    'La modalità terminale è disattivata: vuoi che la attivi?',
    'Ci sono tre schede aperte, due su Wikipedia e una su GitHub.',
  ];
  for (const f of frasi) assert.deepEqual(AD.rileva(f, []), [], f);
});

test('una risposta normale non fa scattare niente', () => {
  const frasi = [
    'Domani a Milano sono previsti 18 gradi e cielo coperto.',
    'Ti conviene partire prima delle 8 per evitare il traffico.',
    'Certo, dimmi pure a che ora la vuoi.',
    'Ho capito cosa intendi, ma il sito non è raggiungibile.',
  ];
  for (const f of frasi) assert.deepEqual(AD.rileva(f, []), [], f);
});

test('la cronologia regge una dichiarazione su un turno precedente', () => {
  const cronologia = [
    { role: 'user', text: 'sveglia alle 7' },
    { role: 'filo', text: 'Fatto.', actions: [{ type: 'SVEGLIA', time: '07:00' }] },
    { role: 'user', text: 'l\'hai messa davvero?' },
  ];
  const tipi = AD.tipiDallaCronologia(cronologia);
  assert.ok(tipi.has('SVEGLIA'));
  assert.deepEqual(AD.rileva('Sì, te l\'ho messa alle 7.', tipi, { orariSveglie: ['07:00'] }), []);
  // Ma una cronologia senza azioni non regge niente.
  assert.deepEqual(
    ids(AD.rileva('Sì, ti ho messo la sveglia alle 7.', AD.tipiDallaCronologia([{ role: 'filo', text: 'ciao' }]))),
    ['sveglia'],
  );
});

test('formatoSospetto riconosce la risposta in formato macchina, non la prosa', () => {
  assert.equal(AD.formatoSospetto('{"text": "Fatto", "actions": [{"type": "SVEGLIA"}]'), true);
  assert.equal(AD.formatoSospetto('```json\n{"actions": [{"type":"TIMER"}]}\n```'), true);
  assert.equal(AD.formatoSospetto('SVEGLIA {"time": "19:00"}'), true);
  assert.equal(AD.formatoSospetto('Fatto, sveglia alle 19:00.'), false);
  assert.equal(AD.formatoSospetto('Il JSON di risposta contiene "actions" tra i campi.'), false);
  assert.equal(AD.formatoSospetto(''), false);
});

test('la spinta al modello elenca le frasi e le tre uscite', () => {
  const fantasmi = AD.rileva('Ti ho messo una sveglia alle 19:00.', []);
  const spinta = AD.spintaAzioniMancanti(fantasmi);
  assert.match(spinta, /Ti ho messo una sveglia alle 19:00/);
  assert.match(spinta, /SVEGLIA/);
  assert.match(spinta, /turno PRECEDENTE/);
  assert.match(spinta, /non lo vede l'utente/);
});

test('l\'avviso per l\'utente dice cosa NON è successo', () => {
  const uno = AD.avvisoPerUtente(AD.rileva('Ti ho messo una sveglia alle 19:00.', []));
  assert.match(uno, /la sveglia non c'è/);
  assert.match(uno, /chiediglielo di nuovo/i);
  const due = AD.avvisoPerUtente([
    { avviso: 'la sveglia non c\'è' },
    { avviso: 'l\'appunto non c\'è' },
  ]);
  assert.match(due, /la sveglia non c'è e l'appunto non c'è/);
  assert.equal(AD.avvisoPerUtente([]), '');
});

test('sentinella: ogni tipo citato dalle famiglie è uno strumento vero (o un segno di contesto dichiarato)', () => {
  const veri = new Set(Tools.NAMES);
  const contesto = new Set(AD.TIPI_DI_CONTESTO);
  for (const c of contesto) {
    assert.ok(!veri.has(c), `${c} è dichiarato come segno di contesto ma è anche uno strumento vero: sceglierne uno`);
  }
  for (const fam of AD.FAMIGLIE) {
    for (const t of fam.tipi) {
      assert.ok(veri.has(t) || contesto.has(t),
        `la famiglia ${fam.id} cita ${t}, che non è né uno strumento del modello né un segno di contesto dichiarato`);
    }
  }
});

// Il presidio è fatto di espressioni regolari, e in JavaScript `\b` guarda solo
// l'alfabeto ASCII: dopo la à di «modalità» non c'è nessun confine di parola,
// quindi una regola scritta `modalità\b` non può fare match su NIENTE. Tre
// regole erano nate così — spente, verdi, e inutili — e nessuno poteva
// accorgersene leggendole. Questa sentinella lo impedisce per sempre.
test('sentinella: nessuna regola è nata spenta (accento subito prima di \\b)', () => {
  const sorgenti = [];
  for (const fam of AD.FAMIGLIE) for (const re of fam.frasi) sorgenti.push([fam.id, re.source]);
  for (const [id, src] of sorgenti) {
    assert.ok(!/[àèéìíòóùúÀÈÉÌÍÒÓÙÚ]\\b/.test(src),
      `la famiglia ${id} ha una regola con un accento subito prima di \\b: non potrà mai scattare`);
  }
  // E la prova che le tre regole rifatte scattano davvero.
  assert.deepEqual(ids(AD.rileva('Ho attivato la modalità scura.', [])), ['impostazione']);
  assert.deepEqual(
    ids(AD.rileva('Non ho trovato l\'evento però ti ho messo una sveglia alle 19.', [])),
    ids(AD.rileva('Non ho trovato l\'evento ma ti ho messo una sveglia alle 19.', [])),
  );
});

// La conferma col PRONOME: quando la cosa l'ha appena nominata l'utente, in
// italiano si risponde «l'ho messa alle 19». Era la forma più probabile subito
// dopo la richiesta, ed era anche l'unica che passava intera.
test('la conferma col pronome viene vista, e tace appena un\'azione c\'è', () => {
  for (const frase of [
    'L\'ho messa alle 19.',
    'Te l\'ho messa alle 19, buonanotte.',
    'Le ho impostate tutte e tre.',
    'Te l’ho messa alle 19.',
  ]) {
    assert.deepEqual(ids(AD.rileva(frase, [])), ['senza-nome'], frase);
    assert.deepEqual(
      AD.rileva(frase, [{ type: 'SVEGLIA' }], { orariSveglie: ['19:00'] }),
      [], `${frase} (con l'azione nel turno e la sveglia che ne è nata)`,
    );
  }
  // Una famiglia che sa dire DI COSA si tratta vince: niente doppio avviso.
  assert.deepEqual(ids(AD.rileva('L\'ho aggiunta al calendario.', [])), ['calendario']);
  assert.deepEqual(ids(AD.rileva('Fatto! L\'ho salvata fra gli appunti.', [])), ['appunto']);
});

// L'avviso che accusa Filo di non aver fatto una cosa che HA fatto è il modo
// più rapido di rendere il presidio inutile: lo si smette di leggere.
test('niente falsi allarmi su quello che Filo fa per altre strade', () => {
  // Un programma o una cartella si aprono con un comando di shell.
  assert.deepEqual(AD.rileva('Ho aperto il blocco note.', [{ type: 'ESEGUI_COMANDO' }]), []);
  // I riassunti dei file dell'editor sono già in contesto a ogni turno.
  assert.deepEqual(AD.rileva('Ho letto il file bolletta.pdf: sono 84 euro.', [{ type: 'CONTESTO_FILE' }]), []);
  // Quello che Filo impara lo scrive in memoria un passaggio che parte da solo
  // dopo il turno: «l'ho memorizzato» è vero, e non ha più una famiglia.
  assert.deepEqual(AD.rileva('L\'ho memorizzato: preferisci le risposte brevi.', []), []);
  assert.deepEqual(AD.rileva('D\'ora in poi me lo ricorderò.', []), []);
});

// «Scrive la risposta buona come preambolo e chiude con un oggetto»: la metà
// del guasto che passava intera, perché si guardava solo l'inizio del testo.
test('il formato macchina si riconosce anche in coda alla risposta', () => {
  assert.equal(AD.formatoSospetto('Ti metto la sveglia alle 19.\n\nSVEGLIA{"time":"19:00"}'), true);
  assert.equal(AD.formatoSospetto('Ecco fatto.\n\n{}'), true);
  assert.equal(AD.formatoSospetto('[{"type":"SVEGLIA","time":"19:00"}]'), true);
  assert.equal(AD.formatoSospetto('Ecco.\n\n{"text":"","actions":[]}'), true);
  // Un esempio dentro un blocco recintato è una risposta, non un guasto.
  assert.equal(AD.formatoSospetto('Un esempio:\n\n```json\n{"text":"x","actions":[]}\n```\n\nChiaro?'), false);
  // E una parola maiuscola con una parentesi dietro non è una chiamata.
  assert.equal(AD.formatoSospetto('Ho scritto TODO{ sistemare } nel file.'), false);
  assert.equal(AD.formatoSospetto('Poi ho messo NOTA{da rivedere} in fondo.'), false);
});

// Giro 2 della verifica. Tutto quello che segue nasce dalla stessa domanda:
// cosa vale come prova che la cosa è stata fatta davvero.

test('un\'azione chiamata che non ha fatto nascere niente non copre la frase', () => {
  // La sveglia viene chiesta con un orario che Filo non sa leggere: lo
  // strumento parte, nessuna sveglia nasce, e il modello la dà per fatta.
  // Prima bastava che il tipo comparisse nel turno perché il presidio tacesse.
  const testo = 'Ti ho messo una sveglia alle 19:00 per stasera.';
  const fallita = [{ type: 'SVEGLIA', _executed: false }];
  assert.deepEqual(ids(AD.rileva(testo, fallita)), ['sveglia']);
  // Ma un'azione che ha prodotto qualcosa resta buona: una ricerca senza
  // risultati è comunque partita, e il comando che esce con un errore ha
  // stampato il suo output.
  assert.deepEqual(AD.rileva(testo, [{ type: 'SVEGLIA', _executed: true }], { orariSveglie: ['19:00'] }), []);
  assert.deepEqual(
    AD.rileva('Ho cercato sul web ma non ho trovato niente.', [{ type: 'CERCA_WEB', _executed: false, _output: { results: [] } }]),
    [],
  );
  // E un'azione in attesa dell'OK dell'utente si vede in chat: non è muta.
  assert.deepEqual(AD.rileva(testo, [{ type: 'SVEGLIA', _executed: false, _confirm: { level: 2 } }]), []);
});

test('un\'azione di una specie non copre le altre', () => {
  // La sveglia parte, l'appunto no, e stanno nella stessa frase.
  assert.deepEqual(
    ids(AD.rileva('Ti ho messo la sveglia alle 19 e ti ho salvato l\'appunto con la lista della spesa.', [{ type: 'SVEGLIA' }], { orariSveglie: ['19:00'] })),
    ['appunto'],
  );
  assert.deepEqual(
    ids(AD.rileva('Ho messo la sveglia e te l\'ho segnata anche in calendario.', [{ type: 'SVEGLIA' }])),
    ['calendario'],
  );
  // «Promemoria» invece in italiano è tutto: appunto, evento, sveglia. Lì i
  // tipi restano larghi, altrimenti l'avviso sbaglierebbe.
  assert.deepEqual(AD.rileva('Ho messo il promemoria per domani.', [{ type: 'SVEGLIA' }]), []);
  assert.deepEqual(ids(AD.rileva('Ho messo il promemoria per domani.', [])), ['promemoria']);
});

test('un\'azione sola non regge due dichiarazioni diverse', () => {
  // La sveglia parte; della spesa, dichiarata col pronome, non resta niente.
  assert.deepEqual(
    ids(AD.rileva('Ho messo la sveglia alle 19, e te l\'ho segnata.', [{ type: 'SVEGLIA' }], { orariSveglie: ['19:00'] })),
    ['senza-nome'],
  );
  // Ma lo stesso fatto detto due volte resta un fatto solo: stesso verbo,
  // nessun avviso.
  assert.deepEqual(
    AD.rileva('Ho messo la sveglia alle 19. Te l\'ho messa per tutte e tre le notti.', [{ type: 'SVEGLIA' }], { orariSveglie: ['19:00'] }),
    [],
  );
});

test('quello che Filo consegna DENTRO la risposta non è un\'azione mancata', () => {
  // L'utente chiede una mail: la mail è la risposta, e non esiste nessuno
  // strumento che possa averla scritta.
  for (const frase of [
    'Te l\'ho scritta qui sotto:\n\nGentile Marco, mi scuso per il ritardo.',
    'L\'ho creata qui sotto, dimmi se ti piace.',
    'Te l\'ho aggiunta alla lista qui sopra.',
    'L\'ho scritta io, dimmi se va bene.',
  ]) {
    assert.deepEqual(AD.rileva(frase, []), [], frase);
  }
});

test('un\'immagine mandata in chat si legge senza strumenti', () => {
  const frase = 'Ho letto la bolletta: sono 84 euro, scadenza il 12.';
  assert.deepEqual(AD.rileva(frase, [{ type: 'CONTESTO_IMMAGINE' }]), []);
  // Senza l'immagine e senza azioni, la stessa frase resta una dichiarazione.
  assert.deepEqual(ids(AD.rileva(frase, [])), ['lettura']);
});

test('una sveglia che ESISTE regge la frase che la racconta', () => {
  // Messa ieri, in un'altra sessione: in questa conversazione non c'è nessuna
  // azione, e senza guardare le sveglie vere l'avviso diventava un'accusa.
  const stato = { orariSveglie: ['19:00'] };
  assert.deepEqual(AD.rileva('Sì, ho messo la sveglia alle 19:00 come mi avevi chiesto.', [], stato), []);
  assert.deepEqual(AD.rileva('Sì, ti ho messo la sveglia alle 19.', [], stato), []);
  // Una sveglia a un'altra ora non copre niente: è il caso del feedback.
  assert.deepEqual(
    ids(AD.rileva('Ti ho messo una sveglia alle 7:00.', [], stato)),
    ['sveglia'],
  );
  assert.deepEqual(ids(AD.rileva('Ti ho messo una sveglia alle 19:00.', [], { orariSveglie: [] })), ['sveglia']);
});

test('gli orari si leggono come li scrive il modello', () => {
  assert.deepEqual([...AD.orariNelTesto('alle 19:00 e alle 7.30')].sort(), ['07:30', '19:00']);
  assert.deepEqual([...AD.orariNelTesto('te la metto alle 19')], ['19:00']);
  assert.deepEqual([...AD.orariNelTesto('nessun orario qui')], []);
});

test('spazi doppi e a capo non spengono il presidio', () => {
  assert.deepEqual(ids(AD.rileva('Ho  messo  la  sveglia alle 19.', [])), ['sveglia']);
  assert.deepEqual(ids(AD.rileva('Ti ho messo\nuna sveglia alle 19.', [])), ['sveglia']);
  assert.deepEqual(ids(AD.rileva('Ho messo il promemoria per domani.', [])), ['promemoria']);
});

test('un esempio di formato annunciato come tale non è un turno buttato', () => {
  assert.equal(AD.formatoSospetto('Ecco un esempio:\n{"type":"SVEGLIA","time":"19:00"}'), false);
  assert.equal(AD.formatoSospetto('Com\'è fatta un\'azione:\n{"type":"TIMER","seconds":60}'), false);
  // Ma una risposta che finisce col formato interno senza annunciarlo resta un
  // turno buttato: è il caso del feedback.
  assert.equal(AD.formatoSospetto('Ecco il riassunto.\n\n{"text":"","actions":[]}'), true);
  assert.equal(AD.formatoSospetto('Ti metto la sveglia alle 19.\n\nSVEGLIA{"time":"19:00"}'), true);
});

test('input limite: vuoto, spazi, testo lunghissimo, caratteri strani', () => {
  assert.deepEqual(AD.rileva('', []), []);
  assert.deepEqual(AD.rileva('   \n\t  ', []), []);
  assert.deepEqual(AD.rileva(null, []), []);
  const lungo = `${'blah blah '.repeat(3000)}Ti ho messo una sveglia alle 19:00.`;
  const t0 = Date.now();
  assert.deepEqual(ids(AD.rileva(lungo, [])), ['sveglia']);
  assert.ok(Date.now() - t0 < 1000, 'troppo lento su un testo lungo');
  assert.deepEqual(AD.rileva('¡™£¢ 😀 <<<ROBA>>> ho messo', []), []);
});

// ── Giro 3 della verifica: cosa vale come prova, ancora ──────────────────────
//
// Le guardie qui sotto tengono chiuse le porte del terzo giro. Tutte sulla
// stessa domanda: la prova che una cosa è stata fatta davvero.

test('un\'azione che mette un bottone in chat è comunque un\'azione fatta', () => {
  // L'evento di calendario, la pulizia delle schede e la cancellazione
  // dell'archivio non si eseguono da sole: il main le TIENE e in chat compare
  // il bottone che preme l'utente. Contarle come «mai chiamate» faceva buttare
  // la risposta, rifarla, e poi smentire Filo per una cosa che aveva fatto.
  const bottone = (type) => [{ type, _executed: false, _kept: true }];
  assert.deepEqual(AD.rileva('Ti ho aggiunto l\'evento in calendario per domani alle 10.', bottone('EVENTO_CALENDARIO')), []);
  assert.deepEqual(AD.rileva('Te l\'ho aggiunta al calendario.', bottone('EVENTO_CALENDARIO')), []);
  assert.deepEqual(AD.rileva('Ho chiuso le schede che non usavi.', bottone('PULISCI_TAB')), []);
  assert.deepEqual(AD.rileva('Ho cancellato la cronologia.', bottone('CANCELLA_ARCHIVIO')), []);
  // E la porta del giro 2 resta chiusa: una sveglia CHIAMATA e non riuscita
  // non tiene niente in chat, e non copre la frase che la dà per fatta.
  assert.deepEqual(ids(AD.rileva('Ti ho messo una sveglia alle 19:00.',
    [{ type: 'SVEGLIA', _executed: false, _kept: false }])), ['sveglia']);
});

test('un\'azione che si limita a guardare non copre la conferma col pronome', () => {
  // Il turno di prosecuzione della segnalazione: «dopo un comando, una lettura,
  // una ricerca». Bastava una ricerca perché il pronome non venisse più
  // guardato, e la sveglia raccontata tornava muta come prima.
  assert.deepEqual(ids(AD.rileva('Ho guardato il meteo: stasera piove. Te l\'ho messa alle 19.',
    [{ type: 'CERCA_WEB', _output: { results: [] } }])), ['senza-nome']);
  // Peggio: bastava avere un file aperto nell'editor. Quel segno arriva a OGNI
  // turno, quindi il presidio funzionava solo su un Filo vuoto.
  for (const segno of AD.TIPI_DI_CONTESTO) {
    assert.deepEqual(ids(AD.rileva('Te l\'ho messa alle 19.', [{ type: segno }])), ['senza-nome'],
      `il segno di contesto ${segno} non può reggere una conferma col pronome`);
  }
  // I tipi di sola lettura sono dichiarati, non indovinati: la sentinella
  // pretende che siano strumenti veri.
  const veri = new Set(Tools.NAMES);
  for (const t of AD.TIPI_DI_SOLA_LETTURA) {
    assert.ok(veri.has(t), `${t} è dichiarato di sola lettura ma non è uno strumento del modello`);
  }
});

test('quello che esiste già regge la frase che lo racconta, comunque sia detta', () => {
  const sveglia = { orariSveglie: ['19:00'] };
  // La forma lunga (chiusa nel giro 2) e le forme che restavano un'accusa.
  assert.deepEqual(AD.rileva('Sì, ho messo la sveglia alle 19:00 come mi avevi chiesto.', [], sveglia), []);
  assert.deepEqual(AD.rileva('Sì, te l\'ho messa alle 19:00 come mi avevi chiesto.', [], sveglia), []);
  assert.deepEqual(AD.rileva('L\'ho messa alle 19.', [], sveglia), []);
  assert.deepEqual(AD.rileva('Ti ho messo il promemoria per le 19:00.', [], sveglia), []);
  // L'ora si dice anche a lettere, e «alle 7 di sera» sono le 19.
  assert.deepEqual(AD.rileva('Ho messo la sveglia alle sette.', [], { orariSveglie: ['07:00'] }), []);
  assert.deepEqual(AD.rileva('Ho messo la sveglia alle 7 di sera.', [], sveglia), []);
  // Un appunto che esiste, nominato per titolo, regge la frase che lo racconta.
  assert.deepEqual(AD.rileva('Sì, l\'ho salvato fra gli appunti: si chiama Lista della spesa.',
    [], { titoliAppunti: ['Lista della spesa'] }), []);
  // Ma senza niente che la regga la dichiarazione resta una dichiarazione.
  assert.deepEqual(ids(AD.rileva('Ti ho messo la sveglia alle 19:00.', [], { orariSveglie: ['07:00'] })), ['sveglia']);
});

test('l\'ora a lettere e il pomeriggio si leggono come li scrive il modello', () => {
  assert.deepEqual([...AD.orariNelTesto('alle sette')], ['07:00']);
  assert.deepEqual([...AD.orariNelTesto('alle 7 di sera')], ['19:00']);
  assert.deepEqual([...AD.orariNelTesto('alle 7 di mattina')], ['07:00']);
  assert.deepEqual([...AD.orariNelTesto('a mezzogiorno')], ['12:00']);
  assert.deepEqual([...AD.orariNelTesto('a mezzanotte')], ['00:00']);
});

test('il formato interno si riconosce anche nelle forme dei modelli aperti', () => {
  assert.equal(AD.formatoSospetto('Ti metto la sveglia.\n<tool_call>{"name":"SVEGLIA","arguments":{"time":"19:00"}}</tool_call>'), true);
  assert.equal(AD.formatoSospetto('Ti metto la sveglia.\nfunctions.SVEGLIA({"time":"19:00"})'), true);
  // Ma un pezzo di HTML dentro una risposta non è una chiamata.
  assert.equal(AD.formatoSospetto('Ecco il codice che mi hai chiesto.\n<div class="box">ciao</div>'), false);
});

test('le parole con cui si dichiara restano riconosciute anche nelle varianti', () => {
  assert.deepEqual(ids(AD.rileva('Ti ho messo l\'allarme alle 19.', [])), ['sveglia']);
  assert.deepEqual(ids(AD.rileva('Ho segnato la spesa fra gli appunti.', [])), ['appunto']);
});

// ── Giro 4 della verifica ────────────────────────────────────────────────────

test('il formato interno vale anche dentro i tre apici e sulla riga della prosa', () => {
  // La risposta buona come preambolo e sotto la chiamata: senza recinto era
  // già riconosciuta, con il recinto passava intera. Un modello abituato a
  // recintare i blocchi di codice ci mette dentro anche la chiamata.
  assert.equal(AD.formatoSospetto('Fatto! Ecco:\n[{"type":"SVEGLIA","time":"19:00"}]'), true);
  assert.equal(AD.formatoSospetto('Fatto! Ecco:\n```json\n[{"type":"SVEGLIA","time":"19:00"}]\n```'), true);
  assert.equal(AD.formatoSospetto('Ti metto la sveglia.\n```json\n{"text":"ok","actions":[{"type":"SVEGLIA"}]}\n```'), true);
  // Sulla stessa riga della prosa è lo stesso turno buttato.
  assert.equal(AD.formatoSospetto('Ok. <tool_call>{"name":"SVEGLIA","arguments":{}}</tool_call>'), true);
  // Le altre due buste dei modelli aperti.
  assert.equal(AD.formatoSospetto('[TOOL_CALLS][{"name":"SVEGLIA","arguments":{"ora":"19:00"}}]'), true);
  assert.equal(AD.formatoSospetto('Ok.\n<|tool_call|>{"name":"SVEGLIA"}'), true);
});

test('un esempio annunciato non è un turno buttato, neanche recintato', () => {
  assert.equal(AD.formatoSospetto('Ecco un esempio di come si scrive:\n```json\n{"type":"SVEGLIA"}\n```'), false);
  assert.equal(AD.formatoSospetto('Il formato è questo:\n```json\n{"type":"SVEGLIA"}\n```'), false);
  // E un JSON qualunque chiesto dall'utente non è una chiamata: il nome dentro
  // «type» si confronta con gli strumenti veri.
  assert.equal(AD.formatoSospetto('Eccolo:\n```json\n{"type":"utente","nome":"Marco"}\n```'), false);
});

test('una congiunzione non conta come negazione', () => {
  // «invece», «prima» e «appena» raccontano QUANDO, non che non è successo.
  assert.deepEqual(ids(AD.rileva('Non ho trovato l\'evento, invece ti ho messo la sveglia alle 19.', [])), ['sveglia']);
  assert.deepEqual(ids(AD.rileva('Prima ti ho messo la sveglia alle 19, poi ti dico il resto.', [])), ['sveglia']);
  assert.deepEqual(ids(AD.rileva('Appena ho potuto ti ho messo la sveglia alle 19.', [])), ['sveglia']);
  // L'ipotesi vera resta fuori.
  assert.deepEqual(AD.rileva('Se ho aperto la pagina sbagliata dimmelo.', []), []);
  assert.deepEqual(AD.rileva('Non ho messo nessuna sveglia.', []), []);
});

test('il testo consegnato nella risposta non è un\'azione mancata', () => {
  // L'utente fa riordinare una lista che sta in chat: la lista è la risposta,
  // non esiste nessuno strumento che la mette in ordine alfabetico.
  assert.deepEqual(AD.rileva('Te l\'ho messa in ordine alfabetico.', []), []);
  assert.deepEqual(AD.rileva('Te l\'ho aggiunta alla lista.', []), []);
  // La conferma che parla di un'ora resta una dichiarazione da verificare.
  assert.deepEqual(ids(AD.rileva('Te l\'ho messa alle 19.', [])), ['senza-nome']);
});

test('una cosa dichiarata accanto a una fatta davvero non sparisce', () => {
  const sveglia = [{ type: 'SVEGLIA', _executed: true }];
  assert.deepEqual(ids(AD.rileva('Ti ho messo la sveglia alle 19 e ti ho segnato la spesa.', sveglia, { orariSveglie: ['19:00'] })), ['appunto']);
  // «Segnare» in calendario è un'altra cosa, e ha la sua famiglia.
  assert.deepEqual(ids(AD.rileva('Ti ho segnato l\'evento in calendario per domani.', [])), ['calendario']);
});

test('un appunto che esiste non prova un promemoria a un\'ora che non esiste', () => {
  const conAppunto = { orariSveglie: [], titoliAppunti: ['spesa'] };
  // Il titolo regge la frase che lo nomina…
  assert.deepEqual(AD.rileva('L\'ho salvato fra gli appunti della spesa.', [], conAppunto), []);
  // …ma non una frase che promette un'ora: un'ora è una sveglia.
  assert.deepEqual(ids(AD.rileva('Ti ho messo il promemoria per la spesa alle 18.', [], conAppunto)), ['promemoria']);
});

// ── Giro 6 ────────────────────────────────────────────────────────────────

test('l\'ora si scrive anche col punto, con la virgola e coi minuti a parole', () => {
  // La sveglia delle 19:30 c'è: la frase che la racconta è vera, comunque sia
  // scritta l'ora. Prima il pezzo di frase veniva tagliato al primo punto,
  // che è uno dei segni con cui in italiano si scrive un orario, e Filo
  // veniva smentito su una sveglia che aveva appena messo.
  const alle1930 = { orariSveglie: ['19:30'] };
  assert.deepEqual(AD.rileva('Ho messo la sveglia alle 19.30 per stasera.', [], alle1930), []);
  assert.deepEqual(AD.rileva('Ho messo la sveglia alle 19,30.', [], alle1930), []);
  assert.deepEqual(AD.rileva('Ho messo la sveglia alle 19 e trenta.', [], alle1930), []);
  assert.deepEqual(AD.rileva('Te l\'ho messa alle 8.15.', [], { orariSveglie: ['08:15'] }), []);
  assert.ok(AD.orariNelTesto('alle 19.30.').has('19:30'));
  // E la frase che l'utente legge non si ferma a metà dell'ora.
  const [f] = AD.rileva('Ho messo la sveglia alle 19.30.', [], { orariSveglie: [] });
  assert.match(f.frase, /19\.30/);
  // L'ora sbagliata resta un avviso.
  assert.deepEqual(ids(AD.rileva('Ho messo la sveglia alle 19.30.', [], { orariSveglie: ['07:00'] })), ['sveglia']);
});

test('senza l\'elenco delle sveglie l\'ora non decide niente', () => {
  // «Non lo so» non è «non ce n'è nessuna». L'Aiuto, che di Filo vede solo la
  // pagina, chiamava il presidio senza stato: ogni frase con un'ora veniva
  // smentita, anche quella che raccontava la sveglia appena messa da lì.
  const aiuto = { famiglie: AD.FAMIGLIE_AIUTO };
  assert.deepEqual(AD.rileva('Sì, ho messo la sveglia alle 19:00 come mi avevi chiesto.', new Set(['SVEGLIA']), {}, aiuto), []);
  assert.deepEqual(AD.rileva('Ho avviato il timer alle 19.', new Set(['TIMER']), {}, aiuto), []);
  // Senza nessuna azione la dichiarazione resta scoperta: il presidio non si
  // spegne, torna solo a guardare le azioni.
  assert.deepEqual(ids(AD.rileva('Ti ho messo una sveglia alle 19:00.', new Set(), {}, aiuto)), ['sveglia']);
});

test('una cosa fatta prima nella conversazione non copre quelle raccontate dopo', () => {
  const crono = (t) => AD.tipiDallaCronologia([{ role: 'filo', actions: [{ type: t, _executed: true }] }]);
  // Un appunto scritto all'inizio non prova l'appunto raccontato adesso…
  assert.deepEqual(ids(AD.rileva('Ti ho salvato l\'appunto con la lista della spesa.', crono('SALVA_APPUNTO'))), ['appunto']);
  assert.deepEqual(ids(AD.rileva('Ti ho aggiunto l\'evento in calendario per domani.', crono('EVENTO_CALENDARIO'))), ['calendario']);
  assert.deepEqual(ids(AD.rileva('Ho mandato la segnalazione agli sviluppatori.', crono('INVIA_FEEDBACK'))), ['segnalazione']);
  assert.deepEqual(ids(AD.rileva('Ho aperto il blocco note.', crono('ESEGUI_COMANDO'))), ['apertura']);
  // …ma la CONFERMA di una cosa fatta prima resta vera: è per questo che la
  // cronologia conta.
  assert.deepEqual(AD.rileva('Sì, te l\'ho già salvato negli appunti.', crono('SALVA_APPUNTO')), []);
  assert.deepEqual(AD.rileva('Come ti dicevo, ho mandato la segnalazione agli sviluppatori.', crono('INVIA_FEEDBACK')), []);
  // E se l'utente sta facendo una domanda, la risposta guarda indietro da sé.
  assert.deepEqual(AD.rileva('Ho mandato la segnalazione agli sviluppatori.', crono('INVIA_FEEDBACK'), { domandaUtente: true }), []);
});

test('due cose della stessa specie vogliono due azioni', () => {
  const unAppunto = [{ type: 'SALVA_APPUNTO', _executed: true }];
  assert.deepEqual(
    ids(AD.rileva('Ti ho salvato l\'appunto della spesa e ti ho segnato anche quello del lavoro.', unAppunto, {})),
    ['appunto'],
  );
  // Con due scritture partite davvero non resta niente da dire.
  assert.deepEqual(AD.rileva(
    'Ti ho salvato l\'appunto della spesa e ti ho segnato anche quello del lavoro.',
    [{ type: 'SALVA_APPUNTO', _executed: true }, { type: 'SALVA_APPUNTO', _executed: true }],
    { contiAzioni: { SALVA_APPUNTO: 2 } },
  ), []);
  // E l'utente non legge due volte la stessa riga.
  assert.equal(
    (AD.avvisoPerUtente([{ avviso: 'l\'appunto non c\'è' }, { avviso: 'l\'appunto non c\'è' }]).match(/appunto/g) || []).length,
    1,
  );
});

test('altri modi normali di dichiarare una cosa mai fatta', () => {
  assert.deepEqual(ids(AD.rileva('Ho fissato l\'appuntamento in calendario per domani.', [])), ['calendario']);
  assert.deepEqual(ids(AD.rileva('Ho aggiunto la riunione al calendario di domani.', [])), ['calendario']);
  assert.deepEqual(ids(AD.rileva('Ho inoltrato la segnalazione agli sviluppatori.', [])), ['segnalazione']);
  assert.deepEqual(ids(AD.rileva('Ho provveduto a metterti la sveglia alle 19.', [])), ['sveglia']);
  assert.deepEqual(ids(AD.rileva('Sono riuscito a metterti la sveglia alle 19.', [])), ['sveglia']);
  assert.deepEqual(ids(AD.rileva('Ti avevo messo la sveglia alle 19.', [])), ['sveglia']);
  assert.deepEqual(ids(AD.rileva('Te l\'avevo messa alle 19.', [])), ['senza-nome']);
  // Il grassetto di Markdown intorno al verbo, e l'apostrofo al posto
  // dell'accento: i modelli scrivono così di continuo.
  assert.deepEqual(ids(AD.rileva('Ti ho **messo** la sveglia alle 19.', [])), ['sveglia']);
  assert.deepEqual(ids(AD.rileva('Ti ho gia\' messo la sveglia alle 19.', [])), ['sveglia']);
});

test('la chiamata a funzione con «name» e «arguments» è formato interno', () => {
  assert.equal(AD.formatoSospetto('{"name":"SVEGLIA","arguments":{"time":"19:00"}}'), true);
  assert.equal(AD.formatoSospetto('Fatto!\n{"name":"SVEGLIA","arguments":{"time":"19:00"}}'), true);
  // Un JSON qualunque, chiesto dall'utente, resta una risposta.
  assert.equal(AD.formatoSospetto('{"nome":"Mario","eta":30}'), false);
  assert.equal(AD.formatoSospetto('{"name":"Mario","arguments":{"x":1}}'), false);
});

// ── Giro 7 ─────────────────────────────────────────────────────────────────

test('la conferma scritta senza «ho» è una dichiarazione come le altre', () => {
  // È il modo più corto con cui un modello conferma, e non scattava.
  assert.deepEqual(ids(AD.rileva('Sveglia impostata per le 19.', [])), ['sveglia']);
  assert.deepEqual(ids(AD.rileva('Appunto salvato.', [])), ['appunto']);
  assert.deepEqual(ids(AD.rileva('Evento aggiunto al calendario.', [])), ['calendario']);
  assert.deepEqual(ids(AD.rileva('La segnalazione è partita.', [])), ['segnalazione']);
  assert.deepEqual(ids(AD.rileva('Timer avviato.', [])), ['timer']);
  // …ma una constatazione dello stato resta una constatazione: lì il tempo
  // non lo dice il verbo, lo dice la parolina che guarda indietro.
  assert.deepEqual(AD.rileva('La sveglia delle 7 è già impostata, ne vuoi un\'altra?', []), []);
  // E se la sveglia c'è davvero, l'ora la regge.
  assert.deepEqual(AD.rileva('Sveglia impostata per le 19.', [], { orariSveglie: ['19:00'] }), []);
});

test('l\'avviso non accusa Filo di cose che ha fatto o che non gli costano un\'azione', () => {
  // Il testo INCOLLATO nel messaggio arriva al modello senza strumenti,
  // esattamente come la foto e i riassunti dei file dell'editor.
  assert.ok(AD.TIPI_DI_CONTESTO.includes('CONTESTO_TESTO'));
  assert.deepEqual(AD.rileva('Ho letto il documento: sono 84 euro.', new Set(['CONTESTO_TESTO'])), []);
  // Quello che Filo impara lo scrive in memoria da solo dopo il turno.
  assert.deepEqual(AD.rileva('Me lo sono segnato per la prossima volta.', []), []);
  // Modi di dire: non promettono nessun appunto e nessuna finestra aperta.
  assert.deepEqual(AD.rileva('Ti ho salvato un po\' di tempo.', []), []);
  assert.deepEqual(AD.rileva('Ti ho aperto gli occhi su una cosa.', []), []);
});

test('«l\'hai già fatto?» non è «me lo fai?»', () => {
  // Solo una domanda sul passato lascia che un\'azione di un turno prima
  // regga la risposta che la racconta. Prima bastava un punto interrogativo,
  // e in italiano una richiesta si scrive quasi sempre così.
  assert.equal(AD.domandaSuCosaFatta('mi segni anche la lista della spesa?'), false);
  assert.equal(AD.domandaSuCosaFatta('me la metti la sveglia alle 19?'), false);
  assert.equal(AD.domandaSuCosaFatta('hai salvato la lista della spesa?'), true);
  assert.equal(AD.domandaSuCosaFatta('l\'hai mandata?'), true);
  assert.equal(AD.domandaSuCosaFatta('la segnalazione è stata mandata?'), true);
  assert.equal(AD.domandaSuCosaFatta('hai salvato la lista'), false);
  // Conseguenza: con la richiesta, l'appunto scritto prima non copre quello
  // raccontato adesso.
  const prima = { tipiPrecedenti: new Set(['SALVA_APPUNTO']) };
  assert.deepEqual(ids(AD.rileva('Ti ho salvato l\'appunto con la lista della spesa.', [],
    { ...prima, domandaUtente: false })), ['appunto']);
});

test('lo stato del presidio: niente sveglie in pausa, niente già suonate, coi giorni', () => {
  const fra2h = new Date(Date.now() + 2 * 3600 * 1000);
  const prove = AD.statoDaTimerEFile([
    { kind: 'alarm', endsAt: fra2h.toISOString() },
    { kind: 'alarm', endsAt: fra2h.toISOString(), paused: true },
    { kind: 'alarm', endsAt: new Date(Date.now() - 3600 * 1000).toISOString(), ringing: true },
    { kind: 'alarm', repeat: ['lun'], atTime: '06:30' },
  ], [{ title: 'lista della spesa' }, { title: 'appunti di lavoro' }]);
  assert.equal(prove.sveglie.filter((s) => s.tipo === 'alarm').length, 2);
  assert.deepEqual(prove.titoliAppunti, ['lista della spesa', 'appunti di lavoro']);
  // Una sveglia che si ripete vale per qualunque giorno.
  assert.equal(prove.sveglie.find((s) => s.ora === '06:30').giorno, '');
});

test('la prova di una sveglia guarda il genere e il giorno, non la sola ora', () => {
  const oggi = Date.now();
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const soloOggi = { sveglie: [{ ora: '07:00', giorno: iso(new Date(oggi)), tipo: 'alarm' }], oggi };
  assert.deepEqual(ids(AD.rileva('Ti ho messo la sveglia alle 7 per domani.', [], soloOggi)), ['sveglia']);
  assert.deepEqual(AD.rileva('Ti ho messo la sveglia alle 7 per stamattina.', [], soloOggi), []);
  // Un conto alla rovescia che finisce alle 19 non è la sveglia delle 19.
  const soloTimer = { sveglie: [{ ora: '19:00', giorno: iso(new Date(oggi)), tipo: 'timer' }], oggi };
  assert.deepEqual(ids(AD.rileva('Ti ho messo la sveglia alle 19.', [], soloTimer)), ['sveglia']);
});

test('nell\'Aiuto la conferma col pronome viene guardata come nella chat della home', () => {
  assert.ok(AD.FAMIGLIE_AIUTO.includes('senza-nome'));
  const aiuto = { famiglie: AD.FAMIGLIE_AIUTO };
  assert.deepEqual(ids(AD.rileva('Sì, te l\'ho mandata.', new Set(), {}, aiuto)), ['senza-nome']);
});

test('le altre due buste con cui un modello scrive una chiamata invece di farla', () => {
  // La LISTA di chiamate: è come un modello ne dichiara più di una insieme.
  assert.equal(AD.formatoSospetto('[{"name":"SVEGLIA","arguments":{"time":"19:00"}}]'), true);
  // La busta dei Llama, che il nome se lo tiene dentro il tag.
  assert.equal(AD.formatoSospetto('<function=SVEGLIA>{"time":"19:00"}</function>'), true);
  assert.equal(AD.formatoSospetto('Fatto.\n<function=SVEGLIA>{"time":"19:00"}</function>'), true);
  // E una lista qualunque, chiesta dall'utente, resta una risposta.
  assert.equal(AD.formatoSospetto('[{"name":"Mario","arguments":{"x":1}}]'), false);
  assert.equal(AD.formatoSospetto('La funzione f(x) = 2x è lineare.'), false);
});

// ─── giro 8 ──────────────────────────────────────────────────────────────────

test('un documento che Filo ha già davanti non si «apre»: non c\'è niente da smentire', () => {
  // Il giro 2 e il giro 7 hanno stabilito che una foto mandata in chat, un
  // testo incollato nel messaggio e i file dell'editor arrivano al modello
  // senza nessuno strumento. Detto con «ho letto» era già vero; detto con «ho
  // aperto», che è la parola più comune, la risposta veniva buttata, rifatta
  // con un'altra chiamata al modello e poi smentita.
  assert.deepEqual(AD.rileva('Ho aperto la bolletta che mi hai mandato: sono 84 euro.',
    new Set(['CONTESTO_IMMAGINE'])), []);
  assert.deepEqual(AD.rileva('Ho aperto il contratto che hai incollato: la penale è del 5%.',
    new Set(['CONTESTO_TESTO'])), []);
  assert.deepEqual(AD.rileva('Ho aperto il tuo appunto della spesa: dice pane, uova e latte.',
    new Set(['CONTESTO_FILE'])), []);
  // Senza niente davanti resta una dichiarazione da verificare…
  assert.deepEqual(ids(AD.rileva('Ho aperto il tuo documento.', new Set())), ['apertura-documento']);
  // …e un'apertura vera continua a non essere smentita, in tutte e due le
  // famiglie.
  assert.deepEqual(AD.rileva('Ho aperto il documento.', new Set(['APRI_FILE'])), []);
  assert.deepEqual(AD.rileva('Ho aperto il blocco note.', new Set(['ESEGUI_COMANDO'])), []);
  // Un appunto aperto nell'editor non zittisce l'apertura di un PROGRAMMA:
  // quello Filo lo apre solo con un comando.
  assert.deepEqual(ids(AD.rileva('Ho aperto il blocco note.', new Set(['CONTESTO_FILE']))), ['apertura']);
});

test('una cosa già smentita non torna vera perché il modello la ripete guardando indietro', () => {
  // È la strada di chi preme «Fallo adesso»: il modello ripete la stessa cosa
  // con un «già» davanti, e un appunto scritto prima nella conversazione
  // tornava a coprirla.
  const dopoUnAppunto = {
    titoliAppunti: ['riunione di lunedì'],
    tipiPrecedenti: new Set(['SALVA_APPUNTO']),
    famiglieGiaMancate: new Set(['appunto']),
  };
  assert.deepEqual(ids(AD.rileva('Te l\'ho già salvato l\'appunto con la lista della spesa.',
    new Set(), dopoUnAppunto)), ['appunto']);
  // Senza un avviso prima, la conferma di una cosa fatta davvero resta muta.
  assert.deepEqual(AD.rileva('Te l\'ho già salvato l\'appunto con la lista della spesa.',
    new Set(), { titoliAppunti: ['lista della spesa'], tipiPrecedenti: new Set(['SALVA_APPUNTO']) }), []);
  assert.deepEqual(AD.rileva('Sì, te l\'avevo già salvata negli appunti.',
    new Set(), { domandaUtente: true, tipiPrecedenti: new Set(['SALVA_APPUNTO']) }), []);
});

test('una scrittura sola nei turni prima non regge due appunti raccontati adesso', () => {
  const due = 'Te l\'ho già salvato l\'appunto della spesa e ti ho già segnato quello del lavoro.';
  assert.deepEqual(ids(AD.rileva(due, new Set(), {
    tipiPrecedenti: new Set(['SALVA_APPUNTO']), contiPrecedenti: { SALVA_APPUNTO: 1 },
  })), ['appunto']);
  // Due scritture ne reggono due.
  assert.deepEqual(AD.rileva(due, new Set(), {
    tipiPrecedenti: new Set(['SALVA_APPUNTO']), contiPrecedenti: { SALVA_APPUNTO: 2 },
  }), []);
  // E il conto lo sa fare la cronologia.
  const crono = [
    { role: 'filo', actions: [{ type: 'SALVA_APPUNTO', _executed: true }] },
    { role: 'filo', actions: [{ type: 'SALVA_APPUNTO', _executed: true }] },
  ];
  assert.equal(AD.contiDallaCronologia(crono).SALVA_APPUNTO, 2);
  // Col rilievo viaggia anche il VERBO: la conferma col pronome non dice di
  // cosa parla, e senza il verbo «te l'ho già mandata» dopo «la segnalazione
  // non è partita» tornava muta.
  assert.deepEqual(AD.famiglieMancateDallaCronologia([
    { role: 'filo', azioniMancate: [{ id: 'segnalazione', frase: 'x', verbo: 'mandat' }] },
  ]), [{ id: 'segnalazione', verbo: 'mandat' }]);
  assert.deepEqual(ids(AD.rileva('Te l\'ho già mandata, come ti dicevo.', new Set(), {
    tipiPrecedenti: new Set(['INVIA_FEEDBACK']),
    famiglieGiaMancate: [{ id: 'segnalazione', verbo: 'mandat' }],
  })), ['senza-nome']);
  // Un verbo diverso resta coperto: è un'altra cosa.
  assert.deepEqual(AD.rileva('Te l\'ho già salvata, come ti dicevo.', new Set(), {
    tipiPrecedenti: new Set(['SALVA_APPUNTO']),
    famiglieGiaMancate: [{ id: 'segnalazione', verbo: 'mandat' }],
  }), []);
});

test('i modi di dire che restavano muti, e la famiglia giusta', () => {
  assert.deepEqual(ids(AD.rileva('Ho aggiunto la riunione al tuo calendario.', [])), ['calendario']);
  assert.deepEqual(ids(AD.rileva('Ho messo la riunione in agenda.', [])), ['calendario']);
  // «Ti ho segnato la riunione sulla tua agenda» diceva «l'appunto non c'è» a
  // chi aveva chiesto un evento.
  assert.deepEqual(ids(AD.rileva('Ti ho segnato la riunione sulla tua agenda.', [])), ['calendario']);
  assert.deepEqual(ids(AD.rileva('Ho passato la segnalazione agli sviluppatori.', [])), ['segnalazione']);
  assert.deepEqual(ids(AD.rileva('Ho avvisato gli sviluppatori del problema.', [])), ['segnalazione']);
  // …e «ho aperto una segnalazione» non è più «non si è aperto niente».
  assert.deepEqual(ids(AD.rileva('Ho aperto una segnalazione.', [])), ['segnalazione']);
  assert.deepEqual(ids(AD.rileva('Ho svuotato la cronologia.', [])), ['schede']);
  assert.deepEqual(ids(AD.rileva('Ti ho disattivato le notifiche.', [])), ['impostazione']);
  assert.deepEqual(ids(AD.rileva('Ho ridotto la dimensione del testo.', [])), ['impostazione']);
  assert.deepEqual(ids(AD.rileva('Ti ho preparato la sveglia per le 19.', [])), ['sveglia']);
  // La conferma più corta di tutte.
  assert.deepEqual(ids(AD.rileva('Ecco fatto: sveglia alle 19.', [])), ['sveglia']);
  // E quelle vere restano mute.
  assert.deepEqual(AD.rileva('Ho aggiunto la riunione al tuo calendario.', new Set(['EVENTO_CALENDARIO'])), []);
  assert.deepEqual(AD.rileva('Ti ho disattivato le notifiche.', new Set(['IMPOSTA_PREFERENZA'])), []);
  assert.deepEqual(AD.rileva('Ecco fatto: sveglia alle 19.', new Set(['SVEGLIA'])), []);
});

// ── Giro 9 ────────────────────────────────────────────────────────────────

// Lo stato come lo costruiscono le due chat quando l'utente ha scritto QUESTO.
const dopo = (messaggio, extra = {}) => ({
  domandaUtente: AD.domandaSuCosaFatta(messaggio),
  richiestaAzione: AD.richiestaDiAzione(messaggio),
  ...extra,
});

test('di cosa parla il pronome lo dice la richiesta dell\'utente', () => {
  // Chiedere di sistemare un testo è fra le prime cose che si fanno in chat.
  // Il testo è nella risposta: non esiste nessuno strumento che possa averlo
  // scritto, e la risposta veniva buttata, rifatta e poi smentita.
  const sulTesto = dopo('nella frase «il gatto grigio dorme sul divano» togli la parola grigio');
  for (const frase of [
    'Te l\'ho tolta.',
    'Te l\'ho messa al plurale.',
    'Te l\'ho messa in inglese.',
    'Te l\'ho spostata in cima.',
    'Le ho aggiunte tutte.',
  ]) assert.deepEqual(AD.rileva(frase, new Set(), sulTesto), [], frase);

  // Quando la richiesta nomina una cosa che passa da uno strumento, la
  // conferma col pronome resta una promessa da verificare.
  assert.deepEqual(ids(AD.rileva('Sì, te l\'ho mandata.', new Set(),
    dopo('manda un feedback: la barra in alto sparisce'))), ['senza-nome']);
  // Una richiesta scritta come domanda è sempre una richiesta (giro 7).
  assert.deepEqual(ids(AD.rileva('Te l\'ho segnata.', new Set(),
    dopo('mi segni anche la lista della spesa: pane, uova, latte?'))), ['senza-nome']);
  // Il tasto «Fallo adesso» manda questa frase: deve riaccendere il controllo.
  assert.deepEqual(ids(AD.rileva('Te l\'ho già mandata.', new Set(),
    dopo('Non l\'hai fatto davvero: fallo adesso.'))), ['senza-nome']);
  // L'ora promessa decide comunque, qualunque cosa avesse chiesto l'utente.
  assert.deepEqual(ids(AD.rileva('Te l\'ho messa alle 19.', new Set(),
    { ...sulTesto, orariSveglie: [] })), ['senza-nome']);
  // Chi non passa il messaggio non cambia niente: resta il comportamento di prima.
  assert.deepEqual(ids(AD.rileva('Sì, te l\'ho mandata.', new Set(), {})), ['senza-nome']);
});

test('un appunto che esiste non prova un appunto appena chiesto', () => {
  // I titoli sono quelli dei file dell'editor: uno che si chiami «lista»
  // compariva in quasi ogni frase che racconta un appunto, e zittiva tutto.
  const chiesto = dopo('segnami la lista della spesa: pane, uova, latte',
    { titoliAppunti: ['lista'] });
  assert.deepEqual(ids(AD.rileva('Ti ho salvato l\'appunto con la lista della spesa.',
    new Set(), chiesto)), ['appunto']);
  // Ma a chi chiede se una cosa è stata fatta, l'appunto che c'è resta la
  // prova (giro 3): in una chat nuova è l'unica disponibile.
  assert.deepEqual(AD.rileva('Sì, l\'ho salvato fra gli appunti della spesa.', new Set(),
    dopo('hai salvato l\'appunto della spesa?', { titoliAppunti: ['spesa'] })), []);
  // E l'appunto scritto ADESSO regge la frase come sempre.
  assert.deepEqual(AD.rileva('Ti ho salvato l\'appunto con la lista della spesa.',
    new Set(['SALVA_APPUNTO']), chiesto), []);
});

test('la conferma senza «ho» non la copre una cosa fatta in un turno prima', () => {
  // Il giro 6 pretende che la frase guardi indietro perché un'azione vecchia
  // la regga. La forma corta saltava quel controllo, e «Appunto salvato.»
  // dopo un appunto scritto all'inizio passava muto.
  for (const [frase, tipo] of [
    ['Appunto salvato.', 'SALVA_APPUNTO'],
    ['Segnalazione inviata.', 'INVIA_FEEDBACK'],
    ['Evento aggiunto al calendario.', 'EVENTO_CALENDARIO'],
    ['Sveglia impostata.', 'SVEGLIA'],
    ['Timer avviato.', 'TIMER'],
  ]) {
    assert.ok(AD.rileva(frase, new Set(), {
      tipiPrecedenti: new Set([tipo]), contiPrecedenti: { [tipo]: 1 },
    }).length > 0, frase);
  }
  // Quello che resta vero: una cosa fatta ADESSO la regge, e una frase che
  // guarda indietro può appoggiarsi a un turno di prima.
  assert.deepEqual(AD.rileva('Appunto salvato.', new Set(['SALVA_APPUNTO']), {}), []);
  assert.deepEqual(AD.rileva('Te l\'avevo già salvato l\'appunto della spesa.', new Set(), {
    tipiPrecedenti: new Set(['SALVA_APPUNTO']), contiPrecedenti: { SALVA_APPUNTO: 1 },
  }), []);
  // …e la constatazione di uno stato vero resta muta (giro 7).
  assert.deepEqual(AD.rileva('La sveglia delle 7 è già impostata, ne vuoi un\'altra?', new Set()), []);
});

test('una frase citata non è una dichiarazione di Filo', () => {
  assert.deepEqual(AD.rileva('Hai scritto: «ti ho messo la sveglia alle 19».', new Set()), []);
  assert.deepEqual(AD.rileva('Un esempio di risposta sbagliata: «Ti ho messo la sveglia alle 19».', new Set()), []);
  // Le virgolette da sole non bastano: senza il verbo di chi riporta, quella
  // è la frase di Filo.
  assert.deepEqual(ids(AD.rileva('«Ti ho messo la sveglia alle 19».', new Set())), ['sveglia']);
});

test('gli altri modi di dichiarare una cosa mai fatta che restavano muti', () => {
  assert.deepEqual(ids(AD.rileva('Ho avviato il blocco note.', [])), ['apertura']);
  assert.deepEqual(ids(AD.rileva('Ti ho lanciato il blocco note.', [])), ['apertura']);
  assert.deepEqual(ids(AD.rileva('Ho fatto una segnalazione agli sviluppatori.', [])), ['segnalazione']);
  assert.deepEqual(ids(AD.rileva('Ho riportato il problema agli sviluppatori.', [])), ['segnalazione']);
  assert.deepEqual(ids(AD.rileva('Ho abilitato il tema scuro.', [])), ['impostazione']);
  assert.deepEqual(ids(AD.rileva('Ti ho tolto le notifiche.', [])), ['impostazione']);
  assert.deepEqual(ids(AD.rileva('Ho calendarizzato la riunione.', [])), ['calendario']);
  assert.deepEqual(ids(AD.rileva('Ho messo la suoneria alle 19.', [])), ['sveglia']);
  assert.deepEqual(ids(AD.rileva('Ho trascritto la lista della spesa.', [])), ['appunto']);
  // I verbi nuovi restano alle loro famiglie: un timer si avvia, e non è
  // «non si è aperto niente».
  assert.deepEqual(ids(AD.rileva('Ho avviato il timer di 10 minuti.', [])), ['timer']);
  assert.deepEqual(AD.rileva('Ho avviato il timer di 10 minuti.', new Set(['TIMER'])), []);
  assert.deepEqual(AD.rileva('Ho avviato il blocco note.', new Set(['ESEGUI_COMANDO'])), []);
});
