// Chiedere al server di fondere — SPEC-RIDISEGNO-MAX.md §10
//
// Da qui passa la chiusura del buco del push diretto: `npm run finish` non
// scrive più su main, lo CHIEDE. Quello che resta di delicato in locale è la
// traduzione della risposta: se un blocco dei controlli sembrasse un guasto di
// rete, o se un esito qualsiasi uscisse con codice zero, si tornerebbe a
// credere pubblicato un lavoro che non è mai arrivato da nessuna parte.
//
// I casi qui sotto sono tutti reali: il server che non è ancora stato
// rideployato, il ramo che cambia mentre si chiude, la credenziale mancante da
// una parte o dall'altra.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyOwnerMerge,
  messageForOwnerMerge,
  exitCodeForOwnerMerge,
  askServerMerge,
} from '../../scripts/lib/owner-merge.mjs';

const risposta = (result) => ({ result });

describe('leggere la risposta del server', () => {
  test('fuso: l’esito porta con sé lo sha del commit di fusione', () => {
    const r = classifyOwnerMerge(200, risposta({ ok: true, result: 'merged', sha: 'abc123def456' }));
    assert.deepEqual(r, { outcome: 'merged', sha: 'abc123def456' });
  });

  test('bloccato dai controlli: si conserva COSA ha bloccato, o non si sa cosa guardare', () => {
    const r = classifyOwnerMerge(200, risposta({ ok: true, result: 'blocked', reason: 'guard_the_guards: firestore.rules' }));
    assert.equal(r.outcome, 'blocked');
    assert.match(r.reason, /firestore\.rules/);
  });

  test('bloccato: si porta dietro la richiesta aperta dal server (o il fatto che non c’è)', () => {
    const con = classifyOwnerMerge(200, risposta({ ok: true, result: 'blocked', reason: 'x', requestId: 'ab12cd34ef56ab12cd34ef56' }));
    assert.equal(con.requestId, 'ab12cd34ef56ab12cd34ef56');
    const senza = classifyOwnerMerge(200, risposta({ ok: true, result: 'blocked', reason: 'x' }));
    assert.equal(senza.requestId, '');
  });

  test('conflitto e ramo cambiato sono esiti DIVERSI: portano a due gesti diversi', () => {
    assert.equal(classifyOwnerMerge(200, risposta({ ok: true, result: 'conflict' })).outcome, 'conflict');
    const stale = classifyOwnerMerge(200, risposta({ ok: true, result: 'stale', headSha: 'ff00ff00' }));
    assert.equal(stale.outcome, 'stale');
    assert.equal(stale.headSha, 'ff00ff00');
  });

  test('il server senza credenziale per scrivere non è il server irraggiungibile', () => {
    assert.equal(classifyOwnerMerge(200, risposta({ ok: false, reason: 'github_no_token' })).outcome, 'no_credential');
    assert.equal(classifyOwnerMerge(200, risposta({ ok: false, reason: 'github_unreachable' })).outcome, 'unreachable');
    assert.equal(classifyOwnerMerge(200, risposta({ ok: false, reason: 'github_503' })).outcome, 'unreachable');
    assert.equal(classifyOwnerMerge(200, risposta({ ok: false, reason: 'github_no_installation' })).outcome, 'fault');
  });

  test('funzione non ancora deployata (404): si dice, invece di far cercare a caso', () => {
    assert.equal(classifyOwnerMerge(404, { error: { message: 'Not Found' } }).outcome, 'not_deployed');
  });

  test('non riconosciuto come proprietario vs richiesta sbagliata', () => {
    assert.equal(classifyOwnerMerge(403, { error: { message: 'Riservato al proprietario.' } }).outcome, 'denied');
    assert.equal(classifyOwnerMerge(401, {}).outcome, 'denied');
    const rifiutata = classifyOwnerMerge(400, { error: { message: 'ramo non fondibile: "main"' } });
    assert.equal(rifiutata.outcome, 'rejected');
    assert.match(rifiutata.reason, /main/);
  });

  test('rete morta o server in errore → irraggiungibile, mai un silenzio che sembra un sì', () => {
    assert.equal(classifyOwnerMerge(0, {}).outcome, 'unreachable');
    assert.equal(classifyOwnerMerge(500, {}).outcome, 'unreachable');
  });

  test('una risposta che non si capisce NON è una fusione', () => {
    assert.equal(classifyOwnerMerge(200, {}).outcome, 'fault');
    assert.equal(classifyOwnerMerge(200, risposta({ ok: true, result: 'boh' })).outcome, 'fault');
    assert.equal(classifyOwnerMerge(200, null).outcome, 'fault');
  });
});

describe('come si chiude il comando', () => {
  test('esce con zero SOLO se il codice è arrivato su main', () => {
    assert.equal(exitCodeForOwnerMerge({ outcome: 'merged' }), 0);
    for (const outcome of [
      'blocked', 'conflict', 'stale', 'no_credential', 'not_deployed',
      'denied', 'rejected', 'unreachable', 'fault', 'no_owner_credential', undefined,
    ]) {
      assert.notEqual(exitCodeForOwnerMerge({ outcome }), 0,
        `"${outcome}" non è una pubblicazione: uscire con zero direbbe il contrario`);
    }
  });

  test('gli esiti che l’owner deve distinguere hanno codici distinti', () => {
    const codici = ['blocked', 'conflict', 'stale'].map((outcome) => exitCodeForOwnerMerge({ outcome }));
    assert.equal(new Set(codici).size, 3);
  });
});

