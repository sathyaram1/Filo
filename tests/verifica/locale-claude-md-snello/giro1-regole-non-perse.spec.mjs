// Giro 1 della verifica di «CLAUDE.md snello»: le regole tolte dal file devono vivere altrove.
// Non apre Filo: si leggono i testi che ogni agente riceve (CLAUDE.md, pattern, ruoli).
import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const leggi = (p) => readFileSync(join(ROOT, p), 'utf8');
const cartella = (d) => readdirSync(join(ROOT, d)).filter((f) => f.endsWith('.md')).map((f) => leggi(join(d, f)));
const tutto = () => [leggi('CLAUDE.md'), leggi('PATTERNS.md'), ...cartella('patterns'), ...cartella('routines/roles')]
  .join('\n');

const regole = [
  ['il report per l\'owner non vanta comportamenti attesi', /comportamenti attesi/i],
  ['un «NON cambiare» verificabile a macchina è una sentinella, non un commento', /sentinella,? non (un )?commento/i],
  ['senza niente da aprire (testi, strumenti da riga di comando) la prova è il controllo veloce, non una spec',
    /per non guardarci niente|niente da aprire/i],
  ['i segnali che si sta curando il sintomo («se l\'utente riprova adesso, gli funziona?»)', /riprova adesso/i],
];

for (const [nome, forma] of regole) {
  test(`la regola resta scritta da qualche parte: ${nome}`, () => {
    expect(tutto(), `regola sparita da CLAUDE.md e non spostata altrove: ${nome}`).toMatch(forma);
  });
}

test('CLAUDE.md non vieta le scorciatoie globali con Alt che Filo usa (su Mac prendono un Ctrl davanti)', () => {
  const shortcuts = leggi('src/main/shortcuts.js');
  expect(shortcuts).toMatch(/'Alt\+E'/);
  expect(leggi('CLAUDE.md')).not.toMatch(/Niente Alt\+lettera/i);
});
