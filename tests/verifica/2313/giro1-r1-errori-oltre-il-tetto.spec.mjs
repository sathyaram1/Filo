// #2313 giro 1: con molti rossi e molti commit dopo l'ultima suite verde, il feedback della suite rossa deve portare
// almeno l'errore del primo rosso. Rifà il passo dell'avviso di suite.yml con due script finti e il tetto vero del server.
import { test, expect } from '@playwright/test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function passoAvviso() {
  const righe = readFileSync(join(ROOT, '.github', 'workflows', 'suite.yml'), 'utf8').split('\n');
  const nome = righe.findIndex((r) => r.includes('- name: Suite rossa su main - apri un feedback'));
  const run = righe.findIndex((r, i) => i > nome && /^\s+run: \|\s*$/.test(r));
  const rientro = righe[run + 1].match(/^ */)[0].length;
  const corpo = [];
  for (const r of righe.slice(run + 1)) {
    if (r.trim() && r.match(/^ */)[0].length < rientro) break;
    corpo.push(r.slice(rientro));
  }
  return corpo.join('\n');
}

test('r1 con sessanta rossi e quaranta commit il feedback porta l\'errore del primo rosso', async () => {
  const { testoErrori } = await import(pathToFileURL(join(ROOT, 'scripts', 'suite-verdict.mjs')).href);
  const { testoEntroIlTetto } = await import(pathToFileURL(join(ROOT, 'scripts', 'build-alarm.mjs')).href);
  const dir = cartellaTemporanea('verifica-2313-');
  mkdirSync(join(dir, 'scripts'));
  mkdirSync(join(dir, 'esiti-suite'));
  writeFileSync(join(dir, 'scripts', 'ultima-suite-verde.mjs'), 'console.log(process.env.VERDE_FINTO || "");\n');
  writeFileSync(join(dir, 'scripts', 'build-alarm.mjs'),
    'import { writeFileSync } from "node:fs";\nwriteFileSync("testo-spedito.txt", process.argv[3]);\n');

  const git = (...a) => execFileSync('git', ['-c', 'user.email=v@v', '-c', 'user.name=v', ...a], { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q', '.');
  git('commit', '-q', '--allow-empty', '-m', 'ultima suite verde');
  const verde = git('rev-parse', 'HEAD');
  for (let i = 1; i <= 40; i++) git('commit', '-q', '--allow-empty', '-m', `worker: la voce ${i} del menu del tasto destro si apre anche dalla scorciatoia (#22${i})`);

  // Un aiuto condiviso rotto: sessanta spec veri, tutti rossi con lo stesso errore.
  const specs = readdirSync(join(ROOT, 'tests')).filter((f) => f.endsWith('.spec.mjs')).slice(0, 60);
  const nuovi = specs.map((f) => ({
    spec: f.replace(/\.spec\.mjs$/, ''), titolo: 'si apre e mostra il suo contenuto', titoloCompleto: 'Apertura › si apre e mostra il suo contenuto',
    errore: `in tests/fixtures/electron.mjs:212\nError: page.waitForSelector: Timeout 15000ms exceeded.\nCall log:\n  - waiting for locator('#barra-schede') to be visible`,
  }));
  writeFileSync(join(dir, 'esiti-suite', 'rossi-nuovi.txt'), `${nuovi.map((c) => `tests/${c.spec}.spec.mjs › ${c.titoloCompleto}`).join('\n')}\n`);
  writeFileSync(join(dir, 'esiti-suite', 'rossi-errori.txt'), `${testoErrori(nuovi)}\n`);
  writeFileSync(join(dir, 'esiti-suite', 'chiavi-allarme.txt'), 'suite:tests/a.spec.mjs\n');
  writeFileSync(join(dir, 'esiti-suite', 'verdetto.log'), 'Rossi NUOVI: 60\n');
  writeFileSync(join(dir, 'esiti-suite', 'suite-risultati.json'), '{}');
  writeFileSync(join(dir, 'avviso.sh'), passoAvviso());

  execFileSync('bash', ['avviso.sh'], {
    cwd: dir,
    env: {
      ...process.env,
      VERDE_FINTO: verde, PARTI_ESITO: 'success', COMMIT_PROVATO: git('rev-parse', 'HEAD'),
      ESECUZIONE: 'https://github.com/sathyaram1/Filo/actions/runs/123456789',
      REGISTRI_DALLA_CLOUD: 'i registri dei lavori si leggono con gh api repos/sathyaram1/Filo/actions/runs/123456789/jobs e gh api repos/sathyaram1/Filo/actions/jobs/<id>/logs.',
    },
  });
  const spedito = testoEntroIlTetto(readFileSync(join(dir, 'testo-spedito.txt'), 'utf8'));
  expect(spedito).toContain("waiting for locator('#barra-schede') to be visible");
});
