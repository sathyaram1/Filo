// Prova da utente (#2507): Haiku, come istanza figlia di Claude Code nella quota della sessione, usa Filo per un compito
// detto in una frase, coi passi di driver.mjs, e lascia passi, schermate ed esito in una cartella che non va nel repo.
// Non giudica al posto di chi lavora: le schermate sì. Regole pure e prove: provaRegole.mjs, tests/unit/provaDaUtente.test.mjs.

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative } from 'node:path';
import { createInterface } from 'node:readline';
import * as d from './driver.mjs';
import { getApiKey } from './llm.mjs';
import { apriFiloPerLaProva, preparaFilo } from './provaPreparazione.mjs';
import { eseguiMossa } from './provaMosse.mjs';
import {
  USO, leggiArgomenti, sistema, messaggioPasso, leggiMossa, rigaMossa, servitoDa, esitoFinale, resoconto, argomentiModello,
} from './provaRegole.mjs';
import { trovaClaude, envFiglio } from '../../scripts/orchestratore-locale.mjs';
import { accendiSchermo } from '../../scripts/lib/schermo-virtuale.mjs';
import { datiWorker } from '../../scripts/lib/dati-worker.mjs';

// Il margine per chiudere Filo e scrivere la cartella dentro il tetto dei minuti.
const MARGINE_MS = 15_000;
const INVALIDE_DI_FILA = 3;

