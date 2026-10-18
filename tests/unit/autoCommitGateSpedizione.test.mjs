// Le prove degli agganci di salvataggio stanno in più file perché girino in parallelo (#1063): la scena comune
// e il racconto della regola sono in tests/helpers/scenaHook.mjs e in tests/unit/autoCommitGate.test.mjs.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ROOT, HOOKS, git, scene, runHook, runHookStderr, runHookRaw, rigaJson, LIMITE, shaOf, filesOnMain, commitFile,
} from '../helpers/scenaHook.mjs';

// ─── La spedizione non tace (giro del 14/09/2026) ────────────────────────────
//
// Il push era `>/dev/null 2>&1 || true`: dopo un rebase git lo rifiutava e
// l'hook non diceva niente. Il ramo su origin restava vecchio e il cancello del
// server rileggeva lo stesso conflitto all'infinito.

describe('la spedizione non tace: storia divergente e push fallito', () => {
  test('storia riscritta da un rebase: il ramo arriva comunque su origin (--force-with-lease)', () => {
    const { work } = scene();
    git(work, ['checkout', '-q', '-b', 'claude/rebase']);
    // Il ramo era già su origin con un commit A…
    commitFile(work, 'a.js');
    git(work, ['push', '-q', 'origin', 'claude/rebase']);
    const a = shaOf(work, 'claude/rebase');
    // …poi la storia locale viene riscritta: A sparisce, al suo posto un
    // commit nuovo (è la forma di un rebase). Origin ha A, la copia locale no.
    git(work, ['reset', '-q', '--hard', 'HEAD~1']);
    writeFileSync(resolve(work, 'b.js'), 'dopo il rebase\n', 'utf8');

    const stderr = runHookStderr(work);

    git(work, ['fetch', '-q', 'origin', 'claude/rebase']);
    assert.notEqual(shaOf(work, 'claude/rebase'), a);
    assert.equal(shaOf(work, 'origin/claude/rebase'), shaOf(work, 'claude/rebase'),
      'dopo un rebase il ramo su origin deve essere quello riscritto, non quello vecchio: altrimenti il cancello rilegge lo stesso conflitto per sempre');
    assert.ok(git(work, ['ls-tree', '-r', '--name-only', 'origin/claude/rebase']).includes('b.js'));
    assert.doesNotMatch(stderr, /NON e' arrivato/, 'nessun allarme quando la spedizione riesce');
  });

  test('qualcun altro ha spinto nel frattempo: il lease rifiuta, e l\'hook lo dice', () => {
    const { base, origin, work } = scene();
    git(work, ['checkout', '-q', '-b', 'claude/conteso']);
    commitFile(work, 'a.js');
    git(work, ['push', '-q', 'origin', 'claude/conteso']);
    // Un'altra copia spinge B sopra A: la copia locale non lo sa (origin/… è fermo ad A).
    const altro = resolve(base, 'altro');
    git(base, ['clone', '-q', origin, altro]);
    git(altro, ['checkout', '-q', 'claude/conteso']);
    commitFile(altro, 'di-un-altro.js');
    git(altro, ['push', '-q', 'origin', 'claude/conteso']);
    const b = git(altro, ['rev-parse', 'HEAD']);
    // Intanto qui la storia viene riscritta.
    git(work, ['reset', '-q', '--hard', 'HEAD~1']);
    writeFileSync(resolve(work, 'c.js'), 'riscritto\n', 'utf8');

    const stderr = runHookStderr(work);

    assert.equal(git(work, ['ls-remote', origin, 'refs/heads/claude/conteso']).split(/\s/)[0], b,
      'il lavoro di un altro non deve essere sovrascritto: il lease è contro il ref conosciuto, e qui non combacia');
    assert.match(stderr, /claude\/conteso.*NON e' arrivato su origin/, 'un push che non arriva si dice, non si tace');
    assert.match(stderr, /force-with-lease/);
  });

  test('origin irraggiungibile: il commit resta come paracadute e la riga di log c\'è, col motivo di git', () => {
    const { work } = scene();
    git(work, ['checkout', '-q', '-b', 'claude/isolato']);
    git(work, ['remote', 'set-url', 'origin', resolve(work, 'non-esiste.git')]);
    writeFileSync(resolve(work, 'lavoro.js'), 'x\n', 'utf8');

    const stderr = runHookStderr(work);

    assert.equal(git(work, ['status', '--porcelain']), '', 'il salvataggio locale resta');
    assert.match(stderr, /'claude\/isolato' NON e' arrivato su origin: .+/, 'una riga con il ramo e il motivo di git');
    assert.match(stderr, /non-esiste|does not appear|repository/i, 'il motivo è quello di git, non una frase generica');
  });

  // Claude Code manda stderr di un hook uscito con 0 al solo registro di
  // debug: la riga qui sopra la sessione non la vede (giro del 14/09,
  // verifica). L'unico canale da un hook PostToolUse alla sessione è un JSON
  // su stdout con additionalContext: è lì che il fallimento deve arrivare.
  test('un push fallito arriva alla SESSIONE: JSON su stdout con additionalContext, uscita 0', () => {
    const { work } = scene();
    git(work, ['checkout', '-q', '-b', 'claude/isolato-2']);
    git(work, ['remote', 'set-url', 'origin', resolve(work, 'non-esiste.git')]);
    writeFileSync(resolve(work, 'lavoro.js'), 'x\n', 'utf8');

    const r = runHookRaw(work, JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Write' }));

    assert.equal(r.status, 0, 'l\'hook non fallisce mai per contratto');
    const righe = String(r.stdout || '').split(/\r?\n/).filter((l) => l.trim().startsWith('{'));
    assert.equal(righe.length, 1, `una riga JSON su stdout, trovato: «${r.stdout}»`);
    const json = JSON.parse(righe[0]);
    assert.equal(json.hookSpecificOutput.hookEventName, 'PostToolUse', 'il nome dell\'evento è quello letto da stdin');
    assert.match(json.hookSpecificOutput.additionalContext, /claude\/isolato-2.*NON e' arrivato su origin/);
    assert.match(json.hookSpecificOutput.additionalContext, /non-esiste|does not appear|repository/i, 'col motivo di git');
    assert.match(json.hookSpecificOutput.additionalContext, /committato in locale ma NON e' su origin/, 'e con quello che c\'è da fare');
    assert.match(String(r.stderr || ''), /NON e' arrivato su origin/, 'la riga su stderr resta, per il registro di debug');
  });

  test('senza stdin (lanciato a mano) l\'evento è PostToolUse; quando la spedizione riesce stdout resta vuoto', () => {
    const { work } = scene();
    git(work, ['checkout', '-q', '-b', 'claude/liscio']);
    writeFileSync(resolve(work, 'lavoro.js'), 'x\n', 'utf8');
    const ok = runHookRaw(work, '');
    assert.equal(ok.status, 0);
    assert.equal(String(ok.stdout || '').trim(), '', 'niente contesto a ogni salvataggio andato bene');

    git(work, ['remote', 'set-url', 'origin', resolve(work, 'non-esiste.git')]);
    writeFileSync(resolve(work, 'altro.js'), 'y\n', 'utf8');
    const ko = runHookRaw(work, '');
    const json = JSON.parse(String(ko.stdout || '').split(/\r?\n/).find((l) => l.trim().startsWith('{')));
    assert.equal(json.hookSpecificOutput.hookEventName, 'PostToolUse');
  });
});

// ─── Giro 2 della verifica (16/09/2026): il lease dopo un fetch ─────────────
describe('il rinvio dopo un rebase non calpesta il lavoro degli altri nemmeno dopo un fetch', () => {
  test('un altro ha spinto e questa copia lo ha scaricato con un fetch: il rinvio viene rifiutato e origin resta suo', () => {
    const { base, origin, work } = scene();
    git(work, ['checkout', '-q', '-b', 'claude/fetch']);
    commitFile(work, 'a.js');
    git(work, ['push', '-q', 'origin', 'claude/fetch']);
    const altro = resolve(base, 'altro');
    git(base, ['clone', '-q', origin, altro]);
    git(altro, ['checkout', '-q', 'claude/fetch']);
    commitFile(altro, 'di-un-altro.js');
    git(altro, ['push', '-q', 'origin', 'claude/fetch']);
    const b = git(altro, ['rev-parse', 'HEAD']);
    // Il fetch porta origin/claude/fetch al commit dell'altro: un lease «nudo» combacerebbe.
    git(work, ['fetch', '-q', 'origin']);
    git(work, ['reset', '-q', '--hard', 'HEAD~1']);
    writeFileSync(resolve(work, 'c.js'), 'riscritto\n', 'utf8');

    const stderr = runHookStderr(work);

    assert.equal(git(work, ['ls-remote', origin, 'refs/heads/claude/fetch']).split(/\s/)[0], b,
      'il commit dell\'altro deve restare su origin anche se questa copia lo aveva già scaricato');
    assert.match(stderr, /claude\/fetch.*NON e' arrivato su origin/);
  });
});
