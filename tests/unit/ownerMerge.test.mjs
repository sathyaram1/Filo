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
    // cosa fa dopo. Una settimana (decisione owner 2026-08-28): l'approvazione
    // non deve essere un appuntamento quotidiano.
    assert.match(msg, /7 giorni/);
    assert.doesNotMatch(msg, /24 ore|mezz'ora|mezz’ora/);
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

// Risposta VERA di runOwnerMerge (filo-security, giroLocale di test/lavori-locali-908.test.js):
// se la forma cambia là, va ricopiata qui, o il finish smette di dire cosa è successo alla pratica.
const BLOCCO = { gate: 'guard_the_guards', label: 'Tocca aree protette (guardie, regole del database, chiavi, automatismi)', detail: 'firestore.rules' };
const RISPOSTA_908 = {
  ok: true, result: 'merged', sha: 'c'.repeat(40),
  local: { feedbackId: 'fid908', eligible: true, num: '#908', skippedL5: true, record: 'traccia-1', closed: true, blocks: [BLOCCO] },
};
const NON_AMMESSA = { feedbackId: 'fid908', eligible: false, reason: 'mittente_non_provato', detail: 'il feedback non porta la prova del mittente (senderProof admin)' };

describe('la pratica del lavoro locale (#908)', () => {
  test('fuso saltando L5, risposta vera del server: L5 saltato, blocchi registrati, pratica chiusa', () => {
    const r = classifyOwnerMerge(200, risposta(RISPOSTA_908));
    assert.equal(r.outcome, 'merged');
    assert.equal(r.skippedL5, true);
    assert.deepEqual(r.blocks, [BLOCCO]);
    assert.equal(r.closed, true);
    const msg = messageForOwnerMerge(r, 'claude/x', { feedbackId: 'fid908' });
    assert.match(msg, /^✓/);
    assert.match(msg, /L5 saltato.*#908/, 'il numero arriva dal server anche senza quello del finish');
    assert.match(msg, /Blocchi registrati \(1\)[^\n]*\n\s+· Tocca aree protette .*: firestore\.rules/);
    assert.match(msg, /Pratica #908 chiusa/);
    assert.doesNotMatch(msg, /NON si è registrata/);
    assert.equal(exitCodeForOwnerMerge(r), 0);
  });

  test('blocchi col solo nome, o con un elenco lunghissimo: si stampano, e un taglio si dichiara', () => {
    const lungo = Array.from({ length: 400 }, (_, i) => `src/file-${i}.js`).join(', ');
    const corpo = { ...RISPOSTA_908, local: { ...RISPOSTA_908.local, blocks: ['new_dependency', { ...BLOCCO, detail: lungo }] } };
    const msg = messageForOwnerMerge(classifyOwnerMerge(200, risposta(corpo)), 'claude/x', {});
    assert.match(msg, /· new_dependency\n/);
    assert.match(msg, /src\/file-0\.js.*… \(elenco intero nella nota della pratica\)/);
  });

  test('fuso ma la pratica non si è chiusa: si dice, con il comando per chiuderla', () => {
    const corpo = { ...RISPOSTA_908, local: { ...RISPOSTA_908.local, closed: false } };
    const msg = messageForOwnerMerge(classifyOwnerMerge(200, risposta(corpo)), 'claude/x', { feedbackId: 'fid908', feedbackNum: 908 });
    assert.match(msg, /La pratica #908 NON si è chiusa\. Chiudila a mano: npm run feedback -- fid908 done .* --come-routine/);
  });

  test('fuso con blocchi ma senza traccia: si dice che l’elenco non è in Automazioni', () => {
    const corpo = { ...RISPOSTA_908, local: { ...RISPOSTA_908.local, record: '' } };
    const msg = messageForOwnerMerge(classifyOwnerMerge(200, risposta(corpo)), 'claude/x', { feedbackNum: 908 });
    assert.match(msg, /traccia dei blocchi NON si è registrata/);
  });

  test('fuso con L5 pulito: niente riga su L5, la pratica chiusa sì', () => {
    const corpo = { ...RISPOSTA_908, local: { feedbackId: 'fid908', eligible: true, num: '#908', skippedL5: false, record: '', closed: true } };
    const msg = messageForOwnerMerge(classifyOwnerMerge(200, risposta(corpo)), 'claude/x', {});
    assert.doesNotMatch(msg, /L5 saltato/);
    assert.match(msg, /Pratica #908 chiusa/);
  });

  test('fuso con L5 pulito ma pratica non ammessa: resta aperta, e si dice perché', () => {
    const corpo = { ok: true, result: 'merged', sha: 'd'.repeat(40), local: NON_AMMESSA };
    const msg = messageForOwnerMerge(classifyOwnerMerge(200, risposta(corpo)), 'claude/x', { feedbackId: 'fid908', feedbackNum: 908 });
    assert.match(msg, /^✓/);
    assert.match(msg, /Pratica #908 non chiusa: il feedback non porta la prova del mittente/);
    assert.match(msg, /npm run feedback -- fid908 done/);
  });

  test('bloccato con la pratica, risposta vera del server: dice perché L5 non è stato saltato, e aspetta il sì senza parlare di muri', () => {
    const corpo = { ok: true, result: 'blocked', reason: 'x', trips: [{ gate: 'guard_the_guards', detail: 'firestore.rules' }], requestId: 'richiesta-1', local: NON_AMMESSA };
    const r = classifyOwnerMerge(200, risposta(corpo));
    assert.equal(r.localReason, 'mittente_non_provato');
    const msg = messageForOwnerMerge(r, 'claude/x', { feedbackId: 'fid908' });
    assert.match(msg, /L5 non è stato saltato: il feedback non porta la prova/);
    assert.match(msg, /aspetta il tuo sì/);
    assert.doesNotMatch(msg, /non si aggirano|da qui non|unica strada/);
  });

  test('bloccato senza pratica: ricorda come legarla', () => {
    const msg = messageForOwnerMerge({ outcome: 'blocked', reason: 'x', requestId: 'ab12' }, 'claude/x');
    assert.match(msg, /--feedback/);
  });

  test('la domanda porta feedbackId solo quando c’è', async () => {
    process.env.FILO_ADMIN_REFRESH_TOKEN = 'refresh-finto';
    const corpi = [];
    const vero = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ id_token: 'id-finto' }), text: async () => '' });
    const fetchImpl = async (_u, opts) => {
      corpi.push(JSON.parse(opts.body));
      return { status: 200, text: async () => JSON.stringify({ result: { ok: true, result: 'merged', sha: 'd' } }) };
    };
    try {
      await askServerMerge({ branch: 'claude/x', sha: 'a'.repeat(40), feedbackId: 'xEedWgj3AnlLh3lTZ5z5', fetchImpl, url: 'https://esempio/ownerMerge' });
      await askServerMerge({ branch: 'claude/x', sha: 'a'.repeat(40), fetchImpl, url: 'https://esempio/ownerMerge' });
    } finally {
      globalThis.fetch = vero;
      delete process.env.FILO_ADMIN_REFRESH_TOKEN;
    }
    assert.deepEqual(corpi[0], { data: { branch: 'claude/x', sha: 'a'.repeat(40), feedbackId: 'xEedWgj3AnlLh3lTZ5z5' } });
    assert.deepEqual(corpi[1], { data: { branch: 'claude/x', sha: 'a'.repeat(40) } });
  });
});
