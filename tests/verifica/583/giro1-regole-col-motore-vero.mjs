// Verifica #583, giro 1 — la lettura dei feedback provata col MOTORE VERO.
//
// NON è uno spec: il nome finisce in `.mjs` e non in `.spec.mjs` apposta, così
// la suite non prova a lanciarlo. Per girare ha bisogno di due cose che nella
// suite non ci sono e non ci devono essere — l'emulatore Firestore ufficiale
// (un .jar da centinaia di MB) e Java. La sentinella sempre accesa sulle regole
// è `tests/unit/firestoreRulesFeedbackRead.test.mjs`, che rilegge il file in
// millisecondi; questo file è l'altra metà: la prova che quel file, dato in
// pasto al motore vero, si comporta come dice.
//
// COME SI LANCIA (fuori dal repo, in una cartella usa-e-getta):
//
//   mkdir /tmp/emu && cd /tmp/emu && npm init -y
//   npm i firebase-tools @firebase/rules-unit-testing firebase
//   cp <repo>/firestore.rules .
//   cp <repo>/tests/verifica/583/giro1-regole-col-motore-vero.mjs .
//   cat > firebase.json <<'FINE'
//   { "firestore": { "rules": "firestore.rules" },
//     "emulators": { "firestore": { "port": 8189, "host": "127.0.0.1" },
//                    "ui": { "enabled": false } } }
//   FINE
//   npx firebase emulators:exec --only firestore --project filo-prova-583 \
//     "node giro1-regole-col-motore-vero.mjs"
//
// Esito atteso: tutte le righe verdi, uscita 0. Al giro 1 (2026-09-11) è stato così.
//
// CONTROPROVA fatta insieme: le stesse chiamate con le regole di `main`
// (`git show main:firestore.rules`), dove la lettura anonima del documento
// feedback riusciva e tornava il documento intero. Una prova che passa su
// entrambe le versioni non prova niente.

import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, orderBy, limit,
} from 'firebase/firestore';

const PORT = 8189;
const OWNER = 'owner@filo.test';
const ROUTINE = 'routine@filo.test';
const ESTRANEO = 'chiunque@gmail.com';

let passati = 0;
let falliti = 0;

async function prova(nome, fn) {
  try {
    await fn();
    passati++;
    console.log(`  ok   ${nome}`);
  } catch (e) {
    falliti++;
    console.log(`  ROTT ${nome}\n       ${e?.message || e}`);
  }
}

const env = await initializeTestEnvironment({
  projectId: 'filo-prova-583',
  firestore: { host: '127.0.0.1', port: PORT, rules: (await import('node:fs')).readFileSync('firestore.rules', 'utf8') },
});

// ── Semi: un feedback vero (con dentro roba che non deve uscire), la sua
// scheda pubblica, le allowlist admin/routine, il contatore dei numeri.
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, 'admins', OWNER), { ok: true });
  await setDoc(doc(db, 'routines', ROUTINE), { ok: true });
  await setDoc(doc(db, 'feedback', 'FB1'), {
    text: 'IL TESTO SEGRETO DEL TESTER',
    url: 'https://banca.example/conto-privato',
    title: 'Conto — Banca',
    name: 'Il bottone non risponde',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0)',
    images: ['https://storage/feedback/1_abc.png'],
    notes: 'note di lavorazione in chiaro',
    status: 'done',
    statusPublic: 'closed',
    clientIdHash: 'a'.repeat(32),
    seq: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  // Un documento ANTERIORE al cutover della cifratura: tutto in chiaro.
  await setDoc(doc(db, 'feedback', 'STORICO'), {
    text: 'feedback di maggio 2026, mai cifrato',
    url: 'https://intranet.example/pagina',
    status: 'new',
    seq: 2,
    createdAt: '2026-05-01T00:00:00.000Z',
  });
  await setDoc(doc(db, 'feedback-public', 'FB1'), {
    name: 'Il bottone non risponde',
    seq: 1,
    subSeq: 0,
    status: 'done',
    statusPublic: 'closed',
    resolvedInVersion: '1.2.3',
    createdAt: '2026-01-01T00:00:00.000Z',
    resolvedAt: '2026-02-01T00:00:00.000Z',
    clientIdTag: 'a'.repeat(32),
    userNote: 'Adesso il bottone risponde al primo clic.',
    publishedAt: '2026-02-01T00:00:00.000Z',
    votes: {},
  });
  await setDoc(doc(db, 'counters', 'feedbackSeq'), { value: 7 });
});

