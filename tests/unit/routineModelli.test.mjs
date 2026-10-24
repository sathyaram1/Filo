// Modello e sforzo per fase (#1193): le regole di SN_ROUTINE_MODELLI e la forma che il main scrive in
// config/routines.roleModels, foglia per foglia, con la PATCH vera di defaultsStore e un fetch finto.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const radice = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const Defaults = require(join(radice, 'src', 'main', 'services', 'defaultsStore.js'));
const RM = globalThis.SN_ROUTINE_MODELLI;

const risposta = (fields) => ({ ok: true, status: 200, async json() { return { fields }; }, async text() { return ''; } });

async function conFetch(finto, fn) {
  const vero = global.fetch;
  global.fetch = finto;
  try { return await fn(); } finally { global.fetch = vero; }
}

test('le fasi e le scelte sono quelle che il server legge', () => {
  assert.deepEqual(RM.RUOLI.map((r) => r.id), ['new-work', 'verifier', 'fixer', 'secaudit']);
  assert.deepEqual(RM.SCELTE.model.map((s) => s.id), ['opus', 'sonnet', 'haiku', 'fable']);
  assert.deepEqual(RM.SCELTE.effort.map((s) => s.id), ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.equal(RM.CAMPO, 'roleModels');
});

test('un documento senza roleModels vale la definizione dell\'agente per tutte le fasi', () => {
  const vuoto = RM.leggiDoc({});
  for (const r of RM.RUOLI) assert.deepEqual(vuoto[r.id], { model: '', effort: '' });
  assert.deepEqual(RM.leggiDoc(null), vuoto);
  assert.deepEqual(RM.leggiDoc({ roleModels: 'storto' }), vuoto);
  assert.deepEqual(RM.leggiDoc({ roleModels: ['opus'] }), vuoto);
});

test('il documento si legge com\'è, e un valore scritto a mano non diventa «definizione dell\'agente»', () => {
  const t = RM.leggiDoc({ roleModels: { 'new-work': { model: 'sonnet' }, verifier: { effort: 'low', model: 'opus' }, fixer: {} } });
  assert.deepEqual(t['new-work'], { model: 'sonnet', effort: '' });
  assert.deepEqual(t.verifier, { model: 'opus', effort: 'low' });
  assert.deepEqual(t.fixer, { model: '', effort: '' });
  // Fuori elenco: il server potrebbe usarlo, quindi la pagina deve vederlo.
  assert.equal(RM.leggiDoc({ roleModels: { secaudit: { model: 'claude-opus-4' } } }).secaudit.model, 'claude-opus-4');
  assert.equal(RM.inElenco('model', 'claude-opus-4'), false);
  // Una fase sconosciuta e le chiavi ereditate non entrano nella tabella.
  const strana = RM.leggiDoc(JSON.parse('{"roleModels":{"orchestrator":{"model":"opus"},"__proto__":{"model":"opus"}}}'));
  assert.deepEqual(Object.keys(strana), RM.RUOLI.map((r) => r.id));
  assert.equal(RM.leggiDoc({ roleModels: { verifier: { model: 7 } } }).verifier.model, '');
});

test('si valida una scelta sola, e una storta si rifiuta dicendo cosa vale', () => {
  assert.deepEqual(RM.valida({ ruolo: 'fixer', campo: 'effort', valore: 'max' }), { ok: true, ruolo: 'fixer', campo: 'effort', valore: 'max' });
  assert.equal(RM.valida({ ruolo: 'secaudit', campo: 'model', valore: '' }).ok, true, 'vuoto = torna alla definizione dell\'agente');
  for (const storto of [
    { ruolo: 'orchestrator', campo: 'model', valore: 'opus' },
    { ruolo: '__proto__', campo: 'model', valore: 'opus' },
    { ruolo: 'verifier', campo: 'temperature', valore: 'opus' },
    { ruolo: 'verifier', campo: 'model', valore: 'Opus' },
    { ruolo: 'verifier', campo: 'model', valore: 'xhigh' },
    { ruolo: 'verifier', campo: 'effort', valore: 'opus' },
    { ruolo: 'verifier', campo: 'effort', valore: null },
    { ruolo: 'verifier', campo: 'effort', valore: ' high' },
  ]) {
    const esito = RM.valida(storto);
    assert.equal(esito.ok, false, JSON.stringify(storto));
    assert.match(esito.testo, /Non salvato/);
  }
  assert.match(RM.valida({ ruolo: 'verifier', campo: 'effort', valore: 'altissimo' }).testo, /low, medium, high, xhigh, max/);
});

test('il percorso della foglia mette fra apici inversi il ruolo col trattino', () => {
  assert.equal(RM.percorso('new-work', 'model'), 'roleModels.`new-work`.model');
  assert.equal(RM.percorso('verifier', 'effort'), 'roleModels.verifier.effort');
});

test('la forma salvata: una foglia per scelta, e vuoto la toglie senza toccare il resto', async () => {
  const scritture = [];
  const doc = { roleModels: { mapValue: { fields: { verifier: { mapValue: { fields: { effort: { stringValue: 'low' } } } } } } } };
  await conFetch(async (url, opts = {}) => {
    if ((opts.method || 'GET') === 'PATCH') {
      scritture.push({ mask: new URL(String(url)).searchParams.getAll('updateMask.fieldPaths'), corpo: JSON.parse(opts.body) });
      return risposta({});
    }
    return risposta(doc);
  }, async () => {
    const r = await Defaults.setRoutineRoleModel({ ruolo: 'new-work', campo: 'model', valore: 'sonnet' }, 'tok');
    assert.equal(r.letto, true);
    assert.deepEqual(r.scritto, { ruolo: 'new-work', campo: 'model', valore: 'sonnet' });
    assert.deepEqual(r.roleModels.verifier, { model: '', effort: 'low' });

    await Defaults.setRoutineRoleModel({ ruolo: 'verifier', campo: 'effort', valore: '' }, 'tok');
  });
  assert.deepEqual(scritture[0], {
    mask: ['roleModels.`new-work`.model'],
    corpo: { fields: { roleModels: { mapValue: { fields: { 'new-work': { mapValue: { fields: { model: { stringValue: 'sonnet' } } } } } } } } },
  });
  // Nella maschera senza valore: Firestore toglie la foglia, e lo sforzo resta assente = definizione dell'agente.
  assert.deepEqual(scritture[1], { mask: ['roleModels.verifier.effort'], corpo: { fields: {} } });
});

test('un valore storto non arriva al server, e senza token non si scrive', async () => {
  let chiamate = 0;
  await conFetch(async () => { chiamate += 1; return risposta({}); }, async () => {
    await assert.rejects(() => Defaults.setRoutineRoleModel({ ruolo: 'verifier', campo: 'model', valore: 'gpt' }, 'tok'), /Non salvato/);
    await assert.rejects(() => Defaults.setRoutineRoleModel({ ruolo: 'verifier', campo: 'model', valore: 'opus' }, ''), /ID token/);
  });
  assert.equal(chiamate, 0);
});

test('non letto non vale «definizione dell\'agente»; scritto ma non riletto lo dice', async () => {
  await conFetch(async () => { throw new Error('offline'); }, async () => {
    await assert.rejects(() => Defaults.getRoutineRoleModels('tok'), /non raggiungibili/);
  });
  await conFetch(async (url, opts = {}) => {
    if ((opts.method || 'GET') === 'PATCH') return risposta({});
    throw new Error('offline');
  }, async () => {
    const r = await Defaults.setRoutineRoleModel({ ruolo: 'secaudit', campo: 'effort', valore: 'xhigh' }, 'tok');
    assert.deepEqual(r, { letto: false, scritto: { ruolo: 'secaudit', campo: 'effort', valore: 'xhigh' } });
  });
});
