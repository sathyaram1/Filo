// L'italiano della chat (#1398): gli stessi turni dell'utente, intervista di benvenuto e poi chat normale, su più modelli,
// col prompt e gli strumenti veri e via OpenRouter con la lista di esclusione. Non giudica: scrive in tests/agent/.out/
// le trascrizioni, il confronto fra testo grezzo del fornitore e testo tenuto da Filo, e il costo di ogni modello.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { getApiKey, excludedProviders } from './llm.mjs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, '..', '..', 'src');
for (const m of ['constants.js', 'capabilities.js', 'onboarding.js', 'actionTools.js', 'filoContesto.js']) require(join(SRC, 'shared', m));
require(join(SRC, 'main', 'services', 'providers', 'openrouter.js'));
const C = globalThis.SN_CONST;
const Onb = globalThis.SN_ONBOARDING;
const Tools = globalThis.SN_ACTION_TOOLS;
const FC = globalThis.SN_FILO_CONTESTO;
const OpenRouter = globalThis.SN_PROVIDER_OPENROUTER;

// I primi due e la segnalazione vengono dalle chat dell'owner della segnalazione; i refusi sono voluti.
export const TURNI = [
  'sono il creatore di filo, uso il computer per lavorarci con claude code',
  'dammi del tu',
  'corto e diretto, niente giri di parole',
  'fai pure da solo le cose che si possono annullare',
  'il tema scuro si, mettilo',
  'come li scegli i modelli?',
  'e i crediti come funzionano',
  'metti un po di musica lofi su youtube',
  'ho trovato un bug nella home, segnalalo: il bottone del meteo non si vede piu',
  'ok grazie, a dopo',
];

const GIRI_PER_TURNO = 4;
const ATTESA_MASSIMA_MS = 180_000;

// Il testo come l'ha mandato il fornitore, letto dai byte interi in un colpo solo: nessun taglio di rete in mezzo.
export function testoGrezzo(byte) {
  let testo = '';
  for (const riga of new TextDecoder('utf-8').decode(byte).split(/\r?\n/)) {
    const t = riga.trim();
    if (!t.startsWith('data:')) continue;
    const dati = t.slice(5).trim();
    if (dati === '[DONE]') continue;
    try { testo += JSON.parse(dati).choices?.[0]?.delta?.content || ''; } catch (_) {}
  }
  return testo;
}

// Il fornitore legge `fetch` globale: uno solo per tutti i modelli in parallelo, che smista i byte per modello.
const registri = new Map();
export async function conFetchRegistrato(fetchVero, corpo, fn) {
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    let body = init.body;
    let model = '';
    if (typeof body === 'string') {
      try {
        const b = JSON.parse(body);
        model = String(b.model || '');
        if (corpo) {
          const { provider, ...resto } = corpo;
          body = JSON.stringify({ ...b, ...resto, ...(provider ? { provider: { ...(b.provider || {}), ...provider } } : {}) });
        }
      } catch (_) {}
    }
    const res = await fetchVero(url, { ...init, body });
    const registro = registri.get(model);
    if (!registro || !res.ok || !res.body || typeof res.body.getReader !== 'function') return res;
    const pezzi = [];
    registro.push(pezzi);
    const getReader = () => {
      const lettore = res.body.getReader();
      return { read: async () => { const r = await lettore.read(); if (!r.done && r.value) pezzi.push(r.value); return r; } };
    };
    return { ok: res.ok, status: res.status, headers: res.headers, text: () => res.text(), clone: () => res.clone(), body: { getReader } };
  };
  try { return await fn(); } finally { globalThis.fetch = orig; }
}

function unisci(pezzi) {
  const out = new Uint8Array(pezzi.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of pezzi) { out.set(p, i); i += p.length; }
  return out;
}

