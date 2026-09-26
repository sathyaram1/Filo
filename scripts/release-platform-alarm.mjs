// release-platform-alarm.mjs — la mezza release di una piattaforma (Mac, Linux)
// è fallita: apre un feedback invece di lasciare un lavoro rosso che nessuno guarda.
// Non tocca niente: la versione per Windows resta pubblicata e valida.
//
// PERCHÉ ESISTE
//   `release-mac` e `release-linux` sono marcati `continue-on-error`, e la
//   ragione è giusta: un problema su Linux non deve togliere l'aggiornamento a
//   chi sta su Windows. Il prezzo era il silenzio — la release usciva con due
//   file su tre, il lavoro diventava rosso in una pagina che nessuno apre, e
//   dal 20/09 al 26/09 nessuno si è accorto che Filo per Linux non c'era.
//   Da qui il guasto diventa un feedback in coda, come già fa la suite rossa.
//
// USO
//   node scripts/release-platform-alarm.mjs            apre il feedback (legge l'ambiente)
//   node scripts/release-platform-alarm.mjs --attesi Linux
//     stampa, uno per riga, i file che devono stare nella release: li chiede il
//     passo di controllo del workflow, così l'elenco vive in un posto solo.

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inviaAllarme } from './build-alarm.mjs';

/**
 * Le piattaforme che si attaccano alla release già pubblicata da Windows.
 * `attesi` è la FONTE UNICA dei file che devono finire nella release: il
 * workflow lo chiede a `--attesi`, non lo ripete.
 */
/** Il nome della casella dell'avvio a mano, uguale a `release.yml`: il feedback
 *  manda li' chi deve rimettere i file, e un nome diverso lo manderebbe a vuoto. */
export const casella = (piattaforma) => `Rimetti i file per ${piattaforma} su una versione gia' uscita`;

export const PIATTAFORME = {
  Mac: {
    attesi: ['Filo-Mac.dmg', 'Filo-Mac.zip', 'latest-mac.yml'],
    scarica: 'Filo-Mac.dmg',
    aggiornamento: 'latest-mac.yml',
    attaccaDa: { 'Filo-Mac.dmg': 'build', 'Filo-Mac.zip': 'build', 'latest-mac.yml': 'build' },
  },
  Linux: {
    attesi: ['Filo-Linux.AppImage', 'latest-linux.yml', 'Se-Filo-non-si-apre-Linux.txt'],
    scarica: 'Filo-Linux.AppImage',
    aggiornamento: 'latest-linux.yml',
    attaccaDa: {
      'Filo-Linux.AppImage': 'build',
      'latest-linux.yml': 'build',
      'Se-Filo-non-si-apre-Linux.txt': 'istruzioni',
    },
  },
};

/**
 * I passi dei due lavori: `id` nel workflow → cosa stava facendo. Un id senza
 * voce qui finisce nell'allarme com'è — mai «sconosciuto»: chi legge deve
 * poterlo cercare nel registro. La sentinella non lascia nascere id muti.
 */
export const PASSI = {
  bersaglio: 'la scelta della versione a cui attaccarsi e del codice da costruire',
  checkout: 'il prelievo del codice di questa versione',
  node: 'la preparazione di Node',
  dipendenze: "l'installazione delle dipendenze (npm ci)",
  versione: 'il controllo che il codice qui sia davvero quello di questa versione',
  bake: "l'incastonatura delle chiavi di default nel pacchetto",
  build: 'la costruzione del pacchetto e il suo caricamento sulla release',
  istruzioni: 'il caricamento del foglietto del primo avvio',
  controllo: 'il controllo che i file siano davvero nella release',
};

/**
 * L'id del primo passo fallito, letto da `toJSON(steps)` di Actions (che li
 * elenca nell'ordine in cui sono girati). Stringa vuota se non si capisce
 * quale sia: l'allarme parte lo stesso, dirlo è meglio che tacere. PURA.
 */
export function passoFallito(esiti) {
  const passi = esiti && typeof esiti === 'object' ? esiti : {};
  for (const [id, stato] of Object.entries(passi)) {
    if (stato && typeof stato === 'object' && stato.outcome === 'failure') return String(id);
  }
  return '';
}

/** `toJSON(steps)` può arrivare vuoto o rotto: non è un motivo per non spedire. PURA. */
export function leggiEsiti(testo) {
  try {
    return JSON.parse(String(testo || '{}'));
  } catch {
    return {};
  }
}

/**
 * I file che a questo punto NON sono nella release, o `null` se non si sa.
 * Il controllo finale ha guardato la release vera: il suo elenco vince. Se ci
 * ci si ferma prima, lo dicono gli esiti dei passi, perché ogni file lo attacca
 * un passo preciso (`attaccaDa`): dare per perso tutto farebbe dire al feedback
 * che il download è rotto quando invece manca solo il foglietto. PURA.
 */