describe('cosa legge l’owner', () => {
  test('ogni esito dice cosa fare adesso, senza gergo', () => {
    const atteso = {
      merged: /fuso su main/i,
      blocked: /BLOCCAT/,
      conflict: /pull --rebase origin main/,
      stale: /rilancia/i,
      no_credential: /Nessuna fusione/i,
      not_deployed: /rideploy/i,
      denied: /admin-login/,
      no_owner_credential: /admin-login/,
      unreachable: /riprova/i,
      fault: /Nessuna fusione/i,
    };
    for (const [outcome, re] of Object.entries(atteso)) {
      const msg = messageForOwnerMerge({ outcome, reason: 'motivo', sha: 'abcdef1234', headSha: 'ff00ff00' }, 'claude/x');
      assert.match(msg, re, `l’esito "${outcome}" non dice all’owner cosa sta succedendo`);
    }
  });

  test('bloccato con richiesta aperta: dice DOVE approvarla, non "decidi tu"', () => {
    // Il lavoro locale tocca le aree protette quasi sempre. Un messaggio che si
    // ferma al blocco lascia chi legge senza nessuna mossa possibile: su main,
    // da questa macchina, non scrive più nessuno.
    const msg = messageForOwnerMerge(
      { outcome: 'blocked', reason: 'guard_the_guards: firestore.rules', requestId: 'ab12cd34ef56ab12cd34ef56' },
      'claude/x'
    );
    assert.match(msg, /in attesa/i);
    // Il posto è UNO (scelta owner 2026-08-26): la dashboard di gestione, in
    // cima ai Ricevuti. Il vecchio messaggio mandava sulla prima schermata,
    // che l'avviso non lo mostra più: un'indicazione sbagliata è peggio di
    // nessuna indicazione.
    assert.match(msg, /dashboard di gestione/i);
    assert.match(msg, /Ricevuti/);
    assert.doesNotMatch(msg, /prima schermata|in cima alla home/i);
    // Quanto dura si dice QUI: è l'unico posto dove l'owner sta guardando nel
    // momento in cui la richiesta nasce, e sapere se deve correre o no cambia
    // cosa fa dopo. Un giorno, non mezz'ora: rifarla costa un giro intero.
    assert.match(msg, /24 ore/);
    assert.doesNotMatch(msg, /mezz'ora|mezz’ora/);
    // E che una pagina già aperta se ne accorge da sola: senza questa riga
    // l'owner chiude e riapre una scheda per far comparire l'avviso.
    assert.match(msg, /già apert/i);
  });

  test('bloccato SENZA richiesta: non promette un avviso che non comparirà mai', () => {
    const msg = messageForOwnerMerge({ outcome: 'blocked', reason: 'x' }, 'claude/x');
    assert.doesNotMatch(msg, /approvala da Filo/i);
    assert.match(msg, /non comparirà niente|non sono riuscito/i);
  });

  test('un esito diverso da "fuso" non dice mai che è stato pubblicato', () => {
    for (const outcome of ['blocked', 'conflict', 'stale', 'unreachable', 'fault', 'no_credential']) {
      const msg = messageForOwnerMerge({ outcome }, 'claude/x');
      assert.ok(msg.startsWith('✗'), `"${outcome}" deve leggersi come un no a colpo d’occhio`);
    }
  });
});

describe('la chiamata al server', () => {
  const RAMO = 'claude/ridisegno-max';
  const SHA = 'a'.repeat(40);

  test('manda ramo e sha nella forma che il server si aspetta, col biglietto d’identità', async () => {
    process.env.FILO_ADMIN_REFRESH_TOKEN = 'refresh-finto';
    const visto = [];
    const fetchImpl = async (url, opts) => {
      visto.push({ url, opts });
      // Prima chiamata: lo scambio del refresh token con un token d'accesso.
      if (String(url).includes('securetoken')) {
        return { ok: true, status: 200, json: async () => ({ id_token: 'id-finto' }), text: async () => '' };
      }
      return { status: 200, text: async () => JSON.stringify({ result: { ok: true, result: 'merged', sha: 'deadbeef' } }) };
    };
    // Il minting del token passa dal fetch globale: lo si sostituisce per il
    // tempo del test (nessuna rete, nessuna credenziale vera).
    const vero = globalThis.fetch;
    globalThis.fetch = fetchImpl;
    try {
      const r = await askServerMerge({ branch: RAMO, sha: SHA, fetchImpl, url: 'https://esempio/ownerMerge' });
      assert.deepEqual(r, { outcome: 'merged', sha: 'deadbeef' });
    } finally {
      globalThis.fetch = vero;
      delete process.env.FILO_ADMIN_REFRESH_TOKEN;
    }

    const chiamata = visto.find((v) => String(v.url).includes('ownerMerge'));
    assert.ok(chiamata, 'la richiesta di fusione deve partire');
    assert.equal(chiamata.opts.headers.Authorization, 'Bearer id-finto');
    assert.deepEqual(JSON.parse(chiamata.opts.body), { data: { branch: RAMO, sha: SHA } });
  });

  test('server irraggiungibile: esito dichiarato, nessuna eccezione che risale', async () => {
    process.env.FILO_ADMIN_REFRESH_TOKEN = 'refresh-finto';
    const vero = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ id_token: 'id-finto' }), text: async () => '' });
    try {
      const r = await askServerMerge({
        branch: RAMO,
        sha: SHA,
        url: 'https://esempio/ownerMerge',
        fetchImpl: async () => { throw new Error('ENOTFOUND'); },
      });
      assert.equal(r.outcome, 'unreachable');
      assert.notEqual(exitCodeForOwnerMerge(r), 0);
    } finally {
      globalThis.fetch = vero;
      delete process.env.FILO_ADMIN_REFRESH_TOKEN;
    }
  });
});