const anon = env.unauthenticatedContext().firestore();
const estraneo = env.authenticatedContext('u-estraneo', { email: ESTRANEO, email_verified: true }).firestore();
const nonVerificato = env.authenticatedContext('u-nv', { email: OWNER, email_verified: false }).firestore();
const admin = env.authenticatedContext('u-owner', { email: OWNER, email_verified: true }).firestore();
const routine = env.authenticatedContext('u-routine', { email: ROUTINE, email_verified: true }).firestore();

console.log('\n— la lettura dei feedback NON è pubblica —');
await prova('anonimo: get di un feedback → rifiutato', () =>
  assertFails(getDoc(doc(anon, 'feedback', 'FB1'))));
await prova('anonimo: get di un feedback STORICO in chiaro → rifiutato', () =>
  assertFails(getDoc(doc(anon, 'feedback', 'STORICO'))));
await prova('anonimo: elenco della collezione feedback → rifiutato', () =>
  assertFails(getDocs(collection(anon, 'feedback'))));
await prova('anonimo: query ordinata (la vecchia strada del numero) → rifiutata', () =>
  assertFails(getDocs(query(collection(anon, 'feedback'), orderBy('seq', 'desc'), limit(1)))));
await prova('account Google qualunque, loggato: get di un feedback → rifiutato', () =>
  assertFails(getDoc(doc(estraneo, 'feedback', 'FB1'))));
await prova('account Google qualunque, loggato: elenco → rifiutato', () =>
  assertFails(getDocs(collection(estraneo, 'feedback'))));
await prova('email non verificata sull\'indirizzo dell\'owner → rifiutato', () =>
  assertFails(getDoc(doc(nonVerificato, 'feedback', 'FB1'))));

console.log('\n— i lettori legittimi passano —');
await prova('owner admin: get → passa', () =>
  assertSucceeds(getDoc(doc(admin, 'feedback', 'FB1'))));
await prova('owner admin: elenco → passa', () =>
  assertSucceeds(getDocs(collection(admin, 'feedback'))));
await prova('routine (identità propria): get → passa', () =>
  assertSucceeds(getDoc(doc(routine, 'feedback', 'FB1'))));
await prova('routine: elenco → passa', () =>
  assertSucceeds(getDocs(collection(routine, 'feedback'))));

console.log('\n— l\'invio resta anonimo —');
await prova('anonimo: invio di un feedback → passa', () =>
  assertSucceeds(setDoc(doc(anon, 'feedback', 'NUOVO1'), {
    text: 'non va il salvataggio', url: 'https://x.example', title: 't', name: 'n',
    userAgent: 'UA', clientId: 'c', clientIdHash: 'b'.repeat(32), images: [], files: [],
    createdAt: '2026-09-11T00:00:00.000Z', seq: 8, subSeq: 0, statusPublic: 'open',
  })));
await prova('anonimo: dopo averlo creato NON lo può rileggere', () =>
  assertFails(getDoc(doc(anon, 'feedback', 'NUOVO1'))));
await prova('anonimo: legge il contatore dei numeri', () =>
  assertSucceeds(getDoc(doc(anon, 'counters', 'feedbackSeq'))));
await prova('anonimo: fa avanzare il contatore di UNO', () =>
  assertSucceeds(updateDoc(doc(anon, 'counters', 'feedbackSeq'), { value: 8 })));
