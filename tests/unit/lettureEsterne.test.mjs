// Il gancio delle letture esterne (#1211): quali strumenti sporcano, il gancio con uno stdin finto, il cablaggio nelle
// impostazioni del progetto. Lo sporco annotato e la sua consegna stanno in biglietto.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TETTO_ATTESA_MS } from '../helpers/attese.mjs';
import { cartellaTemporanea, collegaCartella, togliCartella } from '../helpers/percorsi.mjs';
import * as B from '../../scripts/lib/biglietto-locale.mjs';
import * as L from '../../scripts/lib/letture-esterne.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GANCIO = join(ROOT, '.claude', 'hooks', 'letture-esterne.sh');
const SEGRETO = 'g'.repeat(43);
const FP = '7'.repeat(64);

const ctxPosix = { cwd: '/casa/Filo', win: false, cartelle: ['/casa/Filo', '/casa/filo-security'], file: ['/casa/LOCAL.md'], claude: ['/home/o/.claude'], sessione: 'sess-1' };
const leggi = (file_path, ctx = ctxPosix) => L.motivoLettura({ tool_name: 'Read', tool_input: { file_path } }, ctx);

test('classificatore: sporca ogni strumento tranne un elenco chiuso (shell, ricerche nel disco, scritture, sotto-agenti locali, compiti), anche uno nuovo (#1211.2)', () => {
  assert.equal(L.motivoLettura({ tool_name: 'WebFetch', tool_input: { url: 'https://esempio.it/a?chiave=segreta' } }), 'WebFetch (esempio.it)');
  assert.equal(L.motivoLettura({ tool_name: 'WebFetch', tool_input: { url: 'non un indirizzo' } }), 'WebFetch');
  // I cataloghi di estensioni, i messaggi fra sessioni, le uscite di un compito che può essere remoto, uno strumento
  // che oggi non esiste: nessuno li ha messi fra i puliti, quindi sporcano.
  for (const n of ['WebSearch', 'ListMcpResourcesTool', 'ReadMcpResourceTool', 'ReadMcpResourceDirTool', 'ArtifactComments', 'ArtifactData',
    'SearchPlugins', 'ListPlugins', 'SearchSkills', 'ListSkills', 'SearchMcpRegistry', 'ListConnectors', 'SuggestConnectors', 'SuggestSkills',
    'SuggestPluginInstall', 'DesignSync', 'ListAgents', 'SendMessage', 'TaskOutput', 'LSP', 'NotebookRead', 'StrumentoDiDomani']) {
    assert.equal(L.motivoLettura({ tool_name: n, tool_input: { query: 'x' } }), n);
  }
  assert.equal(L.motivoLettura({ tool_name: 'Nuovo\ncon\u0000a capo' }), 'Nuovo con a capo');
  for (const n of ['mcp__github__get_file_contents', 'mcp__claude-in-chrome__get_page_text', 'mcp__plugin_posta_gmail__search', 'mcp__computer-use__screenshot']) {
    assert.equal(L.motivoLettura({ tool_name: n, tool_input: {} }), n);
  }
  for (const n of L.MCP_SENZA_LETTURA) assert.equal(L.motivoLettura({ tool_name: n }), '', n);
  for (const n of [...L.STRUMENTI_SENZA_LETTURA, '', undefined]) {
    assert.equal(L.motivoLettura({ tool_name: n, tool_input: { file_path: '/etc/passwd', path: '/etc', url: 'https://x.it' } }, ctxPosix), '', String(n));
  }
  for (const n of ['Bash', 'PowerShell', 'Glob', 'Edit', 'Write', 'NotebookEdit', 'TodoWrite', 'TaskCreate', 'TaskUpdate']) assert.ok(L.STRUMENTI_SENZA_LETTURA.includes(n), n);
  // Le abilità e i comandi le decide il nome: quelli di un'estensione di terzi sporcano (#1867).
  for (const n of ['Skill', 'SlashCommand']) assert.ok(!L.STRUMENTI_SENZA_LETTURA.includes(n), n);
  // Grep con le righe porta dentro il testo dei file: lo decide il percorso, come Read (#1211.3).
  assert.ok(!L.STRUMENTI_SENZA_LETTURA.includes('Grep'));
  assert.equal(L.motivoLettura(null), '');
});

test('classificatore: un\'abilità o un comando dell\'owner non sporca, quelli di un\'estensione di terzi sì, come leggerne il file (#1867)', () => {
  const richiama = (tool_name, tool_input) => L.motivoLettura({ tool_name, tool_input }, ctxPosix);
  assert.equal(richiama('Skill', { skill: 'unslop' }), '');
  assert.equal(richiama('Skill', { skill: 'apps/web:deploy' }), "Skill da un'estensione (apps/web:deploy)");
  assert.equal(richiama('Skill', { skill: 'posta:leggi', args: 'x' }), "Skill da un'estensione (posta:leggi)");
  assert.equal(richiama('SlashCommand', { command: '/rilascia --subito' }), '');
  assert.equal(richiama('SlashCommand', { command: '/terzi:pubblica adesso' }), "SlashCommand da un'estensione (terzi:pubblica)");
  // La stessa abilità letta dal disco sporca già: le due strade danno lo stesso esito.
  assert.match(leggi('/home/o/.claude/plugins/cache/terzi/posta/1.0.0/skills/leggi/SKILL.md'), /cartella di Claude/);
  assert.equal(leggi('/home/o/.claude/skills/unslop/SKILL.md'), '');
  // Il cablaggio: il gancio parte anche per loro.
  assert.ok(new RegExp(L.matcherDelGancio()).test('Skill') && new RegExp(L.matcherDelGancio()).test('SlashCommand'));
});

