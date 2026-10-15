// git verso filo-security col token del biglietto (#1233): l'intestazione legata all'URL vince su aiutanti, askpass,
// intestazioni e riscritture del proxy, e non resta nel clone. La prova vera usa git e un server git http in locale.
import '../helpers/senzaSessione.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import {
  URL_SERVER, ambienteGitServer, originDelServer, pianoGitServer, ramoAccettabile, urlSenzaSegreti, voceDiAccesso, vociGitServer,
} from '../../scripts/lib/git-server.mjs';
import { eseguiGitServer } from '../../scripts/routine-channel.mjs';

const TOKEN = 'ghs_tokendiprova_abcdefghijklmnopqrstuvwxyz';
const BASIC = (t) => `basic ${Buffer.from(`x-access-token:${t}`).toString('base64')}`;
const vociDi = (env) => Array.from({ length: Number(env.GIT_CONFIG_COUNT) }, (_, i) => [env[`GIT_CONFIG_KEY_${i}`], env[`GIT_CONFIG_VALUE_${i}`]]);

test('voci di accesso: aiutanti, askpass, intestazioni e riscritture; il resto della configurazione resta', () => {
  for (const k of ['credential.helper', 'credential.https://github.com.helper', 'credential.useHttpPath', 'core.askPass',
    'http.extraHeader', 'http.https://github.com/.extraheader', 'url.http://127.0.0.1:9/.insteadOf', 'url.x.pushInsteadOf']) {
    assert.equal(voceDiAccesso(k), true, k);
  }
  for (const k of ['http.sslCAInfo', 'http.proxy', 'http.https://github.com/.proxy', 'user.name', 'core.autocrlf', 'url.x.foo']) {
    assert.equal(voceDiAccesso(k), false, k);
  }
});

test('l’ambiente del git figlio: niente askpass né aiutanti del proxy, il token solo come intestazione per filo-security', () => {
  const base = {
    PATH: '/bin', HTTPS_PROXY: 'http://proxy:1', GIT_ASKPASS: '/proxy/askpass', SSH_ASKPASS: '/proxy/ssh', GIT_TRACE_REDACT: '0',
    GIT_CONFIG_PARAMETERS: "'credential.helper'='!x'",
    GIT_CONFIG_COUNT: '4',
    GIT_CONFIG_KEY_0: 'http.sslCAInfo', GIT_CONFIG_VALUE_0: '/proxy/ca.crt',
    GIT_CONFIG_KEY_1: 'credential.helper', GIT_CONFIG_VALUE_1: '!proxy-helper',
    GIT_CONFIG_KEY_2: 'url.http://127.0.0.1:9/git/.insteadOf', GIT_CONFIG_VALUE_2: 'https://github.com/',
    GIT_CONFIG_KEY_3: 'http.https://github.com/.extraheader', GIT_CONFIG_VALUE_3: 'AUTHORIZATION: basic proxy',
    GIT_CONFIG_KEY_9: 'avanzo', GIT_CONFIG_VALUE_9: 'oltre il conto',
  };
  const { env, tolte } = ambienteGitServer(base, TOKEN);
  for (const k of ['GIT_ASKPASS', 'SSH_ASKPASS', 'GIT_CONFIG_PARAMETERS', 'GIT_TRACE_REDACT']) assert.ok(!(k in env), k);
  assert.ok(!Object.values(env).includes('avanzo') && !Object.values(env).includes('oltre il conto'), 'le voci fuori dal conto spariscono');
  assert.ok(!(`GIT_CONFIG_KEY_${Number(env.GIT_CONFIG_COUNT)}` in env));
  assert.equal(env.PATH, '/bin');
  assert.equal(env.HTTPS_PROXY, 'http://proxy:1', 'il proxy di rete serve ancora');
  assert.equal(env.GIT_TERMINAL_PROMPT, '0');
  const voci = vociDi(env);
  assert.deepEqual(voci[0], ['http.sslCAInfo', '/proxy/ca.crt'], 'i certificati del proxy restano');
  assert.ok(!voci.some(([k, v]) => v === '!proxy-helper' || v === 'AUTHORIZATION: basic proxy' || k.includes('127.0.0.1')));
  assert.deepEqual(voci.slice(1), vociGitServer(TOKEN));
  assert.deepEqual(tolte, ['GIT_ASKPASS', 'SSH_ASKPASS', 'GIT_CONFIG_PARAMETERS', 'GIT_TRACE_REDACT',
    'credential.helper', 'url.http://127.0.0.1:9/git/.insteadOf', 'http.https://github.com/.extraheader']);
  // Il token esce solo nell'intestazione legata all'URL esatto del repo, dopo l'azzeramento della stessa chiave.
  const conToken = voci.filter(([, v]) => v.includes(BASIC(TOKEN)));
  assert.deepEqual(conToken.map(([k]) => k), [`http.${URL_SERVER}.extraHeader`, `http.${URL_SERVER.replace(/\.git$/, '')}.extraHeader`]);
  for (const [k] of conToken) {
    const i = voci.findIndex(([kk, v]) => kk === k && v === '');
    assert.ok(i >= 0 && i < voci.findIndex(([kk, v]) => kk === k && v !== ''), `${k}: prima l'azzeramento`);
  }
  assert.ok(!Object.entries(env).some(([k, v]) => !k.startsWith('GIT_CONFIG_VALUE_') && String(v).includes(TOKEN)));
  // Senza token: solo gli azzeramenti, per i comandi che non vanno in rete.
  assert.ok(!vociDi(ambienteGitServer(base, '').env).some(([, v]) => /AUTHORIZATION/i.test(v)));
});

