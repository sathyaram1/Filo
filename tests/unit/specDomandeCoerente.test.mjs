// SPEC-DOMANDE.md resta coerente con sé stessa (#1249): rimandi a sezioni che esistono, ordine di lavoro numerato
// di fila, ambiti e azioni nominati che stanno nelle loro tabelle, urgenze dei ricorrenti uguali a quelle dei compiti.
// Ogni feedback che la realizza la legge per pezzi: un rimando rotto lo manda nel posto sbagliato.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const testo = readFileSync(join(ROOT, 'SPEC-DOMANDE.md'), 'utf8').replace(/\r\n/g, '\n');
const piatto = testo.replace(/\s+/g, ' ');

function sezione(titolo) {
  const i = testo.indexOf(`\n${titolo}`);
  assert.ok(i >= 0, `sezione assente: ${titolo}`);
  const resto = testo.slice(i + titolo.length + 1);
  const livello = titolo.match(/^#+/)[0].length;
  const fine = resto.search(new RegExp(`\\n#{1,${livello}} `));
  return fine < 0 ? resto : resto.slice(0, fine);
}

const righe = (s) => s.split('\n').filter((l) => /^\|/.test(l) && !/^\|\s*-/.test(l));
const celle = (riga) => riga.split('|').slice(1, -1).map((c) => c.trim());
const nomiFraApici = (s) => [...s.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]);

