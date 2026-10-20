// #1452, giro 1: la pagina Privacy, che Filo legge a chi chiede dove vanno i suoi dati, dice anche
// che a fine conversazione la chat va a un modello per darle un nome (come già dice il manifesto).
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('r1 la pagina Privacy dice che la chat va a un modello per darle un nome', () => {
  require(join(ROOT, 'src', 'shared', 'transparency.js'));
  const T = globalThis.SN_TRANSPARENCY;
  const docs = T && (T.DOCS || T.docs || T);
  const privacy = JSON.stringify(docs).match(/"text":"Filo legge molto[\s\S]*?"(?:,|\})/);
  expect(privacy, 'documento Privacy non trovato').toBeTruthy();
  const testo = privacy[0];
  const riga = testo.split('\\n').find((r) => /La chat con Filo e la home/.test(r)) || '';
  expect(riga).not.toBe('');
  // La trascrizione di fine conversazione (inizio e fine) va a un modello per titolo e tipo.
  expect(/\b(nome|titolo)\b[^.]*\bchat\b|\bchat\b[^.]*\b(nome|titolo)\b/i.test(riga.replace(/titoli delle schede/g, ''))).toBe(true);
});
