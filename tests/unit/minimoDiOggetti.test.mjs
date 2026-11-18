// Sentinella della regola «minimo di oggetti, e di tipi diversi» (#2384): la regola dell'owner sta nel file di design
// con le sue parole, e il conto oggetto per oggetto arriva sia a chi scrive sia a chi verifica.
// Il racconto: patterns/ogni-schermata-ha-il-minimo-di-oggetti-e-di-tipi-diversi.md.

import '../helpers/senzaSessione.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { readRoleInstructions } = await import('../../scripts/dispatch.mjs');

const REGOLA_OWNER = "ogni schermata ha il minimo di oggetti possibile, e soprattutto di tipi diversi (titolo, testo, riquadro, tasto pieno, tasto vuoto, icona, link…). prima di aggiungere un oggetto chiediti cosa perde l'utente senza: se non sai dirlo, non lo metti. un tipo in più si tiene solo se dice qualcosa che l'utente altrimenti non saprebbe. la stessa cosa ha la stessa forma in tutto filo. una funzione che serve di rado non diventa un oggetto: sta nel tasto destro o si chiede a filo.";

test('la regola dell\'owner sta in filo_design.txt sotto ESTETICA, con le sue parole', () => {
  const design = readFileSync(join(ROOT, 'filo_design.txt'), 'utf8').replace(/\r\n/g, '\n');
  const estetica = design.slice(design.indexOf('\nESTETICA\n'));
  assert.ok(estetica.length > 10, 'manca la sezione ESTETICA');
  assert.ok(estetica.split('\n').includes(REGOLA_OWNER), 'il testo approvato dall\'owner non è nella sezione ESTETICA, o è stato riscritto');
});

test('il pattern è nell\'indice', () => {
  const indice = readFileSync(join(ROOT, 'PATTERNS.md'), 'utf8');
  assert.match(indice, /\(patterns\/ogni-schermata-ha-il-minimo-di-oggetti-e-di-tipi-diversi\.md\)/);
});

test('il conto di oggetti e tipi arriva a chi scrive e a chi verifica', () => {
  for (const ruolo of ['new-work', 'verifier']) {
    const t = readRoleInstructions(ruolo);
    const i = t.indexOf('**Oggetti e tipi.**');
    assert.ok(i >= 0, `${ruolo}: il criterio sugli oggetti e i tipi non arriva nel testo assemblato`);
    const criterio = t.slice(i, i + 600);
    assert.match(criterio, /screenshot di prima con quello\s+di dopo/, `${ruolo}: il confronto fra prima e dopo manca`);
    assert.match(criterio, /cosa perde l'utente senza/, `${ruolo}: la domanda per ogni oggetto manca`);
    assert.match(criterio, /rilievo da correggere, non un dubbio/, `${ruolo}: un oggetto senza risposta deve essere un rilievo`);
  }
});
