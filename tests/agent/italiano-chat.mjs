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

// Ogni risposta passa da qui: i byte si copiano mentre Filo li legge, e il corpo della richiesta prende `corpo`.
function fetchCheRegistra(fetchVero, corpo, registro) {
  return async (url, init = {}) => {
    let body = init.body;
    if (corpo && typeof body === 'string') {
      const b = JSON.parse(body);
      const { provider, ...resto } = corpo;
      body = JSON.stringify({ ...b, ...resto, ...(provider ? { provider: { ...(b.provider || {}), ...provider } } : {}) });
    }
    const res = await fetchVero(url, { ...init, body });
    if (!res.body || typeof res.body.getReader !== 'function') return res;
    const pezzi = [];
    registro.push(pezzi);
    const lettore = res.body.getReader();
    const legge = { read: async () => { const r = await lettore.read(); if (!r.done && r.value) pezzi.push(r.value); return r; } };
    return { ok: res.ok, status: res.status, headers: res.headers, text: () => res.text(), clone: () => res.clone(), body: { getReader: () => legge } };
  };
}

function unisci(pezzi) {
  const out = new Uint8Array(pezzi.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of pezzi) { out.set(p, i); i += p.length; }
  return out;
}

function esitoStrumento(call, stato) {
  const nome = String(call.name || '').toUpperCase();
  let args = {};
  try { args = JSON.parse(call.arguments || '{}') || {}; } catch (_) {}
  if (nome === 'ONBOARDING') {
    const spunte = Array.isArray(args.spunta) ? args.spunta.filter((id) => Onb.ITEM_IDS.includes(id)) : [];
    stato.ticked = [...new Set([...stato.ticked, ...spunte])];
    if (args.fine === true) stato.fine = true;
    return 'Fatto.';
  }
  if (Tools.haRisultato(nome)) return 'Esito non disponibile in questa prova: rispondi all\'utente con quello che sai già.';
  return `Azione ${nome} eseguita.`;
}

// Una conversazione intera su un modello. `fetchImpl` esiste per la prova senza rete.
export async function provaModello({ model, apiKey, turni = TURNI, corpo = null, ordine = null, fetchImpl = globalThis.fetch }) {
  const registro = [];
  const stato = { ticked: [], fine: false };
  const sistema = 'win32';
  const capacita = globalThis.SN_CAPABILITIES.renderIndexForPrompt([]);
  const filo = [{ role: 'assistant', content: Onb.WELCOME_MESSAGE }];
  const esito = { model, turni: [], costoUsd: 0, tokenIngresso: 0, tokenUscita: 0, host: [], diversi: 0, errore: null };
  const routing = { ignore: excludedProviders, ...(ordine ? { sort: ordine } : {}) };
  const orig = globalThis.fetch;
  globalThis.fetch = fetchCheRegistra(fetchImpl, corpo, registro);
  try {
    for (let n = 0; n < turni.length; n++) {
      const intervista = !stato.fine;
      const p = {
        sistema, capacita, modelName: model,
        onboarding: intervista ? Onb.renderChecklistForPrompt({ ticked: stato.ticked }) : '',
        onboardingTurns: n, onboardingMax: Onb.MAX_EXCHANGES,
      };
      const tools = Tools.definitions({ sistema, onboarding: intervista });
      const turno = { utente: turni[n], intervista, giri: [] };
      esito.turni.push(turno);
      filo.push({ role: 'user', content: turni[n] });
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
        const r = await OpenRouter.streamComplete({
          apiKey, model, messages, tools, providerRouting: routing, maxTokens: 4096,
          onReasoning: (t) => { ragionamento += t; }, onDelta: () => {},
        });
        const grezzo = testoGrezzo(unisci(registro.slice(prima).flat()));
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
        for (const c of r.toolCalls) filo.push(Tools.toolMessage(c.id, esitoStrumento(c, stato)));
      }
    }
  } catch (e) {
    esito.errore = String(e && e.message || e);
  } finally {
    globalThis.fetch = orig;
  }
  return esito;
}

export function rapporto(esiti) {
  const righe = ['# Italiano della chat: intervista di benvenuto e chat', ''];
  righe.push('| modello | costo USD | token in / out | host | grezzo ≠ tenuto | errore |', '|---|---|---|---|---|---|');
  for (const e of esiti) {
    righe.push(`| ${e.model} | ${e.costoUsd.toFixed(4)} | ${e.tokenIngresso} / ${e.tokenUscita} | ${e.host.join(', ') || '?'} | ${e.diversi} | ${e.errore || ''} |`);
  }
  for (const e of esiti) {
    righe.push('', `## ${e.model}`, '');
    for (const t of e.turni) {
      righe.push(`**Utente${t.intervista ? ' (intervista)' : ''}:** ${t.utente}`, '');
      for (const g of t.giri) {
        if (g.testo) righe.push(`**Filo:** ${g.testo}`, '');
        for (const s of g.strumenti) righe.push(`- strumento ${s.nome} ${s.argomenti}`);
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
  const modelli = String(a.modelli || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!modelli.length) {
    console.error('Uso: node tests/agent/italiano-chat.mjs --modelli <id>,<id> [--turni N] [--ordine latency|throughput|price] [--corpo \'{"temperature":0.6}\']');
    process.exit(2);
  }
  const apiKey = getApiKey();
  const turni = TURNI.slice(0, Number(a.turni) || TURNI.length);
  const corpo = a.corpo ? JSON.parse(a.corpo) : null;
  const esiti = await Promise.all(modelli.map((model) => provaModello({ model, apiKey, turni, corpo, ordine: a.ordine || null })));
  const cartella = join(__dirname, '.out');
  mkdirSync(cartella, { recursive: true });
  const nome = `italiano-chat-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  writeFileSync(join(cartella, `${nome}.md`), rapporto(esiti));
  writeFileSync(join(cartella, `${nome}.json`), JSON.stringify({ corpo, ordine: a.ordine || null, esiti }, null, 2));
  for (const e of esiti) console.log(`${e.model}: ${e.costoUsd.toFixed(4)} USD, grezzo diverso in ${e.diversi} giri${e.errore ? `, ERRORE ${e.errore}` : ''}`);
  console.log(`Trascrizioni: ${join(cartella, `${nome}.md`)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e && e.message || e); process.exit(1); });
}
