// Verifica #1683 giro 2, rilievo 1 — il testo scritto sotto l'uscita è per il comando: quello che lui non legge non
// diventa un comando della shell quando ha finito, scritto a mano senza passare dalle conferme.

import { test, expect } from '../../fixtures/electron.mjs';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const { createSession } = require('../../../src/main/services/shell.js');

function esegui(s, comando, mentre) {
  return new Promise((risolvi, rifiuta) => {
    let out = '';
    const stop = setTimeout(() => rifiuta(new Error(`«${comando}» è rimasto in corso`)), 15_000);
    s.exec(comando, {
      onData: ({ chunk }) => { out += chunk; },
      onExit: (e) => { clearTimeout(stop); risolvi({ out, ...e }); },
      onError: ({ message }) => { clearTimeout(stop); rifiuta(new Error(message)); },
    });
    if (mentre) setTimeout(mentre, 300);
  });
}

test.skip(process.platform === 'win32', 'la shell POSIX della home');

for (const shell of ['bash', 'sh']) {
  test(`r1 ${shell}: il testo che il comando non legge non parte come comando dopo di lui`, async () => {
    const dir = cartellaTemporanea('filo-1683-g2-r1-');
    const traccia = path.join(dir, 'partito.txt');
    const s = createSession({ shell, cwd: dir });
    try {
      // Un comando lungo che non chiede niente: l'utente scrive lo stesso nella casella sotto l'uscita.
      await esegui(s, 'sleep 1', () => s.write(`touch "${traccia}"\n`));
      // Un comando che chiede una riga sola, e riceve due righe.
      await esegui(s, 'read x; echo "letto=$x"', () => s.write(`si\ntouch "${traccia}"\n`));
      const dopo = await esegui(s, 'echo dopo-1683');
      expect(dopo.out).toBe('dopo-1683\n');
      await new Promise((r) => setTimeout(r, 500));
      expect(existsSync(traccia), 'la riga scritta per il comando è partita come comando della shell').toBe(false);
    } finally { s.kill(); }
  });
}
