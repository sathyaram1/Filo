// Unit test per src/shared/feedbackThread.js — il parser che trasforma un
// feedback (segnalazione + note) nella sua conversazione a turni.
//
// È il cuore del fix #108 (parte 3): la dashboard deve mostrare la segnalazione,
// le risposte di Filo e le risposte dell'utente in BOX DIVERSI, non in un unico
// blocco. Questi test asseriscono che ogni pezzo del blob `notes` diventi il
// turno giusto, con il ruolo (lato/colore) giusto — senza Electron.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'shared', 'feedbackThread.js'));

const TH = globalThis.SN_FEEDBACK_THREAD;

test('si registra su globalThis con la sua API', () => {
  assert.ok(TH);
  assert.equal(typeof TH.parse, 'function');
  assert.equal(typeof TH.appendUserTurn, 'function');
  assert.equal(typeof TH.userTurnMarker, 'function');
  assert.equal(typeof TH.isFromOwner, 'function');
  assert.equal(typeof TH.originOf, 'function');
  assert.equal(typeof TH.ownerize, 'function');
});

test('originOf: classifica l’origine dal prefisso del clientId', () => {
  assert.equal(TH.originOf('owner:abc'), 'owner');
  assert.equal(TH.originOf('agent:gemini'), 'agent');
  assert.equal(TH.originOf('routine:nightly'), 'routine');
  assert.equal(TH.originOf('tester-123'), 'user');
  assert.equal(TH.originOf(''), 'user');
  assert.equal(TH.originOf(null), 'user');
});

test('authorKind: riduce il clientId alle categorie d’autore della dashboard', () => {
  // owner: invio manuale dell'admin loggato.
  assert.equal(TH.authorKind('owner:caf22093'), 'owner');
  // auto: Filo che segnala in automatico per conto dell'utente (capacità
  // mancante o errore) → 'filo'. È la categoria che senza il fix non esisteva.
  assert.equal(TH.authorKind('auto:complaint'), 'filo');
  assert.equal(TH.authorKind('auto:capability-gap:qualcosa'), 'filo');
  // Qualunque altro clientId è un utente esterno.
  assert.equal(TH.authorKind('tester@example.com'), 'user');
  assert.equal(TH.authorKind('caf22093-uuid'), 'user');
  assert.equal(TH.authorKind(''), 'user');
  assert.equal(TH.authorKind(null), 'user');
  // 'auto:' vince su un ipotetico 'owner:' annidato (auto bypassa ownerize,
  // ma l'ordine resta robusto).
  assert.equal(TH.authorKind('owner:auto:complaint'), 'owner');
  assert.equal(TH.authorKind('auto:owner:x'), 'filo');
});

// #443: il mittente vero. Prima di questo un ritrovamento nato esplorando l'app,
// uno nato implementando e uno nato verificando arrivavano tutti come 'claude',
// e Filo-che-scrive-per-un-utente si spacciava per l'utente stesso. Togliendo il
// fix, ognuno di questi assert torna sul valore generico → rosso.
test('authorKind: distingue le tre automazioni fra loro e Filo dall’utente', () => {
  // Filo che scrive per conto di un utente dalla chat: NON è l'utente.
  assert.equal(TH.authorKind('filo:chat'), 'filo');
  // Esplorazione autonoma: parla dell'app in generale.
  assert.equal(TH.authorKind('routine:prober'), 'prober');
  // Chi implementa: il ritrovamento è nato scrivendo il codice.
  assert.equal(TH.authorKind('routine:new-work'), 'worker');
  assert.equal(TH.authorKind('routine:fixer'), 'worker');
  // Chi verifica il lavoro di un altro: parla della modifica appena consegnata.
  assert.equal(TH.authorKind('routine:verifier'), 'verifier');
  assert.equal(TH.authorKind('routine:secaudit'), 'verifier');
  // Vale anche col prefisso 'agent:'.
  assert.equal(TH.authorKind('agent:prober'), 'prober');
  // Automazione che non si è firmata (tutto lo storico fino al 2026-08-08):
  // resta 'claude' generico invece di inventarsi un ruolo.
  assert.equal(TH.authorKind('routine:routine'), 'claude');
  assert.equal(TH.authorKind('routine:nightly'), 'claude');
  assert.equal(TH.authorKind('agent:gemini-3-flash'), 'claude');
  // Il ruolo è case-insensitive e tollera spazi (arriva da un file su disco).
  assert.equal(TH.authorKind('routine:Prober'), 'prober');
  assert.equal(TH.authorKind('routine: verifier '), 'verifier');
});

