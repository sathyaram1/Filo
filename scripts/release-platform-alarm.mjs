// release-platform-alarm.mjs — la metà Mac o Linux di una pubblicazione è fallita: apre un feedback, la release Windows resta.
// Legge le release (mai le scrive) per dire cosa manca e per la chiave; `--attesi <piattaforma>` stampa i file che devono esserci.
// Regole: patterns/mac-e-linux-si-rompono-in-silenzio.md; sentinelle tests/unit/releasePlatformAlarm.test.mjs e releaseSuite.test.mjs.

import { resolve } from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { inviaAllarme } from './build-alarm.mjs';

/** Il nome della casella dell'avvio a mano, uguale a `release.yml`: il feedback
 *  manda li' chi deve rimettere i file, e un nome diverso lo manderebbe a vuoto. */
export const casella = (piattaforma) => `Rimetti i file per ${piattaforma} su una versione gia' uscita`;

/** `attesi` è la FONTE UNICA dei file che devono finire nella release: il controllo del workflow li chiede a `--attesi`. */
export const PIATTAFORME = {
  Mac: {
    attesi: ['Filo-Mac.dmg', 'Filo-Mac.zip', 'latest-mac.yml'],
    scarica: 'Filo-Mac.dmg',
    aggiornamento: 'latest-mac.yml',
  },
  Linux: {
    attesi: ['Filo-Linux.AppImage', 'latest-linux.yml', 'Se-Filo-non-si-apre-Linux.txt'],
    scarica: 'Filo-Linux.AppImage',
    aggiornamento: 'latest-linux.yml',
  },
};

/**
 * I passi dei due lavori: `id` nel workflow → cosa stava facendo. Un id senza
 * voce qui finisce nell'allarme com'è — mai «sconosciuto»: chi legge deve
 * poterlo cercare nel registro. La sentinella non lascia nascere id muti.
 */
export const PASSI = {
  strumento: 'il prelievo del codice di questa corsa, quello che porta lo strumento di questo avviso',
  riparo: "la copia degli strumenti di questa corsa (questo avviso, l'installazione che ritenta, le impronte) fuori dalla copia di lavoro",
  bersaglio: 'la scelta della versione a cui attaccarsi e del codice da costruire',
  checkout: 'il prelievo del codice di questa versione',
  node: 'la preparazione di Node',
  dipendenze: "l'installazione delle dipendenze (npm ci)",
  versione: 'il controllo che il codice qui sia davvero quello di questa versione',
  bake: "l'incastonatura delle chiavi di default nel pacchetto",
  build: 'la costruzione del pacchetto e il suo caricamento sulla release',
  istruzioni: 'il caricamento del foglietto del primo avvio',
  controllo: 'il controllo che i file siano davvero nella release',
  impronte: 'la scrittura delle impronte SHA-256 dei file nella sezione «Verifica» della pagina della versione',
};

const numeri = (tag) => {
  const m = String(tag || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  return m ? m.slice(1).map(Number) : null;
};
const confronta = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
const uscitaPer = (r) => !!r && !r.bozza && !r.anteprima && !!numeri(r.tag);

/** Pagine da cento release che si leggono al massimo: oltre, l'elenco sarebbe monco e si dice «non letto». */
export const PAGINE_MAX = 50;

/**
 * Per piattaforma, se la sezione «Verifica» di una pagina ha le impronte di tutti i suoi file: la legge lo
 * strumento che la scrive. `null` se quello strumento non si carica: l'avviso parte lo stesso, senza saperlo.
 */
export async function lettoreImpronte() {
  try {
    const { leggiSezione, SCARICABILI } = await import('./release-impronte.mjs');
    return (corpo) => {
      const nomi = leggiSezione(corpo).righe.map((r) => r.nome);
      return Object.fromEntries(Object.entries(SCARICABILI).map(([p, file]) => [p, file.every((f) => nomi.includes(f))]));
    };
  } catch (e) {
    console.error(`[allarme] non leggo le impronte delle pagine (${e?.message || e}): la chiave di un guasto alle impronte sarà della versione.`);
    return null;
  }
}

/**
 * Tutte le release del repo, come `{ tag, bozza, anteprima, allegati, impronte }`, o `null`
 * se non si leggono per intero: un elenco monco farebbe dire «non esiste» a una
 * versione che c'è. Non lancia mai: l'avviso parte anche senza.
 */
export async function leggiRilasci({
  repo, token, api = process.env.GITHUB_API_URL || 'https://api.github.com',
  fetchImpl = globalThis.fetch, attesaMs = 20_000, log = (m) => console.error(m), impronteDi = null,
} = {}) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(String(repo || ''))) {
    log('[allarme] repo non indicato: non leggo le release, e il feedback dirà che non ha potuto guardarle.');
    return null;
  }
  const tutti = [];
  try {
    for (let pagina = 1; pagina <= PAGINE_MAX; pagina += 1) {
      const res = await fetchImpl(`${String(api).replace(/\/+$/, '')}/repos/${repo}/releases?per_page=100&page=${pagina}`, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'filo-release-alarm',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: AbortSignal.timeout(attesaMs),
      });
      if (!res.ok) {
        log(`[allarme] le release non si leggono (HTTP ${res.status}): il feedback dirà che non ha potuto guardarle.`);
        return null;
      }
      const lotto = await res.json();
      if (!Array.isArray(lotto)) {
        log('[allarme] le release sono arrivate in una forma che non è un elenco: il feedback dirà che non ha potuto guardarle.');
        return null;
      }
      for (const r of lotto) {
        tutti.push({
          tag: String(r?.tag_name || ''),
          bozza: !!r?.draft,
          anteprima: !!r?.prerelease,
          allegati: (Array.isArray(r?.assets) ? r.assets : []).map((a) => String(a?.name || '')).filter(Boolean),
          impronte: impronteDi ? impronteDi(String(r?.body || '')) : {},
        });
      }
      if (lotto.length < 100) return tutti;
    }
    log(`[allarme] più di ${PAGINE_MAX * 100} release: l'elenco resterebbe monco, quindi non lo uso.`);
    return null;
  } catch (e) {
    log(`[allarme] le release non si leggono (${e?.message || e}): il feedback dirà che non ha potuto guardarle.`);
    return null;
  }
}

