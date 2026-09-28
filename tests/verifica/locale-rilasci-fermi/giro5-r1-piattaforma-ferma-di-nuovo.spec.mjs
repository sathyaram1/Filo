// Giro 5, rilievo 1: una metà Mac o Linux che si ferma di nuovo, dopo essere tornata a uscire, apre un feedback suo
// anche se quello del suo guasto di prima è ancora aperto (parcheggiato). Server degli allarmi e GitHub finti.
import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import yaml from 'js-yaml';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// Stati in cui un feedback resta aperto per regola ma non copre (contratto-allarmi-aggiunta-stati).
const NON_COPRONO = new Set(['spam_confirmed', 'attack_confirmed', 'done']);

function serverAllarmi() {
  const stato = { seq: 700, feedback: [] };
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const j = JSON.parse(raw || '{}');
      const keys = [...new Set((j.keys || []).map((k) => String(k).trim()).filter(Boolean))];
      const aperti = stato.feedback.filter((f) => !NON_COPRONO.has(f.stato));
      const coperte = keys.flatMap((k) => {
        const f = aperti.find((x) => x.alarmKeys.includes(k));
        return f ? [{ key: k, num: f.num }] : [];
      });
      const nuove = keys.filter((k) => !coperte.some((c) => c.key === k));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (!keys.length && aperti.length) return res.end(JSON.stringify({ ok: true, duplicate: true, num: aperti[0].num }));
      if (keys.length && !nuove.length) {
        return res.end(JSON.stringify({ ok: true, duplicate: true, num: coperte[0].num, nuove, coperte }));
      }
      stato.seq += 1;
      const num = `#${stato.seq}`;
      stato.feedback.push({ num, titolo: String(j.name || ''), testo: String(j.text || ''), alarmKeys: nuove, stato: 'unlabeled' });
      return res.end(JSON.stringify({ ok: true, duplicate: false, num, nuove, coperte }));
    });
  });
  return { server, stato };
}

// GitHub finto: le release e i loro allegati, per `gh api`, `gh release view|list` e fetch verso api.github.com.
const PRELOAD = `
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const cp = require('node:child_process');
const rel = () => JSON.parse(readFileSync(process.env.FINTO_GITHUB, 'utf8'));
function risposta(args) {
  const a = args.map(String);
  const rs = rel();
  if (a[0] === 'api') {
    const p = a.find((x) => x.includes('repos/')).replace(/^\\//, '').split('?')[0];
    if (/\\/releases$/.test(p)) return JSON.stringify(rs);
    if (/\\/releases\\/latest$/.test(p)) return JSON.stringify(rs[0]);
    const t = p.match(/\\/releases\\/tags\\/(.+)$/);
    if (t) { const r = rs.find((x) => x.tag_name === t[1]); if (r) return JSON.stringify(r); }
    const e = new Error('gh: Not Found (HTTP 404)'); e.status = 1; e.stderr = 'gh: Not Found (HTTP 404)'; throw e;
  }
  if (a[0] === 'release' && a[1] === 'view') {
    const r = rs.find((x) => x.tag_name === a[2]);
    if (!r) { const e = new Error('release not found'); e.status = 1; e.stderr = 'release not found'; throw e; }
    return a.includes('--jq') ? r.assets.map((x) => x.name).join('\\n') + '\\n' : JSON.stringify({ assets: r.assets, tagName: r.tag_name });
  }
  if (a[0] === 'release' && a[1] === 'list') {
    if (a.includes('--json')) return JSON.stringify(rs.map((r) => ({ tagName: r.tag_name, publishedAt: r.published_at, isDraft: false })));
    return rs.map((r) => r.tag_name + '\\t\\t' + r.tag_name + '\\t' + r.published_at).join('\\n') + '\\n';
  }
  const e = new Error('gh finto: ' + a.join(' ')); e.status = 1; e.stderr = e.message; throw e;
}
const eGh = (c) => /(^|[\\\\/])gh(\\.exe)?$/.test(String(c));
const [efs, es, ss, ef] = [cp.execFileSync, cp.execSync, cp.spawnSync, cp.execFile];
cp.execFileSync = function (c, args, o) { return eGh(c) ? risposta(args || []) : efs.apply(this, arguments); };
cp.execSync = function (c, o) {
  const m = String(c).match(/^\\s*gh\\s+(.*)$/);
  return m ? risposta(m[1].match(/'[^']*'|"[^"]*"|\\S+/g).map((x) => x.replace(/^['"]|['"]$/g, ''))) : es.apply(this, arguments);
};
cp.spawnSync = function (c, args, o) {
  if (!eGh(c)) return ss.apply(this, arguments);
  try { return { status: 0, stdout: risposta(args || []), stderr: '' }; } catch (e) { return { status: 1, stdout: '', stderr: e.stderr }; }
};
cp.execFile = function (c, args, o, cb) {
  if (!eGh(c)) return ef.apply(this, arguments);
  const fine = [o, cb].find((x) => typeof x === 'function');
  try { const out = risposta(args || []); setImmediate(() => fine && fine(null, out, '')); } catch (e) { setImmediate(() => fine && fine(e, '', e.stderr)); }
};
syncBuiltinESMExports();
const fetchVero = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (!u.includes('api.github.com')) return fetchVero(url, init);
  try { return new Response(risposta(['api', u.replace(/^https:\\/\\/api\\.github\\.com\\//, '')]), { status: 200 }); }
  catch { return new Response('{"message":"Not Found"}', { status: 404 }); }
};
`;

