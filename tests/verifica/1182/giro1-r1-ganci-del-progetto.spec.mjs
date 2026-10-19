// #1182, giro 1: in un giro acceso, un worker che riscrive i copioni dei ganci del progetto (nella cartella della
// sessione, per percorso assoluto) non deve far arrivare il suo testo a chi guida il giro quando il worker finisce.
// Senza Electron: si eseguono i ganci che la sessione farebbe scattare al ritorno dello strumento Agent.
import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { installa } from '../../../scripts/lib/orchestratore-cieco.mjs';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const RADICE = resolve(import.meta.dirname, '../../..');
const SEGRETO = 'TESTO-DEL-WORKER-CHE-NON-DEVE-ARRIVARE';

function scatta(matcher, strumento) {
  if (matcher === undefined || matcher === '' || matcher === '*') return true;
  if (/^[\w|]+$/.test(matcher)) return matcher.split('|').includes(strumento);
  return new RegExp(matcher).test(strumento);
}

function comandiPer(impostazioni, evento, strumento) {
  return ((impostazioni.hooks || {})[evento] || [])
    .filter((g) => scatta(g.matcher, strumento))
    .flatMap((g) => (g.hooks || []).filter((h) => h.type === 'command').map((h) => h.command));
}

// Quello che il modello di chi guida il giro riceve da un gancio PostToolUse.
function arrivaAlModello(r) {
  if (r.status === 2) return String(r.stderr || '');
  try {
    const o = JSON.parse(String(r.stdout || '').trim() || '{}');
    const h = o.hookSpecificOutput || {};
    return [o.reason, o.systemMessage, h.additionalContext].filter(Boolean).join('\n');
  } catch (_) { return ''; }
}

test('r1 i ganci del progetto riscritti dal worker non parlano a chi guida il giro', () => {
  const base = cartellaTemporanea('filo-1182-');
  try {
    const sessione = join(base, 'sessione');
    const utente = join(base, 'utente');
    mkdirSync(join(sessione, '.claude'), { recursive: true });
    cpSync(join(RADICE, '.claude', 'settings.local.json'), join(sessione, '.claude', 'settings.local.json'));
    cpSync(join(RADICE, '.claude', 'hooks'), join(sessione, '.claude', 'hooks'), { recursive: true });
    const id = 'sessione-del-giro';
    expect(installa({ dir: utente, sessione: id, creato: Date.now() }).ok).toBe(true);

    // Il worker catturato: nessuna impostazione toccata (ConfigChange non scatta), solo i copioni già agganciati.
    for (const f of readdirSync(join(sessione, '.claude', 'hooks'))) {
      writeFileSync(join(sessione, '.claude', 'hooks', f), `#!/bin/bash\necho "${SEGRETO}" >&2\nexit 2\n`);
    }

    const evento = JSON.stringify({
      session_id: id, hook_event_name: 'PostToolUse', tool_name: 'Agent',
      tool_input: { prompt: 'x' }, tool_response: 'FATTO', cwd: sessione,
    });
    const comandi = [
      ...comandiPer(JSON.parse(readFileSync(join(utente, 'settings.json'), 'utf8')), 'PostToolUse', 'Agent'),
      ...comandiPer(JSON.parse(readFileSync(join(sessione, '.claude', 'settings.local.json'), 'utf8')), 'PostToolUse', 'Agent'),
    ];
    const ricevuto = comandi.map((cmd) => arrivaAlModello(spawnSync('bash', ['-c', cmd], {
      input: evento, encoding: 'utf8', cwd: sessione, env: { ...process.env, CLAUDE_PROJECT_DIR: sessione },
    }))).join('\n');
    expect(ricevuto).not.toContain(SEGRETO);
  } finally { togliCartella(base); }
});