function esitoStrumento(call, s) {
  const nome = String(call.name || '').toUpperCase();
  let args = {};
  try { args = JSON.parse(call.arguments || '{}') || {}; } catch (_) {}
  if (nome === 'ONBOARDING') {
    if (args.spunta) s.onb = Onb.tick(s.onb, args.spunta).state;
    if (args.fine === true) s.onb = Onb.close(s.onb);
    return 'Fatto.';
  }
  if (Tools.haRisultato(nome)) return 'Esito non disponibile in questa prova: rispondi all\'utente con quello che sai già.';
  return `Azione ${nome} eseguita.`;
}

async function unGiro(opts) {
  for (let tentativo = 0; ; tentativo++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ATTESA_MASSIMA_MS);
    try {
      return await OpenRouter.streamComplete({ ...opts, signal: ctrl.signal });
    } catch (e) {
      if (tentativo >= 1) throw e;
      await new Promise((r) => setTimeout(r, 3000));
    } finally {
      clearTimeout(timer);
    }
  }
}

// Una conversazione intera su un modello: dentro `conFetchRegistrato`.
export async function provaModello({ model, apiKey, turni = TURNI, ordine = null }) {
  const registro = [];
  registri.set(model, registro);
  const s = { onb: Onb.emptyState() };
  const sistema = 'win32';
  const capacita = globalThis.SN_CAPABILITIES.renderIndexForPrompt([]);
  const filo = [{ role: 'assistant', content: Onb.WELCOME_MESSAGE }];
  const esito = { model, turni: [], costoUsd: 0, tokenIngresso: 0, tokenUscita: 0, host: [], diversi: 0, errore: null };
  const routing = { ignore: excludedProviders, ...(ordine ? { sort: ordine } : {}) };
  try {
    for (let n = 0; n < turni.length; n++) {
      const intervista = !Onb.normalize(s.onb).done;
      const turno = { utente: turni[n], intervista, giri: [] };
      esito.turni.push(turno);
      filo.push({ role: 'user', content: turni[n] });
      // La parola di stop la gestisce l'app, senza modello: qui come lì.
      if (intervista && Onb.isStopRequest(turni[n])) {
        s.onb = Onb.close(s.onb);
        turno.giri.push({ testo: Onb.CLOSING_MESSAGE, grezzo: Onb.CLOSING_MESSAGE, identico: true, fisso: true, strumenti: [] });
        filo.push({ role: 'assistant', content: Onb.CLOSING_MESSAGE });
        continue;
      }
      const p = {
        sistema, capacita, modelName: model,
        onboarding: intervista ? Onb.renderChecklistForPrompt(s.onb) : '',
        onboardingTurns: n, onboardingMax: Onb.MAX_EXCHANGES,
      };
      const tools = Tools.definitions({ sistema, onboarding: intervista });
      const domanda = filo.length - 1;
      for (let g = 0; g < GIRI_PER_TURNO; g++) {
        const messages = [
          ...FC.assembla({
            tratto: [{ role: 'system', content: C.PROMPTS.filoChatStatic(p) + C.PROMPTS.filoChatOnboarding(p) }],
            scheda: filo.slice(0, domanda),
            contesto: FC.coda({ contesto: C.PROMPTS.filoChatContext({ ...p, onboarding: '' }) }),
            domanda: filo[domanda],
          }),
          ...filo.slice(domanda + 1),
        ];
        const prima = registro.length;
        let ragionamento = '';
        const r = await unGiro({
          apiKey, model, messages, tools, providerRouting: routing, maxTokens: 4096,
          onReasoning: (t) => { ragionamento += t; }, onDelta: () => {},
        });
        // Solo l'ultima risposta riuscita: un tentativo fallito prima non è testo che Filo terrebbe.
        const grezzo = testoGrezzo(unisci(registro.slice(prima).slice(-1).flat()));
        const host = r.servedBy || '';
        if (host && C.isProviderExcluded(host, excludedProviders)) throw new Error(`servito da un fornitore escluso: ${host}`);
        if (host && !esito.host.includes(host)) esito.host.push(host);
        esito.costoUsd += Number(r.usage && r.usage.costUsd) || 0;
        esito.tokenIngresso += Number(r.usage && r.usage.promptTokens) || 0;
        esito.tokenUscita += Number(r.usage && r.usage.completionTokens) || 0;
        const giro = { testo: r.text, grezzo, identico: grezzo === r.text, ragionamento: ragionamento.length, strumenti: r.toolCalls.map((c) => ({ nome: c.name, argomenti: c.arguments })) };
        if (!giro.identico) esito.diversi++;
        turno.giri.push(giro);
        filo.push(Tools.assistantMessage({ text: r.text, toolCalls: r.toolCalls, reasoningDetails: r.reasoningDetails }));
        if (!r.toolCalls.length) break;
        for (const c of r.toolCalls) filo.push(Tools.toolMessage(c.id, esitoStrumento(c, s)));
      }
    }
  } catch (e) {
    esito.errore = String((e && e.message) || e);
  } finally {
    registri.delete(model);
  }
  return esito;
}

