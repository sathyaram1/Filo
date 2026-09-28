// ultima-suite-verde.mjs — il commit da pubblicare: il più nuovo di main (primo genitore) con la suite verde.
// Non pubblica e non scrive su git; se la pubblicazione è ferma da troppo tempo, per qualunque motivo, apre un feedback.
// Garanzie: tests/unit/ultimaSuiteVerde.test.mjs e tests/unit/releaseSuite.test.mjs.

import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inviaAllarme, spedisciAllarme } from './build-alarm.mjs';

/** Oltre questa età dell'ultima versione, con codice nuovo dopo di lei e niente uscito, si grida. */
export const SOGLIA_ORE = 48;
/** Un verde pubblicabile da più di queste ore (due giri) che non è uscito: la pubblicazione si ferma dopo la scelta. */
export const SOGLIA_VERDE_ORE = 12;
export const CHIAVE_FERMO = 'rilascio:fermo';
export const CHIAVE_FERMO_DOPO_VERDE = 'rilascio:fermo-dopo-il-verde';

/**
 * La chiave di un fermo: il tipo e la versione a cui la pubblicazione è ferma. Un fermo dopo una versione uscita è un
 * guasto nuovo, e il feedback del fermo di prima rimasto aperto (parcheggiato, come #569) non deve assorbirlo. PURA.
 */
export function chiaveDelFermo(tipo, tag) {
  return tag ? `${tipo}:${tag}` : tipo;
}
const EVENTI = new Set(['push', 'workflow_dispatch']);
const PROFONDITA = 3000;

/** Le corse riuscite di suite.yml su main, per commit (la più nuova per prima). PURA. */
export function corseVerdi(runs) {
  const perSha = new Map();
  for (const r of Array.isArray(runs) ? runs : []) {
    if (!r || r.conclusion !== 'success' || !r.head_sha) continue;
    if (r.status && r.status !== 'completed') continue;
    if (r.event && !EVENTI.has(r.event)) continue;
    if (r.head_branch && r.head_branch !== 'main') continue;
    if (!perSha.has(r.head_sha)) perSha.set(r.head_sha, r);
  }
  return perSha;
}

/**
 * Il primo sha di `primoGenitore` (main, dal più nuovo) che ha una corsa verde,
 * o ''. Un verde su un commit fuori da quella storia non conta: non è main. PURA.
 */
export function scegliUltimoVerde(runs, primoGenitore) {
  const verdi = corseVerdi(runs);
  for (const sha of Array.isArray(primoGenitore) ? primoGenitore : []) {
    if (verdi.has(sha)) return sha;
  }
  return '';
}

/**
 * Il verde si pubblica solo se è DOPO l'ultima versione: uno uguale non ha niente
 * di nuovo, uno più vecchio ripubblicherebbe codice vecchio sotto un numero nuovo.
 * `eAntenato(a, b)` dice se a sta nella storia di b. PURA (con la domanda iniettata).
 */
export function verdePiuNuovoDelTag(verde, tagSha, eAntenato) {
  if (!verde) return false;
  if (!tagSha) return true;
  return verde !== tagSha && Boolean(eAntenato(tagSha, verde));
}

/**
 * Da quante ore c'è su main un commit verde più nuovo dell'ultima versione: conta il PRIMO diventato verde,
 * perché da allora ogni giro aveva qualcosa da pubblicare. NaN se non ce n'è. PURA (con la domanda iniettata).
 */
export function oreDalPrimoVerde(runs, primoGenitore, tagSha, eAntenato, adesso = Date.now()) {
  const main = new Set(Array.isArray(primoGenitore) ? primoGenitore : []);
  let primo = NaN;
  for (const r of Array.isArray(runs) ? runs : []) {
    if (!r || !corseVerdi([r]).size || !main.has(r.head_sha)) continue;
    if (!verdePiuNuovoDelTag(r.head_sha, tagSha, eAntenato)) continue;
    const quando = Date.parse(r.updated_at || r.created_at || '');
    if (Number.isFinite(quando) && !(quando >= primo)) primo = quando;
  }
  return Number.isFinite(primo) ? (adesso - primo) / 3.6e6 : NaN;
}

