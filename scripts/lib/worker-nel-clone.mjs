// Il worker di un giro lavora in un clone suo, mai nella cartella da cui la sessione dell'orchestratore legge
// impostazioni, agenti e copioni dei ganci (#1182). Lo accende il preflight in cloud; dispatch e il rilascio ci portano
// da soli, qualunque copia degli strumenti si lanci. Regole: tests/unit/workerNelClone.test.mjs.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { allineaPacchetti, elencoCloni, preparaClone } from './clone-worker.mjs';
import { marcatoreWorker } from './dati-worker.mjs';
import { pinnedDir, pinnedDirWorker, pinnedRepoRoot } from './tools-pin.mjs';
import { ticketFile } from './routine-ticket.mjs';

export const MARCA_GIRO = '.filo-clone-del-giro.json';
// Un worker alla volta per ora: i worker in parallelo (#1158) useranno gli indici dopo.
export const INDICE_GIRO = 1;
// Il figlio deve ricavare cartella e strumenti dalla SUA copia: queste due li sovrascriverebbero.
const AMBIENTE_TOLTO = ['FILO_REPO_ROOT', 'FILO_TOOLS_ROOT'];

export { marcatoreWorker };

const leggiJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch (_) { return null; } };

/** Il preflight: da qui i worker di questo giro lavorano nel clone. */
export function accendi(toolsDir, { indice = INDICE_GIRO } = {}) {
  try {
    writeFileSync(resolve(toolsDir, MARCA_GIRO), `${JSON.stringify({ indice })}\n`, 'utf8');
    return { ok: true, why: '' };
  } catch (e) { return { ok: false, why: e.message }; }
}

/**
 * Il clone del giro, se `root` è la cartella della sessione di un giro acceso: il preflight ha fissato in `toolsDir`
 * gli strumenti per QUESTA cartella e li ha marcati. null altrove (test, macchina dell'owner, clone già raggiunto).
 */
export function cloneDelGiro(root, { toolsDir = pinnedDir() } = {}) {
  if (marcatoreWorker(root)) return null;
  const m = leggiJson(resolve(toolsDir, MARCA_GIRO));
  if (!m || !Number.isInteger(m.indice)) return null;
  const perChi = pinnedRepoRoot(toolsDir);
  if (!perChi || resolve(perChi) !== resolve(root)) return null;
  return { indice: m.indice, toolsDir: resolve(toolsDir) };
}

// Il comando del worker ha di serie due minuti: tagliato a metà installazione, rilanciato aspetta quella in corso.
const avvisoDelGiro = (m) => process.stderr.write(`[dispatch] ${m} Se il comando ti torna per il tempo, rilancialo uguale con un timeout di dieci minuti.\n`);

/** Il clone pronto, con gli strumenti suoi: npm ci solo se non ci sono pacchetti da collegare (#1906). */
export function preparaPerIlGiro(root, giro, { prepara = preparaClone, avvisa = avvisoDelGiro } = {}) {
  return prepara(root, giro.indice, { strumentiDa: giro.toolsDir, basePin: giro.toolsDir, soloCollegati: true, avvisa });
}

/** Lo stesso comando, dalla copia degli strumenti del clone. Restituisce l'exit del figlio. */
export function rilancia(strumenti, script, args, { env = process.env, spawn = spawnSync } = {}) {
  const pulito = { ...env };
  for (const k of AMBIENTE_TOLTO) delete pulito[k];
  const r = spawn(process.execPath, [resolve(strumenti, 'scripts', script), ...args], { stdio: 'inherit', env: pulito });
  if (r.error) throw r.error;
  return typeof r.status === 'number' ? r.status : 1;
}

/**
 * Il clone del giro che tiene `ticket`, con la sua copia degli strumenti: è lì che va il rilascio di un worker morto
 * chiesto dall'orchestratore. null se il biglietto non sta in nessun clone del giro.
 */
export function cloneDelBiglietto(root, ticket, { toolsDir = pinnedDir() } = {}) {
  const giro = cloneDelGiro(root, { toolsDir });
  if (!giro || !ticket) return null;
  const voce = elencoCloni(root).find((c) => c.indice === giro.indice && c.esiste);
  if (!voce) return null;
  const t = leggiJson(ticketFile(voce.cartella));
  if (!t || t.ticket !== ticket) return null;
  const strumenti = pinnedDirWorker(giro.indice, giro.toolsDir);
  if (!existsSync(resolve(strumenti, 'scripts'))) return null;
  return { dir: voce.cartella, strumenti };
}

/**
 * Nel clone, a ramo posizionato: pacchetti collegati a quelli della cartella della sessione, e le righe che aprono le
 * istruzioni del worker. '' fuori da un clone di worker.
 */
export function preparaIntestazione(root, { allinea = allineaPacchetti } = {}) {
  const m = marcatoreWorker(root);
  if (!m) return '';
  const dir = resolve(root);
  const p = allinea(dir, m.principale, { soloCollegati: true });
  const righe = [
    '## La tua cartella',
    '',
    `Lavori in \`${dir}\`: un clone tuo del progetto, già sul ramo del lavoro. La cartella della sessione`,
    `(\`${m.principale}\`) è di chi guida il giro: lì non scrivi e non lanci niente.`,
    `La shell riparte ogni volta dalla cartella della sessione: ogni comando comincia con \`cd "${dir}" && …\`,`,
    `e Read, Edit e Write vogliono percorsi sotto \`${dir}\`. Il salvataggio automatico segue il file che modifichi.`,
  ];
  if (!p.ok) righe.push('', `Pacchetti non collegati (${p.why}): prima di provare, \`cd "${dir}" && npm ci\` in sottofondo.`);
  else if (p.lockDiverso) {
    righe.push('', `Il package-lock di questo ramo non è quello della sessione: i pacchetti sono quelli della sessione. Se ti`,
      `servono i suoi, \`cd "${dir}" && npm ci && node scripts/ensure-electron.mjs\` in sottofondo.`);
  }
  return righe.join('\n');
}
