// Una sessione partita sopra i cloni (routine con più repository) non legge le impostazioni di Filo: il preflight porta i
// ganci del progetto in quelle dell'utente, e ognuno tace dove il progetto della sessione lo ha già (#1967).

import '../helpers/senzaSessione.mjs';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { ROOT as RADICE, git, scene, togliScene, clone, remoto, stdinEdit } from '../helpers/scenaHook.mjs';

const { ganciDelProgetto, comandoFissato, unisciGanci, ETICHETTA_GANCI, FILE_IMPOSTAZIONI } = await import('../../scripts/lib/ganci-del-progetto.mjs');
const { installa, ETICHETTA } = await import('../../scripts/lib/orchestratore-cieco.mjs');

const cartelle = [];
after(() => { togliScene(); for (const d of cartelle.splice(0)) togliCartella(d); });
const temporanea = (p) => { const d = cartellaTemporanea(p); cartelle.push(d); return d; };
// Come Claude Code legge un matcher: fatto solo di nomi e barre è un elenco esatto, altrimenti una regex.
const combacia = (matcher, nome) => (!matcher || matcher === '*' ? true
  : /^[A-Za-z0-9_|]+$/.test(matcher) ? matcher.split('|').includes(nome) : new RegExp(matcher).test(nome));
const riportati = (hooks, ev) => (hooks[ev] || []).filter((g) => g.hooks.some((h) => h.command.includes(ETICHETTA_GANCI)));
// Il gancio gira come lo lancia Claude Code: una shell, la cartella della sessione e CLAUDE_PROJECT_DIR sulla cartella di partenza.
function lancia(comando, { partenza, input = '' }) {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: partenza };
  delete env.FILO_ROUTINE;
  return spawnSync('sh', ['-c', comando], { cwd: partenza, env, input, encoding: 'utf8' });
}
function checkoutConImpostazioni() {
  const s = scene();
  for (const f of FILE_IMPOSTAZIONI) copyFileSync(join(RADICE, '.claude', f), join(s.work, '.claude', f));
  return s;
}
function ganciInstallati(progetto) {
  const dir = temporanea('filo-ganci-utente-');
  assert.equal(installa({ dir, sessione: 's1', creato: Date.now(), progetto }).ok, true);
  return JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')).hooks;
}
const salvataggio = (hooks) => riportati(hooks, 'PostToolUse')
  .filter((g) => combacia(g.matcher, 'Edit'))
  .flatMap((g) => g.hooks.map((h) => h.command))
  .find((c) => c.includes('auto-commit-merge.sh'));

test('sessione partita sopra i cloni: l\'Edit del worker nel suo clone finisce in un commit spedito', () => {
  const { base, origin, work } = checkoutConImpostazioni();
  const comando = salvataggio(ganciInstallati(work));
  assert.ok(comando, 'il salvataggio è fra i ganci che il preflight porta nelle impostazioni utente');
  const lavoro = clone(origin, base, 'lavori-1', 'worker/1967');
  const prima = git(lavoro, ['rev-parse', 'HEAD']);
  writeFileSync(resolve(lavoro, 'a.js'), 'a\n', 'utf8');

  const r = lancia(comando, { partenza: base, input: stdinEdit(resolve(lavoro, 'a.js'), { cwd: base }) });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(git(lavoro, ['status', '--porcelain']), '', 'niente resta fuori dai commit');
  assert.notEqual(git(lavoro, ['rev-parse', 'HEAD']), prima);
  assert.equal(git(lavoro, ['log', '-1', '--format=%s']), 'auto: a.js');
  assert.equal(remoto(lavoro, 'worker/1967'), git(lavoro, ['rev-parse', 'HEAD']), 'il ramo del worker è su origin');
});

test('sessione partita dentro il checkout: il gancio riportato tace e salva solo quello del progetto, una volta', () => {
  const { base, origin, work } = checkoutConImpostazioni();
  const comando = salvataggio(ganciInstallati(work));
  const lavoro = clone(origin, base, 'lavori-1', 'worker/1967');
  const prima = git(lavoro, ['rev-parse', 'HEAD']);
  writeFileSync(resolve(lavoro, 'a.js'), 'a\n', 'utf8');
  const input = stdinEdit(resolve(lavoro, 'a.js'), { cwd: work });

  assert.equal(lancia(comando, { partenza: work, input }).status, 0);
  assert.equal(git(lavoro, ['rev-parse', 'HEAD']), prima, 'il progetto della sessione ha già lo script: tocca al suo gancio');
  assert.notEqual(git(lavoro, ['status', '--porcelain']), '');

  const delProgetto = JSON.parse(readFileSync(join(work, '.claude', 'settings.local.json'), 'utf8')).hooks.PostToolUse
    .find((g) => combacia(g.matcher, 'Edit')).hooks[0].command;
  assert.equal(lancia(delProgetto, { partenza: work, input }).status, 0);
  assert.equal(git(lavoro, ['log', '-1', '--format=%s']), 'auto: a.js');
  assert.equal(git(lavoro, ['rev-list', '--count', `${prima}..HEAD`]), '1');
});

