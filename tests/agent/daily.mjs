// daily.mjs — giro automatico di esplorazione su più aree di Filo.
// Esegue explore.mjs per ogni area e raccoglie i report in reports/daily-<ts>/.
//
// Uso:  OPENROUTER_API_KEY=... node tests/agent/daily.mjs [--model M] [--steps N]

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getApiKey } from './llm.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const AREAS = [
  { name: 'dashboard', start: 'filo://newtab/', area: 'dashboard/new tab: messaggio centrale, suggerimenti a sinistra, colonna live a destra, barra input' },
  { name: 'editor', start: 'filo://editor/editor.html', area: 'editor: scrittura nel foglio, griglia moduli, switch pagine, conteggio parole, cerca/sostituisci' },
  { name: 'shell-tabs', start: 'filo://newtab/', area: 'shell: apertura/chiusura tab, menu App, pulsanti barra, navigazione tra pagine interne' },
  { name: 'history', start: 'filo://history/history.html', area: 'cronologia: lista elementi, layout, azioni' },
  { name: 'options', start: 'filo://options/options.html', area: 'impostazioni: campi, tema, salvataggio, layout' },
];

function parseArgs(argv) {
  const o = { model: 'google/gemma-4-31b-it', steps: 8 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--model') o.model = argv[++i];
    else if (argv[i] === '--steps') o.steps = argv[++i];
  }
  return o;
}

const o = parseArgs(process.argv.slice(2));
getApiKey();
const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const base = join(__dirname, 'reports', `daily-${ts}`);
mkdirSync(base, { recursive: true });

const summary = [];
for (const a of AREAS) {
  const out = join(base, a.name);
  console.log(`\n=== AREA: ${a.name} ===`);
  const r = spawnSync(process.execPath, [
    join(__dirname, 'explore.mjs'),
    '--model', o.model, '--steps', String(o.steps),
    '--start', a.start, '--area', a.area, '--out', out,
  ], { stdio: 'inherit', env: process.env });
  let issues = [];
  const ip = join(out, 'issues.json');
  if (existsSync(ip)) { try { issues = JSON.parse(readFileSync(ip, 'utf8')); } catch (_) {} }
  summary.push({ area: a.name, issues });
}

// Indice aggregato
const md = ['# Filo — daily explore', '', `Modello: \`${o.model}\` · ${ts}`, ''];
let total = 0;
for (const s of summary) {
  md.push(`## ${s.area} — ${s.issues.length} issue`);
  for (const i of s.issues) { md.push(`- [${i.severity}] ${i.title} — ${i.detail || ''} (\`${s.area}/${i.shot}\`)`); total++; }
  md.push('');
}
md.splice(3, 0, `Totale issue: **${total}**`, '');
writeFileSync(join(base, 'INDEX.md'), md.join('\n'));
console.log(`\n✓ Daily completato: ${join(base, 'INDEX.md')} — ${total} issue totali`);
