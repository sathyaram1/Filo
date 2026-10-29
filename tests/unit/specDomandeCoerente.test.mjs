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

// Sui guasti la gestione del lavoro risponde con azioni, mai testo: il feedback ripreso resta fidato.
test('le domande di guasto e le segnalazioni vanno alla gestione del lavoro, che sui guasti risponde solo con azioni', () => {
  const s43 = sezione('### 4.3').replace(/\s+/g, ' ');
  assert.match(s43, /domande di guasto.{0,60}vanno a lei, non all'owner/);
  assert.match(s43, /risponde solo con le azioni\*\* `riprendi`, `attendi` o `archivia`.{0,20}mai con testo/);
  assert.match(sezione('### 5.4').replace(/\s+/g, ' '), /consegna alla \*\*gestione del lavoro\*\*/);
  const riga = righe(sezione('### 5.2')).map(celle).find((c) => nomiFraApici(c[0]).includes('gestione_lavoro'));
  assert.match(riga[2], /rispondere con testo a una domanda di guasto/);
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
  for (const s of ['### 4.3', '### 5.4', '### 3.1', '### 3.8']) {
    assert.match(sezione(s).replace(/\s+/g, ' '), /tranne quelle dell'addetto comunicazioni|quelle dell'addetto comunicazioni vanno all'owner|sempre per l'addetto comunicazioni/, `${s} non esclude l'addetto`);
  }
  const riga = righe(sezione('### 5.2')).map(celle).find((c) => nomiFraApici(c[0]).includes('gestione_lavoro'));
  assert.match(riga[1], /segnalazioni, tranne quelle dell'addetto comunicazioni/);
});

// #1249.1: la gestione del lavoro gira nell'ambiente dei riservati, quindi un guasto di lì (anche suo) la ferma come
// ha fermato chi l'ha aperto; e un guasto che anticipa l'istanza di chi l'ha aperto è una fila di accensioni senza fine.
test('i guasti dell\'ambiente dei riservati vanno all\'owner, e un guasto non anticipa l\'istanza di chi l\'ha aperto', () => {
  const s51 = sezione('### 5.1').replace(/\s+/g, ' ');
  assert.match(s51.slice(s51.indexOf('per mestiere')), /^[^.]*la gestione del lavoro/, 'la regola vale finché lei gira nell\'ambiente dei riservati');
  const s43 = sezione('### 4.3').replace(/\s+/g, ' ');
  assert.match(s43, /non va a chi l'ha aperta né a chi gira nello stesso ambiente/);
  assert.match(s43, /aperte da un biglietto di quell'ambiente vanno all'owner, comprese le sue/);
  assert.match(s43, /non anticipa mai l'istanza di chi l'ha aperto/);
  assert.match(s43, /Un guasto che va a lei le anticipa l'istanza/);
  assert.match(sezione('### 3.1').replace(/\s+/g, ' '), /`destinatario`.{0,200}altri biglietti dell'ambiente dei riservati, lei compresa: vanno all'owner/);
  assert.match(sezione('### 3.8').replace(/\s+/g, ' '), /altri biglietti dell'ambiente dei riservati, lei compresa \(§ 4\.3\), va all'owner/);
  const riga = righe(sezione('### 5.2')).map(celle).find((c) => nomiFraApici(c[0]).includes('gestione_lavoro'));
  assert.match(riga[1], /domande di guasto dei biglietti fuori dall'ambiente dei riservati/);
  assert.match(sezione('## 13').replace(/\s+/g, ' '), /`destinatario`, che manda all'owner i guasti dell'ambiente dei riservati; istanza anticipata da un guasto, mai quella di chi l'ha aperto/);
});

test('le domande di guasto vanno all\'owner finché la gestione del lavoro non c\'è', () => {
  assert.match(sezione('### 3.8').replace(/\s+/g, ' '), /dal punto 9 dell'ordine di lavoro \(§ 13\); fino ad allora/);
  assert.match(sezione('## 13').replace(/\s+/g, ' '), /domande di guasto vanno all'owner fino al punto 9/);
});
