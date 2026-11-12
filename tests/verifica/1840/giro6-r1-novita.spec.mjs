// Verifica #1840 giro 6, rilievo 1: nel registro delle novità ogni blocco di versione ha una sola lista «features» e
// una sola «fixes». Una chiave scritta due volte fa fermare lo spostamento delle righe prima della fusione.
import { test, expect } from '../../fixtures/electron.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('r1 nessun blocco delle novità scrive due volte la stessa lista', async () => {
  const src = readFileSync(join(process.cwd(), 'src', 'shared', 'patchNotes.js'), 'utf8');
  const blocchi = src.split(/\bversion:\s*'/).slice(1);
  const doppi = [];
  for (const b of blocchi) {
    const versione = b.slice(0, b.indexOf("'"));
    for (const chiave of ['features', 'fixes']) {
      const n = (b.match(new RegExp(`\\b${chiave}:\\s*\\[`, 'g')) || []).length;
      if (n > 1) doppi.push(`${versione}: «${chiave}» ${n} volte`);
    }
  }
  expect(doppi, doppi.join('\n')).toEqual([]);
});
