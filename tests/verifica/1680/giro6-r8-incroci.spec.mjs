// #1680 giro 6, rilievo 8: «nessun ramo in corso tocca i suoi file» si dice solo quando lo strumento lo sa. Una scheda
// coi file scritti in una forma che non sa confrontare la rifiuta il controllo o la confronta giusta; senza file, o per
// file del server (i cui rami non legge), lo dice; un ramo che lavora più feedback li nomina tutti.

import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { main } from '../../../scripts/manutentore.mjs';
import { validaScheda } from '../../../scripts/schede.mjs';

const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const scheda = (num, file_probabili, extra = {}) => ({ numero: String(num), titolo_breve: 'Menu', riassunto: 'Il menu non si apre.', tipo: 'bug', area: 'browser-schede',
  file_probabili, urgente: false, valido: 'si', prova: 'p', risolto_su_main: null, parole_chiave: [], doppione_di: [], ...extra });

// Un repo con un ramo in corso, claude/menu, che lavora #901 e #905 su src/content/menu.js.
function scena(prefisso) {
  const base = cartellaTemporanea(prefisso);
  const repo = join(base, 'repo');
  mkdirSync(join(repo, 'src', 'content'), { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 'prova@filo.invalid');
  git(repo, 'config', 'user.name', 'prova');
  writeFileSync(join(repo, 'src', 'content', 'menu.js'), 'uno\n');
  git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'inizio');
  git(repo, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  git(repo, 'checkout', '-q', '-b', 'claude-menu');
  for (const [testo, msg] of [['due', '#901 menu: prima parte'], ['tre', '#901 menu: seconda parte'], ['quattro', '#905 menu: il colore']]) {
    writeFileSync(join(repo, 'src', 'content', 'menu.js'), `${testo}\n`);
    git(repo, 'commit', '-q', '-am', msg);
  }
  git(repo, 'update-ref', 'refs/remotes/origin/claude/menu', 'HEAD');
  git(repo, 'checkout', '-q', 'main');
  const cartella = join(base, 'schede');
  mkdirSync(cartella);
  const indice = ['901', '905', '910', '911', '950'].map((num) => ({ id: `I${num}`, num, stato: 'todo', priorita: 1, aggiornato: 't', attese: [], unisce: [] }));
  writeFileSync(join(cartella, 'indice.json'), JSON.stringify(indice));
  return { repo, cartella };
}

async function incroci({ repo, cartella }, num, s) {
  writeFileSync(join(cartella, `${num}.json`), JSON.stringify(s));
  const righe = [];
  const { log, error } = console;
  console.log = (...a) => righe.push(a.join(' '));
  console.error = (...a) => righe.push(a.join(' '));
  try { await main(['incroci', String(num), '--cartella', cartella, '--senza-fetch'], { root: repo }); } finally { console.log = log; console.error = error; }
  return righe.join('\n');
}

const FORME = [
  ['una cartella senza barra finale', ['src/content']],
  ['un percorso assoluto', ['/home/utente/Filo/src/content/menu.js']],
  ['un percorso di Windows', ['C:\\Users\\agenti AI\\Filo\\src\\content\\menu.js']],
];
for (const [nome, file] of FORME) {
  test(`r8 file probabili scritti come ${nome}: il controllo della scheda li rifiuta, o incroci trova il ramo che tocca menu.js`, async () => {
    const s = scheda(910, file);
    const rifiutata = validaScheda(s, '910').length > 0;
    const out = await incroci(scena('filo-1680-g6r8f-'), 910, s);
    expect(rifiutata || out.includes('claude/menu'), `scheda accettata e risposta «${out}»`).toBe(true);
  });
}

test('r8 scheda senza file probabili: incroci non risponde «nessun ramo», dice che non lo sa', async () => {
  const s = scheda(911, []);
  const rifiutata = validaScheda(s, '911').length > 0;
  const out = await incroci(scena('filo-1680-g6r8v-'), 911, s);
  expect(rifiutata || !/Nessun ramo in corso tocca/.test(out), `scheda accettata e risposta «${out}»`).toBe(true);
});

test('r8 scheda di un lavoro sul server: incroci non risponde «nessun ramo» senza dire che i rami del server non li ha letti', async () => {
  const s = scheda(950, ['functions/src/routine/pacemaker.js'], { area: 'server-filo-security' });
  const out = await incroci(scena('filo-1680-g6r8s-'), 950, s);
  expect(!/Nessun ramo in corso tocca/.test(out) || /server/i.test(out), `risposta «${out}»`).toBe(true);
});

test('r8 un ramo che lavora #901 e #905 incrocia la scheda: incroci li nomina tutti e due', async () => {
  const out = await incroci(scena('filo-1680-g6r8n-'), 910, scheda(910, ['src/content/menu.js']));
  expect(out).toContain('claude/menu');
  expect(out, 'il controllo degli incroci nomina solo il primo feedback del ramo').toContain('#905');
});