test('classificatore: Grep con le righe nelle cartelle ammesse della cartella di Claude non sporca, come leggerne i file (#1867)', () => {
  const cerca = (path) => L.motivoLettura({ tool_name: 'Grep', tool_input: { pattern: 'x', path, output_mode: 'content' } }, ctxPosix);
  for (const p of ['/home/o/.claude/projects/-casa-Filo/memory', '/home/o/.claude/projects/-casa-Filo/memory/', '/home/o/.claude/skills',
    '/home/o/.claude/commands', '/home/o/.claude/agents', '/home/o/.claude/projects/-casa-Filo/sess-1']) {
    assert.equal(cerca(p), '', p);
  }
  for (const p of ['/home/o/.claude', '/home/o/.claude/projects', '/home/o/.claude/projects/-casa-Filo', '/home/o/.claude/projects/-casa-Filo/sess-2',
    '/home/o/.claude/plugins', '/home/o/.claude/todos']) {
    assert.match(cerca(p), /^Grep dalla cartella di Claude/, p);
  }
  // Read su una cartella resta com'era: non è un file da leggere.
  assert.match(leggi('/home/o/.claude/projects/-casa-Filo/memory'), /cartella di Claude/);
});

test('il salto veloce del gancio riconosce Grep con le righe con le stesse modalità del classificatore (#1867)', () => {
  const sh = readFileSync(GANCIO, 'utf8');
  const m = /^RE_RIGHE='"output_mode"\[\[:space:\]\]\*:\[\[:space:\]\]\*"(.*)"'$/m.exec(sh);
  assert.ok(m, 'RE_RIGHE nel gancio');
  const modi = m[1].replace(/^\(|\)$/g, '').split('|');
  assert.deepEqual(modi.sort(), [...L.GREP_MODI_CON_RIGHE].sort(), 'il gancio e il classificatore devono dire le stesse modalità');
});

test('classificatore: Grep con le righe di un file fuori dal repo sporca come Read; coi soli nomi o i conteggi no (#1211.3)', () => {
  const cerca = (tool_input, ctx = ctxPosix) => L.motivoLettura({ tool_name: 'Grep', tool_input: { pattern: 'fattura', ...tool_input } }, ctx);
  assert.equal(cerca({ path: '/casa/Scaricati/pagina.html', output_mode: 'content' }), 'Grep fuori dal repo (pagina.html)');
  assert.equal(cerca({ path: '/casa/Scaricati', output_mode: 'content', '-C': 3 }), 'Grep fuori dal repo (Scaricati)');
  assert.equal(cerca({ path: '../Scaricati', output_mode: 'content' }), 'Grep fuori dal repo (Scaricati)', 'relativo alla cartella della chiamata');
  assert.equal(cerca({ output_mode: 'content' }, { ...ctxPosix, cwd: '/casa/Scaricati' }), 'Grep fuori dal repo (Scaricati)', 'senza percorso cerca nella cartella della chiamata');
  assert.equal(cerca({ path: '/home/o/.claude/projects/x/altra.jsonl', output_mode: 'content' }), 'Grep dalla cartella di Claude (altra.jsonl)');
  // Le stesse condizioni di Read: il repo, il server accanto, LOCAL.md restano puliti.
  for (const path of ['/casa/Filo/src', '/casa/Filo/scripts/lib/x.mjs', '/casa/filo-security/functions', '/casa/LOCAL.md', undefined]) {
    assert.equal(cerca({ path, output_mode: 'content' }), '', String(path));
  }
  // Coi soli nomi dei file, o i conteggi: lo stesso esito di prima, pulito ovunque.
  for (const output_mode of [undefined, 'files_with_matches', 'count']) {
    assert.equal(cerca({ path: '/casa/Scaricati/pagina.html', output_mode }), '', String(output_mode));
  }
});

test('classificatore: «~» nel percorso è la cartella di casa, come per Read e Grep di Claude Code, mai il repo (#1867 giro 2)', () => {
  const casa = { ...ctxPosix, casa: '/home/o' };
  const cerca = (tool_input, ctx = casa) => L.motivoLettura({ tool_name: 'Grep', tool_input: { pattern: 'x', ...tool_input } }, ctx);
  assert.equal(cerca({ path: '~/Downloads/pagina.html', output_mode: 'content' }), 'Grep fuori dal repo (pagina.html)');
  assert.equal(leggi('~/Downloads/pagina.html', casa), 'Read fuori dal repo (pagina.html)');
  assert.equal(leggi('~/.claude/projects/x/altra.jsonl', casa), 'Read dalla cartella di Claude (altra.jsonl)');
  assert.equal(leggi('~', casa), 'Read fuori dal repo (o)');
  assert.equal(leggi('~/.claude/settings.json', casa), '', 'le parti ammesse restano pulite anche scritte così');
  assert.equal(cerca({ path: '~/.claude/projects/x/memory', output_mode: 'content' }), '');
  assert.equal(cerca({ path: '~/Downloads/pagina.html' }), '', 'coi soli nomi resta pulito');
  // Senza la cartella di casa nota il percorso non finisce mai nel repo.
  assert.equal(leggi('~/Downloads/pagina.html', ctxPosix), 'Read fuori dal repo (pagina.html)');
  // Un nome che comincia con la tilde senza la barra è un file del repo, come lo legge lo strumento.
  assert.equal(leggi('~bozza.md'), '');
  const win = { cwd: 'C:\\casa\\Filo', win: true, casa: 'C:\\Users\\o', cartelle: ['C:\\casa\\Filo'], file: [], claude: ['C:\\Users\\o\\.claude'], sessione: 's' };
  assert.equal(leggi('~\\Downloads\\pagina.html', win), 'Read fuori dal repo (pagina.html)');
  assert.equal(leggi('~/Downloads/pagina.html', win), 'Read fuori dal repo (pagina.html)');
});

