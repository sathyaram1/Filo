// La migrazione delle attese dalla riga di comando (#1358, SPEC-DOMANDE §3.8): a secco di default, tutti i lotti finché
// il server dà `prossimo`, conti sommati, un errore ferma e lo dice. Il server vero non si tocca.
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

test('a secco di default; --dal-vero crea; altro si rifiuta', () => {
  assert.deepEqual(leggiArgomenti([]), { dalVero: false });
  assert.deepEqual(leggiArgomenti(['--dal-vero']), { dalVero: true });
  assert.match(leggiArgomenti(['--force']).errore, /non vale/);
});

test('tutti i lotti col cursore del server, conti sommati', async () => {
  const s = serverFinto([
    { ok: true, dryRun: true, create: 4, gia: 1, fuori: 295, errori: 0, erroriIds: [], prossimo: 'id300' },
    { ok: true, dryRun: true, create: 2, gia: 0, fuori: 10, errori: 0, erroriIds: [] },
  ]);
  const t = await migraTutto({ chiama: s.chiama });
  assert.deepEqual(s.chiamate, [{ op: 'migra', dryRun: true }, { op: 'migra', dryRun: true, dopo: 'id300' }]);
  assert.equal(t.ok, true);
  assert.equal(t.create, 6);
  assert.match(rigaConto(t), /^A secco: 6 domande da creare, 1 attese l'avevano già, 305 feedback aperti senza attesa\. Lotti: 2\.$/);
});

test('dal vero chiede la scrittura; un errore a metà ferma e tiene i conti fatti', async () => {
  const s = serverFinto([
    { ok: true, dryRun: false, create: 3, gia: 0, fuori: 297, errori: 1, erroriIds: ['x1'], prossimo: 'id300' },
    new Error('la funzione ownerDomande non è ancora pubblicata sul server'),
  ]);
  const t = await migraTutto({ chiama: s.chiama, dalVero: true });
  assert.equal(s.chiamate[0].dryRun, false);
  assert.equal(t.ok, false);
  assert.equal(t.create, 3);
  assert.match(t.motivo, /non è ancora pubblicata/);
  assert.match(rigaConto(t), /^Scritte: 3 domande create.*1 non riuscite \(x1\)/);
});