/**
 * Pubblicazione ferma: l'ultima versione ha più di `soglia` ore e su main c'è codice nuovo dopo di lei.
 * 'senza-verde' se nessun commit più nuovo ha la suite verde; 'dopo-il-verde' se un verde da pubblicare
 * c'è da più di `sogliaVerde` ore e non è uscito (cancello unit, numero, costruzione…); altrimenti ''. PURA.
 */
export function rilascioFermo({
  oreDallUltima, commitDopoTag, verdeDopoTag, oreDalVerde, soglia = SOGLIA_ORE, sogliaVerde = SOGLIA_VERDE_ORE,
} = {}) {
  if (!(Number.isFinite(oreDallUltima) && oreDallUltima > soglia && commitDopoTag > 0)) return '';
  if (!verdeDopoTag) return 'senza-verde';
  return Number.isFinite(oreDalVerde) && oreDalVerde > sogliaVerde ? 'dopo-il-verde' : '';
}

/** Una corsa in una riga: esito, commit, quando, link. PURA. */
export function rigaCorsa(r) {
  const esito = r?.conclusion || r?.status || '?';
  return `${esito} · ${String(r?.head_sha || '').slice(0, 9)} · ${r?.created_at || '?'} · ${r?.html_url || ''}`.trim();
}

/** Titolo e testo del feedback della pubblicazione ferma. PURA. */
export function testoRilascioFermo({ tag, oreDallUltima, commitDopoTag, verde, corsaVerde, corse, esecuzione, erroreApi } = {}) {
  const giorni = Math.floor((oreDallUltima || 0) / 24);
  const righe = [
    `Nessuna versione nuova di Filo da ${giorni} giorni: l'ultima è ${tag}, e da allora su main sono entrati ${commitDopoTag} commit, ma nessuno ha la suite Playwright verde (.github/workflows/suite.yml). Il lavoro di pubblicazione pubblica solo un commit con la suite verde, quindi gli utenti restano fermi a ${tag}.`,
    '',
    verde
      ? `Ultimo commit di main con la suite verde: ${verde}${corsaVerde?.html_url ? ` (${corsaVerde.html_url})` : ''}, che non è più nuovo di ${tag}.`
      : 'Fra le ultime corse riuscite della suite su main non c\'è nessun commit verde.',
  ];
  if (erroreApi) righe.push(`Attenzione: le corse della suite non si sono lette (${erroreApi}); la scelta è stata fatta senza.`);
  righe.push('', 'Ultime corse della suite su main:');
  const elenco = Array.isArray(corse) ? corse : [];
  righe.push(...(elenco.length ? elenco.map((r) => `  ${rigaCorsa(r)}`) : ['  (nessuna letta)']));
  righe.push(
    '',
    'Cosa fare: apri le corse rosse qui sopra, capisci quali rossi si ripetono e correggili finché un commit di main non torna verde; se un rosso è d\'ambiente del contenitore senza schermo, va in tests/rossi-noti.json (contenitore.specs) col titolo esatto. Ogni suite rossa su main ha già aperto il suo feedback: parti da quelli.',
  );
  if (esecuzione) righe.push('', `Registro di questa esecuzione: ${esecuzione}`);
  return { titolo: `Pubblicazione ferma${tag ? ` alla ${tag}` : ''} da ${giorni} giorni: nessun commit di main con la suite verde`, testo: righe.join('\n') };
}

