// Il tetto di spesa dei giudici per i non fidati (#1515): regole di src/shared/spesaGiudici.js, lettura e scrittura
// nel main (config/automation più il contatore del server), e le parole con cui Gestione spiega un non fidato fermo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const shared = (f) => require(join(ROOT, 'src', 'shared', f));
shared('constants.js');
shared('campoNumero.js');
shared('spesaGiudici.js');
const SG = globalThis.SN_SPESA_GIUDICI;

const ORA = Date.UTC(2026, 9, 22, 15, 30);

test('di fabbrica: 2 dollari al giorno e 40.000 caratteri', () => {
  assert.deepEqual(SG.leggiImpostazioni({}), { tettoUsd: 2, maxCaratteri: 40000 });
  assert.deepEqual(SG.leggiImpostazioni(null), { tettoUsd: 2, maxCaratteri: 40000 });
  assert.deepEqual(SG.CAMPI, { tetto: 'judgeBudgetUsd', caratteri: 'judgeMaxChars' });
});

test('un valore scritto nel documento vale, uno storto torna di fabbrica', () => {
  assert.deepEqual(SG.leggiImpostazioni({ judgeBudgetUsd: 0.5, judgeMaxChars: 20000 }), { tettoUsd: 0.5, maxCaratteri: 20000 });
  assert.deepEqual(SG.leggiImpostazioni({ judgeBudgetUsd: 0 }), { tettoUsd: 0, maxCaratteri: 40000 });
  assert.deepEqual(SG.leggiImpostazioni({ judgeBudgetUsd: -1, judgeMaxChars: 999999 }), { tettoUsd: 2, maxCaratteri: 40000 });
  assert.deepEqual(SG.leggiImpostazioni({ judgeBudgetUsd: '5', judgeMaxChars: 'tanti' }), { tettoUsd: 2, maxCaratteri: 40000 });
});

test('valida: i numeri dell\'owner come li scrive, con la frase di rifiuto e niente aggiustato in silenzio', () => {
  assert.deepEqual(SG.valida({ tettoUsd: '3,5' }), { ok: true, valori: { judgeBudgetUsd: 3.5 } });
  assert.deepEqual(SG.valida({ tettoUsd: 1.239 }), { ok: true, valori: { judgeBudgetUsd: 1.24 } });
  assert.deepEqual(SG.valida({ tettoUsd: 0 }), { ok: true, valori: { judgeBudgetUsd: 0 } });
  assert.deepEqual(SG.valida({ maxCaratteri: '60.000' }), { ok: true, valori: { judgeMaxChars: 60000 } });
  assert.deepEqual(SG.valida({ tettoUsd: null, maxCaratteri: '' }), { ok: true, valori: { judgeBudgetUsd: 2, judgeMaxChars: 40000 } });
  assert.deepEqual(SG.valida({}), { ok: true, valori: {} });

  const neg = SG.valida({ tettoUsd: -1 });
  assert.equal(neg.ok, false);
  assert.match(neg.testo, /^Tetto di spesa dei giudici: non può essere negativo\.$/);
  assert.match(SG.valida({ tettoUsd: 5000 }).testo, /al massimo 1\.000/);
  assert.match(SG.valida({ maxCaratteri: 500 }).testo, /^Lunghezza giudicata: almeno 1\.000\.$/);
  assert.match(SG.valida({ maxCaratteri: 200000 }).testo, /al massimo 130\.000/);
  assert.match(SG.valida({ maxCaratteri: '4,5' }).testo, /intero/);
  assert.match(SG.valida({ tettoUsd: 'due' }).testo, /ci vuole un numero/);
});

test('il giorno del contatore è quello di Greenwich, e riparte a mezzanotte di Greenwich', () => {
  assert.equal(SG.giorno(ORA), '2026-10-22');
  assert.equal(SG.giorno(Date.UTC(2026, 9, 22, 23, 59)), '2026-10-22');
  assert.equal(SG.prossimoGiornoMs(ORA), Date.UTC(2026, 9, 23));
});

