// Verifica locale della pre-approvazione, giro 1 — il campo «fondi senza
// chiedermelo» sulle regole Firestore, provato col MOTORE VERO.
//
// NON è uno spec (finisce in `.mjs`, non `.spec.mjs`): gli servono l'emulatore
// Firestore ufficiale e Java, che nella suite non ci sono. Stesso impianto di
// tests/verifica/585/giro1-regole-col-motore-vero.mjs, a cui rimanda per il
// come si lancia (cartella usa-e-getta fuori dal repo, `npm i firebase-tools
// @firebase/rules-unit-testing firebase`, poi `firebase emulators:exec`).
//
// Cosa deve essere vero: il segno lo scrive e lo toglie SOLO l'owner (admin);
// né una routine, né un utente loggato, né chi non ha fatto login lo scrivono,
// nemmeno infilandolo in una creazione o accanto a un voto. La forma è quella
// stretta ({ by, at }, by non vuoto), e toglierlo è cancellare il campo.
//
// Esito al giro 1 (2026-09-13): tutte le righe verdi, controprova compresa.

import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, deleteField, getDoc } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REGOLE_RAMO = process.env.RULES_FILE || resolve(__dirname, '..', '..', '..', 'firestore.rules');
const REGOLE_MAIN = process.env.RULES_MAIN || '';

const SEGNO = { by: 'capo@esempio.it', at: '2026-09-13T08:00:00.000Z' };
const PRATICA = {
  text: 'Le regole vanno strette.', url: '', title: '', name: 'Regole strette',
  userAgent: 'Filo/33', clientId: 'anon-1', images: [], files: [],
  createdAt: new Date().toISOString(), seq: 501, subSeq: 0,
  status: 'working', statusPublic: 'open',
};

let falliti = 0;
async function prova(nome, fn) {
  try { await fn(); console.log(`ok   ${nome}`); }
  catch (e) { falliti += 1; console.log(`ROSSO ${nome}\n      ${e && e.message ? e.message : e}`); }
}

async function apri(regole, projectId) {
  const env = await initializeTestEnvironment({
    projectId,
    firestore: { host: '127.0.0.1', port: 8095, rules: readFileSync(regole, 'utf8') },
  });
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'admins/capo@esempio.it'), { ok: true });
    await setDoc(doc(db, 'routines/routine@esempio.it'), { ok: true });
    await setDoc(doc(db, 'feedback/pratica-1'), PRATICA);
    await setDoc(doc(db, 'feedback/pratica-segnata'), Object.assign({}, PRATICA, { mergePreapproved: SEGNO }));
  });
  return env;
}

function attori(env) {
  return {
    anonimo: env.unauthenticatedContext().firestore(),
    loggato: env.authenticatedContext('utente-1', { email: 'tizio@esempio.it', email_verified: true }).firestore(),
    routine: env.authenticatedContext('routine-1', { email: 'routine@esempio.it', email_verified: true }).firestore(),
    admin: env.authenticatedContext('capo', { email: 'capo@esempio.it', email_verified: true }).firestore(),
  };
}

