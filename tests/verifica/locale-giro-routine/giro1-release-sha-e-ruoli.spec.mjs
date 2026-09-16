// Prove del giro 1 (verifica locale) sul lavoro «giro di routine del 14/09»,
// punti 1, 6 e 7 letti dai testi: il lavoro di release, i ruoli, CLAUDE.md.
// Un workflow di GitHub non si esegue da qui: si legge quello che promette.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const leggi = (p) => readFileSync(join(ROOT, p), 'utf8');

test.describe('lavoro di release — la suite prima della patch', () => {
  test('ogni sei ore, la suite prima della pubblicazione, senza sandbox e con xvfb, e un rosso nuovo apre un feedback', () => {
    const y = leggi('.github/workflows/release.yml');
    expect(y).toMatch(/cron: '0 \*\/6 \* \* \*'/);
    const suite = y.slice(y.indexOf('\n  suite:'), y.indexOf('\n  release:'));
    expect(suite).toMatch(/ELECTRON_DISABLE_SANDBOX=1 .*xvfb-run -a npx playwright test/);
    expect(suite).toMatch(/PLAYWRIGHT_JSON_OUTPUT_NAME=suite-risultati\.json/);
    expect(suite).toMatch(/scripts\/suite-verdict\.mjs suite-risultati\.json/);
    expect(suite).toMatch(/scripts\/build-alarm\.mjs/);
    const release = y.slice(y.indexOf('\n  release:'), y.indexOf('\n  release-mac:'));
    expect(release).toMatch(/needs: suite/);
    expect(release).toMatch(/if: \$\{\{ success\(\) && !inputs\.solo_suite \}\}/);
  });

  test('la versione pubblicata è il commit che la suite ha provato', () => {
    // La suite prova main all'inizio (un'ora e un quarto), poi il lavoro di
    // release riprende main COM'È in quel momento e lo costruisce: quello che
    // è entrato su main nel frattempo esce senza essere mai passato dalla
    // suite. Il lavoro di release deve confrontare il commit che costruisce
    // con quello che la suite ha provato, e fermarsi se non coincidono.
    test.fail(true, 'rilievo aperto del giro 1: il release non confronta il commit costruito con quello provato dalla suite');
    const y = leggi('.github/workflows/release.yml');
    const release = y.slice(y.indexOf('\n  release:'), y.indexOf('\n  release-mac:'));
    expect(release).toMatch(/needs\.suite\.outputs\./);
  });
});

test.describe('ruoli e CLAUDE.md — nessuno chiede più la suite, e il contenitore è scritto dove serve', () => {
  test('CLAUDE.md e i ruoli non chiedono più la suite completa a nessuno', () => {
    const testi = ['CLAUDE.md', 'routines/roles/orchestrator.md', 'routines/roles/resolver.md', 'routines/roles/verifier.md', 'routines/roles/prober.md', 'routines/roles/secaudit.md', 'routines/roles/_contratto-worker.md'];
    for (const t of testi) {
      for (const riga of leggi(t).split('\n')) {
        if (!/\bnpm test\b/.test(riga)) continue;
        // Un `npm test` può restare solo dentro una negazione o una spiegazione.
        expect(riga, `${t}: «${riga.trim()}»`).toMatch(/non|NON|niente|Niente|nessun|GitHub/i);
      }
    }
    expect(leggi('CLAUDE.md')).toMatch(/ELECTRON_DISABLE_SANDBOX=1/);
    expect(leggi('routines/roles/verifier.md')).toMatch(/ELECTRON_DISABLE_SANDBOX=1/);
  });

  test('il ruolo che sonda (prober) scrive il comando del contenitore per intero', () => {
    // prober.md dice «xvfb-run -a npm run test:shoot»: metà del comando. Senza
    // ELECTRON_DISABLE_SANDBOX=1, nel contenitore da root Electron non parte,
    // e un comando scritto a metà nel testo che uno legge è la trappola che il
    // punto 7 voleva togliere.
    test.fail(true, 'rilievo aperto del giro 1: in prober.md il comando con xvfb-run manca della sandbox spenta');
    const p = leggi('routines/roles/prober.md');
    for (const riga of p.split('\n')) {
      if (/xvfb-run/.test(riga)) expect(riga, riga.trim()).toMatch(/ELECTRON_DISABLE_SANDBOX=1/);
    }
  });
});