test('spesa di oggi: un documento di ieri o assente è zero, uno non letto è ignoto', () => {
  assert.deepEqual(SG.spesaDiOggi({ giorno: '2026-10-22', spesoUsd: 1.95, prenotatoUsd: 0.1 }, ORA), { spesoUsd: 1.95, prenotatoUsd: 0.1 });
  assert.deepEqual(SG.spesaDiOggi({ giorno: '2026-10-21', spesoUsd: 7 }, ORA), { spesoUsd: 0, prenotatoUsd: 0 });
  assert.deepEqual(SG.spesaDiOggi({}, ORA), { spesoUsd: 0, prenotatoUsd: 0 });
  assert.deepEqual(SG.spesaDiOggi({ giorno: '2026-10-22', spesoUsd: -3, prenotatoUsd: 'x' }, ORA), { spesoUsd: 0, prenotatoUsd: 0 });
  assert.equal(SG.spesaDiOggi(null, ORA), null);
});

test('la riga di Gestione: spesa accanto al tetto, tetto pieno detto, ignoto col trattino', () => {
  const sotto = SG.rigaSpesa({ spesoUsd: 0.42, prenotatoUsd: 0 }, 2, ORA);
  assert.equal(sotto.testo, 'Oggi: 0,42 $ su 2,00 $');
  assert.equal(sotto.pieno, false);
  assert.ok(Math.abs(sotto.quota - 0.21) < 1e-9);

  const pieno = SG.rigaSpesa({ spesoUsd: 1.95, prenotatoUsd: 0.1 }, 2, ORA);
  assert.equal(pieno.testo, 'Oggi: 1,95 $ su 2,00 $, più 0,10 $ prenotati per i giudizi in corso');
  assert.equal(pieno.pieno, true);
  assert.equal(pieno.quota, 1);
  assert.match(pieno.dettaglio, /^Tetto raggiunto\. I nuovi feedback dei non fidati aspettano te fino alle \d{2}:\d{2}\.$/);

  const zero = SG.rigaSpesa({ spesoUsd: 0, prenotatoUsd: 0 }, 0, ORA);
  assert.equal(zero.pieno, true, 'con tetto zero nessun non fidato va ai giudici');

  const ignoto = SG.rigaSpesa(null, 2, ORA);
  assert.equal(ignoto.testo, 'Oggi: — su 2,00 $');
  assert.equal(ignoto.quota, null);
});

// ── Il main: config/automation e il contatore, con un Firestore finto che applica la maschera ──
const auth = require(join(ROOT, 'src', 'main', 'auth', 'google-auth.js'));
const Defaults = require(join(ROOT, 'src', 'main', 'services', 'defaultsStore.js'));

function conFirestore(docs, fn, { contatoreGiu = false } = {}) {
  const orig = { fetch: global.fetch };
  const scritture = [];
  const fs = (v) => (typeof v === 'string' ? { stringValue: v } : Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v });
  global.fetch = async (url, opts = {}) => {
    const u = new URL(String(url));
    const percorso = decodeURIComponent(u.pathname.split('/documents/')[1] || '');
    const risposta = (status, corpo) => ({ ok: status < 300, status, async json() { return corpo; }, async text() { return JSON.stringify(corpo); } });
    if ((opts.method || 'GET') === 'PATCH') {
      const maschera = u.searchParams.getAll('updateMask.fieldPaths');
      const corpo = JSON.parse(opts.body).fields;
      scritture.push({ percorso, maschera, corpo });
      docs[percorso] = docs[percorso] || {};
      for (const k of maschera) docs[percorso][k] = Number(Object.values(corpo[k])[0]);
      return risposta(200, {});
    }
    if (percorso === 'identities/spesa-giudici' && contatoreGiu) throw new Error('rete');
    if (!(percorso in docs)) return risposta(404, {});
    const fields = {};
    for (const [k, v] of Object.entries(docs[percorso])) fields[k] = fs(v);
    return risposta(200, { fields });
  };
  Defaults._setAdesso(() => ORA);
  return Promise.resolve(fn(scritture)).finally(() => { global.fetch = orig.fetch; Defaults._setAdesso(Date.now); });
}

