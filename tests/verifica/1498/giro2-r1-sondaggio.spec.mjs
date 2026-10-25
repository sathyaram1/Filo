// Verifica #1498 giro 2, rilievo 1: un guasto passeggero al primo sondaggio non fa partire un biglietto senza
// accensione, che nascerebbe non fidato e sporcherebbe la chiave anche per le sessioni dopo.
import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const CANALE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'scripts', 'routine-channel.mjs');

test('r1 col sondaggio in guasto il comando del biglietto non chiede un biglietto senza accensione', async () => {
  test.setTimeout(60_000);
  const utente = cartellaTemporanea('filo-verifica-1498-');
  const ricevute = [];
  const srv = createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      const body = JSON.parse(b || '{}');
      ricevute.push(body);
      res.setHeader('Content-Type', 'application/json');
      if (body.probe) { res.statusCode = 503; return res.end(JSON.stringify({ ok: false, reason: 'queue_unreadable' })); }
      res.end(JSON.stringify({ ok: true, work: true, ticket: 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde', role: 'verifier' }));
    });
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  try {
    const esito = await new Promise((ok) => {
      const p = spawn(process.execPath, [CANALE, 'ticket', 'parola-d-ordine', '--json', '--accensione-pacemaker', 'Pm_segreto_del_pacemaker_0123'], {
        env: { ...process.env, FILO_ROUTINE_TICKET: '', FILO_ROUTINE_API: `http://127.0.0.1:${srv.address().port}`, CLAUDE_CONFIG_DIR: utente },
      });
      let se = '';
      p.stderr.on('data', (c) => { se += c; });
      p.on('close', (code) => ok({ code, se }));
    });
    expect(ricevute.some((r) => r.probe === true), esito.se).toBe(true);
    const senza = ricevute.filter((r) => r.probe !== true && !r.accensione);
    expect(senza.length, `biglietti chiesti senza accensione (uscita ${esito.code})`).toBe(0);
  } finally {
    await new Promise((ok) => srv.close(ok));
    togliCartella(utente);
  }
});
