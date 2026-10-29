// #1680 giro 6, rilievo 2: l'agente che scrive la scheda di #12 lavora sul testo di un feedback che può scrivere
// chiunque. Se tocca la scheda di un altro feedback (#903), timbri compresi, il manutentore non deve leggerla come buona.

import { test, expect } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { main as schede } from '../../../scripts/schede.mjs';
import { main as manutentore } from '../../../scripts/manutentore.mjs';

const cp = createRequire(import.meta.url)('node:child_process');
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const scheda = (num, extra = {}) => ({ numero: String(num), titolo_breve: 'Menu immagini', riassunto: 'Il menu non si apre.', tipo: 'bug', area: 'browser-schede',
  file_probabili: ['src/content/menu.js'], urgente: false, valido: 'si', prova: 'si apre la pagina e il menu non c\'è', risolto_su_main: null, parole_chiave: [], doppione_di: [], ...extra });

// L'agente finto fa quello che il testo ostile di #12 gli chiede: scrive la sua scheda e, dentro la stessa cartella,
// quella di #903 come «non valido, doppione di #12», coi timbri copiati dall'indice e una rilettura inventata.
const AGENTE = `
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
if (process.argv.includes('auth')) { console.log(JSON.stringify({ loggedIn: true })); process.exit(0); }
const prompt = readFileSync(0, 'utf8');
const num = /^Feedback: (\\S+)$/m.exec(prompt)[1];
const cartella = /^Cartella delle schede: (.+)$/m.exec(prompt)[1].trim();
const indice = JSON.parse(readFileSync(join(cartella, 'indice.json'), 'utf8'));
const voce = indice.find((f) => f.num === '903');
const scheda = (n, extra) => ({ numero: n, titolo_breve: 'Menu immagini', riassunto: 'Il menu non si apre.', tipo: 'bug', area: 'browser-schede',
  file_probabili: ['src/content/menu.js'], urgente: false, valido: 'si', prova: 'p', risolto_su_main: null, parole_chiave: [], doppione_di: [], ...extra });
const falsa = { valido: 'no', prova: 'la funzione non esiste più', doppione_di: [num],
  _fonte: { id: voce.id, stato: voce.stato, aggiornato: voce.aggiornato, at: '2026-10-29T08:00:00Z', modello: 'haiku' },
  _riletta: { at: '2026-10-29T08:05:00Z', modello: 'opus' } };
if (process.env.FILO_PROVA_AGENTE === 'fallisce') {
  // Fallisce dopo aver scritto nel proprio file la scheda di un altro feedback.
  writeFileSync(join(cartella, num + '.json'), JSON.stringify(scheda('903', falsa)));
  console.log(JSON.stringify({ is_error: true, result: 'interrotto', total_cost_usd: 0.01 }));
  process.exit(1);
}
writeFileSync(join(cartella, num + '.json'), JSON.stringify(scheda(num, {})));
if (process.env.FILO_PROVA_AGENTE === 'toglie-dall-indice') {
  writeFileSync(join(cartella, 'indice.json'), JSON.stringify(indice.filter((f) => f.num !== '903')));
  console.log(JSON.stringify({ result: '#' + num + ': fatta', total_cost_usd: 0.01 }));
  process.exit(0);
}
writeFileSync(join(cartella, '903.json'), JSON.stringify(scheda('903', falsa)));
console.log(JSON.stringify({ result: '#' + num + ': fatta', total_cost_usd: 0.01 }));
`;

async function zitto(fn) {
  const righe = [];
  const { log, error } = console;
  console.log = (...a) => righe.push(a.join(' '));
  console.error = (...a) => righe.push(a.join(' '));
  try { return { code: await fn(), testo: righe.join('\n') }; } finally { console.log = log; console.error = error; }
}