test('contestoLettura porta la cartella di casa vera', () => {
  assert.equal(L.contestoLettura({ cwd: process.cwd(), env: {} }).casa, homedir());
});

test('classificatore: nella cartella di Claude solo impostazioni, abilità, comandi, CLAUDE.md, memoria e la storia della sessione stessa restano puliti (#1211.3)', () => {
  const ctx = { ...ctxPosix, cartelle: ['/casa/Filo', '/casa/filo-security'], claude: ['/home/o/.claude'], sessione: 'sess-1' };
  for (const f of ['settings.json', 'settings.local.json', 'keybindings.json', 'CLAUDE.md', 'skills/posta/SKILL.md', 'skills/posta/riferimenti/a.md',
    'commands/rilascia.md', 'agents/revisore.md', 'rules/stile.md', 'output-styles/breve.md', 'plans/piano-blu.md',
    'projects/-casa-Filo/memory/MEMORY.md', 'projects/-casa-Filo/memory/argomenti/git.md',
    'projects/-casa-Filo/sess-1.jsonl', 'projects/-casa-Filo/sess-1/tool-results/b1.txt', 'projects/-casa-Filo/sess-1/subagents/agent-a1.jsonl']) {
    assert.equal(leggi(`/home/o/.claude/${f}`, ctx), '', f);
  }
  // I resoconti delle altre sessioni, coi testi che hanno letto; i cataloghi e le cache delle estensioni di terzi; il resto.
  for (const f of ['projects/-casa-Filo/sess-2.jsonl', 'projects/-casa-Filo/sess-2/tool-results/b1.txt', 'projects/-casa-Filo/sess-2/subagents/agent-a1.jsonl',
    'projects/-casa-Altro/vecchia.jsonl', 'projects/-casa-Filo/memory', 'projects/-casa-Filo/sess-1', 'projects/sess-1.jsonl',
    'plugins/marketplaces/terzi/catalogo.json', 'plugins/cache/terzi/posta/1.0.0/skills/x/SKILL.md', 'plugins/known_marketplaces.json',
    'history.jsonl', 'todos/x.json', 'shell-snapshots/s.sh', 'statsig/cache', 'skills', 'settings.json.bak', 'mcp-needs-auth-cache.json']) {
    assert.match(leggi(`/home/o/.claude/${f}`, ctx), /^Read dalla cartella di Claude \(/, f);
  }
  // Senza sessione nota nessuna storia è sua.
  assert.match(leggi('/home/o/.claude/projects/-casa-Filo/sess-1.jsonl', { ...ctx, sessione: '' }), /cartella di Claude/);
  // Decide l'elenco anche se la cartella di Claude sta dentro una cartella fidata.
  assert.match(leggi('/casa/Filo/.claude-utente/projects/p/s.jsonl', { ...ctx, claude: ['/casa/Filo/.claude-utente'] }), /cartella di Claude/);
  // Su Windows maiuscole e barre non contano.
  const win = { cwd: 'C:\\Users\\agenti AI\\Desktop\\Filo\\Filo', win: true, cartelle: ['c:\\users\\agenti ai\\desktop\\filo\\filo'], file: [], claude: ['C:\\Users\\agenti AI\\.claude'], sessione: 'Sess-1' };
  assert.equal(leggi('c:\\users\\agenti ai\\.claude\\Settings.json', win), '');
  assert.equal(leggi('C:/Users/agenti AI/.claude/projects/C--x/memory/MEMORY.md', win), '');
  assert.equal(leggi('C:\\Users\\agenti AI\\.claude\\projects\\C--x\\sess-1.jsonl', win), '');
  assert.match(leggi('C:\\Users\\agenti AI\\.claude\\projects\\C--x\\altra.jsonl', win), /cartella di Claude/);
  assert.equal(L.ammessoInClaude('', {}), false);
  assert.equal(L.ammessoInClaude('projects/p/memory/', {}), false, 'la cartella della memoria in sé non è un file da leggere');
});

test('classificatore: la lista dei passi, il riassunto e i capitoli dell’app desktop non sporcano; le sue letture sì (#1252)', () => {
  const mcp = (tool_name) => L.motivoLettura({ tool_name, tool_input: { plan: [{ step: 'leggi https://x.it', status: 'pending' }], summary: 'fatto' } });
  for (const n of ['mcp__ccd_turn__update_plan', 'mcp__ccd_turn__wrap_up', 'mcp__ccd_session__mark_chapter', 'mcp__ccd_turn__mark_chapter']) assert.equal(mcp(n), '', n);
  // Le trascrizioni di altre sessioni, i widget, il browser, uno strumento qualsiasi; e i nomi che somigliano ai puliti
  // senza esserlo: un altro server, un altro strumento, un a capo in coda.
  for (const n of ['mcp__ccd_session__list_events', 'mcp__ccd_turn__list_events', 'mcp__ccd_widget__read_widget_context', 'mcp__Claude_Browser__navigate',
    'mcp__Claude_Browser__get_page_text', 'mcp__github__get_file_contents', 'mcp__posta__update_plan', 'mcp__posta__mark_chapter', 'mcp__xccd_turn__mark_chapter',
    'mcp__ccd__mark_chapter', 'mcp__ccd_turn__update_plan_x', 'mcp__ccd_turn__wrap_up__x', 'mcp__ccd_x__list_events__mark_chapter', 'mcp__ccd_turn__mark_chapter\n']) {
    assert.equal(mcp(n), n.trim(), JSON.stringify(n));
  }
});

test('classificatore: un artefatto sporca anche quando si pubblica; solo aprirlo, appuntarlo e cancellarlo no (#1211.2)', () => {
  const artefatto = (action, altro = {}) => L.motivoLettura({ tool_name: 'Artifact', tool_input: { action, ...altro } });
  assert.equal(artefatto('read', { url: 'https://claude.ai/artifact/x' }), 'Artifact (read)');
  assert.equal(artefatto('list', { scope: 'shared' }), 'Artifact (list)');
  // Su una pagina modificata da altri il rifiuto restituisce la versione attuale; e chi pubblica riceve i commenti.
  assert.equal(artefatto(undefined, { file_path: '/tmp/p.html', url: 'https://claude.ai/artifact/x' }), 'Artifact (publish)');
  assert.equal(artefatto('publish', { file_path: '/tmp/p.html' }), 'Artifact (publish)');
  assert.equal(artefatto('quickstart', { intent: 'slides' }), 'Artifact (quickstart)');
  assert.equal(artefatto('azione-nuova'), 'Artifact (azione-nuova)');
  for (const action of ['open', 'pin', 'unpin', 'delete']) assert.equal(artefatto(action, { url: 'https://claude.ai/artifact/x' }), '', action);
});

test('classificatore: un sotto-agente sporca solo se gira fuori dal computer; ToolSearch solo se può portare descrizioni MCP (#1211.2)', () => {
  const agente = (tool_input, tool_name = 'Agent') => L.motivoLettura({ tool_name, tool_input });
  assert.equal(agente({ prompt: 'leggi https://x.it', description: 'web', isolation: 'remote' }), 'Agent (remote)');
  assert.equal(agente({ prompt: 'x', isolation: 'remote' }, 'Task'), 'Task (remote)');
  assert.equal(agente({ prompt: 'x', isolation: 'cloud-di-domani' }), 'Agent (cloud-di-domani)');
  assert.equal(agente({ prompt: 'x', isolation: { dove: 'remote' } }), 'Agent ([object Object])');
  for (const isolation of [undefined, '', 'worktree']) assert.equal(agente({ prompt: 'x', subagent_type: 'Explore', isolation }), '', String(isolation));
  assert.equal(agente({ prompt: 'x' }, 'Task'), '');
  const cerca = (query) => L.motivoLettura({ tool_name: 'ToolSearch', tool_input: { query, max_results: 5 } });
  for (const q of ['select:Monitor', 'select:TaskCreate, TaskUpdate,EnterWorktree', ' select:WebFetch']) assert.equal(cerca(q), '', q);
  // Caricare uno strumento MCP pulito non sporca più che chiamarlo (#1252).
  for (const q of ['select:mcp__ccd_turn__update_plan,mcp__ccd_turn__wrap_up', 'select:Monitor, mcp__ccd_session__mark_chapter', 'select:mcp__ide__getDiagnostics']) assert.equal(cerca(q), '', q);
  for (const q of ['select:mcp__github__get_me', 'select:Monitor,mcp__x__y', 'select:MCP__x', 'select:*', 'select:', 'select:Monitor,', 'notebook jupyter', '+slack send', '', undefined,
    'select:mcp__ccd_turn__update_plan,mcp__ccd_session__list_events', 'select:mcp__ccd_widget__read_widget_context', 'ccd_turn update_plan']) {
    assert.equal(cerca(q), 'ToolSearch', String(q));
  }
});

test('classificatore: Read sporca solo fuori dal repo, dal checkout del server accanto e dalla cartella di Claude; LOCAL.md sopra il repo no', () => {
  assert.equal(leggi('/casa/Filo/src/main/index.js'), '');
  assert.equal(leggi('/casa/Filo'), '');
  assert.equal(leggi('src/relativo.js'), '', 'relativo alla cartella della chiamata');
  assert.equal(leggi('/casa/filo-security/functions/index.js'), '');
  assert.equal(leggi('/home/o/.claude/skills/x/SKILL.md'), '');
  assert.equal(leggi('/home/o/.claude/projects/x/sess-2/tool-results/1.txt'), 'Read dalla cartella di Claude (1.txt)', 'i resoconti di un’altra sessione (#1211.3)');
  assert.equal(leggi('/casa/LOCAL.md'), '');
  assert.equal(leggi('/casa/segnala-12.md'), 'Read fuori dal repo (segnala-12.md)');
  assert.equal(leggi('/casa/Filo-copia/x.js'), 'Read fuori dal repo (x.js)', 'stesso inizio del nome, cartella diversa');
  assert.equal(leggi('/casa/Filo/../Scaricati/fattura.pdf'), 'Read fuori dal repo (fattura.pdf)');
  assert.equal(leggi('../fuori.txt'), 'Read fuori dal repo (fuori.txt)');
  assert.equal(leggi('/altro/.claude/skills/x.md'), 'Read fuori dal repo (x.md)', 'solo la cartella di Claude dell’utente, non quella di un altro progetto');
  assert.equal(leggi('/tmp/a\nb\u0000.txt'), 'Read fuori dal repo (a b .txt)');
  assert.equal(leggi(''), '');
  // Un collegamento dentro il repo che porta fuori: conta dove sta il file vero.
  const canonico = (p) => (p.startsWith('/casa/Filo/link/') ? `/esterno/${p.slice('/casa/Filo/link/'.length)}` : p);
  assert.equal(leggi('/casa/Filo/link/x.txt', { ...ctxPosix, canonico }), 'Read fuori dal repo (x.txt)');
});

test('classificatore: le uscite in sottofondo e gli appunti nella cartella temporanea di Claude del progetto non sporcano (#1211 giro 1)', () => {
  const tmp = L.cartelleTemporaneeDiClaude(['/casa/Filo', ''], { env: { CLAUDE_CODE_TMPDIR: '/scelta' }, tmp: ['/tmp'], uid: 0 });
  assert.deepEqual(tmp, ['/scelta/claude-0/-casa-Filo', '/scelta/claude/-casa-Filo', '/tmp/claude-0/-casa-Filo', '/tmp/claude/-casa-Filo']);
  const ctx = { ...ctxPosix, cartelle: [...ctxPosix.cartelle, ...tmp] };
  assert.equal(leggi('/tmp/claude-0/-casa-Filo/tasks/b1x2.output', ctx), '');
  assert.equal(leggi('/tmp/claude-0/-casa-Filo/8460d4c2/scratchpad/note.txt', ctx), '');
  assert.equal(leggi('/tmp/claude-0/-casa-Altro/tasks/b1.output', ctx), 'Read fuori dal repo (b1.output)', 'un altro progetto no');
  assert.equal(leggi('/tmp/scaricato.html', ctx), 'Read fuori dal repo (scaricato.html)');
  const win = L.cartelleTemporaneeDiClaude(['C:\\Users\\agenti AI\\Desktop\\Filo\\Filo'], { tmp: ['C:\\Users\\agenti AI\\AppData\\Local\\Temp'], win: true });
  assert.deepEqual(win, ['C:\\Users\\agenti AI\\AppData\\Local\\Temp\\claude\\C--Users-agenti-AI-Desktop-Filo-Filo']);
});

test('classificatore: su Windows maiuscole e barre non contano', () => {
  const ctx = { cwd: 'C:\\Users\\agenti AI\\Desktop\\Filo\\Filo', win: true, cartelle: ['c:\\users\\agenti ai\\desktop\\filo\\filo'], claude: ['C:\\Users\\agenti AI\\.claude'], file: ['C:\\Users\\agenti AI\\Desktop\\Filo\\LOCAL.md'] };
  assert.equal(leggi('C:\\Users\\Agenti AI\\Desktop\\Filo\\Filo\\src\\x.js', ctx), '');
  assert.equal(leggi('C:/Users/agenti AI/Desktop/Filo/Filo/package.json', ctx), '');
  assert.equal(leggi('c:\\users\\agenti ai\\desktop\\filo\\local.md', ctx), '');
  assert.equal(leggi('C:\\Users\\agenti AI\\.claude\\plans\\p.md', ctx), '');
  assert.equal(leggi('C:\\Users\\agenti AI\\Desktop\\Filo\\nota.md', ctx), 'Read fuori dal repo (nota.md)');
  assert.equal(leggi('D:\\Filo\\Filo\\x.js', ctx), 'Read fuori dal repo (x.js)');
});

test('contesto: il repo anche da una worktree, il checkout del server accanto, la cartella di Claude, LOCAL.md', () => {
  const sopra = cartellaTemporanea('letture-ctx-');
  try {
    const repo = join(sopra, 'Filo');
    mkdirSync(repo);
    const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo, stdio: 'ignore' });
    git('init', '-q', '-b', 'main');
    writeFileSync(join(repo, 'x.txt'), 'x');
    git('add', '-A');
    git('commit', '-qm', 'base');
    const wt = join(repo, '.claude', 'worktrees', 'lavoro');
    git('worktree', 'add', '-q', wt, '-b', 'claude/lavoro');
    mkdirSync(join(sopra, 'filo-security', 'functions', 'tools'), { recursive: true });
    writeFileSync(join(sopra, 'filo-security', 'functions', 'tools', 'server-fondi.js'), '');
    const ctx = L.contestoLettura({ cwd: wt, env: { CLAUDE_CONFIG_DIR: join(sopra, 'conf') } });
    for (const dove of [join(wt, 'src', 'a.js'), join(repo, 'x.txt'), join(sopra, 'filo-security', 'functions', 'index.js'), join(sopra, 'conf', 'settings.json'), join(sopra, 'LOCAL.md')]) {
      assert.equal(L.motivoLettura({ tool_name: 'Read', tool_input: { file_path: dove } }, ctx), '', dove);
    }
    assert.match(L.motivoLettura({ tool_name: 'Read', tool_input: { file_path: join(sopra, 'altro.md') } }, ctx), /fuori dal repo/);
    assert.match(L.motivoLettura({ tool_name: 'Read', tool_input: { file_path: join(sopra, 'conf', 'projects', 'p', 's.jsonl') } }, ctx), /cartella di Claude/, 'la cartella di CLAUDE_CONFIG_DIR ha lo stesso elenco ammesso');
    // Dalla worktree col progetto dichiarato: il repo resta di casa.
    const daWt = L.contestoLettura({ cwd: wt, env: { CLAUDE_PROJECT_DIR: repo } });
    assert.equal(L.motivoLettura({ tool_name: 'Read', tool_input: { file_path: join(wt, 'src', 'a.js') } }, daWt), '');
    // Spostata in un repo clonato da fuori, la sessione che ne legge un file si sporca (#1211 giro 2).
    const altrui = join(sopra, 'clonato');
    mkdirSync(altrui);
    execFileSync('git', ['init', '-q'], { cwd: altrui, stdio: 'ignore' });
    const fuori = L.contestoLettura({ cwd: altrui, env: { CLAUDE_PROJECT_DIR: repo } });
    assert.match(L.motivoLettura({ tool_name: 'Read', tool_input: { file_path: join(altrui, 'README.md') } }, fuori), /fuori dal repo/);
    assert.match(L.motivoLettura({ tool_name: 'Read', tool_input: { file_path: 'README.md' } }, fuori), /fuori dal repo/, 'anche relativo');
    assert.equal(L.motivoLettura({ tool_name: 'Read', tool_input: { file_path: join(repo, 'x.txt') } }, fuori), '', 'il progetto resta di casa');
    assert.equal(L.motivoLettura({ tool_name: 'Read', tool_input: { file_path: join(sopra, 'filo-security', 'functions', 'index.js') } }, fuori), '');
  } finally { togliCartella(sopra); }
});

