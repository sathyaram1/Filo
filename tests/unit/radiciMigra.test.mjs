// La migrazione delle radici dalla riga di comando (#1918, SPEC-DOMANDE.md §1.7): a secco di default, collezione dopo
// collezione col cursore del server, conti sommati, un errore ferma e lo dice. Il server vero non si tocca.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leggiArgomenti, migraTutto, rigaConto } from '../../scripts/radici-migra.mjs';

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

test('a secco di default; --dal-vero scrive; altro si rifiuta col nome giusto', () => {
  assert.deepEqual(leggiArgomenti([]), { dalVero: false });
  assert.deepEqual(leggiArgomenti(['--dal-vero']), { dalVero: true });
  assert.match(leggiArgomenti(['--force']).errore, /radici:migra/);
});

test('dentro una collezione segue `prossimo`, poi passa a `prossimaCollezione`, e si ferma all’ultima', async () => {
  const s = serverFinto([
    { ok: true, collezione: 'feedback', migrati: 300, legacy: 290, giaFatti: 0, errori: 0, erroriIds: [], prossimo: 'f300' },
    { ok: true, collezione: 'feedback', migrati: 10, legacy: 9, giaFatti: 5, errori: 0, erroriIds: [], prossimaCollezione: 'domande' },
    { ok: true, collezione: 'domande', migrati: 29, legacy: 29, giaFatti: 0, errori: 1, erroriIds: ['D-3'], prossimaCollezione: 'stati' },
    { ok: true, collezione: 'stati', migrati: 2, legacy: 2, giaFatti: 0, errori: 0, erroriIds: [] },
  ]);
  const t = await migraTutto({ chiama: s.chiama, dalVero: true });
  assert.deepEqual(s.chiamate, [
    { op: 'migraRadici', dryRun: false },
    { op: 'migraRadici', dryRun: false, collezione: 'feedback', dopo: 'f300' },
    { op: 'migraRadici', dryRun: false, collezione: 'domande' },
    { op: 'migraRadici', dryRun: false, collezione: 'stati' },
  ]);
  assert.equal(t.ok, true);
  assert.equal(t.migrati, 341);
  assert.equal(t.legacy, 330);
  assert.deepEqual(t.perCollezione, { feedback: 310, domande: 29, stati: 2 });
  assert.deepEqual(t.erroriIds, ['domande/D-3']);
  assert.match(rigaConto(t), /^Scritte: radici a 341 documenti \(feedback 310, domande 29, stati 2\), 330 con legacy/);
});

test('un rifiuto del server ferma, coi conti fatti fin lì', async () => {
  const s = serverFinto([
    { ok: true, collezione: 'feedback', migrati: 3, legacy: 1, giaFatti: 0, errori: 0, erroriIds: [], prossimaCollezione: 'domande' },
    { ok: false, reason: 'not_admin', detail: 'riservato al proprietario' },
  ]);
  const t = await migraTutto({ chiama: s.chiama });
  assert.equal(t.ok, false);
  assert.equal(t.motivo, 'riservato al proprietario');
  assert.equal(t.migrati, 3);
  assert.equal(t.dryRun, true);
});

test('il tetto dei lotti ferma un server che non smette, e lo dice', async () => {
  const chiama = async () => ({ ok: true, collezione: 'feedback', migrati: 1, prossimo: `x${Math.random()}` });
  const t = await migraTutto({ chiama, tetto: 3 });
  assert.equal(t.ok, false);
  assert.match(t.motivo, /fermo dopo 3 lotti/);
});