// SPEC-RIDISEGNO-MAX.md §13: i rilievi RESIDUI di una verifica (un lavoro
// promosso dopo N giri «migliorabile») sono una categoria PROPRIA. Spacciarli
// per prober (o per una verifica qualunque) falserebbe la lettura di dove
// nascono i ritrovamenti — che è il motivo per cui le automazioni sono separate.
test('authorKind: routine:residuo è una categoria propria, non prober né verifier', () => {
  assert.equal(TH.authorKind('routine:residuo'), 'residuo');
  assert.notEqual(TH.authorKind('routine:residuo'), 'prober');
  assert.notEqual(TH.authorKind('routine:residuo'), 'verifier');
});

// Decisione presa APPOSTA (SPEC §13, non subìta per inerzia): il residuo è
// un'automazione dell'owner come le altre tre, quindi ai fini dell'ingresso
// automatico in coda cade nel gruppo `claude` — lo stesso interruttore della
// dashboard decide per tutte. Gemello del test in filo-security
// (functions/test/autoApprove.test.js), che è la copia che decide davvero.
test('autoApproveGroup: routine:residuo cade nel gruppo claude (deciso, SPEC §13)', () => {
  assert.equal(TH.autoApproveGroup('routine:residuo'), 'claude');
});

test('isFromOwner: vero solo per il prefisso owner:', () => {
  assert.equal(TH.isFromOwner('owner:abc'), true);
  assert.equal(TH.isFromOwner('routine:x'), false);
  assert.equal(TH.isFromOwner('tester-1'), false);
});

test('ownerize: marca i tester, è idempotente, non tocca le origini modello', () => {
  // Un invio di tester (o dell’owner, stesso UUID) viene marcato owner:.
  assert.equal(TH.ownerize('uuid-123'), 'owner:uuid-123');
  // Idempotente: non raddoppia il prefisso.
  assert.equal(TH.ownerize('owner:uuid-123'), 'owner:uuid-123');
  // Le origini modello NON sono owner: restano intatte.
  assert.equal(TH.ownerize('agent:gemini'), 'agent:gemini');
  assert.equal(TH.ownerize('routine:nightly'), 'routine:nightly');
  // Vuoto → vuoto (niente "owner:").
  assert.equal(TH.ownerize(''), '');
  // Cap a 100 char (limite clientId nelle Firestore rules).
  assert.ok(TH.ownerize('x'.repeat(200)).length <= 100);
});

test('feedback senza note → un solo turno: la segnalazione dell’utente', () => {
  const turns = TH.parse({ text: 'non funziona X', clientId: 'abc', createdAt: '2026-05-14T15:43:28.808Z' });
  assert.equal(turns.length, 1);
  assert.equal(turns[0].kind, 'report');
  assert.equal(turns[0].role, 'user'); // segnalazione di un tester umano
  assert.equal(turns[0].body, 'non funziona X');
  assert.equal(turns[0].ts, '2026-05-14T15:43:28.808Z');
});

test('segnalazione + nota di Filo → segnalazione (utente) poi nota (modello)', () => {
  const turns = TH.parse({
    text: 'manca il tasto copia',
    notes: 'Aggiunto il tasto copia al menu. Verificato con un test.',
    clientId: 'user-1',
  });
  assert.equal(turns.length, 2);
  assert.deepEqual(turns.map((t) => [t.role, t.kind]), [
    ['user', 'report'],
    ['model', 'note'],
  ]);
  assert.match(turns[1].body, /tasto copia al menu/);
});