await prova('anonimo: NON lo fa tornare indietro', () =>
  assertFails(updateDoc(doc(anon, 'counters', 'feedbackSeq'), { value: 3 })));
await prova('anonimo: NON lo fa saltare in avanti', () =>
  assertFails(updateDoc(doc(anon, 'counters', 'feedbackSeq'), { value: 5000 })));
await prova('anonimo: NON ci mette altro dentro', () =>
  assertFails(updateDoc(doc(anon, 'counters', 'feedbackSeq'), { value: 9, roba: 'x' })));

console.log('\n— la bacheca legge la vista, e SOLO i campi pubblici —');
await prova('anonimo: legge la scheda pubblica', () =>
  assertSucceeds(getDoc(doc(anon, 'feedback-public', 'FB1'))));
await prova('anonimo: elenca le schede pubbliche', () =>
  assertSucceeds(getDocs(collection(anon, 'feedback-public'))));
await prova('nella scheda NON c\'è il testo, l\'URL, lo user agent, gli screenshot, le note', async () => {
  const snap = await getDoc(doc(anon, 'feedback-public', 'FB1'));
  const d = snap.data() || {};
  for (const campo of ['text', 'url', 'title', 'userAgent', 'images', 'files', 'notes', 'clientId', 'clientIdHash', 'priority', 'pipeline']) {
    if (campo in d) throw new Error(`la scheda pubblica porta "${campo}"`);
  }
});
await prova('anonimo: NON scrive una scheda', () =>
  assertFails(setDoc(doc(anon, 'feedback-public', 'FB2'), { name: 'finta', seq: 99, status: 'done' })));
await prova('account qualunque loggato: NON scrive una scheda', () =>
  assertFails(setDoc(doc(estraneo, 'feedback-public', 'FB3'), { name: 'finta', seq: 99, status: 'done' })));
await prova('account qualunque loggato: NON cancella una scheda', () =>
  assertFails(deleteDoc(doc(estraneo, 'feedback-public', 'FB1'))));
await prova('owner: NON può infilare il testo dentro una scheda', () =>
  assertFails(setDoc(doc(admin, 'feedback-public', 'FB1'), {
    name: 'x', seq: 1, status: 'done', text: 'IL TESTO SEGRETO DEL TESTER',
  })));
await prova('owner: NON può infilare l\'URL dentro una scheda', () =>
  assertFails(setDoc(doc(admin, 'feedback-public', 'FB4'), {
    name: 'x', seq: 4, status: 'done', url: 'https://banca.example/conto-privato',
  })));
await prova('owner: NON pubblica la scheda di un feedback APERTO', () =>
  assertFails(setDoc(doc(admin, 'feedback-public', 'FB5'), { name: 'x', seq: 5, status: 'new' })));
await prova('owner: pubblica una scheda regolare', () =>
  assertSucceeds(setDoc(doc(admin, 'feedback-public', 'FB6'), {
    name: 'x', seq: 6, subSeq: 0, status: 'done', statusPublic: 'closed',
    resolvedInVersion: '1.0.0', createdAt: 'a', resolvedAt: 'b', clientIdTag: 'c',
    userNote: 'u', publishedAt: 'p',
  })));
await prova('routine: pubblica una scheda regolare', () =>
  assertSucceeds(setDoc(doc(routine, 'feedback-public', 'FB7'), {
    name: 'y', seq: 7, subSeq: 0, status: 'done', statusPublic: 'closed',
    resolvedInVersion: '1.0.0', createdAt: 'a', resolvedAt: 'b', clientIdTag: 'c',
    userNote: 'u', publishedAt: 'p',
  })));

console.log('\n— i voti della bacheca —');
await prova('utente loggato: vota sulla scheda (solo la sua chiave)', () =>
  assertSucceeds(updateDoc(doc(estraneo, 'feedback-public', 'FB1'), {
    'votes.u-estraneo': { vote: 'works', at: '2026-09-11T00:00:00.000Z', credibilitySnapshot: 1 },
  })));