/**
 * La pagina della versione: `null` se le release non si sono lette, `{ esiste: false }`
 * se fra le release non c'è, altrimenti i nomi dei suoi allegati. PURA.
 */
export function paginaDellaVersione(rilasci, versione) {
  if (!Array.isArray(rilasci)) return null;
  const v = String(versione || '').trim();
  const r = v ? rilasci.find((x) => x && x.tag === v) : null;
  return r ? { esiste: true, allegati: [...r.allegati] } : { esiste: false };
}

/**
 * L'ultima versione pubblicata prima di `versione` che porta tutti i file della piattaforma (e, con
 * `conImpronte`, anche le loro impronte nella pagina), o `null`. PURA.
 */
export function ultimaUscita(rilasci, piattaforma, versione, { conImpronte = false } = {}) {
  const nome = String(piattaforma || '').trim();
  const conf = PIATTAFORME[nome];
  const v = numeri(versione);
  if (!conf || !v || !Array.isArray(rilasci)) return null;
  let migliore = null;
  for (const r of rilasci) {
    if (!uscitaPer(r) || confronta(numeri(r.tag), v) >= 0) continue;
    if (!conf.attesi.every((f) => r.allegati.includes(f))) continue;
    if (conImpronte && !(r.impronte && r.impronte[nome] === true)) continue;
    if (!migliore || confronta(numeri(r.tag), numeri(migliore)) > 0) migliore = r.tag;
  }
  return migliore;
}

/** La versione pubblicata più alta, per suggerire un numero che esiste. PURA. */
export function ultimaPubblicata(rilasci) {
  let migliore = null;
  for (const r of Array.isArray(rilasci) ? rilasci : []) {
    if (uscitaPer(r) && (!migliore || confronta(numeri(r.tag), numeri(migliore)) > 0)) migliore = r.tag;
  }
  return migliore;
}

/**
 * La chiave dice al server QUALE guasto è (#752): la piattaforma e l'ultima
 * versione uscita per lei. Finché resta rotta la chiave non cambia; tornata a
 * uscire, un guasto dopo ha una chiave nuova e non finisce dentro un feedback
 * vecchio. Con tutti i file già nella pagina è rotto il resto del lavoro (le
 * impronte), e conta come uscita solo una versione che ha anche quelle: se no
 * ogni versione rotta così sarebbe «uscita» e aprirebbe un feedback suo.
 * Senza release, o impronte, lette la chiave è della versione: un doppione è
 * meglio di un guasto inghiottito. PURA.
 */
