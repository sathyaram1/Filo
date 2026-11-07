// Verifica #2181 giro 1: il censimento da zero dura ore (768 agenti Haiku più la rilettura Opus) e un comando in
// sottofondo si ferma a due: la frase una tantum del ruolo deve dire di rilanciarlo e di segnarlo fatto solo a FERMO sparito.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const RUOLO = readFileSync(resolve(import.meta.dirname, '../../../routines/roles/manutentore.md'), 'utf8');

function fraseUnaTantum() {
  const mattino = RUOLO.slice(RUOLO.indexOf('- **`mattino`**'), RUOLO.indexOf('- **gli altri motivi**')).replace(/\s+/g, ' ');
  const da = mattino.indexOf('**Una volta sola');
  expect(da, 'la frase una tantum sta nel mattino').toBeGreaterThan(-1);
  return mattino.slice(da, mattino.indexOf('npm run manutentore -- contesto'));
}

test('r1 un censimento da zero interrotto si rilancia, e nel taccuino va solo a censimento finito', () => {
  const frase = fraseUnaTantum();
  expect(frase, 'un giro fermato a metà (tetto del sottofondo, sessione chiusa) si rilancia').toMatch(/rilanci/i);
  expect(frase, 'il giorno nel taccuino solo quando il FERMO non c\'è più, non al lancio')
    .toMatch(/(finit|complet|senza (più )?(il )?FERMO|FERMO (non|è) (c'è )?(più|sparito|sparisce))/i);
});