export function mancantiNoti({ piattaforma, esiti, mancanti } = {}) {
  const conf = PIATTAFORME[piattaforma];
  if (!conf) return null;

  const elencati = String(mancanti || '').trim().split(/\s+/).filter(Boolean);
  if (elencati.length) return elencati;

  const passi = esiti && typeof esiti === 'object' && !Array.isArray(esiti) ? esiti : null;
  if (!passi || !Object.keys(passi).length) return null;
  return conf.attesi.filter((f) => (passi[conf.attaccaDa[f]] || {}).outcome !== 'success');
}

/**
 * Titolo e testo del feedback. Nomina piattaforma, versione e passo fallito, e
 * porta il link all'esecuzione: chi lo prende in mano non deve cercarli. PURA.
 */
export function componiAllarme({ piattaforma, versione, passo, esecuzione, repo, mancanti, esiti } = {}) {
  const nome = String(piattaforma || '').trim() || '(piattaforma non indicata)';
  const v = String(versione || '').trim() || '(versione non indicata)';
  const p = String(passo || '').trim();
  const conf = PIATTAFORME[nome];
  const persi = mancantiNoti({ piattaforma: nome, esiti, mancanti });

  // Il titolo non deve gridare piu' del guasto: se il pacchetto da scaricare e'
  // salito e manca un file di contorno, la release e' incompleta, non assente.
  const coda = p ? ` (passo «${p}»)` : ' (passo non identificato)';
  const titolo = (conf && persi && !persi.includes(conf.scarica))
    ? `La release ${v} è incompleta per ${nome}: manca ${persi.join(', ')}${coda}`
    : `Filo per ${nome} non è nella release ${v}${coda}`;

  const righe = [
    `Il lavoro che costruisce Filo per ${nome} e lo attacca alla release ${v} è fallito. La versione per Windows è uscita ed è valida: resta com'è, non va tolta né ripubblicata.`,
    '',
  ];

  // Quello che è rotto si dice per nome. Dare per perso tutto quando manca un
  // file solo manda chi prende il feedback a cercare un guasto che non c'è.
  if (conf && persi === null) {
    righe.push(`Cosa sia arrivato nella release ${v} non si sa da qui: guardala. Devono esserci ${conf.attesi.join(', ')}.`, '');
  } else if (conf && persi.length === 0) {
    righe.push(`I file per ${nome} risultano tutti nella release ${v}: il lavoro si è fermato per altro, e il registro dice dove.`, '');
  } else if (conf) {
    const danni = [`Nella release ${v} mancano: ${persi.join(', ')}.`];
    if (repo && persi.includes(conf.scarica)) {
      danni.push(`Chi prova a scaricare non trova niente: https://github.com/${repo}/releases/latest/download/${conf.scarica} risponde 404.`);
    }
    if (persi.includes(conf.aggiornamento)) {
      danni.push(`E chi ha già Filo per ${nome} non riceve questa versione: l'aggiornamento automatico legge ${conf.aggiornamento}, che nella release non c'è.`);
    }
    righe.push(danni.join(' '), '');
  }

  righe.push(p
    ? `Passo fallito: «${p}»${PASSI[p] ? ` — ${PASSI[p]}.` : ' (non è uno dei passi noti: cercalo nel registro).'}`
    : 'Passo fallito: non identificato — gli esiti dei passi non sono arrivati leggibili. Il registro dell\'esecuzione dice quale si è fermato.');

  if (esecuzione) righe.push(`Registro dell'esecuzione: ${esecuzione}`);

  righe.push(
    '',
    `Cosa fare: capisci perché quel passo si è fermato, poi rimetti i file per ${nome} SU QUELLA STESSA release (${v}). Si fa avviando a mano il lavoro di pubblicazione con la casella «${casella(nome)}» e ${v} nel numero di versione: ricostruisce il codice di quella versione e le riattacca i suoi file, senza pubblicarne una nuova. Rilanciarlo senza quella casella non serve: decide se pubblicare contando i commit dopo l'ultimo tag, quindi senza commit nuovi non rifà niente e la ${v} resta senza.`,
  );

  if (conf) {
    righe.push(
      '',
      `Fatto, \`gh release view ${v} --json assets\` deve elencare: ${conf.attesi.join(', ')}.`,
    );
  }

  return { titolo, testo: righe.join('\n') };
}

async function main() {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--attesi');
  if (i >= 0) {
    const nome = argv[i + 1];
    const conf = PIATTAFORME[nome];
    // Un nome sbagliato deve FERMARE il passo di controllo: un elenco vuoto lo
    // farebbe passare verde senza aver guardato nessun file.
    if (!conf) {
      console.error(`[allarme] piattaforma «${nome || ''}» sconosciuta: sono ${Object.keys(PIATTAFORME).join(', ')}.`);
      process.exit(1);
    }
    console.log(conf.attesi.join('\n'));
    return;
  }

  const esiti = leggiEsiti(process.env.ESITI);
  const { titolo, testo } = componiAllarme({
    piattaforma: process.env.PIATTAFORMA,
    versione: process.env.VERSIONE,
    passo: passoFallito(esiti),
    esecuzione: process.env.ESECUZIONE,
    repo: process.env.REPO,
    mancanti: process.env.MANCANTI,
    esiti,
  });
  await inviaAllarme(titolo, testo);
}

const eseguitoDirettamente = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (eseguitoDirettamente) await main();
