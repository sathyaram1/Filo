// routine-keys.mjs — le parole d'ordine delle routine, dalla parte dell'owner.
//
// PERCHÉ ESISTE (spec ROUTINE-AUTH-SPEC.md)
//   Ogni macchina che fa girare una routine ha la SUA parola d'ordine. Con
//   quella chiede un biglietto usa-e-getta, e con il biglietto lavora: il
//   lavoro glielo sceglie il server, e il server valida ogni consegna. Se una
//   macchina va persa si revoca la sua parola d'ordine e basta — le altre
//   continuano, e non c'è niente da cambiare altrove.
//
//   La parola d'ordine si vede UNA VOLTA SOLA, al momento in cui nasce. Sul
//   server ne resta solo l'impronta: nemmeno chi entrasse lì può rileggerla, ed
//   è il punto — non "una comodità in meno". Se la perdi non si recupera: se ne
//   crea un'altra e si revoca la vecchia.
//
// UN SEGRETO, UN POTERE
//   `routine` apre solo il chiedere lavoro. `build` apre solo la lettura delle
//   chiavi da incastonare nella versione che si distribuisce. Nessuna le apre
//   entrambe, e va DICHIARATO: una credenziale che non dice a cosa serve non
//   apre niente.
//
// USO
//   node scripts/routine-keys.mjs elenco
//   node scripts/routine-keys.mjs crea <nome> <routine|build> ["a cosa serve"]
//   node scripts/routine-keys.mjs revoca <nome>

import { findAdminRefreshToken, mintIdToken } from './lib/firestore-auth.mjs';

const REGIONE = 'europe-west1';
const PROGETTO = 'filo-8b9cb';
const INDIRIZZO = `https://${REGIONE}-${PROGETTO}.cloudfunctions.net/routineKeys`;

async function chiama(data) {
  const refresh = findAdminRefreshToken();
  if (!refresh) {
    console.error('Non trovo le tue credenziali di proprietario (FILO_ADMIN_REFRESH_TOKEN).');
    process.exit(1);
  }
  const idToken = await mintIdToken(refresh);
  const res = await fetch(INDIRIZZO, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ data }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.error?.message || `errore ${res.status}`;
    console.error(`Non riuscito: ${msg}`);
    process.exit(1);
  }
  return body.result || {};
}

function quando(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }); }
  catch (_) { return String(iso); }
}

async function main() {
  const [cmd, nome, potere, ...resto] = process.argv.slice(2);

  if (cmd === 'elenco' || !cmd) {
    const { keys = [] } = await chiama({ op: 'list' });
    if (!keys.length) { console.log('Nessuna parola d\'ordine attiva.'); return; }
    for (const k of keys) {
      // Il server dice `revoked`: guardare un campo che non manda (una data di
      // revoca) faceva sembrare attive anche quelle spente — e su un elenco di
      // credenziali quello e' l'errore peggiore possibile.
      const stato = k.revoked ? 'REVOCATA' : 'attiva';
      console.log(`${String(k.slug).padEnd(24)} ${String(k.scope || '?').padEnd(8)} ${stato}`
        + (k.lastUsedAt ? `  ultimo uso ${quando(k.lastUsedAt)}` : '')
        + (k.label ? `  — ${k.label}` : ''));
    }
    return;
  }

  if (cmd === 'crea') {
    if (!nome || !potere) {
      console.error('Uso: node scripts/routine-keys.mjs crea <nome> <routine|build> ["a cosa serve"]');
      process.exit(1);
    }
    const r = await chiama({ op: 'issue', slug: nome, scope: potere, label: resto.join(' ') });
    console.log(`\nParola d'ordine per "${r.slug}" (potere: ${r.scope}):\n`);
    console.log(`    ${r.passphrase}\n`);
    console.log('Copiala ADESSO dove gira quella routine: non si potrà più rileggere.');
    console.log(potere === 'build'
      ? "Va nell'ambiente della costruzione, come FILO_BUILD_PASSPHRASE."
      : "Va nell'ambiente della routine, come FILO_ROUTINE_PASSPHRASE.");
    return;
  }

  if (cmd === 'revoca') {
    if (!nome) { console.error('Uso: node scripts/routine-keys.mjs revoca <nome>'); process.exit(1); }
    await chiama({ op: 'revoke', slug: nome });
    console.log(`"${nome}" revocata: da adesso non apre più niente.`);
    return;
  }

  console.error('Uso: node scripts/routine-keys.mjs <elenco|crea|revoca> …');
  process.exit(1);
}

main().catch((e) => { console.error(e?.message || e); process.exit(1); });