test('il gancio riportato passa stdin ed esito, e regge una cartella con spazi e apostrofi', () => {
  const sopra = temporanea('filo-ganci-esito-');
  const progetto = join(sopra, "con spazio e l'apostrofo");
  mkdirSync(join(progetto, '.claude', 'hooks'), { recursive: true });
  const segno = join(sopra, 'segno.txt');
  writeFileSync(join(progetto, '.claude', 'hooks', 'prova.sh'), `#!/bin/bash\n{ printf '%s\\n' "$CLAUDE_PROJECT_DIR"; cat; } > '${segno}'\nexit 2\n`, 'utf8');
  writeFileSync(join(progetto, '.claude', 'settings.local.json'), JSON.stringify({
    hooks: { PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'bash "$CLAUDE_PROJECT_DIR/.claude/hooks/prova.sh"', timeout: 7 }] }] },
  }));
  const { hooks, scartati } = ganciDelProgetto(progetto);
  assert.deepEqual(scartati, []);
  const [gruppo] = hooks.PostToolUse;
  assert.equal(gruppo.matcher, 'Bash');
  assert.equal(gruppo.hooks[0].timeout, 7);

  const r = lancia(gruppo.hooks[0].command, { partenza: sopra, input: '{"tool_name":"Bash"}' });
  assert.equal(r.status, 2, 'un gancio che blocca (exit 2) blocca anche riportato');
  const [dove, ...letto] = readFileSync(segno, 'utf8').split('\n');
  assert.equal(resolve(dove), progetto, 'il gancio vede la cartella del progetto (su Windows scritta con le barre normali)');
  assert.equal(letto.join('\n'), '{"tool_name":"Bash"}');

  togliCartella(segno);
  assert.equal(lancia(gruppo.hooks[0].command, { partenza: progetto }).status, 0);
  assert.equal(existsSync(segno), false);
});

test('ogni gancio del progetto si riporta: stessi eventi, matcher e timeout, nessuno scartato', () => {
  const { hooks, scartati } = ganciDelProgetto(RADICE);
  assert.deepEqual(scartati, [], 'un gancio senza `$CLAUDE_PROJECT_DIR/<script>` mancherebbe alle sessioni partite sopra i cloni');
  const attesi = {};
  for (const f of FILE_IMPOSTAZIONI) {
    const p = join(RADICE, '.claude', f);
    const s = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {};
    for (const [ev, gruppi] of Object.entries(s.hooks || {})) (attesi[ev] ||= []).push(...gruppi);
  }
  assert.ok((attesi.PostToolUse || []).length, 'il progetto ha i suoi ganci');
  assert.deepEqual(Object.keys(hooks).sort(), Object.keys(attesi).sort());
  for (const [ev, gruppi] of Object.entries(attesi)) {
    assert.deepEqual(hooks[ev].map((g) => g.matcher), gruppi.map((g) => g.matcher), ev);
    assert.deepEqual(hooks[ev].map((g) => g.hooks.map((h) => h.timeout)), gruppi.map((g) => g.hooks.map((h) => h.timeout)), ev);
  }
  assert.equal(comandoFissato('echo senza script', RADICE), '');
  assert.equal(comandoFissato('bash "$CLAUDE_PROJECT_DIR/x.sh"', ''), '');
});

test('installa: i ganci del progetto entrano con la cecità, una volta sola, e quelli tolti dal progetto se ne vanno', () => {
  const dir = temporanea('filo-ganci-utente-');
  const file = join(dir, 'settings.json');
  const mio = { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mio' }] };
  writeFileSync(file, JSON.stringify({ hooks: { PostToolUse: [mio] } }));
  const { work } = checkoutConImpostazioni();
  assert.equal(installa({ dir, sessione: 's1', progetto: work }).ok, true);
  assert.equal(installa({ dir, sessione: 's1', progetto: work }).ok, true);
  let hooks = JSON.parse(readFileSync(file, 'utf8')).hooks;
  const attesi = ganciDelProgetto(work).hooks;
  for (const ev of Object.keys(attesi)) assert.deepEqual(riportati(hooks, ev), attesi[ev], `${ev}: una volta sola dopo due installazioni`);
  assert.deepEqual(hooks.PostToolUse[0], mio, 'i ganci dell utente restano');
  for (const ev of ['PreToolUse', 'PostToolUse', 'ConfigChange']) {
    assert.equal(hooks[ev].filter((g) => g.hooks.some((h) => h.command.includes(ETICHETTA))).length, 1, `${ev}: la cecità c'è ancora`);
  }

  const ridotto = temporanea('filo-ganci-ridotto-');
  mkdirSync(join(ridotto, '.claude'));
  writeFileSync(join(ridotto, '.claude', 'settings.local.json'), JSON.stringify({
    hooks: { StopFailure: [{ hooks: [{ type: 'command', command: 'bash "$CLAUDE_PROJECT_DIR/.claude/hooks/cap-observe.sh"' }] }] },
  }));
  assert.equal(installa({ dir, sessione: 's1', progetto: ridotto }).ok, true);
  hooks = JSON.parse(readFileSync(file, 'utf8')).hooks;
  assert.equal(riportati(hooks, 'StopFailure').length, 1);
  for (const ev of ['SessionStart', 'SessionEnd', 'PostToolUse', 'PostToolUseFailure']) assert.deepEqual(riportati(hooks, ev), [], ev);
  assert.equal('SessionStart' in hooks, false, 'un evento rimasto vuoto se ne va');

  assert.equal(installa({ dir, sessione: 's1' }).ok, true);
  hooks = JSON.parse(readFileSync(file, 'utf8')).hooks;
  assert.deepEqual(Object.keys(hooks).flatMap((ev) => riportati(hooks, ev)), [], 'senza progetto non resta niente di riportato');
  assert.deepEqual(unisciGanci({ PostToolUse: [mio] }, {}), { PostToolUse: [mio] });
});

test('cablaggio: il preflight passa il checkout di Filo a chi installa la cecità', () => {
  const src = readFileSync(join(RADICE, 'scripts', 'dispatch.mjs'), 'utf8');
  assert.match(src, /installaCecita\(\{[^}]*progetto: ROOT/);
});
