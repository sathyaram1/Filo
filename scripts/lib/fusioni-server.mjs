// I lavori server passati in cloud e fermi per il PC dell'owner (#1159, mappa §2.1): server:fondi per ognuno, un
// server:pubblica per tutti, poi la parte dell'app torna alle routine (mai prima del deploy). Con deploy.yml su main
// (fase 2) il PC non pubblica: la parte dell'app la libera il server al deploy verde. Niente qui decide la fiducia: la
// controlla server-fondi-pratica. Regole: tests/unit/fusioniServer.test.mjs.

import { USCITA_CONFLITTO_MAIN, USCITA_SOLO_APP } from '../server-fondi-pratica.mjs';

const RAMO_RE = /^(claude|worker)\/[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;

const numeroDi = (p) => (Number(p.subSeq) > 0 ? `${p.seq}.${p.subSeq}` : String(p.seq || p.feedbackId));
const coda = (t, n = 8) => String(t || '').trim().split('\n').slice(-n).join('\n');

/**
 * dep: { attese() → [{ feedbackId, seq, subSeq, branch, parti }] o { pratiche, deployDaActions }, esegui(cmd, args,
 *        { cwd, timeoutMs }), pubblica() → { code, out }, puntaServer() → sha di main di filo-security,
 *        fineAttesa(feedbackId, { soloApp, riallinea, attendiDeploy, sha }), log(riga), radice }.
 * → { fuse: [{ num, id, app }], soloApp: [{ num, id, app }], riallineate: [{ num, id }], ferme: [{ num, motivo }], pubblicato, daGitHub }
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
  if (!pratiche.length) {
    dep.log('Nessun lavoro server aspetta il PC.');
    return { fuse, soloApp, riallineate, ferme, pubblicato: false, daGitHub };
  }
  const git = (args) => dep.esegui('git', args, { cwd: dep.radice });
  await git(['fetch', '--quiet', 'origin', 'main']);
  for (const p of pratiche) {
    const num = numeroDi(p);
    const ramo = String(p.branch || '');
    if (!RAMO_RE.test(ramo) || /\.\./.test(ramo)) {
      ferme.push({ num, motivo: `ramo non valido («${ramo.slice(0, 80)}»)` });
      continue;
    }
    // La parte dell'app: commit del ramo dell'app oltre main. Senza, il lavoro sta tutto sul server.
    const preso = await git(['fetch', '--quiet', 'origin', `+refs/heads/${ramo}:refs/remotes/origin/${ramo}`]);
    const conta = preso.code === 0 ? await git(['rev-list', '--count', `refs/remotes/origin/main..refs/remotes/origin/${ramo}`]) : { code: 0, out: '0' };
    const app = conta.code === 0 ? Number(String(conta.out).trim()) || 0 : -1;
    if (app < 0) { ferme.push({ num, motivo: 'non riesco a contare i commit della parte dell’app' }); continue; }
    if (!(p.parti && p.parti.server)) {
      const args = ['scripts/server-fondi-pratica.mjs', ramo, '--feedback', p.feedbackId, ...(app ? [] : ['--solo-server']), ...(prova ? ['--dry-run'] : [])];
      dep.log(`#${num} server:fondi ${ramo}${app ? ` (la parte dell’app, ${app} commit, torna alle routine dopo il deploy)` : ' (solo server)'}`);
      const r = await dep.esegui('node', args, { cwd: dep.radice, timeoutMs: 60 * 60_000 });
      // Sul server il ramo non c'è: il lavoro sta tutto nell'app, che torna alle routine senza aspettare un deploy.
      if (r.code === USCITA_SOLO_APP && app > 0) {
        dep.log(`#${num} su filo-security ${ramo} non c'è: niente da fondere sul server, la parte dell’app torna alle routine`);
        soloApp.push({ num, id: p.feedbackId, app });
        continue;
      }
      if (r.code === USCITA_SOLO_APP) {
        ferme.push({ num, motivo: `né su filo-security né nell’app c’è un ramo ${ramo} da fondere: decide l’owner` });
        continue;
      }
      // Il ramo va in conflitto con main del server: nessuno sul PC lo riallinea, torna alle routine.
      if (r.code === USCITA_CONFLITTO_MAIN) {
        dep.log(`#${num} su filo-security ${ramo} va in conflitto con main: torna alle routine per il riallineamento`);
        riallineate.push({ num, id: p.feedbackId });
        continue;
      }
      if (r.code !== 0) {
        ferme.push({ num, motivo: `server:fondi non ha fuso (uscita ${r.code}):\n${coda(r.out)}` });
        continue;
      }
    } else {
      dep.log(`#${num} il server è già su main: resta il deploy`);
    }
    fuse.push({ num, id: p.feedbackId, app });
  }
  if (prova) return { fuse, soloApp, riallineate, ferme, pubblicato: false, daGitHub };
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
  if (!fuse.length) return { fuse, soloApp, riallineate, ferme, pubblicato: false, daGitHub };

  if (daGitHub) {
    // Il deploy lo fa GitHub: le parti dell'app aspettano quello verde che contiene main di adesso.
    const sha = String((await dep.puntaServer()) || '').trim();
    dep.log(`la pubblicazione la fa GitHub (deploy.yml)${sha ? ` su ${sha.slice(0, 9)}` : ''}: niente server:pubblica dal PC`);
    for (const f of fuse.filter((x) => x.app > 0)) {
      try {
        if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('main di filo-security non si legge');
        await dep.fineAttesa(f.id, { attendiDeploy: true, sha });
        dep.log(`#${f.num}: la parte dell’app torna alle routine quando la pubblicazione da GitHub è verde`);
      } catch (e) {
        ferme.push({ num: f.num, motivo: `fuso, ma la pratica non aspetta la pubblicazione da GitHub: ${String((e && e.message) || e).slice(0, 200)}` });
      }
    }
    return { fuse, soloApp, riallineate, ferme, pubblicato: false, daGitHub };
  }

  // Un deploy solo, dopo tutte le fusioni: incorpora il main del server appena mosso.
  dep.log('server:pubblica');
  const d = await dep.pubblica();
  if (d.code !== 0) {
    // Le parti dell'app restano ferme: senza il server in produzione romperebbero chi le usa (mappa §3.3, rischio 7).
    ferme.push({ num: fuse.map((f) => f.num).join(', '), motivo: `fuso, ma il deploy del server non è andato:\n${coda(d.out)}` });
    return { fuse, soloApp, riallineate, ferme, pubblicato: false, daGitHub };
  }
  for (const f of fuse.filter((x) => x.app > 0)) {
    try {
      await dep.fineAttesa(f.id);
      dep.log(`#${f.num}: server in produzione, la parte dell’app torna alle routine`);
    } catch (e) {
      ferme.push({ num: f.num, motivo: `server in produzione, ma la pratica non è tornata alle routine: ${String((e && e.message) || e).slice(0, 200)}` });
    }
  }
  return { fuse, soloApp, riallineate, ferme, pubblicato: true, daGitHub };
}
