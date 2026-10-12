// #849 giro 1 — la sentinella dei servizi esterni deve accorgersi di un servizio nuovo e di una voce morta anche
// quando file e indirizzo di base sono già nell'elenco per un altro servizio. Gira la sentinella vera su una copia di src/.
import { test, expect } from '@playwright/test';
import { cpSync, mkdirSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SENTINELLA = 'tests/unit/serviziEsterni.test.mjs';

function sentinellaSu(modifica) {
  const dir = cartellaTemporanea('filo-849-');
  try {
    cpSync(join(ROOT, 'src'), join(dir, 'src'), { recursive: true });
    cpSync(join(ROOT, 'package.json'), join(dir, 'package.json'));
    cpSync(join(ROOT, 'transparency'), join(dir, 'transparency'), { recursive: true });
    mkdirSync(join(dir, 'tests', 'unit'), { recursive: true });
    cpSync(join(ROOT, SENTINELLA), join(dir, SENTINELLA));
    symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'), 'junction');
    modifica(dir);
    return spawnSync(process.execPath, ['--test', SENTINELLA], { cwd: dir, encoding: 'utf8' }).status;
  } finally {
    togliCartella(dir);
  }
}

test('la copia senza modifiche è verde (controllo della prova)', () => {
  expect(sentinellaSu(() => {})).toBe(0);
});

test('r1 un servizio nuovo con l’host in una costante, in un file già nell’elenco, fa rosso', () => {
  const stato = sentinellaSu((dir) => {
    const f = join(dir, 'src/main/services/handlers/wallet.js');
    writeFileSync(f, readFileSync(f, 'utf8')
      + "\nconst HOST_NUOVO = 'nuovo-servizio.example';\nasync function nuovo() { return fetch(`https://${HOST_NUOVO}/api`); }\n");
  });
  expect(stato, 'la sentinella resta verde con un servizio nuovo').not.toBe(0);
});

test('r1 la richiesta dell’invito in attesa tolta dal codice fa rossa la sua voce', () => {
  const stato = sentinellaSu((dir) => {
    const f = join(dir, 'src/main/services/handlers/wallet.js');
    const prima = readFileSync(f, 'utf8');
    const dopo = prima.replace("r = await callable('walletPendingInvite');", 'r = null;');
    if (dopo === prima) throw new Error('la richiesta dell’invito in attesa non è più scritta così: aggiorna la prova');
    writeFileSync(f, dopo);
  });
  expect(stato, 'la voce «invito in attesa» resta verde senza la sua richiesta').not.toBe(0);
});
