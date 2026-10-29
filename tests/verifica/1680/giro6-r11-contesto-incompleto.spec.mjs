// #1680 giro 6, rilievo 11: il contesto del manutentore dice quando è incompleto (le schede ci sono ma l'indice no) e
// quando è fuori misura (centinaia di schede lunghe): chi lo legge deve saperlo prima di decidere l'ordine su di lui.

import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { main } from '../../../scripts/manutentore.mjs';

const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const scheda = (num, extra = {}) => ({ numero: String(num), titolo_breve: 'Menu immagini', riassunto: 'Il menu non si apre.', tipo: 'bug', area: 'browser-schede',
  file_probabili: ['src/content/menu.js'], urgente: false, valido: 'si', prova: 'p', risolto_su_main: null, parole_chiave: [], doppione_di: [], ...extra });

function repoVuoto(base) {
  const repo = join(base, 'repo');
  mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 'prova@filo.invalid');
  git(repo, 'config', 'user.name', 'prova');
  writeFileSync(join(repo, 'a.txt'), 'a\n');
  git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'inizio');
  git(repo, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  return repo;
}

async function contesto(cartella, root) {
  const righe = [];
  const { log, error } = console;
  console.log = (...a) => righe.push(a.join(' '));
  console.error = (...a) => righe.push(`ERR ${a.join(' ')}`);
  let code;
  try { code = await main(['contesto', '--cartella', cartella, '--senza-fetch'], { root }); } finally { console.log = log; console.error = error; }
  const tutto = righe.join('\n');
  // Il ruolo in testa parla dell'indice da sé: conta quello che lo strumento dice dopo, e i suoi avvisi.
  const dopo = tutto.slice(Math.max(0, tutto.indexOf('## Schede')));
  return { code, dopo, avvisi: righe.filter((r) => r.startsWith('ERR ')).join('\n') };
}

test('r11 schede senza indice: il contesto dice che l\'indice manca', async () => {
  const base = cartellaTemporanea('filo-1680-g6r11a-');
  const cartella = join(base, 'schede');
  mkdirSync(cartella);
  // La scheda di #700, scritta quando era aperto: senza indice non si sa se lo è ancora.
  writeFileSync(join(cartella, '700.json'), JSON.stringify(scheda(700)));
  const c = await contesto(cartella, repoVuoto(base));
  expect(`${c.avvisi}\n${c.dopo}`, 'stato e priorità sparite, schede di feedback chiusi stampate come aperte, e nessuna riga lo dice').toMatch(/indice/i);
});

test('r11 791 schede col riassunto più lungo che il controllo accetta: il contesto dice quanto pesa', async () => {
  const base = cartellaTemporanea('filo-1680-g6r11b-');
  const cartella = join(base, 'schede');
  mkdirSync(cartella);
  const riassunto = 'il menu delle immagini non si apre quando clicco col destro sulla pagina e Filo '.repeat(30).slice(0, 2000);
  const indice = [];
  for (let i = 1; i <= 791; i += 1) {
    indice.push({ id: `I${i}`, num: String(i), stato: 'todo', priorita: 1, aggiornato: 't', attese: [], unisce: [] });
    writeFileSync(join(cartella, `${i}.json`), JSON.stringify(scheda(i, { riassunto, _fonte: { id: `I${i}`, stato: 'todo', aggiornato: 't' } })));
  }
  writeFileSync(join(cartella, 'indice.json'), JSON.stringify(indice));
  const c = await contesto(cartella, repoVuoto(base));
  expect(c.dopo.length, 'la prova vuole davvero un contesto fuori misura').toBeGreaterThan(1_000_000);
  expect(`${c.avvisi}\n${c.dopo}`, 'oltre un milione di caratteri e lo strumento non lo dice, né offre le sole priorità alte').toMatch(/\d[\d.,\s]*\s*(mila\s+|k\s*)?(caratteri|token)/i);
});
