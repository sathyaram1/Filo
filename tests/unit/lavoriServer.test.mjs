// Lavori server dalla cloud (#1159), lato app: il clone di filo-security non entra mai nel repo pubblico, e la busta
// `lavoroServer` porta al worker le istruzioni del clone coi percorsi veri.
import '../helpers/senzaSessione.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
// Come in dispatch.test.mjs: stato e marcatori in una cartella usa-e-getta, letti all'import.
const TMP = cartellaTemporanea('filo-lavori-server-');
process.env.FILO_DISPATCH_STATE_DIR = TMP;
process.env.FILO_REPO_ROOT = TMP;
process.env.FILO_TOOLS_ROOT = REPO;
process.env.CLAUDE_CONFIG_DIR = cartellaTemporanea('filo-claude-utente-');

const {
  cartellaCloneServer, cloneDentroIlRepo, rigaCartellaDiPartenza, testoLavoroServer, serverCtx, readRoleInstructions,
} = await import('../../scripts/dispatch.mjs');

test('il clone del server non si committa: .gitignore lo esclude ovunque stia', () => {
  const righe = readFileSync(join(REPO, '.gitignore'), 'utf8').split(/\r?\n/).map((l) => l.trim());
  assert.ok(righe.includes('filo-security/'), '.gitignore deve escludere filo-security/');
  for (const p of ['filo-security/functions/index.js', 'tests/filo-security/x.js']) {
    const out = execFileSync('git', ['check-ignore', '-v', p], { cwd: REPO, encoding: 'utf8' });
    assert.match(out, /filo-security\//, p);
  }
});

test('dispatch rifiuta un clone dentro il checkout di Filo', () => {
  const root = resolve('/progetti/Filo');
  assert.equal(cloneDentroIlRepo(join(root, 'filo-security'), root), true);
  assert.equal(cloneDentroIlRepo(root, root), true);
  assert.equal(cloneDentroIlRepo(join(root, 'a', 'b'), root), true);
  assert.equal(cloneDentroIlRepo(resolve('/progetti/filo-security'), root), false);
  assert.equal(cloneDentroIlRepo(resolve('/progetti/Filo-copia'), root), false);
  if (process.platform === 'win32') assert.equal(cloneDentroIlRepo('C:\\PROGETTI\\filo\\filo-security', 'c:\\progetti\\Filo'), true);
  assert.equal(cartellaCloneServer({}), resolve(join(homedir(), 'filo-security')));
  assert.equal(cartellaCloneServer({ FILO_SERVER_CLONE: '/altrove/fs' }), resolve('/altrove/fs'));
});

test('le istruzioni del lavoro server: git verso GitHub solo da git-server, percorsi veri, registro dopo il push', () => {
  const t = testoLavoroServer({ clone: '/home/user/filo-security', canale: 'C:\\x\\scripts\\routine-channel.mjs' });
  assert.ok(t.length > 400);
  assert.ok(!t.includes('<CLONE>') && !t.includes('<CANALE>'), 'segnaposti sostituiti');
  assert.ok(!/<!--\s*includi:/.test(t));
  const canale = 'node "C:/x/scripts/routine-channel.mjs"';
  for (const azione of ['clone', 'ls-remote', 'fetch', 'push']) {
    assert.ok(t.includes(`${canale} git-server ${azione} "/home/user/filo-security"`), `git-server ${azione}, barre in avanti e percorso assoluto`);
  }
  assert.ok(t.includes(`${canale} ramo-server`));
  // #1233: l'aiutante di credenziali lo blocca il controllo dei permessi della sessione, e git fuori da git-server non ha il token.
  assert.ok(!/credential\.|git-credenziali|--global/.test(t), 'niente aiutanti né configurazione di credenziali');
  assert.ok(!/git (-C "[^"]+" )?(clone|fetch|push|pull|ls-remote)\b/.test(t), 'nessun git di rete fuori da git-server');
  assert.match(t, /messaggio esatto/, 'un blocco del controllo dei permessi si riporta parola per parola');
});

test('token negato: ogni ruolo trova la sua strada nel testo che riceve, e chi verifica non passa senza il server', () => {
  const server = testoLavoroServer({ clone: '/home/user/filo-security' });
  // Chi verifica consegna uno stato solo per attacco o spam (#1358): ogni altro gli sarebbe rifiutato.
  const verifica = `${readRoleInstructions('verifier', { scope: 'pieno' })}\n\n${server}`;
  const stati = [...verifica.matchAll(/deliver status --status (\S+)/g)].map((m) => m[1]);
  assert.ok(stati.length > 0 && stati.every((s) => s === 'attack' || s === 'spam'), `al verificatore solo attacco o spam: ${stati.join(', ')}`);
  // Un no al token è un guasto per tutti (#1226.1): chi verifica non passa senza il server, e nessuno lo rimanda al PC.
  assert.match(server, /per qualunque ruolo è un guasto da dichiarare[^]*Chi verifica non passa il lavoro guardando solo l'app/);
  assert.doesNotMatch(server, /rimanda la pratica in locale|lavorarlo in locale/);
  const sezioni = [...server.matchAll(/sezione «([^»]+)»/g)].map((m) => m[1]);
  assert.ok(sezioni.length > 0);
  for (const role of ['new-work', 'fixer']) {
    const t = `${readRoleInstructions(role)}\n\n${server}`;
    for (const titolo of sezioni) assert.ok(t.includes(`## ${titolo}`), `${role} riceve la sezione «${titolo}»`);
  }
});

test('la busta del server passa il segno `lavoroServer` ai ruoli che lavorano, mai al controllo di sicurezza', () => {
  const busta = { payload: { feedback: { text: 'x' }, lavoroServer: { repo: 'sathyaram1/filo-security' } } };
  for (const role of ['new-work', 'fixer', 'verifier']) {
    assert.deepEqual(serverCtx({ role }, busta).lavoroServer, { repo: 'sathyaram1/filo-security' }, role);
  }
  assert.equal(serverCtx({ role: 'verifier' }, { payload: { feedback: { text: 'x' } } }).lavoroServer, undefined);
  assert.equal(serverCtx({ role: 'secaudit' }, busta).lavoroServer, undefined);
});

test('una sessione partita sopra i cloni: il preflight manda l’orchestratore nella radice di Filo (#1761)', () => {
  const sopra = resolve('/home/user');
  const filo = join(sopra, 'Filo');
  const riga = rigaCartellaDiPartenza(sopra, filo);
  assert.ok(riga.includes(`cd "${filo.split('\\').join('/')}"`), riga);
  for (const cwd of [filo, join(filo, 'scripts'), '']) assert.equal(rigaCartellaDiPartenza(cwd, filo), '', cwd);
  const src = readFileSync(join(REPO, 'scripts', 'dispatch.mjs'), 'utf8');
  assert.match(src, /rigaCartellaDiPartenza\(process\.cwd\(\), ROOT\)[^]*Le tue istruzioni/, 'la riga esce prima delle istruzioni');
});

test('il comando del compito programmato trova dispatch sopra i cloni e dentro Filo, qualunque nome abbia la cartella', { skip: process.platform === 'win32' && 'il comando gira nella shell della cloud' }, () => {
  const spec = readFileSync(join(REPO, 'ROUTINE-AUTH-SPEC.md'), 'utf8');
  const comando = (spec.match(/^\s*(node "\$\(ls -d [^\n]*--preflight)\s*$/m) || [])[1];
  assert.ok(comando, 'il comando sta in ROUTINE-AUTH-SPEC.md § 14');
  const sopra = cartellaTemporanea('filo-sopra-i-cloni-');
  try {
    const filo = join(sopra, 'un nome qualunque');
    mkdirSync(join(filo, 'scripts'), { recursive: true });
    mkdirSync(join(sopra, 'filo-security', 'functions'), { recursive: true });
    const finto = join(filo, 'scripts', 'dispatch.mjs');
    writeFileSync(finto, "import { realpathSync } from 'node:fs';\nconsole.log(JSON.stringify([realpathSync(process.argv[1]), ...process.argv.slice(2)]));\n");
    for (const cwd of [sopra, filo]) {
      const out = execFileSync('bash', ['-c', comando], { cwd, encoding: 'utf8' });
      assert.deepEqual(JSON.parse(out), [realpathSync(finto), '--preflight'], cwd);
    }
  } finally {
    togliCartella(sopra);
  }
});
