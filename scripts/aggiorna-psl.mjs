// Rigenera src/vendor/public-suffix-list/ dalla sezione privata della Public Suffix List (MPL 2.0): `node scripts/aggiorna-psl.mjs`.
// Le regole restano quelle dell'elenco, tradotte in ASCII come arrivano gli host; la licenza si copia accanto.
// Chi le usa: src/shared/stessoSito.js, nel main e nelle pagine (per questo è uno script e non un .json).

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL, domainToASCII } from 'node:url';

const REPO = 'https://github.com/publicsuffix/list.git';
const RADICE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEST = path.join(RADICE, 'src', 'vendor', 'public-suffix-list');

function regolaAscii(riga) {
  const m = /^([!]|\*\.)?(.+)$/.exec(riga);
  const nome = domainToASCII(m[2]).toLowerCase();
  if (!nome) throw new Error(`regola che non si traduce in ASCII: ${riga}`);
  return (m[1] || '') + nome;
}

export function testoPrivata(dati) {
  return `// La sezione privata della Public Suffix List (MPL 2.0, licenza qui accanto): le piattaforme che ospitano i siti di
// chiunque. La scrive \`node scripts/aggiorna-psl.mjs\`, non si modifica a mano; la legge solo src/shared/stessoSito.js.

(function (global) {
  'use strict';

  const PSL = ${JSON.stringify(dati, null, 1).replace(/\n/g, '\n  ')};

  global.SN_PSL_PRIVATA = PSL;
  if (typeof module !== 'undefined' && module.exports) module.exports = PSL;
})(typeof globalThis !== 'undefined' ? globalThis : self);
`;
}

function aggiorna() {
  const tmp = mkdtempSync(path.join(tmpdir(), 'psl-'));
  try {
    execFileSync('git', ['clone', '--depth', '1', REPO, tmp], { stdio: 'inherit' });
    const commit = execFileSync('git', ['-C', tmp, 'rev-parse', 'HEAD']).toString().trim();
    const testo = readFileSync(path.join(tmp, 'public_suffix_list.dat'), 'utf8');
    const inizio = testo.indexOf('// ===BEGIN PRIVATE DOMAINS===');
    const fine = testo.indexOf('// ===END PRIVATE DOMAINS===');
    if (inizio < 0 || fine < inizio) throw new Error('sezione privata non trovata: il formato dell\'elenco è cambiato');
    const rules = testo.slice(inizio, fine).split('\n')
      .map((r) => r.trim().split(/\s/)[0])
      .filter((r) => r && !r.startsWith('//'))
      .map(regolaAscii);
    mkdirSync(DEST, { recursive: true });
    writeFileSync(path.join(DEST, 'privata.js'), testoPrivata({ source: REPO, commit, rules }));
    writeFileSync(path.join(DEST, 'LICENSE'), readFileSync(path.join(tmp, 'LICENSE'), 'utf8'));
    console.log(`Public Suffix List ${commit.slice(0, 10)}: ${rules.length} regole private`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) aggiorna();
