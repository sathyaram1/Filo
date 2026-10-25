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
//   node scripts/routine-keys.mjs account <nome> <A|B>
//   node scripts/routine-keys.mjs rete <nome> <limitata|aperta>
//   node scripts/routine-keys.mjs lavori <nome> <server|normali>
//   node scripts/routine-keys.mjs ambiente <nome> <riservati|normale>

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
  // Qui non esistono opzioni, e le azioni non si annullano: una parola che
  // sembra un'opzione — «--dry-run», che ogni strumento vicino accetta —
  // veniva ignorata in silenzio e la parola d'ordine revocata davvero
  // (feedback #565).
  const USO = 'Uso: node scripts/routine-keys.mjs [elenco | crea <nome> <potere> "<descrizione>" | revoca <nome> | account <nome> <A|B>'
    + ' | rete <nome> <limitata|aperta> | lavori <nome> <server|normali> | ambiente <nome> <riservati|normale>]';
  // Chiedere aiuto non è un errore, e questo è lo strumento dove sbagliare
  // costa di più: l'aiuto si stampa e basta (feedback #565).
  if (process.argv.slice(2).some((a) => a === '--help' || a === '-h')) { console.log(USO); return; }
  const { controllaArgomenti } = await import('./lib/argomenti.mjs');
  const male = controllaArgomenti(process.argv.slice(2), { opzioni: [] });
  if (male) {
    console.error(`RIFIUTATO: ${male.replace(/ Ammesse:.*$/, ' Qui non ci sono opzioni.')}`);
    console.error(USO);
    process.exit(1);
  }
  const [cmd, nome, potere, ...resto] = process.argv.slice(2);

  if (cmd === 'elenco' || !cmd) {
    const { keys = [] } = await chiama({ op: 'list' });
    if (!keys.length) { console.log('Nessuna parola d\'ordine attiva.'); return; }
    for (const k of keys) {
      // Il server dice `revoked`: guardare un campo che non manda (una data di
      // revoca) faceva sembrare attive anche quelle spente — e su un elenco di
      // credenziali quello e' l'errore peggiore possibile.
      const stato = k.revoked ? 'REVOCATA' : 'attiva';
      // L'account claude.ai della routine: senza, il suo consumo non va su nessun account (crediti, #1156).
      const account = k.scope === 'routine' ? `account ${k.account || '—'}`.padEnd(10) : ''.padEnd(10);
      // Solo a rete limitata i biglietti nascono puliti; la chiave server prende solo lavori server (#1253).
      const rete = k.scope === 'routine' ? `rete ${k.rete || 'aperta'}`.padEnd(14) : ''.padEnd(14);
      const lavori = k.scope === 'routine' && k.lavori === 'server' ? 'lavori server  ' : ''.padEnd(15);
      // L'ambiente dei riservati (#1153): solo lì il server consegna testo riservato, e solo compiti.
      const ambiente = k.scope === 'routine' && k.ambiente === 'riservati' ? 'riservati  ' : '';
      console.log(`${String(k.slug).padEnd(24)} ${String(k.scope || '?').padEnd(8)} ${account} ${rete} ${lavori}${ambiente}${stato}`
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
    // Da sola sulla riga, senza rientro: si copia con la riga, e i quattro spazi finivano nel segreto (#1210).
    console.log(`${r.passphrase}\n`);
    console.log('Copiala ADESSO dove serve: non si potrà più rileggere.');
    console.log(potere === 'build'
      ? "Va nell'ambiente «rilascio» del repo (Settings → Environments → rilascio), come FILO_BUILD_PASSPHRASE: fra i segreti del repo non la legge nessuno."
      // Una parola d'ordine di routine NON va nell'ambiente: l'ambiente lo
      // eredita ogni lavoratore che parte da lì. Sta solo nel prompt della
      // routine schedulata, che è l'unica cosa che l'orchestratore tiene per sé.
      : 'Va nel PROMPT della routine schedulata: "routine automatica. <parola d\'ordine>".\n'
        + "Mai nell'ambiente: da lì la erediterebbe ogni lavoratore che parte.");
    // Senza account il consumo della routine non entra nella riserva dei crediti (#1156): lo si dice qui, dove nasce.
    if (potere === 'routine') {
      console.log(`\nPoi dille su che account claude.ai gira, o il suo consumo resta fuori dalla riserva dei crediti:\n`
        + `    node scripts/routine-keys.mjs account ${r.slug} <A|B>`);
    }
    return;
  }

  if (cmd === 'revoca') {
    if (!nome) { console.error('Uso: node scripts/routine-keys.mjs revoca <nome>'); process.exit(1); }
    await chiama({ op: 'revoke', slug: nome });
    console.log(`"${nome}" revocata: da adesso non apre più niente.`);
    return;
  }

  if (cmd === 'account') {
    if (!nome || (potere !== 'A' && potere !== 'B') || resto.length) {
      console.error('Uso: node scripts/routine-keys.mjs account <nome> <A|B>');
      process.exit(1);
    }
    await chiama({ op: 'account', slug: nome, account: potere });
    console.log(`"${nome}" gira sull'account ${potere}: da adesso il suo consumo conta lì.`);
    return;
  }

  if (cmd === 'rete') {
    if (!nome || (potere !== 'limitata' && potere !== 'aperta') || resto.length) {
      console.error('Uso: node scripts/routine-keys.mjs rete <nome> <limitata|aperta>');
      process.exit(1);
    }
    await chiama({ op: 'rete', slug: nome, rete: potere });
    console.log(potere === 'limitata'
      ? `"${nome}" è a rete limitata: i suoi biglietti possono nascere puliti. Vale solo se l'ambiente della routine su claude.ai ha davvero la rete limitata.`
      : `"${nome}" è a rete aperta: i suoi biglietti nascono sporchi e non prende lavori server.`);
    return;
  }

  if (cmd === 'lavori') {
    if (!nome || (potere !== 'server' && potere !== 'normali') || resto.length) {
      console.error('Uso: node scripts/routine-keys.mjs lavori <nome> <server|normali>');
      process.exit(1);
    }
    await chiama({ op: 'lavori', slug: nome, lavori: potere });
    console.log(potere === 'server'
      ? `"${nome}" è la chiave della routine server: riceve solo lavori server fidati, e solo a rete limitata.`
      : `"${nome}" prende i lavori normali: mai un lavoro server, salvo il controllo di sicurezza a rete limitata.`);
    return;
  }

  if (cmd === 'ambiente') {
    if (!nome || (potere !== 'riservati' && potere !== 'normale') || resto.length) {
      console.error('Uso: node scripts/routine-keys.mjs ambiente <nome> <riservati|normale>');
      process.exit(1);
    }
    await chiama({ op: 'ambiente', slug: nome, ambiente: potere });
    console.log(potere === 'riservati'
      ? `"${nome}" è la chiave dell'ambiente dei riservati: riceve solo compiti, e lei sola il testo riservato. Vale solo se l'ambiente della routine su claude.ai esce davvero soltanto verso il server.`
      : `"${nome}" è in un ambiente normale: non riceve testo riservato.`);
    return;
  }

  console.error('Uso: node scripts/routine-keys.mjs <elenco|crea|revoca|account|rete|lavori|ambiente> …');
  process.exit(1);
}

main().catch((e) => { console.error(e?.message || e); process.exit(1); });
