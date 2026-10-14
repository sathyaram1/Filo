// Verifica #1222, giro 1, rilievo 2: la pubblicazione oraria delle regole confronta l'impronta con TUTTE le
// pubblicazioni passate, non con l'ultima. Regole A pubblicate, poi B, poi main torna ad A (un ritorno indietro): la
// corsa trova il registro di A e salta, e in produzione restano le B. Atteso: il ritorno ad A si pubblica.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaFunctions, APP_ROOT } from './helpers/server.mjs';

test.skip(!cartellaFunctions(), 'filo-security non è accanto al repo');

const yaml = createRequire(join(APP_ROOT, 'package.json'))('js-yaml');

// Le espressioni che cambiano da una corsa all'altra; tutte le altre (anche github.sha, che per le corse a orario è la
// punta di main del server, ferma) restano uguali.
function chiave(modello, { impronta, corsa }) {
  return String(modello || '').replace(/\$\{\{\s*([^}]+?)\s*\}\}/g, (_, e) => {
    if (/^steps\.[\w-]+\.outputs\.impronta$/.test(e)) return impronta;
    if (/^github\.run_(id|number|attempt)$/.test(e)) return `corsa${corsa}`;
    return 'fisso';
  });
}

test('r2 regole pubblicate A, poi B, poi di nuovo A: la terza corsa non trova un registro che dica «già pubblicate»', () => {
  const file = join(cartellaFunctions(), '..', '.github', 'workflows', 'regole.yml');
  const wf = yaml.load(readFileSync(file, 'utf8'));
  const passi = Object.values(wf.jobs).flatMap((j) => j.steps || []);
  const ripristino = passi.find((p) => /actions\/cache(\/restore)?@/.test(String(p.uses || '')) && !/\/save@/.test(String(p.uses)));
  const salvataggio = passi.find((p) => /actions\/cache(\/save)?@/.test(String(p.uses || '')) && !/\/restore@/.test(String(p.uses)) && p !== ripristino);
  expect(ripristino, 'passo che legge il registro delle pubblicazioni').toBeTruthy();
  expect(salvataggio, 'passo che scrive il registro delle pubblicazioni').toBeTruthy();

  // Corsa 1 pubblica A e salva; corsa 2 pubblica B e salva; corsa 3: main è tornato ad A.
  const salvate = new Set([
    chiave(salvataggio.with.key, { impronta: 'A', corsa: 1 }),
    chiave(salvataggio.with.key, { impronta: 'B', corsa: 2 }),
  ]);
  const cercata = chiave(ripristino.with.key, { impronta: 'A', corsa: 3 });
  // Una corrispondenza esatta è il «cache-hit» che fa saltare la pubblicazione.
  expect(salvate.has(cercata), `la corsa 3 cerca «${cercata}» e lo trova fra le pubblicazioni passate: salta, e in produzione restano le regole B`).toBe(false);
});
