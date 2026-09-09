// Prove del giro 8 (verifica locale) sul lavoro «giri corti».
//
// I giri 6 e 7 hanno chiuso una porta di TESTO: il comando che rilancia le
// prove di un giro risponde «No tests found» anche a cartella piena, se il
// percorso è scritto in un'altra forma, e adesso tutti i testi lo avvertono.
// Resta una cosa che nessuno aveva provato: che il percorso STAMPATO dai due
// testi che chi verifica e chi corregge leggono davvero — il compito consegnato
// all'apertura del giro e la coda della fase di correzione — sia scritto in una
// forma che funziona. Un avvertimento giusto accanto a un comando da copiare
// che non trova niente lascerebbe le prove del giro ferme lo stesso.
//
// Qui il percorso non è scritto a mano: si prende dal testo e si lancia com'è.
//
// Non aprono Filo, e non è una scorciatoia: qui non c'è una schermata, c'è il
// meccanismo del giro (le regole generali del repo dicono che, quando non c'è
// niente da aprire, la prova giusta è il controllo veloce, non una spec che
// apre l'app per non guardarci niente).

import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const RAMO = 'claude/giri-corti';

const modulo = await import(new URL('file:///' + resolve(ROOT, 'scripts/verify-local.mjs').replace(/\\/g, '/')).href);
const { buildVerifierBrief, codaText } = modulo;

/** Lancia il percorso COM'È SCRITTO e dice quante prove ha trovato. */
function proveTrovate(percorso) {
  const out = execFileSync('npx', ['playwright', 'test', percorso, '--list'], {
    cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32',
  });
  const m = /Total: (\d+) tests?/.exec(String(out));
  expect(m, `nessun totale nella risposta: ${String(out).slice(-300)}`).not.toBeNull();
  return Number(m[1]);
}

test('#giri-corti — il percorso stampato nella coda della correzione trova davvero le prove del giro', () => {
  const coda = codaText({
    findings: [{ level: 2, text: 'un rilievo' }], derived: [], budgets: null,
    branch: RAMO, instructions: '(coda)',
  });
  const m = /playwright\s+test\s+(\S+)/.exec(coda);
  expect(m, 'la coda della correzione non stampa più il comando che rilancia le prove del giro: '
    + 'se la regola è cambiata, riscrivi questa prova').not.toBeNull();
  expect(proveTrovate(m[1]), `il percorso stampato a chi corregge (${m && m[1]}) non trova nessuna prova: `
    + 'chi lo copia legge «No tests found», conclude che non c\'era niente da rilanciare '
    + 'e le prove del giro restano ferme').toBeGreaterThan(0);
});

test('#giri-corti — la cartella detta a chi verifica in locale trova davvero le prove dei giri passati', () => {
  const brief = buildVerifierBrief({ request: 'una richiesta', branch: RAMO, recipe: '(ricetta)' });
  const m = /`(tests\/verifica\/[^`]+)`/.exec(brief);
  expect(m, 'il compito consegnato a chi verifica non nomina più la cartella delle prove del giro: '
    + 'se la regola è cambiata, riscrivi questa prova').not.toBeNull();
  expect(proveTrovate(m[1]), `la cartella detta a chi verifica (${m && m[1]}) non trova nessuna prova, `
    + 'mentre le prove dei giri passati ci sono: il giro dopo ripaga tutto').toBeGreaterThan(0);
});

test('#giri-corti — le prove dei giri passati di questo lavoro sono nel ramo e si trovano', () => {
  // La memoria del giro esiste davvero: se qualcuno la cancella, questa
  // diventa rossa. È metà di quello che era stato chiesto.
  const elenco = execFileSync('git', ['ls-files', 'tests/verifica/locale-giri-corti'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(Boolean);
  expect(elenco.length, 'le prove dei giri passati non sono più committate nel ramo').toBeGreaterThan(1);
  for (const f of elenco) expect(f).toMatch(/giro\d+-.+\.spec\.mjs$/);
});
