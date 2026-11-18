// #2303.1 giro 1: l'invito al rapporto parziale arriva al worker quando serve, e solo allora.
import { test, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const B = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde';
const SID = 'sessione-verifica-2303-1';

function fintoServer(rispondi) {
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(rispondi(req.url)));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, port: srv.address().port })));
}

function cli(argv, env, stdin = '') {
  return new Promise((r) => {
    const figlio = execFile(process.execPath, [resolve(REPO, 'scripts', 'routine-channel.mjs'), ...argv], { env: { ...process.env, ...env } },
      (err, so, se) => r({ code: err ? (err.code ?? 1) : 0, so: String(so || ''), se: String(se || '') }));
    figlio.stdin.end(stdin);
  });
}

/** Un compito col tetto di 1 $ e un transcript del worker da decine di dollari: oltre la metà del tetto. */
function compitoOltreLaMeta() {
  const casa = cartellaTemporanea('filo-v2303-');
  mkdirSync(join(casa, 'work', '.claude'), { recursive: true });
  writeFileSync(join(casa, 'work', '.claude', 'routine-ticket.json'), JSON.stringify({ ticket: B, since: new Date(Date.now() - 60_000).toISOString(), tettoUsd: 1 }));
  const tracce = join(casa, 'config', 'projects', '-home-user-Filo', SID, 'subagents');
  mkdirSync(tracce, { recursive: true });
  writeFileSync(join(tracce, 'agent-w1.jsonl'), `${JSON.stringify({
    type: 'assistant', timestamp: new Date().toISOString(), sessionId: SID,
    message: { id: 'caro', model: 'claude-opus-5-5', usage: { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 1_000_000 }, content: [{ type: 'text', text: 'x' }] },
  })}\n`);
  return { casa, work: join(casa, 'work'), configDir: join(casa, 'config') };
}

test('r2 dopo il rapporto finale il worker non viene invitato a consegnare un rapporto parziale', async () => {
  const { casa, work, configDir } = compitoOltreLaMeta();
  const { srv, port } = await fintoServer(() => ({ ok: true, compito: 'C-7', chiuso: true, perIlRicorrente: true }));
  try {
    const env = { FILO_ROUTINE_API: `http://127.0.0.1:${port}`, FILO_REPO_ROOT: work, FILO_ROUTINE_TICKET: B, FILO_NO_BEAT: '1', CLAUDE_CONFIG_DIR: configDir, CLAUDE_CODE_SESSION_ID: SID };
    const sp = await cli(['spesa'], env);
    expect(sp.so, 'la misura vede la corsa oltre la metà del tetto').toMatch(/consegna adesso un rapporto parziale/);
    const r = await cli(['rapporto'], env, 'Finito: riordinati 50 di 50.\n');
    expect(r.code, r.se).toBe(0);
    expect(r.so).toMatch(/OK: rapporto consegnato, C-7 chiuso/);
    // Il compito è chiuso: un parziale adesso il server lo rifiuta, e la riga non deve chiederlo.
    expect(`${r.se}\n${r.so}`).not.toMatch(/consegna adesso un rapporto parziale/);
  } finally { srv.close(); togliCartella(casa); }
});

test('r3 la veglia che misura la corsa oltre la metà del tetto fa arrivare al worker l’invito al rapporto parziale', async () => {
  const { veglia, USCITA_LAVORA } = await import('../../../scripts/lib/veglia-worker.mjs');
  let t = Date.parse('2026-11-18T10:00:00Z');
  const e = await veglia({
    adesso: () => t, dorme: async (ms) => { t += ms; }, fetta: 90_000, passo: 10_000,
    leggi: () => ({ mio: true, finito: false, tempi: [t - 60_000], processi: 0, tracce: { viste: true, attesa: null, file: ['a.jsonl'] }, tettoUsd: 120 }),
    rilascia: () => { throw new Error('nessun guasto'); },
    costo: async () => ({ usd: 80 }),
    rilasciaOltre: () => { throw new Error('sotto il tetto non si ferma'); },
  });
  expect(e.uscita).toBe(USCITA_LAVORA);
  // Un worker che non usa il canale non vede la sua spesa: chi guida il giro, che la misura, deve fargli chiedere il parziale.
  expect(e.testo).toMatch(/parziale/);
});