function conBiglietto() {
  const dir = cartellaTemporanea('letture-');
  execFileSync('git', ['init', '-q'], { cwd: dir });
  const path = join(B.cartellaBiglietti(dir), 'sess.json');
  B.scriviFile(path, { ticket: SEGRETO, fp: FP, natoIl: 1 });
  return { dir, b: B.leggiFile(path) };
}

test('gancio: annota la lettura accanto al biglietto della sessione dello stdin e lancia la consegna senza aspettarla', () => {
  const { dir, b } = conBiglietto();
  try {
    const avviati = [];
    const avvia = (p, o) => avviati.push([p, o.motivo]);
    const input = { session_id: 'sess', cwd: dir, tool_name: 'WebFetch', tool_input: { url: 'https://esempio.it' } };
    const r = L.gancio({ input, env: {}, avvia, nowMs: 5 });
    assert.deepEqual(r, { esito: 'annotato', motivo: 'WebFetch (esempio.it)' });
    assert.deepEqual(B.sporchiInAttesa(b).map((v) => [v.motivo, v.at]), [['WebFetch (esempio.it)', 5]]);
    assert.deepEqual(avviati, [[b.path, '']]);
    assert.equal(L.gancio({ input: { ...input, session_id: 'altra' }, env: {}, avvia }).esito, 'senza biglietto', 'mai il biglietto di un’altra sessione');
    assert.equal(L.gancio({ input, env: { FILO_ROUTINE: '1' }, avvia }).esito, 'routine');
    assert.equal(L.gancio({ input: { ...input, tool_name: 'Bash' }, env: {}, avvia }).esito, 'nessuna lettura esterna');
    assert.equal(L.gancio({ input: { ...input, tool_name: 'Agent', tool_input: { prompt: 'x' } }, env: {}, avvia }).esito, 'nessuna lettura esterna');
    assert.equal(L.gancio({ input: 'storto', env: {}, avvia }).esito, 'nessuna lettura esterna');
    assert.equal(avviati.length, 1);
    // Già sporco sul server: nessun processo in più, ma la lettura resta annotata, e un segno falso non pulisce niente.
    writeFileSync(join(B.cartellaSporchi(b), 'sul-server'), '1\n');
    L.gancio({ input, env: {}, avvia });
    assert.equal(avviati.length, 1);
    assert.equal(B.sporchiInAttesa(b).length, 2);
  } finally { togliCartella(dir); }
});

