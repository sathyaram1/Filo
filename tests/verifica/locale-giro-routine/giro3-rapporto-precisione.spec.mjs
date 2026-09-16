// Prove del giro 3 (verifica locale) sul lavoro «giro di routine del 14/09»,
// punto 5: i numeri del rapporto di fine sessione davanti a due forme che i
// transcript veri di questa macchina hanno davvero (viste il 16/09/2026): il
// testo di un file letto che contiene le parole «timed out», e le righe col
// modello «<synthetic>» (zero token) che Claude Code scrive fra i messaggi
// dell'assistente. E la porta del giro 2 ri-provata: da una cartella di
// lavoro separata (git worktree) il transcript si trova lo stesso.

import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { analizzaRighe, generaRapporto, slugProgetto } from '../../../scripts/session-report.mjs';

const USO = { input_tokens: 10, cache_creation_input_tokens: 30000, cache_read_input_tokens: 0, output_tokens: 40 };
const riga = (o) => JSON.stringify(o);

test.describe('rapporto di fine sessione — i numeri davanti ai transcript veri', () => {
  test('leggere un file che contiene «timed out» non è un timeout: conta solo il risultato in errore di un comando scaduto', async () => {
    // Il rapporto di QUESTA verifica, generato dal suo stesso transcript,
    // diceva «timeout 2» senza che nessun comando fosse scaduto: erano due
    // file letti (uno spec e lo script del rapporto) con dentro le parole
    // «timed out». Nei transcript veri il timeout di Claude Code è un
    // tool_result in errore che COMINCIA con «Command timed out after …».
    // Rilievo del giro 3, livello 1: chi legge codice o spec — cioè ogni
    // worker — porta nel rapporto timeout che non ci sono stati.
    test.fail(true, 'rilievo del giro 3: le parole «timed out» dentro un file letto contano come un timeout');
    const righe = [
      { type: 'assistant', timestamp: '2026-09-16T10:00:00.000Z', sessionId: 's', message: { id: 'm1', model: 'claude-opus-5', usage: USO, content: [{ type: 'tool_use', id: 't1', name: 'Read' }] } },
      { type: 'user', timestamp: '2026-09-16T10:00:01.000Z', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: "    12\tif (/timed out/i.test(testo)) rep.tools.timeouts += 1; // 'Command timed out after 2m 0s'" }] } },
      { type: 'assistant', timestamp: '2026-09-16T10:00:02.000Z', sessionId: 's', message: { id: 'm2', model: 'claude-opus-5', usage: USO, content: [{ type: 'tool_use', id: 't2', name: 'Bash' }] } },
      { type: 'user', timestamp: '2026-09-16T10:02:02.000Z', message: { content: [{ type: 'tool_result', tool_use_id: 't2', is_error: true, content: 'Command timed out after 2m 0s\nnpm run finish:check' }] } },
    ].map(riga);
    const rep = await analizzaRighe(righe, {});
    expect(rep.tools.total).toBe(2);
    expect(rep.tools.timeouts).toBe(1);
    expect(rep.tools.errors).toBe(1);
  });

  test('una riga col modello «<synthetic>» (zero token) non è un turno e non lascia la nota «modello sconosciuto»', async () => {
    // Nei transcript di questa macchina (36 righe in sei file) Claude Code
    // scrive messaggi dell'assistente col modello «<synthetic>» e usage tutta
    // a zero. Il rapporto li conta come turni e aggiunge la nota «modello
    // sconosciuto «<synthetic>»: costo calcolato a tariffa opus» — su un
    // costo che è zero. Rilievo del giro 3, livello 1: un turno in più e una
    // nota falsa in quasi ogni rapporto che l'owner legge.
    test.fail(true, 'rilievo del giro 3: la riga «<synthetic>» conta come turno e produce la nota del modello sconosciuto');
    const zero = { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 };
    const righe = [
      { type: 'assistant', timestamp: '2026-09-16T10:00:00.000Z', sessionId: 's', message: { id: 'm1', model: 'claude-opus-5', usage: USO, content: [{ type: 'text', text: 'ciao' }] } },
      { type: 'assistant', timestamp: '2026-09-16T10:00:05.000Z', sessionId: 's', message: { id: 'sint-1', model: '<synthetic>', role: 'assistant', stop_reason: 'stop_sequence', usage: zero, content: [{ type: 'text', text: 'Request interrupted' }] } },
      { type: 'assistant', timestamp: '2026-09-16T10:01:00.000Z', sessionId: 's', message: { id: 'm2', model: 'claude-opus-5', usage: USO, content: [{ type: 'text', text: 'fine' }] } },
    ].map(riga);
    const rep = await analizzaRighe(righe, {});
    expect(rep.turns).toBe(2);
    expect(rep.models).toEqual(['claude-opus-5']);
    expect(rep.notes.join(' | ')).not.toMatch(/sconosciuto/);
  });
});

test.describe('rapporto di fine sessione — da una cartella di lavoro separata', () => {
  test('lanciato da un git worktree trova il transcript scritto nella cartella del checkout principale', async () => {
    // Porta del giro 2 (livello 0), ri-provata: Claude Code scrive i
    // transcript nella cartella del progetto da cui la sessione è partita,
    // e la sessione locale lavora in .claude/worktrees/<nome>.
    const base = cartellaTemporanea('giro3-rapporto-wt-');
    const repo = join(base, 'repo');
    mkdirSync(repo, { recursive: true });
    const git = (...a) => execFileSync('git', ['-c', 'user.name=prova', '-c', 'user.email=prova@prova', ...a], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git('init', '-q');
    git('checkout', '-q', '-b', 'main');
    writeFileSync(join(repo, 'a.txt'), 'uno\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'primo');
    const wt = join(repo, '.claude', 'worktrees', 'prova');
    git('worktree', 'add', '-q', wt, '-b', 'claude/prova');
    // I transcript stanno sotto lo slug del checkout PRINCIPALE, non del worktree.
    const config = join(base, 'config');
    const dir = join(config, 'projects', slugProgetto(repo));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'sess.jsonl'), [
      { type: 'assistant', timestamp: '2026-09-16T10:00:00.000Z', sessionId: 'sess-wt', message: { id: 'm1', model: 'claude-opus-5', usage: USO, content: [{ type: 'text', text: 'ciao' }] } },
    ].map(riga).join('\n') + '\n');
    const rep = await generaRapporto({ role: 'verifier', cwd: wt, configDir: config });
    expect(rep.sessionId).toBe('sess-wt');
    expect(rep.turns).toBe(1);
    expect(rep.notes).toEqual([]);
  });
});
