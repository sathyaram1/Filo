// Banco del guardiano (#536): quanto spesso grida al lupo?
//
// Un guardiano che blocca la posta normale viene spento, e a quel punto non
// protegge da niente. Quindi il numero che conta non è «quanti attacchi
// prende» ma «quante mail normali ferma». Questo strumento misura tutti e due
// sul corpus di tests/fixtures/banco-guardiano.json.
//
// DUE LIVELLI, misurati separatamente:
//   1. i controlli statici — deterministici, senza modello, senza rete. Girano
//      sempre. Sugli attacchi marcati con una regola DEVONO scattare; sulla
//      posta normale NON devono scattare mai. Questa metà è anche una
//      sentinella sempre accesa in tests/unit/guardiano.test.mjs.
//   2. il guardiano vero — serve un modello, quindi gira solo con una chiave
//      (OPENROUTER_API_KEY, o tests/agent/.env). Senza chiave lo strumento
//      misura solo il primo livello e lo dice.
//
// Uso:
//   node scripts/banco-guardiano.mjs                 # solo controlli statici
//   node scripts/banco-guardiano.mjs --modello <id>  # anche il guardiano vero
//
// NB: il banco è una categoria A PARTE rispetto al banco di sicurezza del
// red-team (che vive sui server di Filo e misura un'altra cosa: se un attacco
// entra). Qui si misura il costo della difesa in falsi allarmi.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const RADICE = join(__dirname, '..');

require(join(RADICE, 'src', 'shared', 'guardiano.js'));
const G = globalThis.SN_GUARDIANO;
const BANCO = JSON.parse(readFileSync(join(RADICE, 'tests', 'fixtures', 'banco-guardiano.json'), 'utf8'));

const argv = process.argv.slice(2);
function opzione(nome, def) {
  const i = argv.indexOf(nome);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
}
const MODELLO = opzione('--modello', argv.includes('--con-modello') ? 'google/gemma-4-31b-it' : '');

function pct(n, tot) {
  return tot ? `${((n / tot) * 100).toFixed(1)}%` : '—';
}

// ── Livello 1: controlli statici ────────────────────────────────────────────
const statico = { falsiPositivi: [], mancati: [], presi: 0, attesiDaRegola: 0 };
for (const n of BANCO.normali) {
  const r = G.controlliStatici({ testo: n.testo });
  if (r.bloccato) statico.falsiPositivi.push(`${n.id} (${r.regola})`);
}
for (const a of BANCO.attacchi) {
  const r = G.controlliStatici({ testo: a.testo });
  if (a.statico) {
    statico.attesiDaRegola++;
    if (r.bloccato && r.regola === a.statico) statico.presi++;
    else statico.mancati.push(`${a.id}: atteso ${a.statico}, ottenuto ${r.regola || 'niente'}`);
  } else if (r.bloccato) {
    statico.falsiPositivi.push(`${a.id} (preso da ${r.regola} invece che dal guardiano)`);
  }
}

console.log('── Controlli statici (senza modello, senza rete) ──');
console.log(`posta normale fermata: ${statico.falsiPositivi.length}/${BANCO.normali.length} (${pct(statico.falsiPositivi.length, BANCO.normali.length)})`);
for (const f of statico.falsiPositivi) console.log(`  ! ${f}`);
console.log(`attacchi da regola presi: ${statico.presi}/${statico.attesiDaRegola}`);
for (const m of statico.mancati) console.log(`  ! ${m}`);

if (!MODELLO) {
  console.log('\n(il guardiano vero non è stato provato: passa --modello <id> con una chiave OpenRouter)');
  process.exit(statico.falsiPositivi.length || statico.mancati.length ? 1 : 0);
}

// ── Livello 2: il guardiano vero ────────────────────────────────────────────
const { generate } = await import(join(RADICE, 'tests', 'agent', 'llm.mjs'));

async function giudica(caso) {
  const { messages } = G.costruisciPrompt({
    testo: caso.testo,
    classe: G.CLASSI.TERZI,
    fonte: caso.fonte,
    richiestaUtente: 'controlla la posta',
  });
  const testo = await generate({
    model: MODELLO,
    system: messages[0].content,
    user: messages[1].content,
    temperature: 0,
  });
  return G.interpretaVerdetto(testo);
}

const esiti = { falsiPositivi: [], mancati: [], senzaRisposta: [] };
for (const n of BANCO.normali) {
  const v = await giudica(n).catch(() => null);
  if (!v) esiti.senzaRisposta.push(n.id);
  else if (v.esito === 'blocca') esiti.falsiPositivi.push(`${n.id}: ${v.motivo}`);
}
for (const a of BANCO.attacchi) {
  if (G.controlliStatici({ testo: a.testo }).bloccato) continue; // già preso dal livello 1
  const v = await giudica(a).catch(() => null);
  if (!v) esiti.senzaRisposta.push(a.id);
  else if (v.esito !== 'blocca') esiti.mancati.push(a.id);
}

const totNormali = BANCO.normali.length;
console.log(`\n── Guardiano (${MODELLO}) ──`);
console.log(`posta normale fermata: ${esiti.falsiPositivi.length}/${totNormali} (${pct(esiti.falsiPositivi.length, totNormali)})`);
for (const f of esiti.falsiPositivi) console.log(`  ! ${f}`);
console.log(`attacchi passati: ${esiti.mancati.length}`);
for (const m of esiti.mancati) console.log(`  ! ${m}`);
if (esiti.senzaRisposta.length) console.log(`senza risposta (in attesa): ${esiti.senzaRisposta.join(', ')}`);

process.exit(esiti.mancati.length || statico.falsiPositivi.length || statico.mancati.length ? 1 : 0);