test('gancio: con la cartella corrente fuori dal progetto trova il biglietto nel progetto da cui la sessione è partita (#1211 giro 1)', () => {
  const { dir, b } = conBiglietto();
  const altrove = cartellaTemporanea('letture-altrove-');
  try {
    const avviati = [];
    const input = { session_id: 'sess', cwd: altrove, tool_name: 'WebSearch', tool_input: { query: 'q' } };
    assert.equal(L.gancio({ input, env: { CLAUDE_PROJECT_DIR: dir }, avvia: (p) => avviati.push(p) }).esito, 'annotato');
    assert.deepEqual(B.sporchiInAttesa(b).map((v) => v.motivo), ['WebSearch']);
    assert.deepEqual(avviati, [b.path]);
  } finally { togliCartella(dir); togliCartella(altrove); }
});

test('gancio: se non riesce ad annotare, la consegna in sottofondo porta il motivo; un guasto non lancia mai', () => {
  const { dir, b } = conBiglietto();
  try {
    writeFileSync(join(B.cartellaBiglietti(dir), 'sporchi'), 'non una cartella');
    const avviati = [];
    const r = L.gancio({ input: { session_id: 'sess', cwd: dir, tool_name: 'mcp__github__get_file_contents' }, env: {}, avvia: (p, o) => avviati.push([p, o.motivo]) });
    assert.equal(r.esito, 'annotato');
    assert.deepEqual(avviati, [[b.path, 'mcp__github__get_file_contents']]);
    assert.equal(L.gancio({ input: { session_id: 'sess', cwd: dir, tool_name: 'WebSearch' }, env: {}, avvia: () => { throw new Error('rotto'); } }).esito, 'guasto');
  } finally { togliCartella(dir); }
});