test('il main legge tetto, lunghezza e spesa di oggi; documento vuoto = di fabbrica e niente speso', async () => {
  await conFirestore({ 'config/automation': { enabled: 'x' } }, async () => {
    const r = await Defaults.getJudgeBudget('token');
    assert.deepEqual(r, { tettoUsd: 2, maxCaratteri: 40000, spesa: { spesoUsd: 0, prenotatoUsd: 0 }, oraMs: ORA });
  });
  await conFirestore({
    'config/automation': { judgeBudgetUsd: 3, judgeMaxChars: 50000 },
    'identities/spesa-giudici': { giorno: '2026-10-22', spesoUsd: 1.25, prenotatoUsd: 0.1 },
  }, async () => {
    const r = await Defaults.getJudgeBudget('token');
    assert.deepEqual(r, { tettoUsd: 3, maxCaratteri: 50000, spesa: { spesoUsd: 1.25, prenotatoUsd: 0.1 }, oraMs: ORA });
  });
});

test('il contatore non letto è ignoto, non zero', async () => {
  await conFirestore({ 'config/automation': {} }, async () => {
    const r = await Defaults.getJudgeBudget('token');
    assert.equal(r.spesa, null);
  }, { contatoreGiu: true });
});

test('un valore nuovo arriva in config/automation, solo nel suo campo', async () => {
  const docs = { 'config/automation': { enabled: 1 } };
  await conFirestore(docs, async (scritture) => {
    const r = await Defaults.setJudgeBudget({ tettoUsd: '1,5' }, 'token');
    assert.equal(scritture.length, 1);
    assert.equal(scritture[0].percorso, 'config/automation');
    assert.deepEqual(scritture[0].maschera, ['judgeBudgetUsd']);
    assert.deepEqual(scritture[0].corpo, { judgeBudgetUsd: { doubleValue: 1.5 } });
    assert.equal(r.tettoUsd, 1.5);
    assert.equal(r.maxCaratteri, 40000);
    assert.equal(docs['config/automation'].enabled, 1, 'gli altri campi restano');

    await Defaults.setJudgeBudget({ maxCaratteri: 60000 }, 'token');
    assert.deepEqual(scritture[1].maschera, ['judgeMaxChars']);
    assert.equal(docs['config/automation'].judgeMaxChars, 60000);
  });
});

test('un valore storto non parte e dice perché', async () => {
  await conFirestore({ 'config/automation': {} }, async (scritture) => {
    await assert.rejects(() => Defaults.setJudgeBudget({ tettoUsd: -2 }, 'token'), /non può essere negativo/);
    await assert.rejects(() => Defaults.setJudgeBudget({}, 'token'), /niente da salvare/);
    await assert.rejects(() => Defaults.setJudgeBudget({ tettoUsd: 1 }, null), /ID token admin/);
    assert.equal(scritture.length, 0);
  });
});

// ── Gestione: il non fidato fermo per tetto o lunghezza non è «in attesa del giudizio» ──
shared('feedbackTransitions.js');
shared('feedbackStatus.js');
shared('mittenti.js');
shared('feedbackThread.js');
shared('manageReview.js');
const MR = globalThis.SN_MANAGE_REVIEW;

test('Gestione spiega perché un non fidato non è stato giudicato, e come farlo giudicare', () => {
  const tetto = MR.judgesNote({ status: 'unlabeled', statusReason: 'budget_giudici', pipeline: {} });
  assert.match(tetto.text, /tetto/);
  assert.match(tetto.text, /Ri-valuta i non filtrati/);
  const lungo = MR.judgesNote({ status: 'unlabeled', statusReason: 'lunghezza_giudici', pipeline: {} });
  assert.match(lungo.text, /troppo lungo per i giudici/);
  assert.equal(MR.judgesNote({ status: 'unlabeled', pipeline: {} }).text, 'In attesa del giudizio.');
  assert.equal(MR.reasonText('budget_giudici'), 'tetto di spesa dei giudici raggiunto');
  assert.equal(MR.reasonText('lunghezza_giudici'), 'troppo lungo per i giudici');
  // Resta fra i «non filtrati»: è la strada con cui l'owner lo manda ai giudici lo stesso.
  assert.equal(MR.classifyBlock({ status: 'unlabeled', statusReason: 'budget_giudici', pipeline: {} }).reason, 'unfiltered');
});
