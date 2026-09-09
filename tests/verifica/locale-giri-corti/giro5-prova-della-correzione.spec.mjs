// Prove del giro 5 (verifica locale) sul lavoro «giri corti».
//
// Il giro 4 aveva trovato che la prova scritta da CHI RISOLVE finiva nella
// cartella che la suite non rilancia mai, e quel testo è stato sistemato.
// Ma dal 2026-09-05 le correzioni non le fa più chi risolve: le fa CHI
// VERIFICA, nella fase di correzione. Nelle sue istruzioni l'unico posto dove
// mettere una prova è la cartella del giro, cioè quella che la suite non
// raccoglie: la guardia contro il ritorno del difetto nasce spenta, sul
// cammino che porta ogni correzione.
//
// Queste prove non aprono Filo: qui non c'è una schermata da ripercorrere,
// c'è il meccanismo del giro. Restano nel ramo: sono la memoria di questo giro.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const leggi = (p) => readFileSync(resolve(ROOT, p), 'utf8');

/**
 * Il pezzo delle istruzioni di chi verifica che parla della FASE DI
 * CORREZIONE: da «la correzione la fai tu» fino alla fine del file.
 */
function sezioneCorrezione(testo) {
  const i = testo.search(/la correzione la fai tu/i);
  expect(i, 'le istruzioni di chi verifica non dicono più che la correzione la fa lui').toBeGreaterThan(-1);
  return testo.slice(i);
}

test('#giri-corti — chi corregge sa dove mettere la prova che tiene chiuso il difetto', () => {
  const sezione = sezioneCorrezione(leggi('routines/roles/verifier.md'));
  // Deve indicare un posto che la suite rilancia davvero: accanto agli altri
  // spec (tests/<feature>.spec.mjs) o negli unit test. Il rimando ai minimi
  // del repo da solo non basta: l'unica cartella nominata in tutto il ruolo è
  // quella del giro, ed è quella che si ha sotto gli occhi mentre si corregge.
  expect(sezione, 'la fase di correzione non dice dove va la prova della correzione: '
    + 'l\'unico posto nominato nel ruolo è la cartella del giro, che la suite non rilancia mai')
    .toMatch(/tests\/unit|tests\/<feature>|accanto alle altre|dove la suite/i);
});

test('#giri-corti — e sa che quella prova NON va nella cartella del giro', () => {
  const sezione = sezioneCorrezione(leggi('routines/roles/verifier.md'));
  expect(sezione, 'va detto per esteso: la cartella del giro è la memoria del giro, '
    + 'non il posto della guardia contro il ritorno del difetto')
    .toMatch(/non (va|ci va|finisce)|non è il posto|memoria del giro/i);
});

test('#giri-corti — le regole generali del repo continuano a dire il posto di sempre', () => {
  // Il riferimento contro cui si misura la divergenza: se un giorno CLAUDE.md
  // cambiasse idea, queste prove andrebbero riscritte, non ignorate.
  const claude = leggi('CLAUDE.md');
  expect(claude).toMatch(/tests\/unit\//);
  expect(claude).toMatch(/tests\/<feature>\.spec\.mjs/);
  // E il ruolo di chi risolve resta allineato (porta chiusa dal giro 4).
  expect(leggi('routines/roles/resolver.md')).toMatch(/tests\/<feature>\.spec\.mjs/);
});