// I file che il lavoro di piattaforma mette al riparo prima di tutto: si lancia la stessa copia che lancia GitHub.
function copiaDelloStrumento(job, dest) {
  const wf = yaml.load(readFileSync(join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8'));
  const riparo = wf.jobs[job].steps.find((s) => s.id === 'riparo').run;
  const cp = riparo.split('\n').find((l) => /^\s*cp\s/.test(l));
  const file = cp.trim().split(/\s+/).slice(1).filter((x) => x.startsWith('scripts/'));
  mkdirSync(join(dest, 'scripts'), { recursive: true });
  for (const f of file) copyFileSync(join(ROOT, f), join(dest, 'scripts', basename(f)));
  return join(dest, 'scripts', 'release-platform-alarm.mjs');
}

for (const [piattaforma, job, nomeFile] of [['Mac', 'release-mac', 'Filo-Mac.dmg'], ['Linux', 'release-linux', 'Filo-Linux.AppImage']]) {
  test(`${piattaforma}: un guasto dopo una versione uscita non finisce nel feedback del guasto di prima`, async () => {
    const dir = cartellaTemporanea('giro5-piattaforma-');
    const script = copiaDelloStrumento(job, join(dir, 'riparo'));
    writeFileSync(join(dir, 'preload.mjs'), PRELOAD);
    const attesi = spawnSync(process.execPath, [script, '--attesi', piattaforma], { encoding: 'utf8' }).stdout.split(/\r?\n/).filter(Boolean);
    const windows = ['Filo-Setup.exe', 'latest.yml'];
    const altra = piattaforma === 'Mac'
      ? ['Filo-Linux.AppImage', 'latest-linux.yml', 'Se-Filo-non-si-apre-Linux.txt']
      : ['Filo-Mac.dmg', 'Filo-Mac.zip', 'latest-mac.yml'];
    const asset = (nomi) => nomi.map((name) => ({ name }));
    const oreFa = (h) => new Date(Date.now() - h * 3.6e6).toISOString();
    // v0.2.300 con la piattaforma, v0.2.301 senza, v0.2.302 con, v0.2.303 di nuovo senza (la più nuova per prima).
    const finto = join(dir, 'github.json');
    const tutte = [
      { tag_name: 'v0.2.303', draft: false, published_at: oreFa(2), assets: asset([...windows, ...altra]) },
      { tag_name: 'v0.2.302', draft: false, published_at: oreFa(30), assets: asset([...windows, ...altra, ...attesi]) },
      { tag_name: 'v0.2.301', draft: false, published_at: oreFa(60), assets: asset([...windows, ...altra]) },
      { tag_name: 'v0.2.300', draft: false, published_at: oreFa(90), assets: asset([...windows, ...altra, ...attesi]) },
    ];
    const finoA = (tag) => writeFileSync(finto, JSON.stringify(tutte.slice(tutte.findIndex((r) => r.tag_name === tag))));

    const { server, stato } = serverAllarmi();
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    // Asincrono: il server finto gira in questo processo, e uno spawnSync lo terrebbe fermo.
    const lancia = (versione, esiti, mancanti = '') => new Promise((fatto) => {
      const figlio = spawn(process.execPath, ['--import', pathToFileURL(join(dir, 'preload.mjs')).href, script], {
        env: {
          ...process.env, FINTO_GITHUB: finto, FILO_ROUTINE_API: base, FILO_BUILD_PASSPHRASE: 'finta',
          GH_TOKEN: 'finto', GITHUB_TOKEN: 'finto', GITHUB_REPOSITORY: 'o/r', REPO: 'o/r',
          PIATTAFORMA: piattaforma, VERSIONE: versione, ESECUZIONE: `https://github.com/o/r/actions/runs/${versione}`,
          ESITI: JSON.stringify(esiti), MANCANTI: mancanti,
        },
      });
      let out = '';
      figlio.stdout.on('data', (c) => { out += c; });
      figlio.stderr.on('data', (c) => { out += c; });
      figlio.on('close', (status) => fatto({ status, stdout: out, stderr: '' }));
    });
    try {
      const primo = await lancia('v0.2.301', { strumento: { outcome: 'success' }, dipendenze: { outcome: 'failure' } });
      expect(primo.status, primo.stdout + primo.stderr).toBe(0);
      expect(stato.feedback).toHaveLength(1);
      // Il feedback resta aperto: parcheggiato in attesa dell'owner, come #569.
      stato.feedback[0].stato = 'revision_security';

      // v0.2.302 è uscita con i file della piattaforma; alla v0.2.303 mancano di nuovo, per un altro motivo.
      const secondo = await lancia('v0.2.303', {
        strumento: { outcome: 'success' }, dipendenze: { outcome: 'success' }, build: { outcome: 'success' },
        controllo: { outcome: 'failure' },
      }, attesi.join(' '));
      expect(secondo.status, secondo.stdout + secondo.stderr).toBe(0);
      expect(stato.feedback.map((f) => f.titolo), 'il guasto della v0.2.303 deve avere un feedback suo').toHaveLength(2);
      const nuovo = stato.feedback[1];
      expect(`${nuovo.titolo}\n${nuovo.testo}`).toContain('v0.2.303');
      expect(`${nuovo.titolo}\n${nuovo.testo}`).toContain(nomeFile);
    } finally {
      server.close();
    }
  });
}