/** Titolo e testo del feedback quando un verde c'è ma la pubblicazione non lo fa uscire. PURA. */
export function testoFermoDopoIlVerde({ tag, oreDallUltima, commitDopoTag, verde, corsaVerde, oreDalVerde, pubblicazioni, esecuzione, erroreApi } = {}) {
  const giorni = Math.floor((oreDallUltima || 0) / 24);
  const righe = [
    `Nessuna versione nuova di Filo da ${giorni} giorni: l'ultima è ${tag}, e da allora su main sono entrati ${commitDopoTag} commit. Un commit con la suite Playwright verde da pubblicare c'è da ${Math.round(oreDalVerde || 0)} ore, quindi la pubblicazione si ferma DOPO aver scelto il commit: nel lavoro per Windows (controlli unit, chiavi di default, numero di versione, costruzione, file nella bozza) o nel passaggio da bozza a pubblicata.`,
    '',
    `Il commit verde più nuovo: ${verde}${corsaVerde?.html_url ? ` (${corsaVerde.html_url})` : ''}.`,
  ];
  if (erroreApi) righe.push(`Attenzione: le corse non si sono lette tutte (${erroreApi}).`);
  righe.push('', 'Ultime corse del lavoro di pubblicazione:');
  const elenco = Array.isArray(pubblicazioni) ? pubblicazioni : [];
  righe.push(...(elenco.length ? elenco.map((r) => `  ${rigaCorsa(r)}`) : ['  (nessuna letta)']));
  righe.push(
    '',
    'Cosa fare: apri l\'ultima corsa rossa qui sopra e guarda quale passo si ferma. Se è un passo che apre già il suo feedback (controlli unit, chiavi di default), quel feedback esiste ma è fermo: portalo avanti o chiedi all\'owner. Se il passo non apre niente (numero di versione rifiutato o server che non risponde, costruzione fallita, file mancanti nella bozza), il guasto sta tutto qui.',
  );
  if (esecuzione) righe.push('', `Registro di questa esecuzione: ${esecuzione}`);
  return { titolo: `Pubblicazione ferma da ${giorni} giorni: c'è un commit verde ma la versione non esce`, testo: righe.join('\n') };
}

