// explore.mjs — esplorazione AUTONOMA di Filo guidata da un LLM vision.
//
// Un agente (Gemini/Gemma) riceve screenshot compositi con badge numerati sugli
// elementi cliccabili, decide la prossima azione, e segnala comportamenti
// inattesi/indesiderati. Al termine scrive un report con le issue trovate.
//
// Uso:
//   GEMINI_API_KEY=... node tests/agent/explore.mjs
//   GEMINI_API_KEY=... node tests/agent/explore.mjs --model gemini-3.5-flash --steps 15
//   GEMINI_API_KEY=... node tests/agent/explore.mjs --area "editor" --start filo://editor/editor.html
//
// Opzioni:
//   --model M     modello (default gemini-3.1-flash-lite)
//   --steps N     numero massimo di passi (default 12)
//   --start URL   tab iniziale (default filo://newtab/)
//   --area TXT    area/obiettivo su cui concentrarsi (libero)
//   --out DIR     cartella output (default tests/agent/reports/<timestamp>)

import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as d from './driver.mjs';
import { generate, extractJson, getApiKey, imagePart } from './llm.mjs';
import { pushIssue } from './feedback.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Schema strutturato (responseSchema): vincola l'output → JSON sempre valido,
// anche con modelli poco disciplinati come Gemma.
const SCHEMA = {
  type: 'OBJECT',
  properties: {
    screen: { type: 'STRING' },
    issues: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          severity: { type: 'STRING', enum: ['low', 'medium', 'high'] },
          title: { type: 'STRING' },
          detail: { type: 'STRING' },
          area: { type: 'STRING' },
        },
        required: ['severity', 'title'],
      },
    },
    action: {
      type: 'OBJECT',
      properties: {
        kind: { type: 'STRING', enum: ['click_mark', 'type', 'key', 'scroll', 'navigate', 'open_tab', 'finish'] },
        mark: { type: 'INTEGER' },
        text: { type: 'STRING' },
        key: { type: 'STRING' },
        dy: { type: 'INTEGER' },
        url: { type: 'STRING' },
        reason: { type: 'STRING' },
      },
      required: ['kind'],
    },
    why: { type: 'STRING' },
  },
  required: ['screen', 'issues', 'action'],
};

function parseArgs(argv) {
  const o = { model: 'gemini-3.1-flash-lite', steps: 12, start: 'filo://newtab/', area: '', out: '', feedback: true, minSeverity: 'low' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--model') o.model = argv[++i];
    else if (a === '--steps') o.steps = Number(argv[++i]);
    else if (a === '--start') o.start = argv[++i];
    else if (a === '--area') o.area = argv[++i];
    else if (a === '--out') o.out = resolve(argv[++i]);
    else if (a === '--no-feedback') o.feedback = false;
    else if (a === '--min-severity') o.minSeverity = argv[++i];
  }
  if (!o.out) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    o.out = join(__dirname, 'reports', ts);
  }
  return o;
}

const SYSTEM = `Sei un tester QA che esplora "Filo", un browser desktop AI-native (Electron).
Ricevi uno SCREENSHOT della finestra con BADGE NUMERATI rossi sovrapposti agli
elementi interagibili. La finestra ha in alto la "shell" (tab bar + barra
indirizzi + pulsanti Home/Impostazioni/App) e sotto la pagina della tab attiva.

Il tuo compito: navigare come un utente curioso e SEGNALARE ogni comportamento
inatteso o indesiderato che VEDI nello screenshot: aree vuote/bianche dove
dovrebbe esserci contenuto, testo tagliato/sovrapposto, elementi fuori posto,
colori/temi incoerenti, contrasto illeggibile, pulsanti che non fanno nulla,
stati incoerenti dopo un'azione, ecc.

Confronta lo screenshot con lo stato ATTESO data l'azione precedente. Se
qualcosa è palesemente rotto, è una issue.

Rispondi SEMPRE e SOLO con un oggetto JSON con questa forma (lascia vuoti i campi
di "action" non pertinenti al "kind" scelto):
{
  "screen": "1 frase su cosa mostra lo schermo ORA",
  "issues": [
    {"severity":"low|medium|high","title":"breve","detail":"cosa è sbagliato e perché","area":"editor|dashboard|shell|history|options"}
  ],
  "action": {
    "kind": "click_mark | type | key | scroll | navigate | open_tab | finish",
    "mark": <numero badge se kind=click_mark>,
    "text": "<testo se kind=type>",
    "key": "<es. Enter o Control+b se kind=key>",
    "dy": <px +giù/-su se kind=scroll>,
    "url": "<filo://... se kind=navigate o open_tab>",
    "reason": "<se kind=finish>"
  },
  "why": "perché questa azione fa progredire l'esplorazione"
}
"issues" è [] se non vedi nulla di anomalo. Preferisci click_mark usando i numeri
visibili. Esplora aree diverse; NON ripetere la stessa azione due volte di fila.
NOTA: il pulsante "App" è un TOGGLE — un click lo apre, un altro lo chiude; se hai
appena cliccato App e il menu non c'è, l'hai semplicemente chiuso (non è un bug).
URL interni utili:
filo://newtab/ (dashboard), filo://editor/editor.html, filo://history/history.html,
filo://options/options.html.`;