test('riapertura: nota di Filo + risposta dell’utente (storico "Riaperto il")', () => {
  const notes = [
    'Ho risolto come chiesto.',
    '',
    '--- Riaperto il 20/05/26, 19:37 ---',
    'No, manca ancora il caso con due immagini.',
  ].join('\n');
  const turns = TH.parse({ text: 'segnalazione', notes, clientId: 'user-1' });
  assert.equal(turns.length, 3);
  assert.deepEqual(turns.map((t) => t.role), ['user', 'model', 'user']);
  assert.deepEqual(turns.map((t) => t.kind), ['report', 'note', 'reply']);
  assert.equal(turns[1].body, 'Ho risolto come chiesto.');
  assert.equal(turns[2].body, 'No, manca ancora il caso con due immagini.');
  assert.equal(turns[2].ts, '20/05/26, 19:37'); // ts estratto dal marcatore
});

test('più turni alternati Filo/utente in ordine cronologico', () => {
  const notes = [
    'Prima risposta di Filo.',
    '--- La tua risposta del 01/06/26, 10:00 ---',
    'Prima risposta utente.',
    '--- Riaperto il 02/06/26, 11:00 ---',
    'Seconda risposta utente.',
  ].join('\n');
  const turns = TH.parse({ text: 'orig', notes, clientId: 'u' });
  assert.deepEqual(turns.map((t) => `${t.role}:${t.kind}`), [
    'user:report',
    'model:note',
    'user:reply',
    'user:reply',
  ]);
  assert.equal(turns[2].body, 'Prima risposta utente.');
  assert.equal(turns[3].body, 'Seconda risposta utente.');
});

test('note che iniziano con un marcatore → nessun turno-Filo vuoto', () => {
  const notes = '--- Riaperto il 03/06/26 ---\nsolo una riapertura, niente nota prima';
  const turns = TH.parse({ text: 'orig', notes, clientId: 'u' });
  assert.equal(turns.length, 2);
  assert.deepEqual(turns.map((t) => t.kind), ['report', 'reply']);
});

test('feedback inviato da un AGENTE → segnalazione lato modello', () => {
  const turns = TH.parse({ text: 'area vuota', clientId: 'agent:gemini-3.1-flash-lite' });
  assert.equal(turns[0].role, 'model');
  assert.equal(turns[0].kind, 'report');
  assert.equal(TH.isFromModel('routine:notturna'), true);
  assert.equal(TH.isFromModel('101ff602-clientid'), false);
});

test('feedback vuoto → nessun turno (niente crash)', () => {
  assert.deepEqual(TH.parse({}), []);
  assert.deepEqual(TH.parse(null), []);
  assert.deepEqual(TH.parse({ text: '   ', notes: '   ' }), []);
});

test('appendUserTurn conserva lo storico ed è ri-parsabile', () => {
  const before = 'Domanda di Filo: quale provider?';
  const after = TH.appendUserTurn(before, 'Usa quello gratuito.', { ts: '05/06/26, 09:00' });
  assert.match(after, /Domanda di Filo/);
  assert.match(after, /Usa quello gratuito\./);
  // Il risultato deve riparsare in 2 turni (nota + risposta).
  const turns = TH.parse({ text: '', notes: after, clientId: 'u' });
  assert.deepEqual(turns.map((t) => t.kind), ['note', 'reply']);
  assert.equal(turns[1].body, 'Usa quello gratuito.');
  assert.equal(turns[1].ts, '05/06/26, 09:00');
});

test('appendUserTurn ignora una risposta vuota', () => {
  assert.equal(TH.appendUserTurn('x', '   '), 'x');
  assert.equal(TH.appendUserTurn('', ''), '');
});

// ── Fix: riaprire + ri-risolvere NON deve perdere lo storico ────────────────
// Quando una routine ri-risolve un feedback già lavorato e riaperto, il suo
// nuovo report deve APPENDERSI (turno dell'agente), conservando il report
// precedente e l'annotazione di riapertura dell'utente.

test('mergeModelReport: prima risoluzione → il report è il primo turno (no marcatore)', () => {
  assert.equal(TH.mergeModelReport('', 'Risolto: aggiunto lo zoom.'), 'Risolto: aggiunto lo zoom.');
  assert.equal(TH.mergeModelReport('   ', 'Risolto.'), 'Risolto.');
});

