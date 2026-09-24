// Verifica locale del lavoro «#661», primo giro — il cammino intero.
//
// Qui non si chiamano funzioni: si lancia lo strumento come lo lancia chi
// verifica. Apre il giro, registra una critica che promuove il lavoro con un
// rilievo messo da parte (il bilancio di quel livello è a zero), segna la
// prova del giro come rossa attesa, la committa, e chiede al cancello se si
// può ancora pubblicare. È la lamentela, rifatta dall'inizio.
//
// I bilanci del giro lo strumento li chiede al server: qui risponde un server
// finto, in un processo a parte (lo strumento gira con execFileSync, che
// blocca il processo che lo lancia: un server nello stesso processo non
// risponderebbe mai).
import { test, expect } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(process.cwd());
const VERIFY_LOCAL = join(ROOT, 'scripts', 'verify-local.mjs');

const PROVA = `import { test, expect } from '@playwright/test';

test('il bordo del riquadro è caldo', async () => {
  expect('grigio').toBe('caldo');
});
`;
const SPEC = 'tests/verifica/locale-prova/giro1-bordo.spec.mjs';

const SERVER = `import { createServer } from 'node:http';
const srv = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ fields: { cap3: { integerValue: '1' }, cap2: { integerValue: '1' }, cap1: { integerValue: '0' }, cap0: { integerValue: '0' } } }));
});
srv.listen(0, '127.0.0.1', () => { console.log('PORTA ' + srv.address().port); });
`;

test('il verdetto locale sopravvive al commit dei rossi attesi', async () => {
  test.setTimeout(120_000);
  const dir = cartellaTemporanea('verifica-661-cli-');
  const git = (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  mkdirSync(join(dir, 'tests', 'verifica', 'locale-prova'), { recursive: true });
  mkdirSync(join(dir, 'src'), { recursive: true });
  git(['init', '-q', '-b', 'claude/prova']);
  git(['config', 'user.email', 'prova@filo.test']);
  git(['config', 'user.name', 'prova']);
  // `.claude/` è ignorato come nel repo vero; il server finto vive qui accanto
  // ma non è roba del progetto, e una directory sporca fermerebbe la critica.
  writeFileSync(join(dir, '.gitignore'), '.claude/\nserver-bilanci.mjs\n');
  writeFileSync(join(dir, SPEC), PROVA);
  writeFileSync(join(dir, 'src', 'riquadro.js'), 'const bordo = 1;\n');
  git(['add', '-A']);
  git(['commit', '-qm', 'lavoro e prove del giro']);

  writeFileSync(join(dir, 'server-bilanci.mjs'), SERVER);
  const server = spawn(process.execPath, [join(dir, 'server-bilanci.mjs')], { stdio: ['ignore', 'pipe', 'ignore'] });
  const porta = await new Promise((ok, no) => {
    const t = setTimeout(() => no(new Error('il server dei bilanci non è partito')), 20_000);
    server.stdout.on('data', (b) => {
      const m = String(b).match(/PORTA (\d+)/);
      if (m) { clearTimeout(t); ok(m[1]); }
    });
  });

  const env = {
    ...process.env,
    FILO_REPO_ROOT: dir,
    FILO_ROUTINE_CONFIG_URL: `http://127.0.0.1:${porta}/config/routines`,
    FILO_ADMIN_ID_TOKEN: 'finto-per-la-prova',
    // Il server finto è qui accanto: nessun proxy di mezzo.
    NO_PROXY: '*', no_proxy: '*', HTTP_PROXY: '', HTTPS_PROXY: '', http_proxy: '', https_proxy: '',
  };
  const lancia = (args) => {
    try { return { code: 0, out: execFileSync(process.execPath, [VERIFY_LOCAL, ...args], { cwd: dir, encoding: 'utf8', env }) }; }
    catch (e) { return { code: e.status, out: `${e.stdout || ''}${e.stderr || ''}` }; }
  };

  try {
    expect(lancia(['start', 'rendi caldo il bordo del riquadro']).code).toBe(0);
    const critica = lancia(['critica', 'Provato il cammino principale, i casi limite e i due temi: la cosa chiesta si ottiene. Resta un dettaglio estetico fuori dal cammino principale.\n[0] Il bordo del riquadro resta grigio in un caso raro.']);
    expect(critica.code).toBe(0);
    expect(critica.out).toContain('Si può pubblicare');
    // Chi verifica deve sapere che la prova rimasta rossa va segnata, e come.
    expect(critica.out).toContain('test.fail(true,');

    // Il marcatore, e il commit che sposta la punta del ramo.
    writeFileSync(join(dir, SPEC), PROVA.replace(
      "test('il bordo del riquadro è caldo', async () => {",
      "test('il bordo del riquadro è caldo', async () => {\n  test.fail(true, 'bordo grigio in un caso raro: rilievo messo da parte');",
    ));
    git(['add', '-A']);
    git(['commit', '-qm', 'verifica: rossi attesi']);

    const dopo = lancia(['status']);
    expect(dopo.code, dopo.out).toBe(0);
    expect(dopo.out).toContain('verifica superata');
  } finally {
    server.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('le prove del giro restano fra gli spec che la chiusura rilancia', async () => {
  // L'altra metà della promessa: una prova del giro rimasta rossa SENZA
  // marcatore deve continuare a fermare la chiusura, e può farlo solo se la
  // chiusura quelle prove le lancia davvero.
  const { specsForChangedFiles } = await import('../../../scripts/finish-local.mjs');
  const cambiati = ['tests/verifica/661/giro1-verdetto-e-marcatori.spec.mjs', 'scripts/verify-local.mjs'];
  const tracciati = ['tests/verifica/661/giro1-verdetto-e-marcatori.spec.mjs'];
  expect(specsForChangedFiles(cambiati, tracciati)).toContain('tests/verifica/661/giro1-verdetto-e-marcatori');
});