await prova('utente loggato: NON vota al posto di un altro', () =>
  assertFails(updateDoc(doc(estraneo, 'feedback-public', 'FB1'), {
    'votes.qualcun-altro': { vote: 'works', at: '2026-09-11T00:00:00.000Z', credibilitySnapshot: 1 },
  })));
await prova('anonimo: NON vota', () =>
  assertFails(updateDoc(doc(anon, 'feedback-public', 'FB1'), {
    'votes.chiunque': { vote: 'works', at: 'x', credibilitySnapshot: 1 },
  })));
await prova('utente loggato: NON cambia il titolo col pretesto del voto', () =>
  assertFails(updateDoc(doc(estraneo, 'feedback-public', 'FB1'), {
    'votes.u-estraneo': { vote: 'broken', at: 'x', credibilitySnapshot: 1 },
    name: 'titolo riscritto da un estraneo',
  })));
await prova('utente loggato: segnala la riapertura (solo la sua chiave)', () =>
  assertSucceeds(updateDoc(doc(estraneo, 'feedback-public', 'FB1'), {
    'reopenRequests.u-estraneo': { at: '2026-09-11T00:00:00.000Z' },
  })));


console.log('\n— l\'impronta sulla scheda non raggruppa i fix per segnalatore —');
await prova('owner: NON può mettere sulla scheda l\'impronta dell\'installazione', () =>
  assertFails(setDoc(doc(admin, 'feedback-public', 'FB8'), {
    name: 'x', seq: 8, status: 'done', clientIdHash: 'a'.repeat(32),
  })));

console.log('\n— i voti storici si possono travasare nella scheda —');
await prova('owner: scrive i voti sulla scheda (il travaso dal documento)', () =>
  assertSucceeds(setDoc(doc(admin, 'feedback-public', 'FB6'), {
    name: 'x', seq: 6, subSeq: 0, status: 'done', statusPublic: 'closed',
    resolvedInVersion: '1.0.0', createdAt: 'a', resolvedAt: 'b', clientIdTag: 'c',
    userNote: 'u', publishedAt: 'p',
    votes: { 'uid-a': { vote: 'works', at: 'x', credibilitySnapshot: 1 } },
    reopenRequests: { 'uid-b': { at: 'y' } },
  })));

console.log('\n— i percorsi: conoscenza condivisa, senza chi era —');
await prova('anonimo: scrive un percorso senza identificativo', () =>
  assertSucceeds(setDoc(doc(anon, 'paths', 'P1'), {
    domain: 'esempio.test', initialUrl: '/carrello', intent: 'svuotare il carrello',
    steps: [{ selector: '#a', action: 'click' }], success: true,
    createdAt: new Date().toISOString(),
  })));
await prova('anonimo: NON ci può più attaccare il clientId', () =>
  assertFails(setDoc(doc(anon, 'paths', 'P2'), {
    domain: 'esempio.test', initialUrl: '/carrello', intent: 'svuotare il carrello',
    steps: [], success: true, createdAt: new Date().toISOString(),
    clientId: 'installazione-di-mario',
  })));
await prova('anonimo: NON ci può più attaccare lo user agent', () =>
  assertFails(setDoc(doc(anon, 'paths', 'P3'), {
    domain: 'esempio.test', initialUrl: '/carrello', intent: 'svuotare il carrello',
    steps: [], success: true, createdAt: new Date().toISOString(),
    userAgent: 'Mozilla/5.0 (Windows NT 10.0)',
  })));

console.log('\n— gli allegati: un file sì, l\'elenco no —');
await prova('(storage) la regola di list è chiusa nel file', async () => {
  const s = (await import('node:fs')).readFileSync('storage.rules', 'utf8');
  if (!/allow\s+list\s*:\s*if\s+false/.test(s)) throw new Error('storage.rules: `allow list: if false` non c\'è');
});

await env.cleanup();
console.log(`\n${passati} passate, ${falliti} rotte`);
process.exit(falliti === 0 ? 0 : 1);
