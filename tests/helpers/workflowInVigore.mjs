// I workflow come saranno in vigore: in .github/workflows li porta solo l'owner (#1140), e una copia in attesa in
// routines/automazioni vale al posto dell'attiva omonima. Le sentinelle provano così il file che entrerà; che la copia
// sia nata sull'attiva di adesso lo tiene tests/unit/automazioniInAttesa.test.mjs.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ATTIVI = join(ROOT, '.github', 'workflows');
export const IN_ATTESA = join(ROOT, 'routines', 'automazioni');

export const nomiYaml = (cartella) => (existsSync(cartella) ? readdirSync(cartella).filter((f) => /\.ya?ml$/.test(f)).sort() : []);

export function percorsoWorkflow(nome) {
  const attesa = join(IN_ATTESA, nome);
  return existsSync(attesa) ? attesa : join(ATTIVI, nome);
}

export const leggiWorkflow = (nome) => readFileSync(percorsoWorkflow(nome), 'utf8');

/** Attivi e in attesa, uno per nome: `[{ nome, testo }]`. */
export function workflowInVigore() {
  return [...new Set([...nomiYaml(ATTIVI), ...nomiYaml(IN_ATTESA)])].sort().map((nome) => ({ nome, testo: leggiWorkflow(nome) }));
}
