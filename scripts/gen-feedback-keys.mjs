// Genera la coppia di chiavi per la cifratura dei feedback (S1.1).
//
// Schema: ECDH P-256 (sealed box, vedi src/shared/feedbackCrypto.js).
//   - PUBBLICA  -> scritta in src/shared/feedbackPublicKey.js (committabile).
//   - PRIVATA   -> stampata a video, da salvare FUORI dal repo (owner/backend/
//                  routine). Non viene mai scritta su disco da questo script.
//
// USO:
//   node scripts/gen-feedback-keys.mjs            # genera e aggiorna il file pubblico
//   node scripts/gen-feedback-keys.mjs --print    # stampa soltanto, NON tocca il file
//
// ⚠️ Rigenerare la coppia rende ILLEGGIBILI i feedback cifrati con la vecchia
//    chiave. Fallo solo a freddo (nessun feedback cifrato in giro) o gestisci
//    la rotazione conservando la vecchia privata per decifrare lo storico.

import { webcrypto as crypto } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBKEY_FILE = join(__dirname, '..', 'src', 'shared', 'feedbackPublicKey.js');

// Qui l'azione di serie RIGENERA la chiave, e i feedback cifrati con la
// vecchia non si leggono più: un'opzione scritta male non deve arrivarci
// (feedback #565).
if (process.argv.slice(2).some((a) => a === '--help' || a === '-h')) {
  console.log([
    'Uso: node scripts/gen-feedback-keys.mjs [--print]',
    '  ATTENZIONE: senza --print RIGENERA la chiave, e i feedback cifrati con la',
    '  vecchia non si leggono più. --print stampa soltanto la chiave attuale.',
  ].join('\n'));
  process.exit(0);
}
const { controllaArgomenti } = await import('./lib/argomenti.mjs');
const argomentiSbagliati = controllaArgomenti(process.argv.slice(2), { opzioni: ['--print'] });
if (argomentiSbagliati) {
  console.error(`RIFIUTATO: ${argomentiSbagliati}`);
  process.exit(1);
}
const printOnly = process.argv.includes('--print');

function bytesToB64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function main() {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']
  );
  const pubRaw = await crypto.subtle.exportKey('raw', pair.publicKey);     // 65 byte
  const privPkcs8 = await crypto.subtle.exportKey('pkcs8', pair.privateKey);

  const pubB64url = bytesToB64url(pubRaw);
  const privB64 = Buffer.from(privPkcs8).toString('base64');

  if (!printOnly) {
    const src = readFileSync(PUBKEY_FILE, 'utf8');
    const re = /(=== FILO_FEEDBACK_PUBKEY[^\n]*\n)[\s\S]*?(\n\s*\/\/ === \/FILO_FEEDBACK_PUBKEY ===)/;
    if (!re.test(src)) {
      console.error('ERRORE: marcatori FILO_FEEDBACK_PUBKEY non trovati in', PUBKEY_FILE);
      process.exit(1);
    }
    const replaced = src.replace(
      re,
      `$1  global.SN_FEEDBACK_PUBKEY = ${JSON.stringify(pubB64url)};$2`
    );
    writeFileSync(PUBKEY_FILE, replaced);
    console.log('✓ Chiave pubblica scritta in src/shared/feedbackPublicKey.js');
  }

  console.log('\n=== CHIAVE PUBBLICA (committabile) ===');
  console.log(pubB64url);
  console.log('\n=== CHIAVE PRIVATA (SEGRETA — salvala fuori dal repo) ===');
  console.log(privB64);
  console.log(
    '\nDove va la privata (S1.5):\n' +
    '  • owner:    impostazione/env locale sulla macchina dell\'owner;\n' +
    '  • backend:  secret delle Cloud Functions (filo-security);\n' +
    '  • routine:  variabile d\'ambiente FILO_FEEDBACK_PRIVKEY (mai in chiaro nel repo).\n' +
    '⚠️ NON committarla, NON incollarla in chat/prompt non fidati.\n'
  );
}

main().catch((e) => { console.error(e); process.exit(1); });
