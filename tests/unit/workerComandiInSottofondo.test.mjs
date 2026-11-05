// Il «primo piano» è del lancio del worker, non dei suoi comandi (#1914): il ruolo gli chiede finish:check in sottofondo,
// e un prompt che glielo vietasse metterebbe due regole che non si rispettano insieme.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RADICE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const leggi = (...p) => readFileSync(join(RADICE, ...p), 'utf8').replace(/\r\n/g, '\n');
const una = (s) => s.replace(/\s+/g, ' ');
const { readRoleInstructions } = await import('../../scripts/dispatch.mjs');

test('ogni worker sa dalla sua definizione che i comandi lunghi vanno in sottofondo, qualunque cosa dica il prompt', () => {
  for (const nome of ['routine-worker', 'routine-nuovo-lavoro', 'routine-secaudit']) {
    const corpo = una(leggi('.claude', 'agents', `${nome}.md`).split(/^---$/m).slice(2).join('---'));
    assert.match(corpo, /quelli lunghi in sottofondo, anche se il prompt dice altro/, nome);
    assert.match(corpo, /il «primo piano» vale per il tuo lancio, non per i tuoi comandi/, nome);
  }
});

test('chi lancia il worker tiene il primo piano per sé: nel prompt minimo non c’è', () => {
  for (const [file, inizio] of [['orchestrator.md', 'Prompt del worker (minimo):'], ['sessione.md', 'Prompt minimo:']]) {
    const testo = leggi('routines', 'roles', file);
    const da = testo.indexOf(inizio);
    assert.ok(da >= 0, `${file}: il prompt minimo c’è ancora`);
    const prompt = testo.slice(da, testo.indexOf('\n\n', da));
    assert.doesNotMatch(prompt, /sottofondo|run_in_background|primo piano/i, file);
    assert.match(una(testo), /mai `run_in_background`[.:] È una regola del tuo lancio[^.]*nel prompt non va|mai `run_in_background`: è una regola del tuo lancio e nel prompt non va/, file);
  }
});

test('il contratto dei worker chiede i comandi lunghi in sottofondo, finish:check compreso', () => {
  const contratto = leggi('routines', 'roles', '_contratto-worker.md');
  const sezione = contratto.slice(contratto.indexOf('## Comandi lunghi'), contratto.indexOf('\n## ', contratto.indexOf('## Comandi lunghi') + 3));
  assert.match(sezione, /va in \*\*sottofondo\*\*/);
  assert.match(sezione, /npm run finish:check/);
});

// In cloud un'attesa scritta nella shell (#1685) e un file scritto da un interprete o da un heredoc (#1563) chiedono un
// permesso che nessuno approva, e il worker muore in silenzio: nessun testo che un agente riceve li propone, li nomina
// solo la regola che li vieta.
// `timeout N <comando>` sì, «(timeout 90 s)» no: è il parametro della chiamata Bash, che va bene.
const ATTESE = [/\bsleep\b/, /\btail\s+--pid/, /\buntil\b/, /\btimeout\s+\d+\s+(?:-|[a-z]{2,}\b)/];
const SCRITTURE = [/\b(?:python3?|perl|ruby)\s+(?:-\s*<<|-[cei]\b)/, /\bnode\s+-e\b/, /\bsed\s+-i\b/, /\bcat\s*>/, /<<-?\s*['"]?\w+['"]?\s*>/];
const REGOLA_ATTESE = /\*\*Mai un'attesa scritta da te nella shell\*\*[^]*?\n\n/;
const REGOLA_FILE = /## I file si scrivono con Edit e Write\n[^]*?(?=\n## )/;
const REGOLA_CLAUDE = /- \*\*Attese\.\*\*[^]*?(?=\n- )/;

function superfici() {
  const ruoli = join(RADICE, 'routines', 'roles');
  const agenti = join(RADICE, '.claude', 'agents');
  return [
    ...readdirSync(ruoli).filter((n) => n.endsWith('.md')).map((n) => [n, leggi('routines', 'roles', n)]),
    // La testa degli agenti sono i ganci, eseguiti dall'harness e non proposti al modello.
    ...readdirSync(agenti).filter((n) => n.endsWith('.md')).map((n) => [`agente ${n}`, leggi('.claude', 'agents', n).split(/^---$/m).slice(2).join('---')]),
    ['CLAUDE.md', leggi('CLAUDE.md')],
  ];
}

test('nessun testo per gli agenti propone un’attesa nella shell o un file scritto dalla shell: li nomina solo la regola', () => {
  const fuori = [];
  for (const [nome, t] of superfici()) {
    const resto = t.replace(REGOLA_ATTESE, '').replace(REGOLA_FILE, '').replace(REGOLA_CLAUDE, '');
    for (const re of [...ATTESE, ...SCRITTURE]) {
      const m = new RegExp(re.source, 'g').exec(resto);
      if (m) fuori.push(`${nome}: …${resto.slice(Math.max(0, m.index - 40), m.index + 40).replace(/\s+/g, ' ')}…`);
    }
  }
  assert.deepEqual(fuori, []);
  // La sentinella vede le due forme che hanno fermato i worker, e lascia stare i testi passati al canale.
  const comando1685 = "timeout 235 bash -c 'until [ $(grep -c x finish.log) -eq 0 ]; do sleep 15; done'";
  assert.ok(ATTESE.some((re) => re.test(comando1685)));
  assert.ok(ATTESE.some((re) => re.test('`timeout 240 tail --pid=<pid> -f /dev/null`')));
  assert.ok(ATTESE.some((re) => re.test('`timeout 240 node scripts/x.mjs`')), 'il tetto in un comando');
  assert.ok(SCRITTURE.some((re) => re.test("python3 - <<'EOF'\ns=open(p).read()\nEOF")));
  assert.ok(SCRITTURE.some((re) => re.test("cat <<'EOF' > ../domanda.json")));
  assert.ok(!SCRITTURE.some((re) => re.test("node scripts/routine-channel.mjs segnala <<'FINE'")));
});

test('ogni worker riceve le due regole: l’attesa è l’avviso di fine o Monitor, i file si toccano con Edit e Write', () => {
  for (const ruolo of ['new-work', 'fixer', 'verifier', 'secaudit', 'risposta', 'smistamento', 'compito', 'manutentore']) {
    const t = readRoleInstructions(ruolo);
    const lunghi = una(t.slice(t.indexOf('## Comandi lunghi'), t.indexOf('\n## ', t.indexOf('## Comandi lunghi') + 3)));
    assert.match(lunghi, /`run_in_background` della chiamata Bash/, ruolo);
    assert.match(lunghi, /strumento Monitor/, ruolo);
    assert.match(lunghi, /Non chiudere il turno per aspettare/, ruolo);
    assert.match(lunghi, /`node \S*scripts\/routine-channel\.mjs aspetta <biglietto>`/, ruolo);
    assert.match(lunghi, /\*\*Mai un'attesa scritta da te nella shell\*\*: `sleep`, un ciclo `until`/, ruolo);
    const file = una((REGOLA_FILE.exec(t) || [''])[0]);
    assert.match(file, /si crea con Write e si modifica con Edit/, ruolo);
    for (const vietato of ['`python3`', '`node -e`', '`perl`', 'heredoc che scrive']) assert.ok(file.includes(vietato), `${ruolo}: ${vietato}`);
  }
});
