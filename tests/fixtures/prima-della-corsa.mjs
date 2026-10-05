// Il globalSetup di Playwright: prima di ogni corsa toglie le cartelle delle corse uccise (#717). La regola sta in
// tests/helpers/percorsi.mjs, insieme a chi le crea.
import { togliCartelleOrfane } from '../helpers/percorsi.mjs';

export default function primaDellaCorsa() {
  togliCartelleOrfane({ annuncia: (n) => console.error(`[test] tolgo ${n} cartelle temporanee lasciate da prove interrotte`) });
}