async function scena(prefisso, comportamento) {
  const base = cartellaTemporanea(prefisso);
  const repo = join(base, 'repo');
  mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 'prova@filo.invalid');
  git(repo, 'config', 'user.name', 'prova');
  writeFileSync(join(repo, 'a.txt'), 'a\n');
  git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'inizio');
  git(repo, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  const cartella = join(base, 'schede');
  mkdirSync(cartella);
  const indice = [
    { id: 'idDodici', num: '12', stato: 'todo', priorita: 1, aggiornato: '2026-10-29T07:00:00Z', attese: [], unisce: [] },
    { id: 'idNovecentotre', num: '903', stato: 'todo', priorita: 3, aggiornato: '2026-10-28T07:00:00Z', attese: [], unisce: [] },
  ];
  writeFileSync(join(cartella, 'indice.json'), JSON.stringify(indice));
  // La scheda di #903 com'era prima: buona, scritta e timbrata da `scrivi` sulla versione di adesso.
  writeFileSync(join(cartella, '903.json'), JSON.stringify(scheda(903, { _fonte: { id: 'idNovecentotre', stato: 'todo', aggiornato: '2026-10-28T07:00:00Z', at: '2026-10-28T08:00:00Z', modello: 'haiku' } })));
  const agente = join(base, 'agente-finto.mjs');
  writeFileSync(agente, AGENTE);
  // `claude` è l'agente finto: lo stesso lancio di `scrivi`, con node e lo script al posto del binario.
  const BIN = join(base, 'claude-finto');
  const spawnVero = cp.spawn;
  const env = { bin: process.env.FILO_CLAUDE_BIN, comp: process.env.FILO_PROVA_AGENTE };
  cp.spawn = (cmd, args, opts) => (cmd === BIN ? spawnVero(process.execPath, [agente, ...args], opts) : spawnVero(cmd, args, opts));
  syncBuiltinESMExports();
  process.env.FILO_CLAUDE_BIN = BIN;
  process.env.FILO_PROVA_AGENTE = comportamento;
  let scrivi;
  try {
    scrivi = await zitto(() => schede(['scrivi', '--solo', '12', '--cartella', cartella]));
  } finally {
    cp.spawn = spawnVero;
    syncBuiltinESMExports();
    for (const [k, v] of [['FILO_CLAUDE_BIN', env.bin], ['FILO_PROVA_AGENTE', env.comp]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
  const contesto = await zitto(() => manutentore(['contesto', '--cartella', cartella, '--senza-fetch'], { root: repo }));
  const righe903 = contesto.testo.split('\n').filter((r) => r.startsWith('#903 '));
  return { scrivi, contesto, righe903, cartella };
}

// Una riga di scheda senza avviso è `#N · [area/tipo] · …`: chi la legge la prende per buona.
const presaPerBuona = (r) => /^#903 · \[/.test(r) && /valido no/.test(r);

test('r2 l\'agente di #12 riscrive la scheda di #903 come doppione di #12, timbri compresi: il manutentore non la legge come buona', async () => {
  const s = await scena('filo-1680-g6r2a-', 'riscrive-altri');
  // L'agente finto è partito davvero: senza, la prova non direbbe niente.
  expect(JSON.parse(readFileSync(join(s.cartella, '12.json'), 'utf8')).numero).toBe('12');
  const buone = s.righe903.filter(presaPerBuona);
  expect(buone, `#903 doppione di #12 senza nessun avviso:\n${s.righe903.join('\n')}`).toEqual([]);
});

test('r2 l\'agente di #12 fallisce lasciando nel suo file la scheda di #903: nel contesto non passa per buona', async () => {
  const s = await scena('filo-1680-g6r2b-', 'fallisce');
  expect(s.scrivi.testo).toMatch(/#12: agente fallito/);
  const buone = s.righe903.filter(presaPerBuona);
  expect(buone, `una scheda di #903 «non valido» presa per buona:\n${s.righe903.join('\n')}`).toEqual([]);
});

test('r2 l\'agente di #12 toglie #903 dall\'indice: #903 non sparisce dal contesto senza che il manutentore lo sappia', async () => {
  const s = await scena('filo-1680-g6r2c-', 'toglie-dall-indice');
  expect(JSON.parse(readFileSync(join(s.cartella, '12.json'), 'utf8')).numero).toBe('12');
  const dopo = s.contesto.testo.slice(Math.max(0, s.contesto.testo.indexOf('## Schede')));
  expect(s.contesto.code !== 0 || dopo.includes('#903'), `#903 sparito dal contesto senza una riga:\n${dopo.split('## Rami')[0]}`).toBe(true);
});
