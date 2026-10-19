// La migrazione della classe del mittente dalla riga di comando (#1162, SPEC-DOMANDE.md §10): a secco di default, tutti
// i lotti finché il server dà `prossimo`, conti per classe sommati, un errore ferma e lo dice. Il server vero non si tocca.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leggiArgomenti, migraTutto, rigaConto } from '../../scripts/mittenti-migra.mjs';

function serverFinto(lotti) {
  const chiamate = [];
  const chiama = async (data) => {
    chiamate.push(data);
    const l = lotti[chiamate.length - 1];
    if (l instanceof Error) throw l;
    return l;
  };
  return { chiama, chiamate };
}

test('a secco di default; --dal-vero scrive; altro si rifiuta', () => {
  assert.deepEqual(leggiArgomenti([]), { dalVero: false });
  assert.deepEqual(leggiArgomenti(['--dal-vero']), { dalVero: true });
  assert.match(leggiArgomenti(['--force']).errore, /non vale/);
});

test('tutti i lotti col cursore del server, conti per classe sommati', async () => {
  const s = serverFinto([
    { ok: true, dryRun: false, perClasse: { utente: 400, routine: 90 }, giaImpostati: 8, illeggibili: 2, illeggibiliIds: ['a', 'b'], errori: 0, erroriIds: [], prossimo: 'id500' },
    { ok: true, dryRun: false, perClasse: { utente: 3, owner: 1 }, giaImpostati: 0, illeggibili: 0, illeggibiliIds: [], errori: 1, erroriIds: ['z'] },
  ]);
  const t = await migraTutto({ chiama: s.chiama, dalVero: true });
  assert.deepEqual(s.chiamate, [{ op: 'migra', dryRun: false }, { op: 'migra', dryRun: false, dopo: 'id500' }]);
  assert.deepEqual(t.perClasse, { utente: 403, routine: 90, owner: 1 });
  assert.equal(t.lotti, 2);
  assert.equal(t.illeggibili, 2);
  assert.deepEqual(t.erroriIds, ['z']);
  const riga = rigaConto(t);
  assert.match(riga, /^Scritti: 403 utente, 90 routine, 1 owner; 8 avevano già la classe, 2 con un mittente che non si apre \(a, b\), 1 non scritti \(z\)/);
});

test('un rifiuto o un guasto ferma, coi conti fatti fin lì', async () => {
  const rifiuto = await migraTutto({ chiama: serverFinto([{ ok: false, reason: 'not_admin', detail: 'riservato al proprietario' }]).chiama });
  assert.deepEqual([rifiuto.ok, rifiuto.motivo], [false, 'riservato al proprietario']);
  const guasto = await migraTutto({ chiama: serverFinto([{ ok: true, perClasse: { test: 2 }, prossimo: 'x' }, new Error('rete giù')]).chiama });
  assert.deepEqual([guasto.ok, guasto.motivo, guasto.perClasse.test], [false, 'rete giù', 2]);
  const tetto = await migraTutto({ chiama: serverFinto([{ ok: true, prossimo: 'a' }, { ok: true, prossimo: 'b' }]).chiama, tetto: 1 });
  assert.match(tetto.motivo, /tetto/);
});