// ───────────────────────────── le regole del ramo ──────────────────────────
{
  const env = await apri(REGOLE_RAMO, 'filo-prova-preapprovazione');
  const { anonimo, loggato, routine, admin } = attori(env);

  await prova('ramo: l’owner mette il segno', () =>
    assertSucceeds(updateDoc(doc(admin, 'feedback/pratica-1'), { mergePreapproved: SEGNO })));

  await prova('ramo: l’owner lo mette insieme a un cambio di stato (lo script con --preapprova)', () =>
    assertSucceeds(updateDoc(doc(admin, 'feedback/pratica-1'), { status: 'todo', statusPublic: 'open', mergePreapproved: SEGNO })));

  await prova('ramo: l’owner lo toglie cancellando il campo', async () => {
    await assertSucceeds(updateDoc(doc(admin, 'feedback/pratica-segnata'), { mergePreapproved: deleteField() }));
    const letto = await getDoc(doc(admin, 'feedback/pratica-segnata'));
    if ('mergePreapproved' in (letto.data() || {})) throw new Error('il campo è rimasto');
  });

  await prova('ramo: forma stretta — «by» vuoto no', () =>
    assertFails(updateDoc(doc(admin, 'feedback/pratica-1'), { mergePreapproved: { by: '', at: 'x' } })));
  await prova('ramo: forma stretta — «by» non stringa no', () =>
    assertFails(updateDoc(doc(admin, 'feedback/pratica-1'), { mergePreapproved: { by: 42, at: 'x' } })));
  await prova('ramo: forma stretta — chiave in più no', () =>
    assertFails(updateDoc(doc(admin, 'feedback/pratica-1'), { mergePreapproved: { by: 'a', at: 'x', note: 'no' } })));
  await prova('ramo: forma stretta — «by» oltre 120 caratteri no', () =>
    assertFails(updateDoc(doc(admin, 'feedback/pratica-1'), { mergePreapproved: { by: 'a'.repeat(121), at: 'x' } })));
  await prova('ramo: forma stretta — un booleano al posto della mappa no', () =>
    assertFails(updateDoc(doc(admin, 'feedback/pratica-1'), { mergePreapproved: true })));

  await prova('ramo: una ROUTINE non mette il segno', () =>
    assertFails(updateDoc(doc(routine, 'feedback/pratica-1'), { mergePreapproved: SEGNO })));
  await prova('ramo: una routine non lo infila nemmeno insieme a un passaggio suo', () =>
    assertFails(updateDoc(doc(routine, 'feedback/pratica-1'), { status: 'working', mergePreapproved: SEGNO })));
  await prova('ramo: una routine non lo TOGLIE', () =>
    assertFails(updateDoc(doc(routine, 'feedback/pratica-segnata'), { mergePreapproved: deleteField() })));

  await prova('ramo: un utente loggato non mette il segno', () =>
    assertFails(updateDoc(doc(loggato, 'feedback/pratica-1'), { mergePreapproved: SEGNO })));
  await prova('ramo: un utente loggato non lo infila accanto al proprio voto', () =>
    assertFails(updateDoc(doc(loggato, 'feedback/pratica-1'), {
      votes: { 'utente-1': { vote: 'works', at: new Date().toISOString(), credibilitySnapshot: 0 } },
      mergePreapproved: SEGNO,
    })));
  await prova('ramo: un utente loggato non lo infila accanto a una richiesta di riapertura', () =>
    assertFails(updateDoc(doc(loggato, 'feedback/pratica-1'), {
      reopenRequests: { 'utente-1': { at: new Date().toISOString() } },
      mergePreapproved: SEGNO,
    })));

  await prova('ramo: chi non ha fatto login non mette il segno', () =>
    assertFails(updateDoc(doc(anonimo, 'feedback/pratica-1'), { mergePreapproved: SEGNO })));
  await prova('ramo: una segnalazione NUOVA non nasce già pre-approvata', () =>
    assertFails(setDoc(doc(anonimo, 'feedback/nuova-1'), Object.assign({}, PRATICA, { status: undefined, mergePreapproved: SEGNO }))));
  await prova('ramo: (controllo) la stessa segnalazione senza il segno nasce', () => {
    const d = Object.assign({}, PRATICA); delete d.status;
    return assertSucceeds(setDoc(doc(anonimo, 'feedback/nuova-2'), d));
  });
  await prova('ramo: la lettura resta pubblica, segno compreso', () =>
    assertSucceeds(getDoc(doc(anonimo, 'feedback/pratica-1'))));

  await env.cleanup();
}

// ─────────────────────── controprova: le regole di main ────────────────────
if (REGOLE_MAIN) {
  const env = await apri(REGOLE_MAIN, 'filo-prova-preapprovazione-main');
  const { admin } = attori(env);
  await prova('CONTROPROVA main: prima di questo lavoro nemmeno l’owner poteva scrivere il campo', () =>
    assertFails(updateDoc(doc(admin, 'feedback/pratica-1'), { mergePreapproved: SEGNO })));
  await env.cleanup();
} else {
  console.log('salto  controprova su main: passa RULES_MAIN con `git show main:firestore.rules`');
}

console.log(falliti ? `\n${falliti} righe rosse` : '\ntutto verde');
process.exit(falliti ? 1 : 0);