export function chiaviAllarme(piattaforma, { versione, rilasci, impronteLette = true } = {}) {
  const nome = String(piattaforma || '').trim().toLowerCase();
  if (!nome) return ['piattaforma'];
  const base = `piattaforma:${nome}`;
  const v = String(versione || '').trim();
  const pezzo = v.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 60);
  if (!v) return [`${base}:senza-versione`];
  const pagina = paginaDellaVersione(rilasci, v);
  if (!pagina) return [`${base}:in-${pezzo}`];
  if (!pagina.esiste) return [`${base}:inesistente-${pezzo}`];
  const conf = PIATTAFORME[String(piattaforma).trim()];
  if (conf && conf.attesi.every((f) => pagina.allegati.includes(f))) {
    if (!impronteLette) return [`${base}:impronte:in-${pezzo}`];
    return [`${base}:impronte:dopo-${ultimaUscita(rilasci, piattaforma, v, { conImpronte: true }) || 'nessuna'}`];
  }
  return [`${base}:dopo-${ultimaUscita(rilasci, piattaforma, v) || 'nessuna'}`];
}

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
 * I file che NON sono nella release, o `null` se nessuno l'ha guardata. Vale
 * solo una lettura vera della pagina: quella dell'avviso, poi quella del
 * controllo finale. Dedurlo dai passi girati sbagliava a ogni secondo tentativo
 * e su una versione inesistente (#733.3). PURA.
 */
export function mancantiNoti({ piattaforma, esiti, mancanti, pagina } = {}) {
  const conf = PIATTAFORME[piattaforma];
  if (!conf) return null;
  if (pagina && pagina.esiste) return conf.attesi.filter((f) => !pagina.allegati.includes(f));

  const elencati = String(mancanti || '').trim().split(/\s+/).filter(Boolean);
  if (elencati.length) return elencati;

  const passi = esiti && typeof esiti === 'object' && !Array.isArray(esiti) ? esiti : {};
  return (passi.controllo || {}).outcome === 'success' ? [] : null;
}

const rigaPasso = (p, senza) => (p
  ? `Passo fallito: «${p}»${PASSI[p] ? ` — ${PASSI[p]}.` : ' (non è uno dei passi noti: cercalo nel registro).'}`
  : senza);

/**
 * Titolo e testo del feedback. Nomina piattaforma, versione e passo fallito, e
 * porta il link all'esecuzione: chi lo prende in mano non deve cercarli. Dice
 * solo quello che ha guardato. PURA.
 */
export function componiAllarme({ piattaforma, versione, passo, esecuzione, repo, mancanti, esiti, pagina, ultima } = {}) {
  const nome = String(piattaforma || '').trim() || '(piattaforma non indicata)';
  const v = String(versione || '').trim();
  const p = String(passo || '').trim();
  const conf = PIATTAFORME[nome];
  const registro = esecuzione ? [`Registro dell'esecuzione: ${esecuzione}`] : [];

  const coda = p ? ` (passo «${p}»)` : ' (passo non identificato)';
  if (!v) {
    return {
      titolo: `Il lavoro che attacca Filo per ${nome} a una release si è fermato subito${coda}`,
      testo: [
        `Il lavoro che costruisce Filo per ${nome} si è fermato prima di sapere a quale release attaccarsi: nessuna release è stata toccata, e nessun file è andato perso. Succede quando lo si avvia a mano senza scrivere il numero della versione nella sua casella.`,
        '',
        rigaPasso(p, 'Passo fallito: non identificato. Il registro dell\'esecuzione dice quale si è fermato.'),
        ...registro,
        '',
        `Cosa fare: riavvia a mano il lavoro di pubblicazione con la casella «${casella(nome)}» e il numero della versione scritto per intero.`,
      ].join('\n'),
    };
  }

  if (pagina && pagina.esiste === false) {
    const u = String(ultima || '').trim();
    return {
      titolo: `La versione ${v} non esiste: Filo per ${nome} non è stato attaccato a niente${coda}`,
      testo: [
        `Il lavoro che costruisce Filo per ${nome} doveva attaccarlo alla versione ${v}, ma fra le release del repo non ce n'è nessuna con quel numero. Questa corsa non ha toccato nessuna release e non ha tolto nessun file. Succede quando lo si avvia a mano con un numero sbagliato.`,
        '',
        rigaPasso(p, 'Passo fallito: non identificato. Il registro dell\'esecuzione dice quale si è fermato.'),
        ...registro,
        '',
        `Cosa fare: riavvia a mano il lavoro di pubblicazione con la casella «${casella(nome)}» e il numero di una versione che esiste${u ? ` (l'ultima pubblicata è ${u})` : ''}.`,
      ].join('\n'),
    };
  }

  const persi = mancantiNoti({ piattaforma: nome, esiti, mancanti, pagina });

  // Fermo alle impronte: i file sono nella release, manca solo con cosa confrontarli.
  if (conf && p === 'impronte' && Array.isArray(persi) && persi.length === 0) {
    return {
      titolo: `La pagina della release ${v} non riporta le impronte dei file per ${nome}${coda}`,
      testo: [
        `I file per ${nome} sono nella release ${v}, ma le loro impronte SHA-256 non sono finite nella sezione «Verifica» della pagina della versione: chi li scarica non ha con cosa confrontarli. Se il passo è arrivato a calcolarle, stanno nel riassunto dell'esecuzione.`,
        '',
        `Passo fallito: «${p}» — ${PASSI[p]}.`,
        ...registro,
        '',
        `Cosa fare: capisci perché il passo si è fermato, poi avvia a mano il lavoro di pubblicazione con la casella «${casella(nome)}» e ${v} nel numero di versione. Ricostruisce i file per ${nome}, li riattacca alla stessa release e ne riscrive le righe nella sezione, senza toccare quelle delle altre piattaforme.`,
      ].join('\n'),
    };
  }

  // I file ci sono tutti (per esempio un secondo tentativo su una release già
  // completa): non si manda a rimetterli.
  if (conf && Array.isArray(persi) && persi.length === 0) {
    return {
      titolo: `Il lavoro che attacca Filo per ${nome} alla release ${v} si è fermato, ma i file ci sono${coda}`,
      testo: [
        `Nella release ${v} ci sono tutti i file per ${nome} (${conf.attesi.join(', ')}): chi scarica e chi aggiorna li trova. La versione per Windows è uscita ed è valida.`,
        '',
        rigaPasso(p, 'Passo fallito: non identificato — gli esiti dei passi non sono arrivati leggibili. Il registro dell\'esecuzione dice quale si è fermato.'),
        ...registro,
        '',
        `Cosa fare: capisci perché quel passo si è fermato. I file non vanno rimessi: sono già lì.`,
      ].join('\n'),
    };
  }

  // Il titolo non deve gridare piu' del guasto (se manca un file di contorno la
  // release e' incompleta, non assente) né meno: senza un elenco di file persi
  // non si annuncia un elenco.
  const titolo = (!conf || !persi)
    ? `Il lavoro che attacca Filo per ${nome} alla release ${v} si è fermato${coda}`
    : persi.includes(conf.scarica)
      ? `Filo per ${nome} non è nella release ${v}${coda}`
      : `La release ${v} è incompleta per ${nome}: manca ${persi.join(', ')}${coda}`;

  const righe = [
    `Il lavoro che costruisce Filo per ${nome} e lo attacca alla release ${v} è fallito. La versione per Windows è uscita ed è valida: resta com'è, non va tolta né ripubblicata.`,
    '',
  ];

  if (conf && persi === null) {
    righe.push(`Non ho potuto leggere la pagina della release ${v}, quindi non so quali file ci siano: aprila e guarda. Devono esserci ${conf.attesi.join(', ')}.`, '');
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

  righe.push(rigaPasso(p, 'Passo fallito: non identificato — gli esiti dei passi non sono arrivati leggibili. Il registro dell\'esecuzione dice quale si è fermato.'));
  righe.push(...registro);

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
  const piattaforma = String(process.env.PIATTAFORMA || '').trim();
  const versione = String(process.env.VERSIONE || '').trim();
  const impronteDi = versione ? await lettoreImpronte() : null;
  const rilasci = versione ? await leggiRilasci({ repo: process.env.REPO, token: process.env.GH_TOKEN, impronteDi }) : null;
  const { titolo, testo } = componiAllarme({
    piattaforma,
    versione,
    passo: passoFallito(esiti),
    esecuzione: process.env.ESECUZIONE,
    repo: process.env.REPO,
    mancanti: process.env.MANCANTI,
    esiti,
    pagina: paginaDellaVersione(rilasci, versione),
    ultima: ultimaPubblicata(rilasci),
  });
  await inviaAllarme(titolo, testo, chiaviAllarme(piattaforma, { versione, rilasci, impronteLette: !!impronteDi }));
}

// Il workflow lancia una COPIA di questo file, fuori dalla copia di lavoro: se
// un pezzo di quel percorso è un collegamento, Node scioglie i collegamenti in
// `import.meta.url` e non in `argv[1]`, i due non combaciano e lo script non
// farebbe niente restando verde — muto l'allarme, e l'elenco dei file attesi
// vuoto, cioè un controllo che passa senza guardare (#733, secondo giro).
const stessoFile = (a, b) => {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return resolve(a) === b;
  }
};
if (process.argv[1] && stessoFile(process.argv[1], fileURLToPath(import.meta.url))) await main();
