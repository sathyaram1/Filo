// Prove del giro 7 (verifica locale) sul lavoro «giri corti».
//
// Il giro 6 ha chiuso una porta: nominare la cartella delle prove del giro con
// un percorso scritto in un'altra forma dà la STESSA risposta che dà una
// cartella assente («No tests found», uscita con errore), e i testi insegnavano
// a leggere quella risposta come «non c'era niente da rilanciare». Riprovato su
// questa macchina, con la cartella piena di diciotto prove:
//   · tests/verifica/locale-giri-corti            → 18 prove trovate
//   · lo stesso percorso con le barre di Windows  → 0, esce con errore
//   · lo stesso percorso dalla radice del disco   → 0, esce con errore
// L'avvertimento è stato messo nelle istruzioni dei due ruoli, nel compito
// consegnato a chi verifica in locale e nella coda della fase di correzione.
//
// Manca proprio dove chi lavora a mano in locale legge le sue regole: le regole
// generali del repo (CLAUDE.md). Lì il comando che rilancia le prove del giro è
// scritto per esteso, e nessuno avverte che una risposta vuota può voler dire
// due cose opposte. È la sola strada che una sessione locale legge sempre — i
// ruoli delle routine non li riceve — ed è la strada con cui il lavoro si
// chiude a mano.
//
// Queste prove non aprono Filo: qui non c'è una schermata, c'è il meccanismo
// del giro (le regole generali del repo dicono che, quando non c'è niente da
// aprire, la prova giusta è il controllo veloce, non una spec che apre l'app
// per non guardarci niente).

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const leggi = (p) => readFileSync(resolve(ROOT, p), 'utf8');

// Il comando che rilancia le prove di un giro, dovunque sia scritto per esteso.
const COMANDO = /playwright\s+test\s+tests\/verifica/gi;
// Il modo di distinguere una cartella assente da un percorso scritto male:
// nominare la forma del percorso, o mandare a guardare la cartella.
const DISTINGUE = /percors|barre/i;

/** Le finestre di testo attorno a ogni punto in cui il comando è scritto. */
function attorno(testo, raggio = 500) {
  const out = [];
  const re = new RegExp(COMANDO.source, 'gi');
  let m;
  while ((m = re.exec(testo)) !== null) {
    out.push(testo.slice(Math.max(0, m.index - raggio), m.index + raggio));
  }
  return out;
}

for (const file of ['CLAUDE.md', 'routines/roles/verifier.md', 'routines/roles/resolver.md']) {
  test(`#giri-corti — ${file}: chi rilancia le prove del giro sa che una risposta vuota può ingannare`, () => {
    const finestre = attorno(leggi(file));
    expect(finestre.length, `${file} non nomina più il comando che rilancia le prove del giro: `
      + 'se la regola è cambiata, riscrivi questa prova').toBeGreaterThan(0);
    for (const f of finestre) {
      expect(f, `${file}: il comando che rilancia le prove del giro è scritto per esteso, `
        + 'ma niente avverte che «No tests found» arriva anche a cartella piena quando il percorso '
        + 'è scritto in un\'altra forma (le barre di Windows, che il completamento automatico del '
        + 'terminale di Windows produce da solo, o il percorso per intero dalla radice del disco). '
        + 'Chi legge conclude che non c\'era niente da rilanciare, le prove del giro restano ferme, '
        + 'e il giro dopo ritrova la porta aperta')
        .toMatch(DISTINGUE);
    }
  });
}
