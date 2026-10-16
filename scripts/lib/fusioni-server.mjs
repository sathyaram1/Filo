// I lavori server passati in cloud e fermi per il PC dell'owner (#1159, mappa §2.1), nell'ordine del cancello (#1222):
// prima la parte dell'app (op fondiApp), poi server:fondi, che chiude la pratica; un deploy per tutti, se non lo fa GitHub.
// Un server che non conosce fondiApp vuole l'ordine di prima. Regole: tests/unit/fusioniServer.test.mjs.

import { USCITA_CONFLITTO_MAIN, USCITA_SOLO_APP } from '../server-fondi-pratica.mjs';

const RAMO_RE = /^(claude|worker)\/[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;
const OP_SCONOSCIUTA = /^op_sconosciuta\b/;

const numeroDi = (p) => (Number(p.subSeq) > 0 ? `${p.seq}.${p.subSeq}` : String(p.seq || p.feedbackId));
const coda = (t, n = 8) => String(t || '').trim().split('\n').slice(-n).join('\n');
const SEGUITO_APP = { blocked: 'L5 l’ha fermata: la richiesta è nei Ricevuti', conflict: 'va in conflitto con main: torna alle routine per il riallineamento', rifiutata: 'il cancello la rifiuta' };

/**
 * dep: { attese() → [{ feedbackId, seq, subSeq, branch, parti }] o { pratiche, deployDaActions }, fondiApp(feedbackId) →
 *        { result, sha, reason, detail } (lancia), filoDiMain() → { dir, togli() } | null, esegui(cmd, args, { cwd,
 *        timeoutMs, env }), pubblica() → { code, out }, fineAttesa(feedbackId, { soloApp, riallinea }), log(riga), radice }.
 * → { fuse: [{ num, id, app, appPrima }], soloApp, riallineate, ferme: [{ num, motivo }], pubblicato, daGitHub }
 */
export async function fusioniServer(dep, { prova = false } = {}) {
  const lette = await dep.attese();
  const pratiche = Array.isArray(lette) ? lette : (lette && Array.isArray(lette.pratiche) ? lette.pratiche : []);
  // Il server legge le corse di deploy.yml, quindi il file è su main e la spinta del PC lo accende: un deploy dal PC
  // correrebbe insieme al suo sulle stesse funzioni, anche prima del primo verde. Un rosso resta all'allarme.
  const daGitHub = !Array.isArray(lette) && !!(lette && lette.deployDaActions && typeof lette.deployDaActions === 'object');
  const fuse = [];
  const soloApp = [];
  const riallineate = [];
  const ferme = [];
  const fine = (pubblicato) => ({ fuse, soloApp, riallineate, ferme, pubblicato, daGitHub });
  if (!pratiche.length) {
    dep.log('Nessun lavoro server aspetta il PC.');
    return fine(false);
  }
  const git = (args) => dep.esegui('git', args, { cwd: dep.radice });
  await git(['fetch', '--quiet', 'origin', 'main']);
  const daFondere = [];
  for (const p of pratiche) {
    const num = numeroDi(p);
    const ramo = String(p.branch || '');
    if (!RAMO_RE.test(ramo) || /\.\./.test(ramo)) {
      ferme.push({ num, motivo: `ramo non valido («${ramo.slice(0, 80)}»)` });
      continue;
    }
    // La parte dell'app: commit del ramo dell'app oltre main. Senza, il lavoro sta tutto sul server (o l'app è già su main).
    const preso = await git(['fetch', '--quiet', 'origin', `+refs/heads/${ramo}:refs/remotes/origin/${ramo}`]);
    const conta = preso.code === 0 ? await git(['rev-list', '--count', `refs/remotes/origin/main..refs/remotes/origin/${ramo}`]) : { code: 0, out: '0' };
    const app = conta.code === 0 ? Number(String(conta.out).trim()) || 0 : -1;
    if (app < 0) { ferme.push({ num, motivo: 'non riesco a contare i commit della parte dell’app' }); continue; }
    if (p.parti && p.parti.server) {
      // Fuso dal PC prima di #1222, col deploy mancato: la parte dell'app la porta il cancello dopo il deploy.
      dep.log(`#${num} il server è già su main: resta il deploy, poi la parte dell’app`);
      fuse.push({ num, id: p.feedbackId, app, appPrima: false });
      continue;
    }
    daFondere.push({ num, id: p.feedbackId, ramo, app, appFusa: false });
  }

  const fondi = (x, extra, env) => dep.esegui('node', ['scripts/server-fondi-pratica.mjs', x.ramo, '--feedback', x.id, ...extra],
    Object.assign({ cwd: dep.radice, timeoutMs: 60 * 60_000 }, env ? { env } : {}));
  // Gli esiti di server:fondi che non sono una fusione. → true se la pratica è sistemata qui.
  const fermaSe = (x, r, prima = '') => {
    if (r.code === USCITA_SOLO_APP && x.app > 0 && !x.appFusa) {
      dep.log(`#${x.num} su filo-security ${x.ramo} non c'è: niente da fondere sul server, la parte dell’app torna alle routine`);
      soloApp.push({ num: x.num, id: x.id, app: x.app });
    } else if (r.code === USCITA_SOLO_APP && !x.appFusa) {
      ferme.push({ num: x.num, motivo: `né su filo-security né nell’app c’è un ramo ${x.ramo} da fondere: decide l’owner` });
    } else if (r.code === USCITA_CONFLITTO_MAIN) {
      // Il ramo va in conflitto con main del server: nessuno sul PC lo riallinea, torna alle routine.
      dep.log(`#${x.num} su filo-security ${x.ramo} va in conflitto con main: torna alle routine per il riallineamento`);
      riallineate.push({ num: x.num, id: x.id });
      if (x.appFusa) ferme.push({ num: x.num, motivo: `${prima}main del server è andato avanti fra la prova a vuoto e la fusione, e il ramo ora va in conflitto: torna alle routine, e fino ad allora l’app su main parla col server di prima` });
    } else if (r.code !== 0) {
      ferme.push({ num: x.num, motivo: `${prima}server:fondi non ha fuso (uscita ${r.code}):\n${coda(r.out)}` });
    } else return false;
    return true;
  };

  if (prova) {
    for (const x of daFondere) {
      dep.log(`#${x.num} a vuoto: ${x.app ? `prima la parte dell’app (${x.app} commit) col cancello, poi ` : ''}server:fondi ${x.ramo}`);
      const r = await fondi(x, [...(x.app ? [] : ['--solo-server']), '--dry-run']);
      if (!fermaSe(x, r)) fuse.push({ num: x.num, id: x.id, app: x.app, appPrima: x.app > 0 });
    }
    return fine(false);
  }

  // Un lavoro misto: la parte dell'app va su main solo se server:fondi a vuoto dice che il server la segue subito.
  let vecchioOrdine = false;
  for (const x of daFondere.filter((y) => y.app > 0)) {
    const r = await fondi(x, ['--dry-run']);
    if (fermaSe(x, r, 'a vuoto, quindi la parte dell’app resta fuori da main: ')) { x.sistemata = true; continue; }
    if (vecchioOrdine) continue;
    let a;
    try {
      a = await dep.fondiApp(x.id);
    } catch (e) {
      const m = String((e && e.message) || e);
      if (OP_SCONOSCIUTA.test(m)) {
        vecchioOrdine = true;
        dep.log('il server non sa ancora fondere la parte dell’app prima del server: per questo giro l’ordine di prima (server, deploy, app)');
        continue;
      }
      ferme.push({ num: x.num, motivo: `la parte dell’app non si è fusa (${m.slice(0, 200)}), e il server resta fuori da main: si riprova al prossimo giro` });
      x.sistemata = true;
      continue;
    }
    if (a && a.result === 'merged') {
      x.appFusa = true;
      dep.log(`#${x.num} parte dell’app su main di Filo${a.sha ? ` (${String(a.sha).slice(0, 9)})` : ''}: ora il server`);
      continue;
    }
    const esito = String((a && a.result) || 'guasto');
    ferme.push({ num: x.num, motivo: `la parte dell’app non si è fusa (${esito}${a && a.detail ? `: ${String(a.detail).slice(0, 200)}` : ''}), e il server resta fuori da main. ${SEGUITO_APP[esito] || 'Si riprova al prossimo giro'}.` });
    x.sistemata = true;
  }

  // Le prove del server leggono Filo: main appena letto, con le parti dell'app appena fuse, non il checkout di questo PC.
  const restano = daFondere.filter((x) => !x.sistemata && (x.appFusa || x.app === 0 || vecchioOrdine));
  let filo = null;
  if (restano.some((x) => x.appFusa)) {
    try { filo = await dep.filoDiMain(); } catch (e) { filo = null; }
    if (!filo) dep.log('main di Filo non si legge in una cartella sua: le prove del server leggono il checkout di questo PC');
  }
  try {
    for (const x of restano) {
      const env = filo ? Object.assign({}, process.env, { FILO_PUBLIC_REPO: filo.dir }) : null;
      dep.log(`#${x.num} server:fondi ${x.ramo}${x.appFusa ? ' (la parte dell’app è già su main)' : x.app ? ` (la parte dell’app, ${x.app} commit, torna alle routine dopo il deploy)` : ' (solo server)'}`);
      // Con la parte dell'app già su main server:fondi chiude la pratica da sé: è l'ultima parte.
      const r = await fondi(x, x.app ? [] : ['--solo-server'], env);
      if (fermaSe(x, r, x.appFusa ? 'la parte dell’app è già su main di Filo, il server no: ' : '')) continue;
      fuse.push({ num: x.num, id: x.id, app: x.app, appPrima: x.appFusa });
    }
  } finally {
    if (filo) await filo.togli();
  }

  for (const s of riallineate) {
    try {
      await dep.fineAttesa(s.id, { riallinea: true });
    } catch (e) {
      ferme.push({ num: s.num, motivo: `il ramo del server va in conflitto con main, ma la pratica non è tornata alle routine: ${String((e && e.message) || e).slice(0, 200)}` });
    }
  }
  for (const s of soloApp) {
    try {
      await dep.fineAttesa(s.id, { soloApp: true });
    } catch (e) {
      ferme.push({ num: s.num, motivo: `sul server non c’era niente da fondere, ma la pratica non è tornata alle routine: ${String((e && e.message) || e).slice(0, 200)}` });
    }
  }
  if (!fuse.length) return fine(false);

  // La parte dell'app che segue il server (l'ordine di prima) riparte solo col server in produzione (mappa §3.3, rischio 7).
  const dopo = fuse.filter((f) => f.app > 0 && !f.appPrima);
  let pubblicato = false;
  if (daGitHub) {
    dep.log('la pubblicazione la fa GitHub (deploy.yml) sulla spinta di main del server: niente server:pubblica dal PC');
  } else {
    // Un deploy solo, dopo tutte le fusioni: incorpora il main del server appena mosso e main di Filo con le parti dell'app.
    dep.log('server:pubblica');
    const d = await dep.pubblica();
    if (d.code !== 0) {
      const giaSuMain = fuse.filter((f) => f.appPrima).map((f) => f.num);
      ferme.push({
        num: fuse.map((f) => f.num).join(', '),
        motivo: `fuso, ma il deploy del server non è andato${giaSuMain.length ? ` (la parte dell’app di #${giaSuMain.join(', #')} è già su main: rilancia npm run server:pubblica presto)` : ''}:\n${coda(d.out)}`,
      });
      return fine(false);
    }
    pubblicato = true;
  }
  for (const f of dopo) {
    try {
      await dep.fineAttesa(f.id);
      dep.log(`#${f.num}: server ${daGitHub ? 'su main' : 'in produzione'}, la parte dell’app torna al cancello`);
    } catch (e) {
      ferme.push({ num: f.num, motivo: `server in produzione, ma la pratica non è tornata alle routine: ${String((e && e.message) || e).slice(0, 200)}` });
    }
  }
  return fine(pubblicato);
}