export function rapporto(esiti, { corpo = null, ordine = null } = {}) {
  const righe = ['# Italiano della chat: intervista di benvenuto e chat', ''];
  if (corpo || ordine) righe.push(`Richiesta modificata: ${JSON.stringify({ corpo, ordine })}`, '');
  righe.push('| modello | costo USD | token in / out | host | grezzo diverso dal tenuto | errore |', '|---|---|---|---|---|---|');
  for (const e of esiti) {
    righe.push(`| ${e.model} | ${e.costoUsd.toFixed(4)} | ${e.tokenIngresso} / ${e.tokenUscita} | ${e.host.join(', ') || '?'} | ${e.diversi} | ${e.errore || ''} |`);
  }
  for (const e of esiti) {
    righe.push('', `## ${e.model}`, '');
    for (const t of e.turni) {
      righe.push(`**Utente${t.intervista ? ' (intervista)' : ''}:** ${t.utente}`, '');
      for (const g of t.giri) {
        if (g.testo) righe.push(`**Filo${g.fisso ? ' (testo fisso dell\'app)' : ''}:** ${g.testo}`, '');
        for (const x of g.strumenti) righe.push(`- strumento ${x.nome} ${x.argomenti}`);
        if (g.strumenti.length) righe.push('');
        if (!g.identico) righe.push('**GREZZO DIVERSO DAL TENUTO.** Grezzo:', '', '```', g.grezzo, '```', '');
      }
    }
  }
  return righe.join('\n') + '\n';
}

function argomenti(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([\w-]+)$/.exec(argv[i]);
    if (m) out[m[1]] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return out;
}

async function main() {
  const a = argomenti(process.argv.slice(2));
  const modelli = [...new Set(String(a.modelli || '').split(',').map((x) => x.trim()).filter(Boolean))];
  if (!modelli.length) {
    console.error('Uso: node tests/agent/italiano-chat.mjs --modelli <id>,<id> [--turni N] [--ordine latency|throughput|price] [--corpo \'{"temperature":0.6}\']');
    process.exit(2);
  }
  const apiKey = getApiKey();
  const turni = TURNI.slice(0, Number(a.turni) || TURNI.length);
  const corpo = a.corpo ? JSON.parse(a.corpo) : null;
  const ordine = typeof a.ordine === 'string' ? a.ordine : null;
  const esiti = await conFetchRegistrato(globalThis.fetch, corpo,
    () => Promise.all(modelli.map((model) => provaModello({ model, apiKey, turni, ordine }))));
  const cartella = join(__dirname, '.out');
  mkdirSync(cartella, { recursive: true });
  const nome = `italiano-chat-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  writeFileSync(join(cartella, `${nome}.md`), rapporto(esiti, { corpo, ordine }));
  writeFileSync(join(cartella, `${nome}.json`), JSON.stringify({ corpo, ordine, esiti }, null, 2));
  for (const e of esiti) console.log(`${e.model}: ${e.costoUsd.toFixed(4)} USD, grezzo diverso in ${e.diversi} giri${e.errore ? `, ERRORE ${e.errore}` : ''}`);
  console.log(`Trascrizioni: ${join(cartella, `${nome}.md`)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error((e && e.message) || e); process.exit(1); });
}