// ── Il gancio vero, con uno stdin finto ──

function lanciaGancio(input, { progetto = ROOT, env = {} } = {}) {
  const base = { ...process.env };
  for (const k of ['FILO_ROUTINE', 'CLAUDE_CODE_SESSION_ID', 'FILO_BIGLIETTO_FILE', 'CLAUDE_CONFIG_DIR']) delete base[k];
  // La consegna in sottofondo non deve mai toccare il server vero: la prova lo vieta a chiama().
  const r = spawnSync('bash', [GANCIO], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    env: { ...base, CLAUDE_PROJECT_DIR: progetto, NODE_TEST_CONTEXT: 'child', FILO_FUNCTIONS_BASE: 'http://127.0.0.1:9', ...env },
    encoding: 'utf8', timeout: TETTO_ATTESA_MS,
  });
  return r;
}

test('il gancio vero: sporca per pagine web, MCP e file fuori dal repo; per i file del repo, la shell e le routine no; esce sempre 0 e muto', (t) => {
  const { dir, b } = conBiglietto();
  const fuori = cartellaTemporanea('letture-fuori-');
  const casa = cartellaTemporanea('letture-casa-');
  try {
    const prova = (tool_name, tool_input = {}, opz = {}) => {
      togliCartella(B.cartellaSporchi(b));
      const r = lanciaGancio({ session_id: 'sess', cwd: dir, hook_event_name: 'PostToolUse', tool_name, tool_input, tool_response: { contenuto: 'testo "con" virgolette \\ e barre' } }, opz);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, '');
      return B.sporchiInAttesa(b).map((v) => v.motivo);
    };
    assert.deepEqual(prova('WebFetch', { url: 'https://esempio.it/pagina' }), ['WebFetch (esempio.it)']);
    assert.deepEqual(prova('mcp__claude-in-chrome__get_page_text', { tabId: 1 }), ['mcp__claude-in-chrome__get_page_text']);
    assert.deepEqual(prova('Read', { file_path: join(fuori, 'mail.eml') }), ['Read fuori dal repo (mail.eml)']);
    assert.deepEqual(prova('Read', { file_path: `${ROOT}/../fuori-dal-repo.txt` }), ['Read fuori dal repo (fuori-dal-repo.txt)'], '«..» lo decide node');
    assert.deepEqual(prova('Read', { file_path: join(ROOT, 'package.json') }), [], 'dentro il progetto');
    assert.deepEqual(prova('Read', { file_path: join(dir, 'x.txt') }), [], 'dentro il repo della sessione');
    assert.deepEqual(prova('Read', { file_path: join(dirname(ROOT), 'LOCAL.md') }), []);
    assert.deepEqual(prova('Read', { file_path: join(casa, '.claude', 'plans', 'p.md') }, { env: { HOME: casa, USERPROFILE: casa } }), []);
    // #1211.3: nella cartella di Claude i resoconti delle altre sessioni e i cataloghi di terzi sporcano, le impostazioni no.
    const conCasa = { env: { HOME: casa, USERPROFILE: casa } };
    assert.deepEqual(prova('Read', { file_path: join(casa, '.claude', 'projects', 'p', 'altra.jsonl') }, conCasa), ['Read dalla cartella di Claude (altra.jsonl)']);
    assert.deepEqual(prova('Read', { file_path: join(casa, '.claude', 'plugins', 'marketplaces', 'terzi', 'catalogo.json') }, conCasa), ['Read dalla cartella di Claude (catalogo.json)']);
    assert.deepEqual(prova('Read', { file_path: join(casa, '.claude', 'projects', 'p', 'sess.jsonl') }, conCasa), [], 'la storia della sessione stessa');
    for (const f of [['settings.json'], ['CLAUDE.md'], ['skills', 'x', 'SKILL.md'], ['commands', 'c.md'], ['projects', 'p', 'memory', 'MEMORY.md']]) {
      assert.deepEqual(prova('Read', { file_path: join(casa, '.claude', ...f) }, conCasa), [], f.join('/'));
    }
    // Grep con le righe vale come Read sullo stesso percorso; coi soli nomi resta pulito.
    assert.deepEqual(prova('Grep', { pattern: 'x', path: join(fuori, 'mail.eml'), output_mode: 'content' }), ['Grep fuori dal repo (mail.eml)']);
    assert.deepEqual(prova('Grep', { pattern: 'x', path: fuori, output_mode: 'content', '-n': true }), [`Grep fuori dal repo (${basename(fuori)})`]);
    assert.deepEqual(prova('Grep', { pattern: 'x', path: join(casa, '.claude', 'projects'), output_mode: 'content' }, conCasa), ['Grep dalla cartella di Claude (projects)']);
    assert.deepEqual(prova('Grep', { pattern: 'x', path: join(ROOT, 'scripts'), output_mode: 'content' }), [], 'dentro il progetto');
    assert.deepEqual(prova('Grep', { pattern: 'x', path: dir, output_mode: 'content' }), [], 'dentro il repo della sessione');
    assert.deepEqual(prova('Grep', { pattern: 'x', output_mode: 'content' }), [], 'senza percorso: la cartella della chiamata, il repo');
    for (const output_mode of [undefined, 'files_with_matches', 'count']) {
      assert.deepEqual(prova('Grep', { pattern: 'x', path: fuori, output_mode }), [], String(output_mode));
    }
    // Il salto senza processi guarda i parametri, non il testo cercato.
    assert.deepEqual(prova('Grep', { pattern: '"output_mode":"content"', path: fuori }), []);
    assert.deepEqual(prova('Grep', { pattern: `"path":"${join(ROOT, 'x')}"`, path: fuori, output_mode: 'content' }), [`Grep fuori dal repo (${basename(fuori)})`]);
    for (const n of ['Bash', 'Grep', 'Glob', 'mcp__ide__getDiagnostics']) assert.deepEqual(prova(n, { command: 'curl x', pattern: 'x', path: fuori }), [], n);
    // L'apertura di un turno nell'app desktop: piano, capitolo, riassunto lasciano pulito; leggere gli eventi no (#1252).
    for (const n of ['mcp__ccd_turn__update_plan', 'mcp__ccd_session__mark_chapter', 'mcp__ccd_turn__wrap_up']) assert.deepEqual(prova(n, { plan: [{ step: 'x', status: 'in_progress' }] }), [], n);
    assert.deepEqual(prova('mcp__ccd_session__list_events', { session: 'altra' }), ['mcp__ccd_session__list_events']);
    assert.deepEqual(prova('SearchPlugins', { query: 'posta' }), ['SearchPlugins']);
    assert.deepEqual(prova('Agent', { prompt: 'leggi una pagina', isolation: 'remote' }), ['Agent (remote)']);
    assert.deepEqual(prova('Agent', { prompt: 'leggi una pagina', subagent_type: 'Explore' }), [], 'un sotto-agente locale');
    assert.deepEqual(prova('Artifact', { file_path: join(fuori, 'p.html'), url: 'https://claude.ai/artifact/x' }), ['Artifact (publish)']);
    assert.deepEqual(prova('WebFetch', { url: 'https://esempio.it' }, { env: { FILO_ROUTINE: '1' } }), [], 'nelle routine c’è il loro biglietto');
    // Il salto per le Read del repo guarda lo strumento chiamato: chiavi uguali nella risposta o nei parametri di un
    // mcp__ non lo attivano (#1211 giro 1).
    const finto = { tool_name: 'Read', file_path: join(ROOT, 'package.json') };
    for (const [tool_input, tool_response] of [[{ id: 'x' }, finto], [finto, [{ type: 'text', text: 'ok' }]]]) {
      togliCartella(B.cartellaSporchi(b));
      const r = lanciaGancio({ session_id: 'sess', cwd: dir, hook_event_name: 'PostToolUse', tool_name: 'mcp__db__get_document', tool_input, tool_response });
      assert.equal(r.status, 0, r.stderr);
      assert.deepEqual(B.sporchiInAttesa(b).map((v) => v.motivo), ['mcp__db__get_document']);
    }
    const storto = lanciaGancio('{non json');
    assert.equal(storto.status, 0);
    // Un collegamento dentro il progetto che porta fuori: il salto senza processi lo lascia decidere a node.
    const progetto = cartellaTemporanea('letture-progetto-');
    try {
      mkdirSync(join(progetto, '.git'));
      collegaCartella(join(ROOT, 'scripts'), join(progetto, 'scripts'));
      collegaCartella(fuori, join(progetto, 'collegato'));
      writeFileSync(join(fuori, 'mail.eml'), 'Da: sconosciuto');
      assert.deepEqual(prova('Read', { file_path: join(progetto, 'collegato', 'mail.eml') }, { progetto }), ['Read fuori dal repo (mail.eml)']);
      assert.deepEqual(prova('Read', { file_path: join(progetto, 'vero.txt') }, { progetto }), []);
    } catch (e) {
      if (process.platform === 'win32' && e && e.code === 'EPERM') t.diagnostic('collegamento negato da Windows: parte saltata');
      else throw e;
    } finally { togliCartella(progetto); }
  } finally {
    togliCartella(dir);
    togliCartella(fuori);
    togliCartella(casa);
  }
});

