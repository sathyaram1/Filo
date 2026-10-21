// La migrazione delle attese in domande dalla riga di comando (#1358): a secco di default, tutti i lotti finché il server
// dà `prossimo`, conti sommati, un errore ferma e lo dice. Il server vero non si tocca.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leggiArgomenti, migraTutto, rigaConto } from '../../scripts/domande-migra.mjs';

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
  assert.match(leggiArgomenti(['--tutto']).errore, /non vale/);
});

test('tutti i lotti col cursore del server, conti sommati', async () => {
  const s = serverFinto([
    { ok: true, dryRun: true, letti: 500, conDomanda: 4, nuove: 0, giaLegate: 1, errori: 0, erroriIds: [], prossimo: 'id500' },
    { ok: true, dryRun: true, letti: 12, conDomanda: 1, nuove: 0, giaLegate: 0, errori: 0, erroriIds: [] },
  ]);
  const t = await migraTutto({ chiama: s.chiama });
  assert.deepEqual(s.chiamate, [{ op: 'migra', dryRun: true }, { op: 'migra', dryRun: true, dopo: 'id500' }]);
  assert.equal(t.ok, true);
  assert.equal(t.conDomanda, 5);
  assert.equal(t.letti, 512);
  assert.equal(rigaConto(t), 'A secco: 5 attese riceverebbero la loro domanda, 1 l\'avevano già. Feedback letti: 512, lotti: 2.');
});

test('dal vero chiede la scrittura; un errore a metà ferma coi conti fatti', async () => {
  const s = serverFinto([
    { ok: true, dryRun: false, letti: 500, conDomanda: 3, nuove: 2, giaLegate: 0, errori: 1, erroriIds: ['f9'], prossimo: 'id500' },
    new Error('la funzione ownerDomande non è ancora pubblicata sul server'),
  ]);
  const t = await migraTutto({ chiama: s.chiama, dalVero: true });
  assert.equal(s.chiamate[0].dryRun, false);
  assert.equal(t.ok, false);
  assert.match(t.motivo, /non è ancora pubblicata/);
  assert.equal(t.nuove, 2);
  assert.match(rigaConto(t), /^Dal vero: 2 domande scritte su 3 attese, 0 l'avevano già, 1 non scritte \(f9\)/);
});
