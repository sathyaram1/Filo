// #849 giro 6: la sentinella dei servizi esterni, girata su una copia di src/ cambiata come la cambierebbe un lavoro futuro.
// r2: un file nuovo che apre una connessione verso un host in una costante va riconosciuto come file che fa rete.

import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, collegaCartella, togliCartella } from '../../helpers/percorsi.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SENTINELLA = join('tests', 'unit', 'serviziEsterni.test.mjs');

function sentinellaSu(modifica) {
  const dir = cartellaTemporanea('filo-849-');
  try {
    cpSync(join(ROOT, 'src'), join(dir, 'src'), { recursive: true });
    cpSync(join(ROOT, 'package.json'), join(dir, 'package.json'));
    mkdirSync(join(dir, 'tests', 'unit'), { recursive: true });
    cpSync(join(ROOT, SENTINELLA), join(dir, SENTINELLA));
    collegaCartella(join(ROOT, 'node_modules'), join(dir, 'node_modules'));
    modifica(dir);
    const r = spawnSync(process.execPath, ['--test', SENTINELLA], { cwd: dir, encoding: 'utf8' });
    return { rossa: r.status !== 0, uscita: r.stdout };
  } finally { togliCartella(dir); }
}

const fileNuovo = (file, testo) => (dir) => writeFileSync(join(dir, file), testo);

test('controllo: la copia senza modifiche è verde', () => {
  expect(sentinellaSu(() => {}).rossa).toBe(false);
});

for (const [cosa, testo] of [
  ['il modulo net di Node preso al volo', "const HOST = 'nuovo.example';\nmodule.exports = () => require('node:net').connect(443, HOST);\n"],
  ['connect preso dal modulo net di Node', "const { connect } = require('node:net');\nconst HOST = 'nuovo.example';\nmodule.exports = () => connect(443, HOST);\n"],
  ['request presa dalla rete di Electron', "const { request } = require('electron').net;\nconst HOST = 'nuovo.example';\nmodule.exports = () => request({ protocol: 'https:', hostname: HOST, path: '/' });\n"],
]) {
  test(`r2 ${cosa}: un servizio nuovo in un file nuovo fa rossa la sentinella`, () => {
    const s = sentinellaSu(fileNuovo('src/main/services/zzServizioNuovo.js', testo));
    expect(s.rossa, 'la sentinella resta verde con un file nuovo che contatta nuovo.example').toBe(true);
  });
}
