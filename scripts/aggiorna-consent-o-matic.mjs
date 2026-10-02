// Rigenera src/vendor/consent-o-matic/rules.json dalle regole di Consent-O-Matic (MIT): `node scripts/aggiorna-consent-o-matic.mjs`.
// Segue rules-list.json del progetto (le regole che il progetto stesso esclude restano fuori) e copia anche la licenza.
// Chi le usa: src/main/services/consentRules.js.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'https://github.com/cavi-au/Consent-O-Matic.git';
const RADICE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEST = path.join(RADICE, 'src', 'vendor', 'consent-o-matic');

const tmp = mkdtempSync(path.join(tmpdir(), 'com-'));
try {
  execFileSync('git', ['clone', '--depth', '1', REPO, tmp], { stdio: 'inherit' });
  const commit = execFileSync('git', ['-C', tmp, 'rev-parse', 'HEAD']).toString().trim();
  const elenco = JSON.parse(readFileSync(path.join(tmp, 'rules-list.json'), 'utf8')).references || [];
  const rules = {};
  for (const url of elenco) {
    const file = String(url).split('/rules/')[1];
    if (!file) continue;
    const parte = JSON.parse(readFileSync(path.join(tmp, 'rules', file), 'utf8'));
    for (const [nome, regola] of Object.entries(parte)) {
      if (nome.startsWith('$')) continue;
      rules[nome] = regola;
    }
  }
  mkdirSync(DEST, { recursive: true });
  writeFileSync(path.join(DEST, 'rules.json'), JSON.stringify({ source: REPO, commit, rules }) + '\n');
  writeFileSync(path.join(DEST, 'LICENSE'), readFileSync(path.join(tmp, 'LICENSE'), 'utf8'));
  console.log(`Consent-O-Matic ${commit.slice(0, 10)}: ${Object.keys(rules).length} regole`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
