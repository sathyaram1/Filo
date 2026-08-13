// explore.mjs — esplorazione AUTONOMA di Filo guidata da un LLM vision.
//
// Un agente (Gemma, pesi aperti, servito da un fornitore indipendente) riceve
// screenshot compositi con badge numerati sugli elementi cliccabili, decide la
// prossima azione, e segnala comportamenti inattesi/indesiderati. Al termine
// scrive un report con le issue trovate.
//
// Uso:
//   OPENROUTER_API_KEY=... node tests/agent/explore.mjs
//   OPENROUTER_API_KEY=... node tests/agent/explore.mjs --model google/gemma-4-26b-a4b-it --steps 15
//   OPENROUTER_API_KEY=... node tests/agent/explore.mjs --area "editor" --start filo://editor/editor.html
//
// Opzioni:
//   --model M     modello (default google/gemma-4-31b-it)
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

// Schema strutturato (JSON Schema): vincola l'output → JSON sempre valido,
// anche con modelli poco disciplinati sul formato.
const SCHEMA = {
  type: 'object',
  properties: {
    screen: { type: 'string' },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['low', 'medium', 'high'] },
          title: { type: 'string' },
          detail: { type: 'string' },
          area: { type: 'string' },
        },
        required: ['severity', 'title'],
      },
    },
    action: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['click_mark', 'type', 'key', 'scroll', 'navigate', 'open_tab', 'finish'] },
        mark: { type: 'integer' },
        text: { type: 'string' },
        key: { type: 'string' },
        dy: { type: 'integer' },
        url: { type: 'string' },
        reason: { type: 'string' },
      },
      required: ['kind'],
    },
    why: { type: 'string' },
  },
  required: ['screen', 'issues', 'action'],
};

