// Prove del giro 6 (verifica locale) sul lavoro «giri corti».
//
// Le prove di un giro restano nel ramo e chi corregge le rilancia nominando la
// cartella. Se la cartella non c'è, il comando risponde «No tests found» ed
// esce con un errore, e i testi dicono — giustamente — che quello vuol dire
// «non c'era niente da rilanciare».
//
// Il problema è che quella STESSA risposta arriva anche quando la cartella c'è
// eccome, ma il percorso è scritto in una forma che il comando non riconosce.
// Misurato su questa macchina, con la cartella piena di dieci prove:
//   · `tests/verifica/locale-giri-corti`            → 13 prove trovate
//   · `tests\verifica\locale-giri-corti` (PowerShell) → 0, esce con errore
//   · lo stesso percorso scritto per intero dalla radice del disco → 0, errore
// Chi corregge legge «niente da trovare», conclude «non c'era niente da
// rilanciare» — è proprio quello che i testi gli hanno insegnato a concludere —
// e le prove del giro non girano. Il guasto è silenzioso e nasconde
// esattamente il meccanismo che questo lavoro esiste per costruire.
//
// Queste prove non aprono Filo: qui non c'è una schermata, c'è il meccanismo
// del giro. Restano nel ramo: sono la memoria di questo giro.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const leggi = (p) => readFileSync(resolve(ROOT, p), 'utf8');

// La frase che insegna a leggere una risposta vuota come un'assenza.
const ASSENZA = /niente da rilanciare|No tests found/i;
// Il modo di distinguere: nominare la forma del percorso, o mandare a guardare
// la cartella prima di concludere che non c'è.
const DISTINGUE = /percors|barre/i;

/** Le finestre di testo attorno a ogni frase che parla di assenza. */
function attorno(testo, raggio = 350) {
  const out = [];
  const re = new RegExp(ASSENZA.source, 'gi');
  let m;
  while ((m = re.exec(testo)) !== null) {
    out.push(testo.slice(Math.max(0, m.index - raggio), m.index + raggio));
  }
  return out;
}

for (const file of ['routines/roles/verifier.md', 'routines/roles/resolver.md']) {
  test(`#giri-corti — ${file}: una risposta vuota non è per forza un'assenza`, () => {
    const finestre = attorno(leggi(file));
    expect(finestre.length, `${file} non parla più della cartella assente: se la regola è cambiata, riscrivi questa prova`).toBeGreaterThan(0);
    for (const f of finestre) {
      expect(f, `${file}: si dice che una risposta vuota vuol dire «niente da rilanciare», `
        + 'ma non si dice che la stessa risposta arriva col percorso scritto in un\'altra forma '
        + '(le barre di Windows, o il percorso per intero dalla radice del disco): '
        + 'così le prove del giro restano ferme e nessuno se ne accorge')
        .toMatch(DISTINGUE);
    }
  });
}

test('#giri-corti — anche il compito consegnato a chi verifica in locale lo dice', () => {
  const strumento = leggi('scripts/verify-local.mjs');
  const finestre = attorno(strumento);
  expect(finestre.length, 'lo strumento non parla più della cartella assente: se la regola è cambiata, riscrivi questa prova').toBeGreaterThan(0);
  for (const f of finestre) {
    expect(f, 'il testo che chi verifica in locale riceve (e la coda della fase di correzione) '
      + 'insegna a leggere una risposta vuota come «non c\'era niente da rilanciare», senza avvertire '
      + 'che la stessa risposta arriva col percorso scritto in un\'altra forma')
      .toMatch(DISTINGUE);
  }
});
