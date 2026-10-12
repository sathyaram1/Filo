// Verifica locale «fiducia» (#1148), giro 7, rilievo 1: in locale una sessione che legge testo che il server non vede
// (pagina web, posta) resta pulita: nessuno le dice di dichiararsi sporca e nessun gancio lo fa per lei. Server finto.
// Passa se la riga che l'hook di avvio consegna alla sessione nomina il comando, o se un gancio sugli strumenti lo chiama.
import { test, expect } from './../../fixtures/electron.mjs';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const RADICE = join(import.meta.dirname, '..', '..', '..');
const SEGRETO = 's'.repeat(48);
const FP = 'f'.repeat(64);

function serverFinto() {
  const fetchImpl = async (_url, init) => {
    const { data } = JSON.parse(init.body);
    const result = data.op === 'prendi' ? { ok: true, ticket: SEGRETO, fp: FP, fiducia: data.sporco ? 'non_fidato' : 'fidato' }
      : data.op === 'stato' ? { ok: true, fiducia: 'fidato', sporcatoDa: [], chiuso: false } : { ok: true };
    return { ok: true, status: 200, json: async () => ({ result }) };
  };
  return { fetchImpl, idToken: async () => 'token-finto' };
}

/** Quello che la sessione legge all'avvio: l'hook passa solo la prima riga di `biglietto.mjs avvio`. */
async function rigaDellaSessione() {
  const B = await import(pathToFileURL(join(RADICE, 'scripts', 'lib', 'biglietto-locale.mjs')).href);
  const dir = cartellaTemporanea('giro7-lettura-');
  try {
    execFileSync('git', ['init', '-q'], { cwd: dir });
    const r = await B.avvio({ input: { session_id: 'nuova', source: 'startup' }, env: { CLAUDE_ENV_FILE: join(dir, 'env.sh') }, cwd: dir, deps: serverFinto(), haCredenziale: async () => true });
    return String(r.riga || '').split('\n')[0];
  } finally { togliCartella(dir); }
}

/** I ganci della sessione che scattano dopo `strumento` e chiamano la dichiarazione di sporco. */
function gancioCheSporca(strumento) {
  const f = join(RADICE, '.claude', 'settings.local.json');
  if (!existsSync(f)) return false;
  const hooks = (JSON.parse(readFileSync(f, 'utf8')).hooks) || {};
  for (const fase of ['PreToolUse', 'PostToolUse']) {
    for (const voce of hooks[fase] || []) {
      let prende = voce.matcher === '*';
      try { prende = prende || new RegExp(`^(?:${voce.matcher || '.*'})$`).test(strumento); } catch (_) {}
      if (!prende) continue;
      for (const h of voce.hooks || []) {
        const cmd = String(h.command || '');
        const file = (cmd.match(/hooks\/([\w.-]+)/) || [])[1];
        const testo = cmd + (file && existsSync(join(RADICE, '.claude', 'hooks', file)) ? readFileSync(join(RADICE, '.claude', 'hooks', file), 'utf8') : '');
        if (/sporca/.test(testo)) return true;
      }
    }
  }
  return false;
}

for (const [cosa, strumento] of [['una pagina web', 'WebFetch'], ['una mail', 'mcp__gmail__get_thread']]) {
  test(`r1 una sessione locale pulita che legge ${cosa} sa di doversi sporcare, o un gancio la sporca`, async () => {
    const riga = await rigaDellaSessione();
    expect(riga, 'la sessione nasce pulita').toMatch(/pulito/);
    const detto = /biglietto\.mjs sporca/.test(riga);
    const fatto = gancioCheSporca(strumento);
    expect(detto || fatto, `all'avvio la sessione legge solo «${riga}», e nessun gancio dopo ${strumento} la sporca`).toBe(true);
  });
}