function parseArgs(argv) {
  // Entrambi a pesi aperti e serviti da fornitori indipendenti (#461).
  // Primario: Gemma 4 31B (vede le immagini meglio). Fallback: la variante più
  // economica, quando il primario esaurisce i crediti (429).
  const o = { model: 'google/gemma-4-31b-it', fallback: 'google/gemma-4-26b-a4b-it', steps: 12, start: 'filo://newtab/', area: '', task: '', out: '', feedback: true, minSeverity: 'low' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--model') o.model = argv[++i];
    else if (a === '--fallback') o.fallback = argv[++i];
    else if (a === '--no-fallback') o.fallback = '';
    else if (a === '--steps') o.steps = Number(argv[++i]);
    else if (a === '--start') o.start = argv[++i];
    else if (a === '--area') o.area = argv[++i];
    else if (a === '--task') o.task = argv[++i];
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

Hai l'INTERA cronologia della sessione nei turni precedenti (ogni screenshot
passato e le tue risposte). USALA: confronta lo stato attuale con quelli
precedenti e con lo stato ATTESO dopo la tua ultima azione. Se qualcosa cambia
in modo inatteso (es. contenuto che PRIMA c'era e ORA è sparito, area diventata
vuota), è una issue. Se ti viene dato un COMPITO, portalo a termine con azioni
reali e segnala ogni bug incontrato lungo il percorso.

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

// Finestra di screenshot tenuti nel contesto. Qui si paga a token, quindi la
// finestra conta davvero: 8 screenshot bastano a riconoscere "prima c'era, ora
// non c'è" senza far esplodere il costo di un run lungo.
const IMG_WINDOW = 8;

// Mantiene le immagini solo negli ultimi IMG_WINDOW turni utente; quelli più
// vecchi conservano il testo ma rilasciano l'immagine (sostituita da una nota).
function pruneOldImages(convo, keep = IMG_WINDOW) {
  const imgTurns = [];
  for (let i = 0; i < convo.length; i++) {
    if (convo[i].role === 'user' && convo[i].parts.some((p) => p.inline_data)) imgTurns.push(i);
  }
  for (const idx of imgTurns.slice(0, Math.max(0, imgTurns.length - keep))) {
    convo[idx].parts = convo[idx].parts.map((p) => (p.inline_data ? { text: '[screenshot di un passo precedente — omesso]' } : p));
  }
}

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
  // Conversazione multi-turn COMPLETA: ogni passo aggiunge il turno utente
  // (testo + screenshot) e il turno del modello. Così il modello vede gli stati
  // precedenti (utile per riconoscere "c'era contenuto, ora è sparito"); le
  // immagini più vecchie di IMG_WINDOW passi vengono rilasciate.
  const convo = [];
  const logPath = join(o.out, 'log.txt');
  const log = (s) => { console.log(s); appendFileSync(logPath, s + '\n'); };

  log(`Filo explore — model=${o.model}${o.fallback ? ` (fallback ${o.fallback})` : ''} steps=${o.steps} ${o.task ? `task="${o.task}"` : `area="${o.area || '(libera)'}"`} start=${o.start}`);
  let activeModel = o.model; // può passare al fallback se il primario esaurisce la quota
  const { app, shell } = await d.launchFilo();
  try {
    if (o.start && o.start !== 'filo://newtab/') await d.openTab(app, shell, o.start);

    for (let step = 1; step <= o.steps; step++) {
      const { map } = await d.markInteractables(app, shell);
      const shot = join(shotsDir, `step-${String(step).padStart(2, '0')}.png`);
      await d.captureComposite(app, shot);
      await d.clearMarks(app, shell);

      const objective = o.task
        ? `COMPITO DA SVOLGERE: ${o.task}\nEseguilo con interazioni reali (click sui badge, digitazione, navigazione). Segnala QUALSIASI bug incontrato lungo il percorso. Usa kind=finish solo quando il compito è completato o sei davvero bloccato.`
        : (o.area ? `AREA DA TESTARE (priorità): ${o.area}` : 'Esplora liberamente tutta la app, provando aree e funzioni diverse.');
      const stepText = [
        objective,
        `Passo ${step}/${o.steps}. Lo screenshot allegato è lo stato ATTUALE; i turni precedenti mostrano gli stati passati.`,
        `Elementi cliccabili ORA (i badge nello screenshot):\n${marksToText(map)}`,
        'Rispondi col JSON richiesto.',
      ].join('\n\n');

      // Turno utente con screenshot corrente (resta nel contesto per i passi futuri).
      convo.push({ role: 'user', parts: [{ text: stepText }, imagePart(shot)] });
      pruneOldImages(convo); // tieni al massimo IMG_WINDOW screenshot nel contesto

      // Fino a 2 tentativi: un campione degenere (ramble ripetitiva → JSON
      // troncato) è stocastico, un nuovo sample di solito risolve.
      let parsed = null;
      let modelTurnText = '(risposta non valida)';
      for (let t = 0; t < 3 && !parsed; t++) {
        try {
          const out = await generate({ model: activeModel, system: SYSTEM, contents: convo, temperature: 0.2, schema: SCHEMA });
          parsed = extractJson(out);
          if (parsed) modelTurnText = JSON.stringify(parsed);
          else if (t === 2) {
            writeFileSync(join(o.out, `fail-step-${String(step).padStart(2, '0')}.txt`), out);
            log(`  [step ${step}] JSON non parsabile (len=${out.length}) dopo 3 tentativi.`);
          }
        } catch (e) {
          // Quota/crediti del primario esauriti → passa al fallback per il resto.
          const quota = e?.status === 429 || /429|quota|exhaust/i.test(e?.message || '');
          if (quota && o.fallback && activeModel !== o.fallback) {
            log(`  [step ${step}] ${activeModel} ha esaurito la quota → passo al fallback ${o.fallback}`);
            activeModel = o.fallback;
            t--; // non consumare il tentativo: riprova subito col fallback
            continue;
          }
          log(`  [step ${step}] errore LLM (tentativo ${t + 1}): ${e.message.slice(0, 140)}`);
        }
      }
      // Mantieni l'alternanza user/model nel contesto (compatto, niente ramble).
      convo.push({ role: 'model', parts: [{ text: modelTurnText }] });
      if (!parsed) continue;

      log(`  [step ${step}] ${parsed.screen || ''}`);
      for (const iss of (parsed.issues || [])) {
        const rec = { step, model: activeModel, shot: `shots/step-${String(step).padStart(2, '0')}.png`, ...iss };
        allIssues.push(rec);
        log(`    ⚠ [${iss.severity}] ${iss.title} — ${iss.detail || ''}`);
      }

      const act = parsed.action || { kind: 'finish', reason: 'nessuna azione' };
      log(`    → ${act.kind}${act.mark != null ? ' #' + act.mark : ''}${act.text ? ' "' + String(act.text).slice(0, 30) + '"' : ''}${act.url ? ' ' + act.url : ''}`);
      try {
        switch (act.kind) {
          case 'click_mark': await d.clickMark(app, shell, map, Number(act.mark)); break;
          case 'type':
            // Se il modello indica anche un badge, ci clicchiamo prima per dare
            // il focus al campo giusto subito prima di digitare (robusto).
            if (act.mark != null && map.find((m) => m.i === Number(act.mark))) {
              await d.clickMark(app, shell, map, Number(act.mark));
            }
            await d.typeText(app, shell, act.text || '');
            break;
          case 'key': await d.pressKey(app, shell, act.key || 'Enter'); break;
          case 'scroll': await d.scrollBy(app, shell, Number(act.dy) || 300); break;
          case 'navigate': await d.navigate(app, shell, act.url); break;
          case 'open_tab': await d.openTab(app, shell, act.url); break;
          case 'finish': log(`  [step ${step}] finish: ${act.reason || ''}`); step = o.steps; break;
        }
      } catch (e) {
        log(`    azione fallita (${act.kind}): ${e.message.slice(0, 120)}`);
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
    o.task ? `- Compito: ${o.task}` : `- Area: ${o.area || '(libera)'}`,
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
          model: i.model || o.model,
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
