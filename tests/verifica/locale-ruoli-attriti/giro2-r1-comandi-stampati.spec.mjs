// Giro locale «ruoli-attriti», giro 2 — i comandi che gli strumenti del giro
// STAMPANO a chi lavora portano alla copia fissata, come quelli delle ricette.
//
// Gli strumenti si fissano fuori dal progetto come nel giro vero e si lanciano
// dalla copia; ogni `node <script>` stampato deve puntare lì, non al ramo.

import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { execFile, execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const RADICE = fileURLToPath(new URL('../../../', import.meta.url));
const norm = (p) => String(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

async function strumentiFissati() {
  const dest = resolve(cartellaTemporanea('filo-ruoli-attriti-pin2-'), 'strumenti');
  const { pinTools } = await import(pathToFileURL(resolve(RADICE, 'scripts/lib/tools-pin.mjs')).href);
  const r = pinTools(RADICE, { dest });
  expect(r.ok, r.why).toBe(true);
  return r.dir;
}

function progetto(fuori) {
  const dir = resolve(fuori, 'progetto');
  mkdirSync(dir, { recursive: true });
  const g = (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g(['init', '-q', '--initial-branch=main']);
  g(['config', 'user.email', 't@t']);
  g(['config', 'user.name', 't']);
  writeFileSync(resolve(dir, 'a.txt'), 'base\n', 'utf8');
  g(['add', '-A']);
  g(['commit', '-qm', 'base']);
  g(['checkout', '-qb', 'claude/lavoro']);
  return dir;
}

// Il testo che il server manda a chi verifica quando deve anche correggere:
// i due comandi sono quelli, parola per parola, della risposta vera.
const ISTRUZIONI_DEL_SERVER = [
  '8. Consegna:',
  '     node scripts/dispatch.mjs --record-fixed <id> "<report della correzione>" [--frase "<frase>"] [--segnala <file.md>]',
  '   Senza segnalazione il lavoro torna in verifica sul commit nuovo, da un',
  '   altro verificatore. Poi rilascia:',
  '     node scripts/routine-channel.mjs release <biglietto> --role verifier',
].join('\n');

function fintoServer() {
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        ok: true,
        reply: {
          outcome: 'fix',
          phase2: {
            findings: [{ level: 2, sede: 'i', text: 'il salvataggio non parte col titolo vuoto' }],
            derived: [{ num: '#901', level: 1, sede: 'e', text: 'il menu esce dallo schermo' }],
            instructions: ISTRUZIONI_DEL_SERVER,
          },
        },
      }));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, port: srv.address().port })));
}

function lancia(args, env, cwd) {
  return new Promise((r) => execFile(process.execPath, args, { env, cwd },
    (err, so, se) => r({ status: err ? (err.code ?? 1) : 0, out: `${so || ''}\n${se || ''}` })));
}

// Ogni `node <script .mjs>` nel testo stampato, col percorso come lo scriverebbe chi lo lancia.
function scriptNominati(testo) {
  return [...testo.matchAll(/node\s+(?:"([^"]+\.mjs)"|(\S+\.mjs))/g)].map((m) => m[1] || m[2]);
}

async function ambiente(pin) {
  const fuori = cartellaTemporanea('filo-ruoli-attriti-stampa-');
  const dir = progetto(fuori);
  const statoDir = resolve(fuori, 'stato');
  mkdirSync(statoDir, { recursive: true });
  for (const id of ['IDSEC', 'IDVER']) {
    writeFileSync(resolve(statoDir, `${id}.json`), JSON.stringify({ id, branch: 'claude/lavoro' }) + '\n', 'utf8');
  }
  const { srv, port } = await fintoServer();
  const env = {
    ...process.env,
    FILO_REPO_ROOT: dir,
    FILO_TOOLS_ROOT: '',
    FILO_DISPATCH_STATE_DIR: statoDir,
    FILO_NO_BEAT: '1',
    FILO_ROUTINE_TICKET: 'biglietto-finto',
    FILO_ROUTINE_API: `http://127.0.0.1:${port}`,
  };
  return { dir, env, srv, dispatch: resolve(pin, 'scripts', 'dispatch.mjs') };
}

function tuttiAllaCopiaFissata(testo, pin, cosa) {
  const nominati = scriptNominati(testo);
  expect(nominati.length, `${cosa}: deve nominare almeno un comando\n${testo}`).toBeGreaterThan(0);
  for (const s of nominati) {
    expect(norm(s).startsWith(norm(pin) + '/scripts/'),
      `${cosa}: «node ${s}» lanciato dalla cartella di lavoro esegue gli strumenti del ramo, non quelli fissati (${pin})`).toBe(true);
  }
}

test('controllo di sicurezza, «pass» senza nota: il comando per rilanciare porta agli strumenti fissati', async () => {
  const pin = await strumentiFissati();
  const { dir, env, srv, dispatch } = await ambiente(pin);
  try {
    const r = await lancia([dispatch, '--record-secaudit', 'IDSEC', 'pass'], env, dir);
    expect(r.status, 'senza nota il pass si ferma prima di consegnare').not.toBe(0);
    tuttiAllaCopiaFissata(r.out, pin, 'il rifiuto del pass senza nota');
  } finally {
    srv.close();
  }
});

test('verifica con rilievi da correggere: i comandi della risposta (pulizia, consegna, rilascio) portano agli strumenti fissati', async () => {
  const pin = await strumentiFissati();
  const { dir, env, srv, dispatch } = await ambiente(pin);
  try {
    const critica = 'Provato il salvataggio in tutti i modi.\n[2i] il salvataggio non parte col titolo vuoto\n[1e] il menu esce dallo schermo';
    const r = await lancia([dispatch, '--record-verifier', 'IDVER', critica], env, dir);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain('--record-pulizia');
    expect(r.out).toContain('--record-fixed');
    tuttiAllaCopiaFissata(r.out, pin, 'la risposta del server stampata a chi verifica');
  } finally {
    srv.close();
  }
});
