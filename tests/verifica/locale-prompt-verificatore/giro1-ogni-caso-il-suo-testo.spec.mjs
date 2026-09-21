// Prove del giro 1 (verifica locale) sul lavoro «testi dei ruoli delle
// routine»: quello che deve funzionare, e che qui risulta funzionante.
//
//   - ogni ruolo riceve un testo composto e COMPLETO (nessun segnaposto di
//     pezzo condiviso rimasto dentro: un ruolo consegnato con un buco lavora
//     senza una parte delle regole);
//   - chi fa il primo lavoro e chi riallinea dopo un conflitto ricevono
//     ciascuno SOLO il testo del proprio caso;
//   - il riallineamento dice al ruolo che sta facendo un riallineamento, e
//     cosa deve scriverne nel resoconto;
//   - i criteri con cui si giudica il lavoro sono la STESSA lista, parola per
//     parola, per chi lo fa e per chi lo verifica.
//
// Si guarda il testo COMPOSTO dallo strumento di consegna, non i file sorgente:
// è quello che arriva davvero a chi lavora.

import { test, expect } from '@playwright/test';
import { readRoleInstructions } from '../../../scripts/dispatch.mjs';

const CASI = ['new-work', 'fixer', 'verifier', 'secaudit', 'prober', 'halt'];

test('ogni ruolo riceve un testo intero, senza segnaposti rimasti dentro', () => {
  for (const ruolo of CASI) {
    const testo = readRoleInstructions(ruolo);
    expect(testo.length, `il ruolo ${ruolo} riceve un testo vuoto`).toBeGreaterThan(400);
    expect(testo, `nel testo del ruolo ${ruolo} è rimasto un segnaposto non espanso`).not.toContain('includi:');
  }
});

test('primo lavoro e riallineamento: ciascuno solo il proprio caso', () => {
  const primo = readRoleInstructions('new-work');
  const riallineo = readRoleInstructions('fixer');

  // Il primo passaggio non deve ricevere le istruzioni del riallineamento.
  expect(primo).not.toMatch(/git rebase/i);
  expect(primo).not.toMatch(/conflitt/i);

  // Il riallineamento deve dire cos'è, come si fa e cosa scriverne.
  expect(riallineo).toMatch(/rebase/i);
  expect(riallineo).toMatch(/conflitt/i);
  expect(riallineo).toMatch(/[Nn]el report scrivi/);
  // …e non deve ripetere le istruzioni del primo passaggio.
  expect(riallineo).not.toContain('--status revision_capability');
});

test('i criteri di giudizio sono la stessa lista per chi lavora e per chi verifica', () => {
  const primo = readRoleInstructions('new-work');
  const verifica = readRoleInstructions('verifier');
  // L'intero elenco numerato, preso dal primo criterio all'ultimo.
  const elenco = (t) => {
    const da = t.indexOf('1. **La lamentela.**');
    const a = t.indexOf('la cura è una regola sola sulla causa, non una pezza sulla porta vista.');
    expect(da, 'elenco dei criteri non trovato').toBeGreaterThan(-1);
    expect(a, 'fine dell\'elenco dei criteri non trovata').toBeGreaterThan(da);
    return t.slice(da, a);
  };
  expect(elenco(primo)).toBe(elenco(verifica));
});

test('chi verifica non sa, prima di registrare, cosa succederà dopo', () => {
  const verifica = readRoleInstructions('verifier');
  // Il seguito (chi corregge i rilievi, con quali giri a disposizione) arriva
  // solo nella risposta al comando di registrazione: saperlo prima orienta i
  // livelli che si scrivono.
  expect(verifica).not.toMatch(/correggerai (tu|poi)/i);
  expect(verifica).not.toMatch(/cap2|cap1|cap0/);
  expect(verifica).not.toMatch(/bilanci/i);
  expect(verifica).toMatch(/la risposta del server, e fa parte delle tue\s+istruzioni/);
});