const git = (...a) => execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const gitForse = (...a) => { try { return git(...a); } catch { return ''; } };
const ghApi = (percorso) => JSON.parse(execFileSync('gh', ['api', percorso], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
const eAntenato = (a, b) => { try { git('merge-base', '--is-ancestor', a, b); return true; } catch { return false; } };
// Le fusioni su main, non i commit dei rami fusi; il commit del numero di versione non è codice.
const soloCodice = (da, a) => Number(gitForse('rev-list', '--count', '--first-parent', '--invert-grep', '--grep=^release: v[0-9]', `${da}..${a}`) || 0);

function leggiCorse(repo, filtro) {
  const j = ghApi(`repos/${repo}/actions/workflows/suite.yml/runs?branch=main&${filtro}`);
  return Array.isArray(j?.workflow_runs) ? j.workflow_runs : [];
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY || '';
  const primoGenitore = gitForse('rev-list', '--first-parent', `--max-count=${PROFONDITA}`, 'HEAD').split('\n').filter(Boolean);
  let runs = [];
  let erroreApi = '';
  try {
    if (!repo) throw new Error('GITHUB_REPOSITORY assente');
    runs = leggiCorse(repo, 'status=success&per_page=100');
  } catch (e) {
    erroreApi = String(e.stderr || e.message || e).trim().split('\n')[0];
  }
  const verde = scegliUltimoVerde(runs, primoGenitore);

  // Il suite.yml di un avviso vuole solo lo sha: da lì conta i commit entrati dopo.
  if (process.argv.includes('--stampa')) {
    if (erroreApi) console.error(`[suite verde] corse non lette: ${erroreApi}`);
    if (verde) console.log(verde);
    return;
  }

  const testa = gitForse('rev-parse', 'HEAD');
  const tag = gitForse('describe', '--tags', '--abbrev=0', '--match', 'v*', 'HEAD');
  const tagSha = tag ? gitForse('rev-parse', `${tag}^{commit}`) : '';
  let pubblicataIl = '';
  if (tag && repo) {
    try { pubblicataIl = ghApi(`repos/${repo}/releases/tags/${tag}`)?.published_at || ''; } catch { /* sotto, la data del commit */ }
  }
  if (tag && !pubblicataIl) pubblicataIl = gitForse('log', '-1', '--format=%cI', tagSha);
  const oreDallUltima = pubblicataIl ? (Date.now() - Date.parse(pubblicataIl)) / 3.6e6 : NaN;
  const commitDopoTag = tag ? soloCodice(tag, 'HEAD') : 0;
  const verdeDopoTag = verdePiuNuovoDelTag(verde, tagSha, eAntenato);
  const sha = verdeDopoTag ? verde : '';
  const corsaVerde = verde ? corseVerdi(runs).get(verde) : null;
  const esecuzione = process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL || 'https://github.com'}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : '';

  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `sha=${sha}\n`);

  const nonProvati = verde ? soloCodice(verde, 'HEAD') : null;
  const riassunto = [
    '## Quale commit si pubblica',
    '',
    sha
      ? `- Si pubblica \`${sha}\`, il commit più nuovo di main con la suite verde${corsaVerde?.html_url ? ` ([corsa](${corsaVerde.html_url}))` : ''}.`
      : verde
        ? `- Niente da pubblicare: il commit più nuovo con la suite verde è \`${verde}\`, non più nuovo di ${tag}.`
        : '- Niente da pubblicare: nessun commit di main ha la suite verde fra le ultime corse riuscite.',
    `- main adesso: \`${testa}\`.`,
    `- Commit di main dopo il verde, non ancora verdi o non ancora provati: ${nonProvati === null ? 'tutti (nessun verde)' : nonProvati}.`,
    tag
      ? `- Ultima versione: ${tag}, ${Number.isFinite(oreDallUltima) ? `${Math.round(oreDallUltima)} ore fa` : 'età sconosciuta'}; commit di codice dopo di lei: ${commitDopoTag}.`
      : '- Nessuna versione ancora pubblicata.',
  ];
  if (erroreApi) riassunto.push(`- Le corse della suite non si sono lette: ${erroreApi}.`);

  const oreDalVerde = verdeDopoTag ? oreDalPrimoVerde(runs, primoGenitore, tagSha, eAntenato) : NaN;
  const fermo = rilascioFermo({ oreDallUltima, commitDopoTag, verdeDopoTag, oreDalVerde });
  if (!fermo && tag && commitDopoTag > 0 && !verdeDopoTag && Number.isFinite(oreDallUltima)) {
    riassunto.push(`- Nessun commit verde dopo ${tag} da ${Math.round(oreDallUltima)} ore: sopra le ${SOGLIA_ORE} si apre un feedback.`);
  }
  if (Number.isFinite(oreDalVerde)) {
    riassunto.push(`- Il primo verde dopo ${tag || 'nessuna versione'} c'è da ${Math.round(oreDalVerde)} ore: se non esce entro ${SOGLIA_VERDE_ORE}, con l'ultima versione più vecchia di ${SOGLIA_ORE}, si apre un feedback.`);
  }
  if (fermo === 'senza-verde') riassunto.push('', `**Pubblicazione ferma da più di ${SOGLIA_ORE} ore: si apre un feedback e la corsa resta rossa.**`);
  if (fermo === 'dopo-il-verde') riassunto.push('', `**Pubblicazione ferma da più di ${SOGLIA_ORE} ore anche se un verde c'è: si apre un feedback e si prova lo stesso a pubblicare.**`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${riassunto.join('\n')}\n`);
  console.log(riassunto.join('\n'));

  // Il guasto sta a valle, e può essere già passato: l'allarme parte, ma la pubblicazione si tenta lo stesso.
  // Un allarme che non arriva non deve fermarla: la corsa resta rossa solo se la pubblicazione fallisce.
  if (fermo === 'dopo-il-verde') {
    let pubblicazioni = [];
    try {
      const j = ghApi(`repos/${repo}/actions/workflows/release.yml/runs?branch=main&per_page=8`);
      pubblicazioni = Array.isArray(j?.workflow_runs) ? j.workflow_runs : [];
    } catch { /* il testo lo dice: nessuna letta */ }
    const { titolo, testo } = testoFermoDopoIlVerde({
      tag, oreDallUltima, commitDopoTag, verde, corsaVerde, oreDalVerde, pubblicazioni, esecuzione, erroreApi,
    });
    console.log(`::error::${titolo}`);
    if (!(await spedisciAllarme(titolo, testo, [CHIAVE_FERMO_DOPO_VERDE]))) {
      console.log('::error::l\'allarme della pubblicazione ferma non è partito: il guasto resta solo in questa corsa.');
    }
  }
  if (fermo === 'senza-verde') {
    let corse = [];
    try { corse = repo ? leggiCorse(repo, 'per_page=8') : []; } catch { /* il testo lo dice: nessuna letta */ }
    const { titolo, testo } = testoRilascioFermo({ tag, oreDallUltima, commitDopoTag, verde, corsaVerde, corse, esecuzione, erroreApi });
    console.log(`::error::${titolo}`);
    await inviaAllarme(titolo, testo, [CHIAVE_FERMO]);
    process.exit(1);
  }
  if (erroreApi) {
    console.log(`::error::le corse della suite non si sono lette (${erroreApi}): senza, nessun commit risulta verde.`);
    process.exit(1);
  }
}

const eseguitoDirettamente = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (eseguitoDirettamente) await main();
