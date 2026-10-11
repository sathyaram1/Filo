// La migrazione della fiducia dalla riga di comando (#1148, SPEC-DOMANDE.md §1.7): a secco di default, tutti i lotti
// finché il server dà `prossimo`, conti sommati, un errore ferma e lo dice. Il server vero non si tocca.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leggiArgomenti, migraTutto, rigaConto } from '../../scripts/fiducia-migra.mjs';

function serverFinto(lotti) {
  const chiamate = [];
  const chiama = async (data) => {
    chiamate.push(data);
    const i = chiamate.length - 1;
    const l = lotti[i];
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

test('tutti i lotti col cursore del server, conti sommati, a secco', async () => {
  const s = serverFinto([
    { ok: true, dryRun: true, fidati: 3, nonFidati: 495, giaImpostati: 2, errori: 0, erroriIds: [], prossimo: 'id500' },
    { ok: true, dryRun: true, fidati: 1, nonFidati: 9, giaImpostati: 0, errori: 0, erroriIds: [] },
  ]);
  const t = await migraTutto({ chiama: s.chiama });
  assert.deepEqual(s.chiamate, [{ op: 'migra', dryRun: true }, { op: 'migra', dryRun: true, dopo: 'id500' }]);
  assert.equal(t.ok, true);
  assert.equal(t.dryRun, true);
  assert.equal(t.lotti, 2);
  assert.equal(t.fidati, 4);
  assert.equal(t.nonFidati, 504);
  assert.match(rigaConto(t), /^A secco: 4 fidati, 504 non fidati, 2 avevano già la fiducia\. Lotti: 2\.$/);
});

test('dal vero chiede la scrittura; un errore a metà ferma e tiene i conti fatti', async () => {
  const s = serverFinto([
    { ok: true, fidati: 2, nonFidati: 3, giaImpostati: 0, errori: 1, erroriIds: ['x1'], prossimo: 'b' },
    new Error('il server non risponde'),
  ]);
  const t = await migraTutto({ chiama: s.chiama, dalVero: true });
  assert.equal(s.chiamate[0].dryRun, false);
  assert.equal(t.ok, false);
  assert.match(t.motivo, /non risponde/);
  assert.equal(t.fidati, 2);
  assert.match(rigaConto(t), /Scritti: 2 fidati, 3 non fidati, 0 avevano già la fiducia, 1 non scritti \(x1\)/);
});

test('un rifiuto del server (non admin) ferma col suo motivo; un cursore che non avanza non gira all’infinito', async () => {
  const no = await migraTutto({ chiama: async () => ({ ok: false, reason: 'not_admin', detail: 'riservato al proprietario' }) });
  assert.equal(no.ok, false);
  assert.match(no.motivo, /riservato al proprietario/);
  let n = 0;
  const fermo = await migraTutto({ chiama: async () => { n += 1; return { ok: true, fidati: 0, prossimo: 'sempre' }; } });
  assert.equal(fermo.ok, true);
  assert.equal(n, 2, 'lo stesso cursore due volte vuol dire fine, non un altro giro');
  const tetto = await migraTutto({ chiama: async () => { n += 1; return { ok: true, prossimo: `p${n}` }; }, tetto: 3 });
  assert.equal(tetto.ok, false);
  assert.match(tetto.motivo, /tetto/);
});