test('piano di git-server: azioni, cartella fuori da Filo, rami ammessi, mai main', () => {
  const root = resolve('/progetti/Filo');
  const fuori = resolve('/progetti/filo-security');
  assert.deepEqual(pianoGitServer({ azione: 'clone', cartella: fuori, root }), { argv: ['clone', URL_SERVER, fuori], dir: fuori, controllaOrigin: false });
  assert.deepEqual(pianoGitServer({ azione: 'clone', cartella: fuori, root, clonato: true }).argv, ['-C', fuori, 'fetch', 'origin']);
  assert.match(pianoGitServer({ azione: 'clone', cartella: fuori, root, clonato: true }).nota, /c'è già/);
  assert.deepEqual(pianoGitServer({ azione: 'ls-remote', cartella: fuori, root, clonato: true }).argv, ['-C', fuori, 'ls-remote', 'origin', 'HEAD']);
  assert.deepEqual(pianoGitServer({ azione: 'fetch', cartella: fuori, ramo: 'main', root, clonato: true }).argv, ['-C', fuori, 'fetch', 'origin', 'main']);
  assert.deepEqual(pianoGitServer({ azione: 'push', cartella: fuori, ramo: 'worker/f1-20261015T090000Z', root, clonato: true }).argv,
    ['-C', fuori, 'push', 'origin', 'worker/f1-20261015T090000Z']);
  for (const [chiesto, motivo] of [
    [{ azione: 'pull', cartella: fuori }, /azione/],
    [{ azione: 'clone' }, /cartella/],
    [{ azione: 'clone', cartella: join(root, 'filo-security') }, /dentro il checkout di Filo/],
    [{ azione: 'fetch', cartella: fuori }, /non c'è un clone/],
    [{ azione: 'push', cartella: fuori, clonato: true }, /vuole il ramo/],
    [{ azione: 'push', cartella: fuori, ramo: 'main', clonato: true }, /main di filo-security/],
    [{ azione: 'push', cartella: fuori, ramo: '+worker/x', clonato: true }, /non è un nome di ramo/],
    [{ azione: 'push', cartella: fuori, ramo: 'HEAD:main', clonato: true }, /non è un nome di ramo/],
    [{ azione: 'fetch', cartella: fuori, ramo: '--upload-pack=x', clonato: true }, /non è un nome di ramo/],
  ]) assert.match(pianoGitServer({ root, ...chiesto }).errore || '', motivo, JSON.stringify(chiesto));
  for (const r of ['a..b', 'x.lock', '/x', 'x/', 'a//b', 'con spazio', '']) assert.equal(ramoAccettabile(r), false, r);
  assert.equal(originDelServer(URL_SERVER), true);
  assert.equal(originDelServer('https://github.com/sathyaram1/filo-security'), true);
  assert.equal(originDelServer('https://x-access-token:t@github.com/sathyaram1/filo-security.git'), false);
  assert.equal(urlSenzaSegreti('https://x-access-token:SEGRETO@github.com/a.git'), 'https://***@github.com/a.git');
});

test('eseguiGitServer: il token chiesto col biglietto arriva a git nell’ambiente, mai fra gli argomenti', async () => {
  const casa = cartellaTemporanea('filo-git-server-');
  const clone = join(casa, 'filo-security');
  mkdirSync(join(clone, '.git'), { recursive: true });
  const lanciati = [];
  const righe = [];
  const lancia = (argv, o) => {
    lanciati.push({ argv, env: o.env });
    return argv.includes('get-url') ? { status: 0, stdout: `${URL_SERVER}\n` } : { status: 0 };
  };
  const chiesti = [];
  const token = async (b) => { chiesti.push(b); return { outcome: 'ok', token: TOKEN, scadeIl: Date.parse('2026-10-15T11:00:00Z') }; };
  try {
    const exit = await eseguiGitServer({
      azione: 'push', cartella: clone, ramo: 'worker/f1', biglietto: 'B1', root: join(casa, 'Filo'),
      env: { GIT_ASKPASS: '/proxy/askpass' }, lancia, token, scrivi: (r) => righe.push(r),
    });
    assert.equal(exit, 0, righe.join('\n'));
    assert.deepEqual(chiesti, ['B1']);
    assert.equal(lanciati.length, 3, 'due letture dell’origin e la spinta');
    const spinta = lanciati[2];
    assert.deepEqual(spinta.argv, ['-C', clone, 'push', 'origin', 'worker/f1']);
    assert.ok(vociDi(spinta.env).some(([k, v]) => k === `http.${URL_SERVER}.extraHeader` && v === `AUTHORIZATION: ${BASIC(TOKEN)}`));
    assert.ok(!('GIT_ASKPASS' in spinta.env));
    for (const l of lanciati.slice(0, 2)) assert.ok(!JSON.stringify(l).includes(BASIC(TOKEN)), 'la lettura dell’origin non porta il token');
    assert.ok(!righe.join('\n').includes(TOKEN));
    assert.match(righe.join('\n'), /scade alle 11:00 UTC/);
    assert.match(righe.join('\n'), /tolti per questa chiamata: GIT_ASKPASS/);
  } finally {
    togliCartella(casa);
  }
});

test('eseguiGitServer: token negato, guasto, git che fallisce, origin estraneo', async () => {
  const casa = cartellaTemporanea('filo-git-server-');
  const clone = join(casa, 'filo-security');
  mkdirSync(join(clone, '.git'), { recursive: true });
  const base = { azione: 'fetch', cartella: clone, biglietto: 'B1', root: join(casa, 'Filo'), env: {} };
  const origin = (url, esito = 0) => (argv) => (argv.includes('get-url') ? { status: 0, stdout: url } : { status: esito });
  try {
    let righe = [];
    let chiamato = false;
    const scrivi = (r) => righe.push(r);
    assert.equal(await eseguiGitServer({ ...base, lancia: origin(URL_SERVER), scrivi, token: async () => ({ outcome: 'refused', reason: 'biglietto_chiuso' }) }), 4);
    assert.match(righe.join('\n'), /RIFIUTATO dal server: niente token per filo-security \(biglietto_chiuso\)/);
    righe = [];
    assert.equal(await eseguiGitServer({ ...base, lancia: origin(URL_SERVER), scrivi, token: async () => ({ outcome: 'fault', reason: 'http_503' }) }), 3);
    righe = [];
    assert.equal(await eseguiGitServer({ ...base, lancia: origin(URL_SERVER, 128), scrivi, token: async () => ({ outcome: 'ok', token: TOKEN }) }), 1);
    assert.match(righe.join('\n'), /git è uscito con 128[^]*a GitHub non è arrivato buono/);
    righe = [];
    const estraneo = 'https://x-access-token:SEGRETO@example.com/filo-security.git';
    assert.equal(await eseguiGitServer({ ...base, lancia: origin(estraneo), scrivi, token: async () => { chiamato = true; return { outcome: 'ok', token: TOKEN }; } }), 1);
    assert.equal(chiamato, false, 'con un origin estraneo il server non si chiama');
    assert.match(righe.join('\n'), /«https:\/\/\*\*\*@example\.com\/filo-security\.git»/);
    assert.ok(!righe.join('\n').includes('SEGRETO'));
    righe = [];
    assert.equal(await eseguiGitServer({ ...base, biglietto: '', lancia: origin(URL_SERVER), scrivi, token: async () => { chiamato = true; return {}; } }), 1);
    assert.equal(chiamato, false);
    assert.match(righe.join('\n'), /NESSUN BIGLIETTO/);
  } finally {
    togliCartella(casa);
  }
});

// ─── La prova con git vero ───────────────────────────────────────────────────

const gitHttpBackend = () => {
  const r = spawnSync('git', ['--exec-path'], { encoding: 'utf8' });
  const dir = String(r.stdout || '').trim();
  return dir && ['git-http-backend', 'git-http-backend.exe'].some((n) => existsSync(join(dir, n)));
};

/** Un server git http che vuole una sola intestazione Authorization, quella giusta. */
function servitoreGit(radice, attesa) {
  const visti = [];
  const srv = createServer((req, res) => {
    const auth = req.rawHeaders.filter((_, i, a) => i % 2 === 1 && /^authorization$/i.test(a[i - 1]));
    visti.push({ percorso: req.url, auth });
    if (auth.length !== 1 || auth[0] !== attesa) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="prova"' });
      res.end();
      req.resume();
      return;
    }
    const u = new URL(req.url, 'http://x');
    const cgi = spawn('git', ['http-backend'], {
      env: {
        PATH: process.env.PATH, SystemRoot: process.env.SystemRoot || '', GIT_PROJECT_ROOT: radice, GIT_HTTP_EXPORT_ALL: '1',
        PATH_INFO: decodeURIComponent(u.pathname), QUERY_STRING: u.search.slice(1), REQUEST_METHOD: req.method,
        CONTENT_TYPE: req.headers['content-type'] || '', REMOTE_USER: 'prova', REMOTE_ADDR: '127.0.0.1',
        ...(req.headers['content-length'] ? { CONTENT_LENGTH: req.headers['content-length'] } : {}),
        ...(req.headers['content-encoding'] ? { HTTP_CONTENT_ENCODING: req.headers['content-encoding'] } : {}),
        ...(req.headers['git-protocol'] ? { HTTP_GIT_PROTOCOL: req.headers['git-protocol'] } : {}),
      },
    });
    req.pipe(cgi.stdin);
    const pezzi = [];
    cgi.stdout.on('data', (c) => pezzi.push(c));
    cgi.on('close', () => {
      const tutto = Buffer.concat(pezzi);
      const fine = tutto.indexOf('\r\n\r\n');
      const testa = tutto.subarray(0, fine).toString('latin1').split('\r\n');
      let stato = 200;
      const intestazioni = {};
      for (const riga of testa) {
        const [k, ...v] = riga.split(':');
        if (/^status$/i.test(k)) stato = Number.parseInt(v.join(':'), 10) || 200;
        else if (k) intestazioni[k.trim()] = v.join(':').trim();
      }
      res.writeHead(stato, intestazioni);
      res.end(tutto.subarray(fine + 4));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, visti, port: srv.address().port })));
}

test('git vero: con l’ambiente del proxy il clone fallisce, con quello di git-server clona e spinge, e il token non resta', { skip: !gitHttpBackend() && 'git http-backend non c’è' }, async () => {
  const casa = cartellaTemporanea('filo-git-server-vero-');
  const radice = join(casa, 'server');
  const globale = join(casa, 'gitconfig-del-proxy');
  // La macchina della prova: niente configurazione e proxy di chi la lancia.
  const macchina = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(GIT_|SSH_ASKPASS$|https?_proxy$|all_proxy$|no_proxy$)/i.test(k)));
  Object.assign(macchina, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: globale, NO_PROXY: '*', no_proxy: '*', GIT_TERMINAL_PROMPT: '0' });
  writeFileSync(globale, '');
  // Asincrono: il server git sta in questo processo, e una chiamata sincrona lo fermerebbe.
  const git = (args, env = macchina, cwd = casa) => new Promise((ok, ko) => {
    execFile('git', args, { cwd, env, encoding: 'utf8', timeout: 60_000 }, (e, so, se) => (e ? ko(Object.assign(e, { se })) : ok(so)));
  });
  const { srv, visti, port } = await servitoreGit(radice, BASIC(TOKEN));
  const url = `http://127.0.0.1:${port}/filo-security.git`;
  const segno = join(casa, 'aiutante-del-proxy-chiamato');
  try {
    mkdirSync(radice, { recursive: true });
    await git(['init', '-q', '--bare', '-b', 'main', join(radice, 'filo-security.git')]);
    const semina = join(casa, 'semina');
    await git(['init', '-q', '-b', 'main', semina]);
    writeFileSync(join(semina, 'README.md'), 'filo-security\n');
    await git(['add', 'README.md'], macchina, semina);
    await git(['-c', 'user.name=prova', '-c', 'user.email=prova@example.invalid', 'commit', '-q', '-m', 'primo'], macchina, semina);
    await git(['push', '-q', join(radice, 'filo-security.git'), 'main'], macchina, semina);

    // Il proxy, nel file globale e nell'ambiente: askpass, aiutanti con credenziali sbagliate, intestazioni sbagliate e
    // riscritture del repo verso una porta morta. Quelle del file non si tolgono: devono perdere contro le voci nostre.
    writeFileSync(globale, [
      '[credential]', `\thelper = "!f() { echo chiamato >> '${segno.split('\\').join('/')}'; echo username=proxy; echo password=sbagliata; }; f"`,
      `[http "http://127.0.0.1:${port}/"]`, '\textraHeader = AUTHORIZATION: basic globale-sbagliata',
      '[url "http://127.0.0.1:1/morto-globale/"]', `\tinsteadOf = http://127.0.0.1:${port}/`, '',
    ].join('\n'));
    const proxy = {
      ...macchina, GIT_ASKPASS: join(casa, 'askpass-che-non-esiste'),
      GIT_CONFIG_COUNT: '3',
      GIT_CONFIG_KEY_0: 'credential.helper', GIT_CONFIG_VALUE_0: '!f() { echo username=env; echo password=sbagliata; }; f',
      GIT_CONFIG_KEY_1: 'http.extraHeader', GIT_CONFIG_VALUE_1: 'AUTHORIZATION: basic ambiente-sbagliata',
      GIT_CONFIG_KEY_2: `url.http://127.0.0.1:1/morto/.insteadOf`, GIT_CONFIG_VALUE_2: `http://127.0.0.1:${port}/`,
    };

    // Senza la cura il clone non passa: è il guasto della segnalazione.
    await assert.rejects(git(['clone', '-q', url, join(casa, 'col-proxy')], proxy));
    togliCartella(segno);

    const { env } = ambienteGitServer(proxy, TOKEN, url);
    const clone = join(casa, 'filo-security');
    visti.length = 0;
    await git(['clone', '-q', url, clone], env);
    assert.ok(visti.length > 0 && visti.every((v) => v.auth.length === 1 && v.auth[0] === BASIC(TOKEN)), JSON.stringify(visti.map((v) => v.auth)));
    assert.equal(readFileSync(join(clone, 'README.md'), 'utf8'), 'filo-security\n');
    const configClone = readFileSync(join(clone, '.git', 'config'), 'utf8');
    assert.ok(!configClone.includes(TOKEN) && !configClone.includes(BASIC(TOKEN).split(' ')[1]), 'il token non resta nel clone');
    assert.match(configClone, new RegExp(`url = ${url.replace(/[.]/g, '\\.')}`));

    await git(['checkout', '-q', '-b', 'worker/f1-prova'], macchina, clone);
    writeFileSync(join(clone, 'README.md'), 'filo-security\nuna riga\n');
    await git(['-c', 'user.name=prova', '-c', 'user.email=prova@example.invalid', 'commit', '-q', '-am', 'una riga'], macchina, clone);
    await git(['-C', clone, 'push', '-q', 'origin', 'worker/f1-prova'], env);
    assert.match(await git(['-C', clone, 'ls-remote', 'origin', 'worker/f1-prova'], env), /refs\/heads\/worker\/f1-prova/);

    // Con un token diverso il server dice di no, e git non ripiega sulle credenziali del proxy.
    const { env: altro } = ambienteGitServer(proxy, 'ghs_scaduto', url);
    visti.length = 0;
    await assert.rejects(git(['-C', clone, 'ls-remote', 'origin'], altro));
    assert.ok(visti.length > 0 && visti.every((v) => v.auth.length === 1 && v.auth[0] === BASIC('ghs_scaduto')), JSON.stringify(visti.map((v) => v.auth)));
    assert.equal(existsSync(segno), false, 'l’aiutante del proxy non è stato chiamato');
  } finally {
    srv.closeAllConnections();
    srv.close();
    togliCartella(casa);
  }
});
