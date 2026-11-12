// #1256 — l'elenco dei download sta nella memoria del suo modulo, che lo salva da lì: quello che arriva da un backup
// entra da `importa`, resta accanto a quello di qui, rispetta il tetto e non porta con sé niente di vivo o di pericoloso.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync, existsSync } from 'node:fs';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DL = require(join(ROOT, 'src', 'main', 'services', 'downloads.js'));

const voce = (id, giorno, over = {}) => ({
  id, filename: `${id}.pdf`, url: `https://example.com/${id}.pdf`, state: 'completed', savePath: '',
  startedAt: `2026-0${Math.floor(giorno / 28) + 1}-${String((giorno % 28) + 1).padStart(2, '0')}T10:00:00.000Z`, ...over,
});

test('le voci del backup entrano nell\'elenco vivo accanto a quelle di qui, senza stato vivo né file da cancellare', () => {
  DL._records.clear();
  const qui = voce('qui', 10, { savePath: '/percorso/qui.pdf' });
  DL._records.set(qui.id, { ...qui });

  const dir = cartellaTemporanea('filo-dl-imp-');
  const fuori = join(dir, 'documento-importante.txt');
  writeFileSync(fuori, 'non toccarmi');
  const nuove = DL.importa([
    qui,
    voce('backup', 5, { _scope: 'incognito', _quarantena: true }),
    voce('attesa', 6, { state: 'pending', savePath: fuori }),
  ]);

  assert.equal(nuove, 2);
  assert.deepEqual(DL.list('').map((r) => r.id), ['qui', 'attesa', 'backup']);
  assert.equal(DL._records.get('qui').savePath, '/percorso/qui.pdf', 'quella di qui resta com\'era');
  assert.ok(!('_scope' in DL._records.get('backup')), 'un campo vivo non arriva da un backup');
  assert.equal(DL._records.get('attesa').state, 'cancelled');
  assert.ok(existsSync(fuori), 'un percorso fuori dalla quarantena non si cancella');
});

test('oltre il tetto escono dall\'elenco vivo le voci più vecchie, come nell\'unione che la conferma ha contato', () => {
  DL._records.clear();
  const lista = Array.from({ length: DL.HISTORY_LIMIT + 3 }, (_, i) => voce(`v${i}`, i % 300));
  DL._records.set('in-corso', voce('in-corso', 0, { state: 'progressing' }));
  DL.importa(lista);
  const finiti = DL.list('').filter((r) => r.state === 'completed');
  assert.equal(finiti.length, DL.HISTORY_LIMIT);
  assert.ok(DL._records.has('in-corso'), 'uno scaricamento in corso non esce mai');
  assert.ok(!DL._records.has('v0') && !DL._records.has('v1') && !DL._records.has('v2'), 'escono le tre più vecchie');
});
