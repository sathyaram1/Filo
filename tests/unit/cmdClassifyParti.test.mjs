// Il classificatore dei comandi diviso in parti (#2493): l'entrata le carica tutte, nessuna resta fuori, e insieme
// pubblicano soltanto SN_CMD_CLASSIFY (più lo spazio privato delle parti), anche dove `require` non c'è.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { partiDelClassificatore, fileDelClassificatore } from '../helpers/sorgenteClassificatore.mjs';

const SHARED = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'shared');

test('#2493 — ogni file che si registra fra le parti del classificatore è nell\'elenco che l\'entrata carica', () => {
  const parti = partiDelClassificatore();
  assert.ok(parti.length >= 5, `parti: ${parti.join(', ')}`);
  const registrate = readdirSync(SHARED).filter((f) => f.endsWith('.js') && f !== 'cmdClassify.js'
    && readFileSync(join(SHARED, f), 'utf8').includes('SN_CMD_PARTI')).map((f) => f.replace(/\.js$/, ''));
  assert.deepEqual([...registrate].sort(), [...parti].sort(), 'una parte che l\'entrata non carica sparisce in silenzio');
  assert.equal(parti[0], 'cmdBase', 'cmdBase si carica per prima: le altre parti prendono da lei al caricamento');
});

test('#2493 — le parti caricate in fila senza require compongono il classificatore e non pubblicano altro', () => {
  const ctx = vm.createContext({ TextDecoder });
  for (const f of fileDelClassificatore()) vm.runInContext(readFileSync(f, 'utf8'), ctx, { filename: f });
  const pubblicati = Object.keys(ctx).filter((k) => k !== 'TextDecoder').sort();
  assert.deepEqual(pubblicati, ['SN_CMD_CLASSIFY', 'SN_CMD_PARTI']);
  const C = ctx.SN_CMD_CLASSIFY;
  // Le chiamate che attraversano le parti: pipeline → lettura → classifyOne, gruppo → riga piatta, perimetro, git.
  assert.equal(C.classify('cat a.txt | grep errore'), 1);
  assert.equal(C.classify('ls (Remove-Item x)'), 3);
  assert.equal(C.classify('git status'), 1);
  assert.equal(C.classify('git push --force'), 3);
  const casa = { cwd: '/home/u', home: '/home/u', win: false, shell: 'bash' };
  assert.equal(C.classifyDetail('cat ~/.ssh/id_rsa', casa).level, 2);
  const esiste = (p) => (p === '/home/u/b' ? 'file' : null);
  assert.equal(C.classifyDetail('cp a b', { ...casa, esiste }).level, 3, 'la sovrascrittura arriva dalla sua parte');
});
