// shoot.mjs — controllo visivo SCRIPTATO di Filo (per uso umano/Claude).
//
// Esegue una sequenza di passi e salva screenshot compositi (shell + view) che
// possono essere ispezionati a occhio. Pensato per il controllo dopo aver
// implementato una feature: niente LLM, deterministico.
//
// Uso:
//   node tests/agent/shoot.mjs "nav:filo://editor/editor.html; shot:editor; click-shell:#nav-apps; shot:appsmenu"
//   node tests/agent/shoot.mjs --file scenario.txt
//   node tests/agent/shoot.mjs --out tests/agent/.out/mio "tab:filo://history/history.html; shot:history"
//
// Passi disponibili (separati da ';'):
//   nav:URL              naviga la tab attiva
//   tab:URL              apri una nuova tab
//   shot:NAME            cattura screenshot composito → <out>/NAME.png
//   marks:NAME           come shot ma con badge numerati sugli elementi cliccabili
//   click-shell:SELECT   click su selettore CSS della shell (tab bar/barra ind.)
//   click-view:SELECT    click su selettore CSS della view attiva
//   eval-view:JS         esegui JS nella view attiva (per stati dietro flussi non scriptabili)
//   type:TESTO           digita testo nella view attiva
//   key:KEY              premi un tasto (es. Enter, Control+b)
//   wait:MS              attendi N ms

import { mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import * as d from './driver.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const opts = { out: join(__dirname, '.out'), steps: '' };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') opts.out = resolve(argv[++i]);
    else if (argv[i] === '--file') opts.steps = readFileSync(resolve(argv[++i]), 'utf8');
    else rest.push(argv[i]);
  }
  if (!opts.steps) opts.steps = rest.join(' ');
  return opts;
}

async function run() {
  const opts = parseArgs(process.argv.slice(2));
  mkdirSync(opts.out, { recursive: true });
  const steps = opts.steps.split(';').map((s) => s.trim()).filter(Boolean);
  if (!steps.length) {
    console.error('Nessun passo. Esempio: node tests/agent/shoot.mjs "nav:filo://editor/editor.html; shot:editor"');
    process.exit(1);
  }

  const { app, shell } = await d.launchFilo();
  const saved = [];
  try {
    for (const step of steps) {
      const ci = step.indexOf(':');
      const cmd = (ci < 0 ? step : step.slice(0, ci)).trim();
      const arg = ci < 0 ? '' : step.slice(ci + 1).trim();
      console.log('»', cmd, arg);
      switch (cmd) {
        case 'nav': await d.navigate(app, shell, arg); break;
        case 'tab': await d.openTab(app, shell, arg); break;
        case 'shot': {
          const p = join(opts.out, arg + '.png');
          await d.captureComposite(app, p); saved.push(p); break;
        }
        case 'marks': {
          const { map } = await d.markInteractables(app, shell);
          const p = join(opts.out, arg + '.png');
          await d.captureComposite(app, p); saved.push(p);
          await d.clearMarks(app, shell);
          console.log('  marks:', map.map((m) => `${m.i}=${m.page}:${m.tag}"${m.label}"`).join(' | '));
          break;
        }
        case 'click-shell': await shell.click(arg).catch((e) => console.log('  click-shell err', e.message)); await d.sleep(400); break;
        case 'hover-shell': await shell.hover(arg).catch((e) => console.log('  hover-shell err', e.message)); await d.sleep(400); break;
        case 'eval-shell': {
          const r = await shell.evaluate((s) => {
            const el = document.querySelector(s);
            if (!el) return { found: false };
            const cs = getComputedStyle(el);
            return {
              found: true,
              className: el.className,
              tag: el.tagName,
              bg: cs.backgroundColor,
              border: cs.border,
              borderRadius: cs.borderRadius,
              accentRgb: getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb'),
            };
          }, arg);
          console.log('  eval-shell:', JSON.stringify(r));
          break;
        }
        case 'click-view': {
          const v = await d.activeView(app, shell);
          if (v) await v.click(arg).catch((e) => console.log('  click-view err', e.message));
          await d.sleep(400); break;
        }
        case 'rclick-view': {
          // Tasto destro su un selettore della view attiva: apre il menu Filo.
          const v = await d.activeView(app, shell);
          if (v) await v.click(arg, { button: 'right' }).catch((e) => console.log('  rclick-view err', e.message));
          await d.sleep(700); break;
        }
        case 'eval-view': {
          // Esegue JS arbitrario nella view attiva (gemello di eval-shell ma per
          // il WebContentsView). Utile per portare la pagina in uno stato che
          // serve a uno screenshot ma è dietro un flusso non scriptabile a mano
          // (es. aprire un overlay che normalmente apre un'azione di chat).
          // La funzione è costruita in Node (`new Function`) e iniettata da
          // Playwright: gira nel contesto pagina ma NON passa per `eval` in-page,
          // quindi non urta la CSP `script-src 'self' filo:`.
          const v = await d.activeView(app, shell);
          if (v) {
            try {
              const fn = new Function(`return (async () => { ${arg} })()`);
              const r = await v.evaluate(fn);
              console.log('  eval-view:', JSON.stringify(r));
            } catch (e) { console.log('  eval-view err', e.message); }
          }
          await d.sleep(400); break;
        }
        case 'type': await d.typeText(app, shell, arg); break;
        case 'key': await d.pressKey(app, shell, arg); break;
        case 'wait': await d.sleep(Number(arg) || 0); break;
        default: console.log('  passo sconosciuto:', cmd);
      }
    }
  } finally {
    await d.closeFilo(app);
  }
  console.log('\nScreenshot salvati:');
  for (const p of saved) console.log('  ' + p);
}

run().catch((e) => { console.error(e); process.exit(1); });
