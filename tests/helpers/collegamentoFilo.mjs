// Il collegamento come Filo lo disegna DAVVERO, dentro una pagina web.
// Le prove che si costruivano l'ancora a mano provavano una forma che Filo
// poteva aver smesso di scrivere (#533, nono giro di verifica): qui si carica
// la sorgente unica del rendering nel mondo della pagina e si usa quella.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SORGENTE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'shared', 'filoMarkdown.js'),
  'utf8',
);

/** Rende disponibile `self.SN_MARKDOWN` nel mondo principale della pagina. */
export async function caricaMarkdown(page) {
  await page.evaluate((src) => {
    if (!self.SN_MARKDOWN) (0, eval)(src);
  }, SORGENTE);
}
