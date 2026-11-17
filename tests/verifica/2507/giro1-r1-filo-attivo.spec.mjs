// #2507 giro 1, rilievo 1: nella prova «da utente» Filo deve essere quello di un utente normale, acceso coi
// modelli, non la home spenta che chiede di riscattare un invito (lì ogni funzione che passa da un modello fallisce).

import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FINTO = join(ROOT, 'tests', 'helpers', 'claudeFinto.mjs');

test.setTimeout(150_000);

async function prova(copione, argomenti) {
  const cartella = cartellaTemporanea('filo-verifica-2507-');
  const env = { ...process.env, FILO_CLAUDE_BIN: FINTO, FILO_CLAUDE_FINTO: JSON.stringify(copione) };
  const figlio = spawn(process.execPath, [join(ROOT, 'tests', 'agent', 'prova.mjs'), '--out', cartella, ...argomenti], { cwd: ROOT, env });
  let uscita = '';
  figlio.stdout.on('data', (b) => { uscita += b; });
  figlio.stderr.on('data', (b) => { uscita += b; });
  const codice = await new Promise((ok) => figlio.on('exit', ok));
  const file = join(cartella, 'esito.json');
  const esito = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
  return { codice, uscita, esito, cartella };
}

test('r1 da utente la home è quella di Filo acceso: niente invito da riscattare, ci sono i moduli', async () => {
  const conCard = await prova([{ azione: 'fine', seBadge: ':Apri Crediti$' }], ['--compito', 'guarda la home']);
  expect(conCard.esito, conCard.uscita).not.toBeNull();
  expect(conCard.esito.esito, `la home chiede ancora l'invito: ${conCard.esito.riga}`).toBe('non riuscito');
  togliCartella(conCard.cartella);

  const coiModuli = await prova([{ azione: 'fine', seBadge: ':(Scrivi|Preferenze)$' }], ['--compito', 'guarda la home']);
  expect(coiModuli.esito.esito, `la home non ha i moduli di Filo acceso: ${coiModuli.esito.riga}`).toBe('riuscito');
  togliCartella(coiModuli.cartella);
});