// Haiku in una conversazione sola (stream-json): ogni turno è una schermata, la risposta è la mossa.
function apriModello(claude, modello, prompt) {
  const cwd = tmpdir();
  // Un FILO_CLAUDE_BIN che è uno script (il finto delle prove) parte con Node, su ogni sistema.
  const [cmd, args] = /\.m?js$/.test(claude) ? [process.execPath, [claude, ...argomentiModello(modello, prompt)]] : [claude, argomentiModello(modello, prompt)];
  const figlio = spawn(cmd, args, { cwd, env: envFiglio(process.env, { cwd }), stdio: ['pipe', 'pipe', 'pipe'] });
  let attesa = null;
  let stderr = '';
  let uscito = '';
  const chiudiAttesa = (v) => { const a = attesa; attesa = null; if (a) { clearTimeout(a.tetto); a.risolvi(v); } };
  createInterface({ input: figlio.stdout }).on('line', (riga) => {
    let j;
    try { j = JSON.parse(riga); } catch (_) { return; }
    if (j.type === 'result') chiudiAttesa({ risultato: j });
  });
  figlio.stderr.on('data', (b) => { stderr = (stderr + b).slice(-2000); });
  figlio.on('error', (e) => { uscito = `il modello non parte: ${e.message}`; chiudiAttesa({ errore: uscito }); });
  figlio.on('exit', (c, s) => { uscito = `il modello è uscito (${s || c})${stderr.trim() ? `: ${stderr.trim()}` : ''}`; chiudiAttesa({ errore: uscito }); });
  return {
    chiedi(testo, immagine, ms) {
      if (uscito) return Promise.resolve({ errore: uscito });
      return new Promise((risolvi) => {
        attesa = { risolvi, tetto: setTimeout(() => chiudiAttesa({ tempo: true }), Math.max(1000, ms)) };
        const content = [{ type: 'text', text: testo }];
        if (immagine) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: readFileSync(immagine).toString('base64') } });
        figlio.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content } })}\n`);
      });
    },
    chiudi() { try { figlio.stdin.end(); } catch (_) {} setTimeout(() => { try { figlio.kill('SIGTERM'); } catch (_) {} }, 2000).unref(); },
  };
}

async function run() {
  const a = leggiArgomenti(process.argv.slice(2));
  if (!a.ok) { console.error(`${a.errore}\n\n${USO}`); return 2; }
  const o = a.opzioni;
  const t0 = Date.now();
  const scadenza = t0 + o.minuti * 60_000 - MARGINE_MS;
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const out = o.out ? resolve(o.out) : join(d.APP_ROOT, 'tests', 'agent', '.out', `prova-${ts}`);
  mkdirSync(out, { recursive: true });

  const claude = trovaClaude();
  if (!claude) { console.error('Claude Code non si trova (PATH o FILO_CLAUDE_BIN): senza, Haiku non parte.'); return 3; }
  let chiave = '';
  let avviso = '';
  try { chiave = getApiKey(); } catch (e) {
    if (o.modo === 'chat') { console.error(`Il modo chat fa rispondere la chat di Filo con un modello vero. ${e.message}`); return 2; }
    // Senza chiave Filo si accende lo stesso, con una chiave che il fornitore rifiuta: le schermate restano quelle
    // di un utente normale, e l'avviso dice che i modelli non rispondono.
    chiave = 'chiave-assente';
    avviso = `Nessuna chiave OpenRouter: Filo è acceso ma le funzioni che passano da un modello rispondono con un errore. ${e.message}`;
    console.log(avviso);
  }

  const schermo = await accendiSchermo({ worker: datiWorker({ root: d.APP_ROOT }) });
  if (schermo.nota) console.log(schermo.nota);
  const modello = apriModello(claude, o.modello, sistema(o.modo));
  const passi = [];
  let fine = null;
  let tetto = '';
  let errore = '';
  let ultimo = null;
  let finale = '';
  let app = null;
  try {
    const aperta = await apriFiloPerLaProva();
    app = aperta.app;
    const { shell } = aperta;
    if (chiave) await preparaFilo(app, shell, chiave);
    if (o.start) await d.navigate(app, shell, o.start);
    let fuoco = null;
    let nota = '';
    for (let n = 1; n <= o.passi; n++) {
      if (Date.now() >= scadenza) { tetto = 'tempo'; break; }
      const { map } = await d.markInteractables(app, shell);
      const nome = `passo-${String(n).padStart(2, '0')}.png`;
      await d.captureComposite(app, join(out, nome));
      await d.clearMarks(app, shell);
      const testo = messaggioPasso({ compito: o.compito, passo: n, passi: o.passi, secondiRestanti: (scadenza - Date.now()) / 1000, map, notaUltima: nota });
      // Una risposta che non si esegue torna al modello sulla stessa schermata: non consuma un passo.
      let letta = null;
      let r = await modello.chiedi(testo, join(out, nome), scadenza - Date.now());
      for (let tentativo = 1; ; tentativo++) {
        if (r.tempo || r.errore) break;
        ultimo = r.risultato;
        const servito = servitoDa(ultimo.modelUsage);
        if (servito.violazione) { r = { errore: `modello fuori politica: ${servito.violazione}` }; break; }
        if (ultimo.is_error) { r = { errore: `il modello ha risposto con un errore: ${String(ultimo.result || ultimo.subtype).slice(0, 300)}` }; break; }
        letta = leggiMossa(ultimo.result, map.map((m) => m.i));
        if (letta.ok) break;
        if (tentativo >= INVALIDE_DI_FILA) { r = { errore: `${INVALIDE_DI_FILA} risposte non eseguibili di fila (l'ultima: ${letta.errore}; testo: ${String(ultimo.result).slice(0, 200)})` }; break; }
        r = await modello.chiedi(`La risposta non va: ${letta.errore}. Stessa schermata di prima: rispondi col JSON.`, null, scadenza - Date.now());
      }
      if (r.tempo) { tetto = 'tempo'; passi.push({ n, schermata: nome, vedo: '', mossa: { azione: 'aspetta il modello' }, nota: 'tempo finito mentre il modello rispondeva' }); break; }
      if (r.errore) { errore = r.errore; break; }
      nota = '';
      const passo = { n, schermata: nome, vedo: letta.mossa.vedo, mossa: letta.mossa };
      passi.push(passo);
      console.log(`[passo ${n}] ${passo.vedo} → ${rigaMossa(letta.mossa)}`);
      if (letta.mossa.azione === 'fine') { fine = letta.mossa; break; }
      try {
        fuoco = await eseguiMossa(app, shell, letta.mossa, map, fuoco);
        await d.sleep(500);
      } catch (e) {
        passo.nota = `la mossa non è riuscita: ${String(e.message).split('\n')[0].slice(0, 200)}`;
        nota = passo.nota;
      }
      if (n === o.passi) tetto = 'passi';
    }
    try { await d.captureComposite(app, join(out, 'finale.png')); finale = 'finale.png'; } catch (_) {}
  } catch (e) {
    errore = errore || `lo strumento si è fermato: ${String(e.message).split('\n')[0].slice(0, 300)}`;
  } finally {
    modello.chiudi();
    if (app) await d.closeFilo(app);
    await schermo.spegni();
  }

  const esito = esitoFinale({ fine, passi, tetto, errore, opzioni: o });
  const servito = servitoDa(ultimo && ultimo.modelUsage);
  const costo = Number(ultimo && ultimo.total_cost_usd) || 0;
  const secondi = (Date.now() - t0) / 1000;
  const dati = { compito: o.compito, modo: o.modo, ...esito, passi, servito, costo, secondi: Math.round(secondi), finale, avviso };
  writeFileSync(join(out, 'esito.json'), `${JSON.stringify(dati, null, 2)}\n`);
  writeFileSync(join(out, 'esito.md'), resoconto({ opzioni: o, esito, passi, servito, costo, secondi, finale, avviso }));
  const dove = relative(process.cwd(), out) || out;
  console.log(`\n${esito.riga}\nModello: ${servito.modelli.join(', ') || o.modello}, servito da ${servito.fornitore || 'non riportato'}. ${Math.round(secondi)} s.`);
  console.log(`Passi e schermate: ${join(dove, 'esito.md')} (il giudizio del modello è un indizio: guarda le schermate).`);
  return esito.codice;
}

run().then((c) => process.exit(c), (e) => { console.error(e); process.exit(3); });