test('mergeModelReport: ri-risoluzione conserva report precedente + nota utente', () => {
  // Stato dopo: report iniziale + riapertura dell'utente con la sua annotazione.
  const existing = [
    'Ho aggiunto lo zoom con Ctrl +.',
    '',
    '--- Riaperto il 16/06/26, 22:00 ---',
    'Manca lo zoom col trackpad (pinch).',
  ].join('\n');
  const merged = TH.mergeModelReport(existing, 'Ora supporto anche il pinch sul trackpad.', { ts: '17/06/26, 09:00' });
  // Niente è andato perso.
  assert.match(merged, /Ho aggiunto lo zoom con Ctrl/);
  assert.match(merged, /Manca lo zoom col trackpad/);
  assert.match(merged, /Ora supporto anche il pinch/);
  // E riparsa in 4 turni: report(utente) → nota(modello) → riapertura(utente)
  // → nuovo aggiornamento (modello), con i lati giusti.
  const turns = TH.parse({ text: 'rendi possibile zoommare col trackpad', notes: merged, clientId: 'user-1' });
  assert.deepEqual(turns.map((t) => `${t.role}:${t.kind}`), [
    'user:report',
    'model:note',
    'user:reply',
    'model:note',
  ]);
  assert.match(turns[3].body, /Ora supporto anche il pinch/);
});

test('mergeModelReport: idempotente — re-applicare lo stesso report non duplica', () => {
  const once = TH.mergeModelReport('Report iniziale.', 'Aggiornamento dopo riapertura.');
  const twice = TH.mergeModelReport(once, 'Aggiornamento dopo riapertura.');
  assert.equal(twice, once); // già presente → nessun secondo marcatore
});

test('mergeModelReport: report vuoto lascia intatte le note esistenti', () => {
  assert.equal(TH.mergeModelReport('storico', '   '), 'storico');
});

test('splitNotes riconosce il marcatore del turno agente come lato modello', () => {
  const notes = [
    'Report iniziale di Filo.',
    "--- Aggiornamento dell'agente del 17/06/26 ---",
    'Secondo report di Filo.',
  ].join('\n');
  const segs = TH.splitNotes(notes);
  assert.deepEqual(segs.map((s) => s.role), ['model', 'model']);
  assert.equal(segs[1].body, 'Secondo report di Filo.');
});

// ── Allegati per-turno (#190.3) ─────────────────────────────────────────────
// Un allegato incollato in un COMMENTO deve restare ancorato a QUEL turno, non
// finire nella griglia immagini della segnalazione originale. Gli allegati
// vivono come righe-marcatore dentro `notes` (niente cambio schema Firestore).

test('serialize/parse di una riga-allegato: round-trip immagine e file', () => {
  const img = { kind: 'img', url: 'https://x/i.png' };
  const line = TH.serializeAttachment(img);
  assert.ok(line.startsWith(TH.ATTACH_PREFIX));
  assert.deepEqual(TH.parseAttachmentLine(line), img);

  const file = { kind: 'file', url: 'https://x/d.pdf', name: 'doc 1.pdf', type: 'application/pdf' };
  const fline = TH.serializeAttachment(file);
  assert.deepEqual(TH.parseAttachmentLine(fline), file);
});

test('parseAttachmentLine: prosa normale → null; URL non http(s) scartato (no XSS)', () => {
  assert.equal(TH.parseAttachmentLine('una riga di testo normale'), null);
  assert.equal(TH.parseAttachmentLine(''), null);
  // javascript:/data: non devono passare (finirebbero in href/src in dashboard).
  assert.equal(TH.parseAttachmentLine(TH.ATTACH_PREFIX + '{"kind":"img","url":"javascript:alert(1)"}'), null);
  assert.equal(TH.parseAttachmentLine(TH.ATTACH_PREFIX + '{"kind":"file","url":"data:text/html,x"}'), null);
  // JSON rotto → null, niente crash.
  assert.equal(TH.parseAttachmentLine(TH.ATTACH_PREFIX + '{rotto'), null);
});

test('splitNotes: la riga-allegato si ancora al turno, non al corpo testuale', () => {
  const notes = [
    'Ho commentato il problema.',
    TH.serializeAttachment({ kind: 'img', url: 'https://x/a.png' }),
  ].join('\n');
  const segs = TH.splitNotes(notes);
  assert.equal(segs.length, 1);
  // Il corpo NON contiene la riga-marcatore (è prosa pulita)…
  assert.equal(segs[0].body, 'Ho commentato il problema.');
  // …e l'allegato è raccolto a parte sul turno.
  assert.deepEqual(segs[0].attachments, [{ kind: 'img', url: 'https://x/a.png' }]);
});