const sezioni = new Set([...testo.matchAll(/^#{2,3} (\d+(?:\.\d+)?)[. ]/gm)].map((m) => m[1]));
const ambiti = new Set(righe(sezione('### 5.2')).slice(1).flatMap((r) => nomiFraApici(celle(r)[0])));
const azioni = new Set([...sezione('### 3.3').matchAll(/^- `([a-z_]+)`/gm)].map((m) => m[1]));

test('ogni rimando «§ n» porta a una sezione che esiste', () => {
  const rotti = [];
  for (const m of testo.matchAll(/§\s*(\d+(?:\.\d+)?)(?:\s*[–-]\s*(\d+(?:\.\d+)?))?/g)) {
    for (const n of [m[1], m[2]].filter(Boolean)) if (!sezioni.has(n)) rotti.push(m[0]);
  }
  assert.deepEqual(rotti, []);
});

test('l\'ordine di lavoro è numerato di fila e ogni «punto n» ci sta dentro', () => {
  const punti = [...sezione('## 13. Ordine di lavoro').matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
  assert.ok(punti.length > 0);
  assert.deepEqual(punti, punti.map((_, i) => i + 1));
  const citati = [...piatto.matchAll(/punt[oi] (\d+)(?:\s*(?:e|–|-)\s*(\d+))?/g)].flatMap((m) => [m[1], m[2]].filter(Boolean).map(Number));
  assert.ok(citati.length > 0);
  for (const n of citati) assert.ok(n >= 1 && n <= punti.length, `punto ${n} fuori dall'ordine di lavoro (1–${punti.length})`);
});

test('gli ambiti nominati nel testo e nei ricorrenti stanno nella tabella degli ambiti', () => {
  assert.ok(ambiti.has('lavoro') && ambiti.size >= 5, 'tabella degli ambiti non letta');
  const nominati = [...piatto.matchAll(/ambit[oi] ((?:`[a-z_]+`\s*(?:\/|,|e|o)?\s*)+)/g)].flatMap((m) => nomiFraApici(m[1]));
  const ricorrenti = righe(sezione('### 4.1')).slice(1).flatMap((r) => nomiFraApici(celle(r)[2]));
  assert.ok(ricorrenti.length > 0);
  for (const a of [...nominati, ...ricorrenti]) assert.ok(ambiti.has(a), `ambito \`${a}\` assente dalla tabella del § 5.2`);
});

test('le azioni nominate nel testo sono tipi ammessi del § 3.3', () => {
  assert.ok(azioni.has('riprendi') && azioni.has('compito'), 'elenco delle azioni non letto');
  const nominate = [...piatto.matchAll(/azion[ei] ((?:`[a-z_]+`\s*(?:\/|,|e|o)?\s*)+)/g)].flatMap((m) => nomiFraApici(m[1]));
  assert.ok(nominate.length > 0);
  for (const a of nominate) assert.ok(azioni.has(a), `azione \`${a}\` assente dal § 3.3`);
});

test('ogni ricorrente ha la stessa urgenza nella tabella dei compiti senza feedback', () => {
  const senzaFeedback = righe(sezione('### 6.3')).map(celle).filter((c) => c.length === 2 && /^\d+$/.test(c[1]));
  assert.ok(senzaFeedback.length > 0);
  for (const r of righe(sezione('### 4.1')).slice(1).map(celle)) {
    const nome = r[1].split(/\s*[(:]/)[0].toLowerCase();
    const compito = senzaFeedback.find((c) => c[0].toLowerCase().includes(nome));
    assert.ok(compito, `il ricorrente «${nome}» manca fra i compiti senza feedback del § 6.3`);
    assert.equal(Number(r[3]), Number(compito[1]), `urgenza di «${nome}»`);
  }
});

// La triade del § 5.1 sulla casella (D-55): chi la riceve non esce in rete, chi cerca sul web non la riceve.
test('nessun ambito riceve la casella di Filo e insieme cerca sul web', () => {
  const tabella = righe(sezione('### 5.2')).slice(1).map(celle);
  const conCasella = tabella.filter((c) => /ricevere[^;]*casella/i.test(c[1]));
  assert.ok(conCasella.length > 0, 'nessun ambito riceve la casella: tabella non letta');
  for (const c of conCasella) assert.doesNotMatch(c[1], /web|internet|scaric/i, `ambito ${c[0]}`);
  for (const c of tabella.filter((c) => /web/i.test(c[1]))) assert.match(c[2], /casella/i, `ambito ${c[0]} cerca sul web ma non gli è negata la casella`);
});

// La triade segue il testo (§ 5.1): il testo che il monitoraggio scrive per un esperimento porta quello che ha letto,
// quindi l'esperimento non spinge sul repo pubblico, e un'azione che esce non parte senza l'owner.
test('l\'esperimento consegna l\'esito al server e non spinge su GitHub', () => {
  const riga = righe(sezione('### 5.2')).map(celle).find((c) => nomiFraApici(c[0]).includes('esperimento'));
  assert.ok(riga, 'ambito `esperimento` assente');
  assert.doesNotMatch(riga[1], /spinger/i);
  assert.match(riga[1], /server/i);
  assert.match(riga[2], /GitHub/);
});

test('il giudice cieco degli esperimenti ha un ambito della tabella', () => {
  const frase = sezione('### 4.6').replace(/\s+/g, ' ').split(/[;.]/).find((f) => /giudic/i.test(f) && /ambito `/.test(f));
  assert.ok(frase, 'il § 4.6 non dice l\'ambito del giudice');
  for (const a of nomiFraApici(frase)) assert.ok(ambiti.has(a), `ambito \`${a}\` assente dal § 5.2`);
});

test('un\'azione che esce non parte da una risposta automatica', () => {
  const s = sezione('### 3.6').replace(/\s+/g, ' ');
  assert.match(s, /`invia_mail`[^.]*non si applica da una risposta automatica/);
});

// La ricerca web della sessione gira dal fornitore del modello: la rete limitata del contenitore non la ferma.
test('dove la spec conta sulla rete limitata, la sessione parte senza i suoi strumenti web', () => {
  const frasi = sezione('### 1.2').replace(/\s+/g, ' ').split(/(?<=[.:;])\s/);
  assert.ok(frasi.some((f) => /strument/i.test(f) && /web/i.test(f) && /senza/i.test(f)), 'rete limitata senza togliere gli strumenti web della sessione');
});

// Un riservato non esce perché la sessione nasce senza i canali che il server non vede (strumenti web, scrittura
// su GitHub, salvataggio automatico che spinge a ogni modifica), non perché l'ambito glielo vieta.
test('l\'ambiente dei riservati ha come unica uscita il server, e chi è riservato ci gira', () => {
  const s12 = sezione('### 1.2').replace(/\s+/g, ' ');
  assert.ok(s12.includes('ambiente dei riservati'), '§ 1.2 non definisce l\'ambiente dei riservati');
  const regola = s12.slice(s12.indexOf('ambiente dei riservati'));
  for (const r of [/unica uscita è il server/, /senza strumenti web/, /senza permesso di scrittura su GitHub/, /senza salvataggio automatico/]) {
    assert.match(regola, r);
  }
  for (const titolo of ['### 4.6', '### 5.1']) {
    assert.match(sezione(titolo).replace(/\s+/g, ' '), /ambiente dei riservati \(§ 1\.2\)/, titolo);
  }
  assert.match(sezione('## 13. Ordine di lavoro').replace(/\s+/g, ' '), /ambiente dei riservati[^;]{0,120}senza salvataggio automatico/);
});

// Il segno riservato si prende a sessione avviata, l'ambiente no: il server consegna testo riservato solo a chi ci
// gira già, e chi lo legge per mestiere ci parte, ambiente costruito prima di lui (giro 5 di #1249).
test('il testo riservato arriva solo a chi gira già nell\'ambiente dei riservati', () => {
  const s51 = sezione('### 5.1').replace(/\s+/g, ' ');
  const regola = s51.split(/(?<=[.;])\s/).filter((f) => /consegna testo riservato solo/.test(f) || /per mestiere/.test(f)).join(' ');
  assert.match(regola, /solo a un biglietto che gira già nell'ambiente dei riservati/);
  for (const r of righe(sezione('### 4.1')).slice(1).map(celle)) {
    const nome = r[1].split(/\s*[(:]/)[0].toLowerCase();
    assert.ok(nome.split(/\s+/).some((p) => p.length >= 5 && regola.toLowerCase().includes(p)), `il ricorrente «${nome}» non è fra chi parte nell'ambiente dei riservati`);
  }
  const punti = sezione('## 13. Ordine di lavoro').split(/\n(?=\d+\. )/).map((p) => p.replace(/\s+/g, ' '));
  const punto = (frase) => Number(punti.find((p) => p.includes(frase))?.match(/^(\d+)\./)?.[1]);
  for (const chi of ['Compito «Gestisci la risposta»', 'revisione quotidiana', 'Compiti ricorrenti']) {
    assert.ok(punto('ambiente dei riservati') < punto(chi), `«${chi}» arriva prima dell'ambiente dei riservati`);
  }
});

// D-141 opzione 3: la domanda di fine turno della gestione del lavoro arriva a tutti, come limite accettato; regge
// perché della posta lei vede solo i numeri (decisione del 23/10): le due cose stanno o cadono insieme.
test('la domanda di fine turno della gestione del lavoro è un limite scritto, e la gestione non vede la posta', () => {
  const s54 = sezione('### 5.4').replace(/\s+/g, ' ');
  assert.match(s54, /gestione del lavoro arriva a tutti i ruoli/);
  assert.match(s54, /Limite accettato dall'owner/);
  assert.match(s54, /ingannati due agenti/);
  assert.match(sezione('### 5.1').replace(/\s+/g, ' '), /eccezioni sono due.{0,200}domanda di fine turno della gestione del lavoro \(§ 5\.4\)/);
  const riga = righe(sezione('### 5.2')).map(celle).find((c) => nomiFraApici(c[0]).includes('gestione_lavoro'));
  assert.ok(riga, 'ambito `gestione_lavoro` assente');
  assert.match(riga[2], /addetto comunicazioni/);
  assert.match(sezione('### 4.1').replace(/\s+/g, ' '), /nessun altro compito le legge/);
});

// #1790: i guasti non vanno alla gestione del lavoro né all'owner, li smista il compito «Gestisci la domanda»; le
// segnalazioni restano a lei.
test('le segnalazioni vanno alla gestione del lavoro; i guasti li smista il compito, e lei non smista né risponde', () => {
  const s43 = sezione('### 4.3').replace(/\s+/g, ' ');
  assert.match(s43, /segnalazioni libere \(§ 5\.4\) vanno a lei, non all'owner/);
  assert.match(s43, /I guasti non passano da lei\*\* \(#1790\): li smista in minuti il compito «Gestisci la domanda» \(§ 3\.5\)/);
  assert.match(sezione('### 5.4').replace(/\s+/g, ' '), /consegna alla \*\*gestione del lavoro\*\*/);
  const riga = righe(sezione('### 5.2')).map(celle).find((c) => nomiFraApici(c[0]).includes('gestione_lavoro'));
  assert.match(riga[2], /smistare o rispondere alle domande \(lo fa il compito della § 3\.5\)/);
  assert.doesNotMatch(riga[1], /domande di guasto/);
});

// La domanda della gestione del lavoro è testo non fidato a ogni ruolo: se arrivasse prima dell'ultima scrittura,
// ogni lavoro fidato perderebbe la fiducia e tornerebbe sotto L5.
test('la domanda di fine turno della gestione del lavoro arriva dopo l\'ultima scrittura e non toglie la fiducia al lavoro', () => {
  const s54 = sezione('### 5.4').replace(/\s+/g, ' ');
  assert.match(s54, /arriva dopo l'ultima scrittura/);
  assert.match(s54, /da lì il rilascio non salva più niente/);
  assert.match(sezione('### 1.5').replace(/\s+/g, ' '), /domanda di fine turno della gestione del lavoro.{0,80}\(§ 5\.4\)/);
});

// Decisione del 23/10: la mail resta fra l'addetto comunicazioni e l'owner, nemmeno per segnalazioni e guasti.
test('segnalazioni, guasti e risposte di fine turno dell\'addetto comunicazioni vanno all\'owner, non alla gestione del lavoro', () => {
  assert.match(sezione('### 4.1').replace(/\s+/g, ' '), /segnalazioni libere, le sue domande di guasto e le sue risposte alla domanda di fine turno vanno all'owner/);
  for (const s of ['### 4.3', '### 5.4']) {
    assert.match(sezione(s).replace(/\s+/g, ' '), /tranne quelle dell'addetto comunicazioni|quelle dell'addetto comunicazioni vanno all'owner|sempre per l'addetto comunicazioni/, `${s} non esclude l'addetto`);
  }
  const riga = righe(sezione('### 5.2')).map(celle).find((c) => nomiFraApici(c[0]).includes('gestione_lavoro'));
  assert.match(riga[1], /segnalazioni, tranne quelle dell'addetto comunicazioni/);
  // Nessun compito legge le sue domande: nemmeno quello che smista le domande alla nascita (#1790).
  assert.match(sezione('### 3.5').replace(/\s+/g, ' '), /Non lo apre\*\* sulle domande dell'addetto comunicazioni \(`soloOwner`, § 4\.1\)/);
});

// #1249.1: un guasto che anticipa l'istanza di chi l'ha aperto è una fila di accensioni senza fine. #1790: un guasto
// che colpisce il compito che smista non trattiene la domanda: al terzo tentativo esce all'owner com'è.
test('un guasto non anticipa l\'istanza di chi ci è caduto, e un compito che non gira non trattiene la domanda', () => {
  const s51 = sezione('### 5.1').replace(/\s+/g, ' ');
  assert.match(s51.slice(s51.indexOf('per mestiere')), /^[^.]*la gestione del lavoro/, 'la regola vale finché lei gira nell\'ambiente dei riservati');
  const s43 = sezione('### 4.3').replace(/\s+/g, ' ');
  assert.match(s43, /Un guasto non anticipa mai l'istanza di chi ci è caduto/);
  const s35 = sezione('### 3.5').replace(/\s+/g, ' ');
  assert.match(s35, /al terzo la domanda esce com'è fra quelle da rispondere, con `smistamento: 'fallito'`/);
  assert.match(s35, /un compito che non può girare non trattiene una domanda per sempre/);
  assert.match(sezione('## 13').replace(/\s+/g, ' '), /`destinatario`, che manda all'owner i guasti dell'ambiente dei riservati; istanza anticipata da un guasto, mai quella di chi l'ha aperto/);
});

// #1249.3: fermo su un guasto suo, ogni accensione automatica (battito, segnali, sveglia) cade sullo stesso guasto; e
// un controllo sulle scritture nel taccuino non vede una sessione che scrive e poi cade. #1249.4: l'owner che ha
// sistemato l'ambiente lo riaccende subito, dalla chat o rispondendo al controllo, senza aspettare il mattino.
const manutentore = readFileSync(join(ROOT, 'SPEC-MANUTENTORE.md'), 'utf8').replace(/\r\n/g, '\n');
const paragrafo7 = manutentore.slice(manutentore.indexOf('\n## 7.'), manutentore.indexOf('\n## 8.'));

test('fermo su un guasto suo il manutentore lo accendono il mattino e l\'owner, e il controllo conta le sessioni chiuse bene', () => {
  const man = manutentore;
  const s7 = paragrafo7.replace(/\s+/g, ' ');
  assert.match(s7, /fermo fino alla prossima \*\*sessione chiusa bene\*\*, cioè arrivata al rilascio senza guasto/);
  assert.match(s7, /non lo accende per nessun automatismo: né il battito, né un segnale .{0,200}né una sveglia chiesta prima/);
  assert.match(s7, /Lo accendono solo: - la \*\*decisione del mattino\*\*/);
  assert.match(s7, /- l'\*\*owner dalla chat\*\*, quando chiede di farlo ripartire .{0,80}: subito, senza aspettare il mattino/);
  assert.match(s7, /- la risposta \*\*«lascialo riprovare»\*\* dell'owner alla domanda del controllo .{0,30}: subito anche lei/);
  assert.match(s7, /- l'\*\*interruttore\*\* del manutentore .{0,200}vale come «lascialo riprovare»/);
  assert.match(s7, /lasciarlo riprovare \(azione `automazione`, che lo accende subito anche se è fermo\)/);
  assert.match(s7, /Va diretta all'owner, senza passare dal compito che smista le domande/);
  assert.match(s7, /Contano le chiusure, non le scritture nel taccuino/);
  assert.match(s7, /Una domanda alla volta, e la prima sessione chiusa bene la rende superata/);
  const s4 = man.slice(man.indexOf('\n## 4.'), man.indexOf('\n## 5.')).replace(/\s+/g, ' ');
  assert.match(s4, /Fermo su un guasto suo, invece, valgono solo le accensioni del § 7/);
  // Il segnale dell'owner dalla chat sta nell'elenco del § 4: il rimando non deve toglierlo con un «solo il mattino».
  assert.match(s4, /richiesta dell'owner dalla chat/);
  assert.doesNotMatch(sezione('### 4.3').replace(/\s+/g, ' '), /scrivere nel taccuino da 26 ore/);
  assert.match(sezione('### 4.3').replace(/\s+/g, ' '), /conta le sue sessioni chiuse bene, non le scritture nel taccuino/);
  assert.match(sezione('### 3.3').replace(/\s+/g, ' '), /`attendi`.{0,250}tranne mentre è ferma su un guasto suo/);
  assert.match(sezione('### 3.5').replace(/\s+/g, ' '), /Quella del controllo sul manutentore non passa di qui: va diretta all'owner \(SPEC-MANUTENTORE\.md § 7\)/);
});

// La soglia del controllo sul manutentore vive solo in SPEC-MANUTENTORE § 7: una copia altrove resta indietro, e lo
// smistamento che riconoscesse la domanda dal numero la tratterebbe da guasto al primo cambio.
test('la soglia del controllo sul manutentore è scritta in un posto solo', () => {
  const soglia = /\b\d+\s*ore\b[^.]{0,60}(chiu[sd]\w* bene|taccuino)|(chiu[sd]\w* bene|taccuino)[^.]{0,60}\b\d+\s*ore\b|controllo delle \d+ ore/;
  for (const f of ['SPEC-DOMANDE.md', 'FEEDBACK-STATES.md', join('routines', 'roles', 'smistamento.md'), join('routines', 'roles', 'manutentore.md')]) {
    assert.doesNotMatch(readFileSync(join(ROOT, f), 'utf8').replace(/\s+/g, ' '), soglia, f);
  }
  const man = readFileSync(join(ROOT, 'SPEC-MANUTENTORE.md'), 'utf8').replace(/\s+/g, ' ');
  assert.equal((man.match(/\b\d+ ore\b/g) || []).filter((x) => x !== '5 ore').length, 1, 'una sola soglia in ore nella spec del manutentore');
});

// #1249.4: le copie riassunte del fermo dicevano «solo il mattino» e lasciavano fuori la chat; chi costruiva
// l'accensione partendo da una di loro lasciava l'owner senza modo di farlo ripartire fino al giorno dopo.
test('il fermo del manutentore su un guasto suo è scritto per intero solo nel § 7, gli altri testi rimandano lì', () => {
  const fuori7 = manutentore.replace(paragrafo7, '\n');
  const testi = [['SPEC-MANUTENTORE.md fuori dal § 7', fuori7]];
  const radice = ['SPEC-DOMANDE.md', 'FEEDBACK-STATES.md', 'SPEC-RIDISEGNO-LAVORO.md', 'CLAUDE.md'];
  for (const f of radice) testi.push([f, readFileSync(join(ROOT, f), 'utf8')]);
  for (const f of ['manutentore.md', 'smistamento.md', 'pacemaker.md']) {
    try { testi.push([f, readFileSync(join(ROOT, 'routines', 'roles', f), 'utf8')]); } catch { /* ruolo assente */ }
  }
  const riassunto = /solo (il|al) mattino|anticipa niente|oltre al mattino|solo la sessione del giorno|riaccende solo l'owner/i;
  let menzioni = 0;
  for (const [nome, t] of testi) {
    const p = t.replace(/\s+/g, ' ');
    assert.doesNotMatch(p, riassunto, `${nome}: una versione ridotta della regola del fermo`);
    for (const m of p.matchAll(/guasto suo/gi)) {
      menzioni++;
      assert.match(p.slice(m.index, m.index + 170), /§ 7/, `${nome}: «${p.slice(m.index, m.index + 90)}…» non rimanda al § 7`);
    }
  }
  assert.ok(menzioni >= 6, `i rimandi al fermo sono spariti (${menzioni})`);
});

test('un guasto non diventa una domanda per l\'owner (#1790)', () => {
  const s38 = sezione('### 3.8').replace(/\s+/g, ' ');
  assert.match(s38, /guasto \(#1781\) \| nessuna domanda e nessuna fermata/);
  assert.match(s38, /Al terzo guasto uguale di seguito sullo stesso feedback nasce UNA domanda col conteggio/);
  assert.match(sezione('### 3.1').replace(/\s+/g, ' '), /`destinatario`: l'owner\. Le domande di guasto non arrivano a nessuno/);
  assert.match(sezione('## 13').replace(/\s+/g, ' '), /dal #1790 non ne nascono più: § 3\.8/);
});