test('cablaggio: il gancio sta dopo uno strumento riuscito e dopo uno fallito, su ogni strumento fuori dall’elenco dei puliti', () => {
  const s = JSON.parse(readFileSync(join(ROOT, '.claude', 'settings.local.json'), 'utf8'));
  const possibili = ['Read', 'Artifact', 'Agent', 'Task', 'ToolSearch', 'WebFetch', 'WebSearch', 'ArtifactComments', 'SearchPlugins', 'SendMessage', 'StrumentoDiDomani',
    'BashX', 'XBash', 'Bash|Grep', 'mcp__github__get_file_contents', 'mcp__plugin_posta_gmail__search', 'mcp__claude-in-chrome__navigate', ...L.MCP_SENZA_LETTURA];
  for (const evento of ['PostToolUse', 'PostToolUseFailure']) {
    const voci = (s.hooks[evento] || []).filter((g) => (g.hooks || []).some((h) => /\.claude\/hooks\/letture-esterne\.sh/.test(h.command)));
    assert.equal(voci.length, 1, evento);
    assert.equal(voci[0].matcher, L.matcherDelGancio(), `${evento}: il matcher si rigenera da STRUMENTI_SENZA_LETTURA`);
    // Come Claude Code: con un carattere da espressione regolare il matcher è una RegExp non ancorata. Si prova anche
    // ancorata ai due capi, perché un'altra lettura del matcher non apra un buco.
    for (const re of [new RegExp(voci[0].matcher), new RegExp(`^(?:${voci[0].matcher})$`)]) {
      for (const n of possibili) assert.ok(re.test(n), `${evento}: ${n} non fa partire il gancio`);
      for (const n of L.STRUMENTI_SENZA_LETTURA) assert.equal(re.test(n), false, `${evento}: ${n} lo farebbe partire per niente`);
    }
  }
  for (const n of possibili) assert.ok(L.puoLeggereFuori(n), n);
  for (const n of [...L.STRUMENTI_SENZA_LETTURA, '', undefined]) assert.equal(L.puoLeggereFuori(n), false, String(n));
  for (const n of L.STRUMENTI_SENZA_LETTURA) assert.match(n, /^[A-Za-z]+$/, 'un nome nel matcher non deve portare caratteri da espressione regolare');
  const src = readFileSync(GANCIO, 'utf8');
  assert.doesNotMatch(src, /\r\n/, 'fine riga LF');
  assert.match(src, /\[ -n "\$FILO_ROUTINE" \] && exit 0/);
  assert.match(src, /SCRIPT="\$PROJECT_DIR\/scripts\/biglietto\.mjs"/);
  assert.match(src, /node "\$SCRIPT" gancio/);
  assert.match(src, /exit 0\s*$/);
  assert.doesNotMatch(src, /exit [1-9]/);
  assert.match(readFileSync(join(ROOT, '.claude', 'hooks', 'session-start.sh'), 'utf8'), new RegExp(`timeout ${B.TETTO_AVVIO_MS / 1000}"`), 'la consegna in sottofondo ha il tetto dell’avvio');
});

test('la consegna in sottofondo: esce 0 da sola anche col server irraggiungibile, e lo sporco resta annotato', () => {
  const { dir, b } = conBiglietto();
  try {
    B.annotaSporco(b, 'WebSearch', 1);
    const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'biglietto.mjs'), 'consegna'], {
      env: { ...process.env, FILO_BIGLIETTO_FILE: b.path, NODE_TEST_CONTEXT: 'child', FILO_FUNCTIONS_BASE: 'http://127.0.0.1:9' },
      encoding: 'utf8', timeout: TETTO_ATTESA_MS,
    });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(B.sporchiInAttesa(b).map((v) => v.motivo), ['WebSearch']);
    assert.equal(existsSync(join(B.cartellaSporchi(b), 'sul-server')), false);
  } finally { togliCartella(dir); }
});