test('parse: ogni turno porta i SUOI allegati, separati dalla segnalazione', () => {
  const notes = [
    'Nota di Filo con un file.',
    TH.serializeAttachment({ kind: 'file', url: 'https://x/log.txt', name: 'log.txt', type: 'text/plain' }),
    '--- La tua risposta del 10/06/26 ---',
    'Ecco lo screenshot.',
    TH.serializeAttachment({ kind: 'img', url: 'https://x/shot.png' }),
  ].join('\n');
  const turns = TH.parse({ text: 'segnalazione senza immagini', notes, clientId: 'user-1' });
  assert.deepEqual(turns.map((t) => `${t.kind}`), ['report', 'note', 'reply']);
  // La segnalazione non ha allegati nelle note (usa images/files piatti).
  assert.deepEqual(turns[0].attachments, []);
  // Il file sta sul turno di Filo; l'immagine sul turno della risposta utente.
  assert.deepEqual(turns[1].attachments, [{ kind: 'file', url: 'https://x/log.txt', name: 'log.txt', type: 'text/plain' }]);
  assert.deepEqual(turns[2].attachments, [{ kind: 'img', url: 'https://x/shot.png' }]);
});

test('appendUserTurn con allegati: ri-parsa nel turno giusto', () => {
  const after = TH.appendUserTurn('Domanda di Filo.', 'Risposta con prova.', {
    ts: '11/06/26, 09:00',
    attachments: [{ kind: 'img', url: 'https://x/p.png' }],
  });
  const turns = TH.parse({ text: '', notes: after, clientId: 'u' });
  assert.deepEqual(turns.map((t) => t.kind), ['note', 'reply']);
  assert.equal(turns[1].body, 'Risposta con prova.');
  assert.deepEqual(turns[1].attachments, [{ kind: 'img', url: 'https://x/p.png' }]);
});

test('appendUserTurn: una risposta di SOLI allegati (senza parole) è valida', () => {
  const after = TH.appendUserTurn('', '  ', { attachments: [{ kind: 'img', url: 'https://x/q.png' }] });
  const turns = TH.parse({ text: '', notes: after, clientId: 'u' });
  assert.equal(turns.length, 1);
  assert.equal(turns[0].body, '');
  assert.deepEqual(turns[0].attachments, [{ kind: 'img', url: 'https://x/q.png' }]);
});

test('appendUserTurn: senza testo né allegati lascia le note intatte', () => {
  assert.equal(TH.appendUserTurn('storico', '   ', { attachments: [] }), 'storico');
  assert.equal(TH.appendUserTurn('storico', ''), 'storico');
});

test('stripAttachments/composeNotes: round-trip per il compositore note editabile', () => {
  const notes = [
    'La mia nota di triage.',
    TH.serializeAttachment({ kind: 'img', url: 'https://x/n.png' }),
  ].join('\n');
  const { text, attachments } = TH.stripAttachments(notes);
  // La textarea mostra solo prosa (niente righe-marcatore).
  assert.equal(text, 'La mia nota di triage.');
  assert.deepEqual(attachments, [{ kind: 'img', url: 'https://x/n.png' }]);
  // Ricomponendo si torna a un blob ri-parsabile con l'allegato sul turno.
  const recomposed = TH.composeNotes(text, attachments);
  const segs = TH.splitNotes(recomposed);
  assert.equal(segs[0].body, 'La mia nota di triage.');
  assert.deepEqual(segs[0].attachments, [{ kind: 'img', url: 'https://x/n.png' }]);
});

test('composeNotes: senza allegati ritorna il testo invariato', () => {
  assert.equal(TH.composeNotes('solo testo', []), 'solo testo');
  assert.equal(TH.composeNotes('', []), '');
  // Solo allegati, nessun testo → solo le righe-marcatore, ri-estraibili.
  const onlyAtt = TH.composeNotes('', [{ kind: 'img', url: 'https://x/z.png' }]);
  assert.deepEqual(TH.stripAttachments(onlyAtt).attachments, [{ kind: 'img', url: 'https://x/z.png' }]);
  assert.equal(TH.stripAttachments(onlyAtt).text, '');
});
