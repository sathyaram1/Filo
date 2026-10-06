// Per ogni modello predefinito (Firestore config/models): quanti host non esclusi e a ritenzione zero restano,
// e se il vincolo toglie l'host più veloce (#831). Usa la rete, fuori dalla suite: `node scripts/host-ritenzione-zero.mjs`.
// Esce 2 se un predefinito resta senza host: coi crediti di Filo quella funzione si fermerebbe per tutti.

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../src/shared/constants.js');
require('../src/main/services/providers/openrouter.js');
const C = globalThis.SN_CONST;
const OR = globalThis.SN_PROVIDER_OPENROUTER;

const FIRESTORE = 'https://firestore.googleapis.com/v1/projects/filo-8b9cb/databases/(default)/documents/config/models';

function fromFs(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromFs);
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, fromFs(x)]));
  return null;
}

async function json(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

// Più veloce = latenza più bassa; senza latenza, throughput più alto. I campi del catalogo cambiano nome: si accettano le forme note.
function speed(e) {
  const num = (v) => (typeof v === 'number' ? v : v && typeof v === 'object' ? Number(v.p50 ?? v.median ?? v.avg) : NaN);
  return { latency: num(e.latency_last_30m ?? e.latency), throughput: num(e.throughput_last_30m ?? e.throughput) };
}

function fastest(list) {
  const withLat = list.filter((e) => Number.isFinite(e.speed.latency));
  if (withLat.length) return withLat.reduce((a, b) => (b.speed.latency < a.speed.latency ? b : a));
  const withThr = list.filter((e) => Number.isFinite(e.speed.throughput));
  if (withThr.length) return withThr.reduce((a, b) => (b.speed.throughput > a.speed.throughput ? b : a));
  return null;
}

const doc = Object.fromEntries(Object.entries((await json(FIRESTORE)).fields || {}).map(([k, v]) => [k, fromFs(v)]));
const registry = doc.modelRegistry || {};
const excluded = Array.isArray(doc.excludedProviders) ? doc.excludedProviders : C.DEFAULT_EXCLUDED_PROVIDERS;
const useBy = new Map();
for (const [action, chain] of Object.entries(doc.models || {})) {
  for (const nick of String(chain || '').split(',').map((x) => x.trim()).filter(Boolean)) {
    const entry = registry[nick];
    const id = entry && entry.model;
    if (!id) { console.log(`! ${action}: «${nick}» non è nel registro remoto, salto`); continue; }
    if (!useBy.has(id)) useBy.set(id, new Set());
    useBy.get(id).add(action);
  }
}

const zdrMap = OR.parseZdrCatalog(await json(OR.ZDR_ENDPOINT));
if (!zdrMap) throw new Error('catalogo a ritenzione zero illeggibile: la forma della risposta non è quella attesa');

let senzaHost = 0;
for (const [id, actions] of useBy) {
  if (C.producerOnlyRule(id)) { console.log(`${id}: solo dal produttore, la ritenzione zero non si applica`); continue; }
  const data = await json(`${OR.MODELS_ENDPOINT}/${id}/endpoints`);
  const endpoints = ((data.data && data.data.endpoints) || []).map((e) => ({
    name: e.provider_name || '', tag: e.tag || '', speed: speed(e),
  }));
  const zdrHosts = zdrMap.get(id.toLowerCase()) || [];
  const isZdr = (e) => zdrHosts.some((z) => (z.tag && z.tag === e.tag) || (z.name && z.name === e.name));
  const allowed = endpoints.filter((e) => !C.hostPolicyViolation(e, id, excluded));
  const ok = allowed.filter(isZdr);
  const top = fastest(allowed);
  const topZdr = fastest(ok);
  const perdeTop = top && !isZdr(top);
  if (!ok.length) senzaHost++;
  console.log(`${id} (${[...actions].length} funzioni: ${[...actions].slice(0, 4).join(', ')}${actions.size > 4 ? '…' : ''})`);
  console.log(`  host: ${endpoints.length}, non esclusi: ${allowed.length}, non esclusi a ritenzione zero: ${ok.length}${ok.length ? '' : '  <-- NESSUNO'}`);
  if (top) console.log(`  più veloce: ${top.name}${perdeTop ? `, PERSO col vincolo (il più veloce rimasto: ${topZdr ? topZdr.name : '—'})` : ', resta'}`);
  else console.log('  più veloce: il catalogo non riporta latenza né throughput');
}
if (senzaHost) {
  console.log(`\n${senzaHost} predefiniti senza host: coi crediti di Filo si fermerebbero. Il sostituto lo sceglie l'owner in Modelli predefiniti.`);
  process.exit(2);
}