function marksToText(map) {
  return map.map((m) => `#${m.i} [${m.page}] ${m.tag}${m.label ? ' "' + m.label + '"' : ''} @${m.cx},${m.cy}`).join('\n');
}

async function run() {
  const o = parseArgs(process.argv.slice(2));
  getApiKey(); // fail-fast se manca la chiave
  mkdirSync(o.out, { recursive: true });
  const shotsDir = join(o.out, 'shots');
  mkdirSync(shotsDir, { recursive: true });
  const allIssues = [];
  const history = [];
  const logPath = join(o.out, 'log.txt');
  const log = (s) => { console.log(s); appendFileSync(logPath, s + '\n'); };

  log(`Filo explore — model=${o.model} steps=${o.steps} area="${o.area || '(libera)'}" start=${o.start}`);
  const { app, shell } = await d.launchFilo();
  try {
    if (o.start && o.start !== 'filo://newtab/') await d.openTab(app, shell, o.start);

    for (let step = 1; step <= o.steps; step++) {
      const { map } = await d.markInteractables(app, shell);
      const shot = join(shotsDir, `step-${String(step).padStart(2, '0')}.png`);
      await d.captureComposite(app, shot);
      await d.clearMarks(app, shell);

      const user = [
        o.area ? `AREA DA TESTARE (priorità): ${o.area}` : 'Esplora liberamente tutta la app.',
        `Passo ${step}/${o.steps}.`,
        history.length ? `Ultime azioni:\n${history.slice(-5).map((h, i) => `  - ${h}`).join('\n')}` : 'Primo passo.',
        `Elementi cliccabili (badge):\n${marksToText(map)}`,
        'Analizza lo screenshot allegato e rispondi col JSON richiesto.',
      ].join('\n\n');

      // Fino a 2 tentativi: un campione degenere (ramble ripetitiva → JSON
      // troncato) è stocastico, un nuovo sample di solito risolve. Temperatura
      // bassa per ridurre le ripetizioni.
      let parsed = null;
      for (let t = 0; t < 2 && !parsed; t++) {
        try {
          const out = await generate({ model: o.model, system: SYSTEM, user, imagePath: shot, temperature: 0.2, schema: SCHEMA });
          parsed = extractJson(out);
          if (!parsed && t === 1) {
            writeFileSync(join(o.out, `fail-step-${String(step).padStart(2, '0')}.txt`), out);
            log(`  [step ${step}] JSON non parsabile (len=${out.length}) dopo 2 tentativi.`);
          }
        } catch (e) {
          log(`  [step ${step}] errore LLM (tentativo ${t + 1}): ${e.message.slice(0, 140)}`);
        }
      }
      if (!parsed) { history.push(`(passo ${step}: risposta non valida)`); continue; }

      log(`  [step ${step}] ${parsed.screen || ''}`);
      for (const iss of (parsed.issues || [])) {
        const rec = { step, shot: `shots/step-${String(step).padStart(2, '0')}.png`, ...iss };
        allIssues.push(rec);
        log(`    ⚠ [${iss.severity}] ${iss.title} — ${iss.detail || ''}`);
      }

      const act = parsed.action || { kind: 'finish', reason: 'nessuna azione' };
      try {
        switch (act.kind) {
          case 'click_mark': await d.clickMark(app, shell, map, Number(act.mark)); history.push(`click #${act.mark}`); break;
          case 'type': await d.typeText(app, shell, act.text || ''); history.push(`type "${(act.text || '').slice(0, 30)}"`); break;
          case 'key': await d.pressKey(app, shell, act.key || 'Enter'); history.push(`key ${act.key}`); break;
          case 'scroll': await d.scrollBy(app, shell, Number(act.dy) || 300); history.push(`scroll ${act.dy}`); break;
          case 'navigate': await d.navigate(app, shell, act.url); history.push(`navigate ${act.url}`); break;
          case 'open_tab': await d.openTab(app, shell, act.url); history.push(`open_tab ${act.url}`); break;
          case 'finish': log(`  [step ${step}] finish: ${act.reason || ''}`); step = o.steps; break;
          default: history.push(`(azione ignota ${act.kind})`);
        }
      } catch (e) {
        log(`    azione fallita (${act.kind}): ${e.message.slice(0, 120)}`);
        history.push(`(azione fallita: ${act.kind})`);
      }
    }
  } finally {
    await d.closeFilo(app);
  }

  // Report — dedup per (title|area) tenendo la severità più alta.
  const rank = { high: 3, medium: 2, low: 1 };
  const dedup = new Map();
  for (const i of allIssues) {
    const key = `${(i.title || '').toLowerCase()}|${i.area || ''}`;
    const prev = dedup.get(key);
    if (!prev || (rank[i.severity] || 0) > (rank[prev.severity] || 0)) dedup.set(key, i);
  }
  const issues = [...dedup.values()].sort((a, b) => (rank[b.severity] || 0) - (rank[a.severity] || 0));
  writeFileSync(join(o.out, 'issues.json'), JSON.stringify(issues, null, 2));
  const allIssuesRef = issues;
  const bySev = (s) => allIssuesRef.filter((i) => i.severity === s);
  const md = [
    `# Filo — report esplorazione`,
    ``,
    `- Modello: \`${o.model}\``,
    `- Passi: ${o.steps}`,
    `- Area: ${o.area || '(libera)'}`,
    `- Issue trovate: **${allIssuesRef.length}** (high: ${bySev('high').length}, medium: ${bySev('medium').length}, low: ${bySev('low').length})`,
    ``,
    `## Issue`,
    allIssuesRef.length ? '' : '_Nessuna anomalia segnalata._',
    ...allIssuesRef.map((i, n) => [
      `### ${n + 1}. [${i.severity}] ${i.title}`,
      `- Area: ${i.area || '?'} · Passo: ${i.step}`,
      `- ${i.detail || ''}`,
      `- Screenshot: \`${i.shot}\``,
      ``,
    ].join('\n')),
  ].join('\n');
  writeFileSync(join(o.out, 'report.md'), md);
  console.log(`\n✓ Report: ${join(o.out, 'report.md')}  (${allIssuesRef.length} issue)`);

  // Push su Firestore feedback (categoria "agente"), con modello e screenshot.
  if (o.feedback && allIssuesRef.length) {
    const minRank = rank[o.minSeverity] || 1;
    const toPush = allIssuesRef.filter((i) => (rank[i.severity] || 0) >= minRank);
    console.log(`\nInvio ${toPush.length} issue ai feedback (modello ${o.model})…`);
    for (const i of toPush) {
      try {
        const r = await pushIssue({
          model: o.model,
          severity: i.severity,
          area: i.area || '?',
          title: i.title,
          detail: i.detail || '',
          foundAt: o.start,
          screenshotPath: join(o.out, i.shot),
        });
        console.log(`  ✓ feedback ${r.id} — ${i.title}`);
      } catch (e) {
        console.log(`  ✗ push fallito (${i.title}): ${e.message.slice(0, 140)}`);
      }
    }
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
