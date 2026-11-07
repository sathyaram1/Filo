// Gli unit sul risultato della fusione dentro l'azione chiesta dal server (.github/workflows/unit-fusione.yml, #1207):
// ogni sistema prova la coppia (ramo, main) in una sua parte, e `--unisci` scrive l'unica riga che il server legge (#2225).
// Gira dagli strumenti di main, mai da quelli del ramo provato. Sentinella: tests/unit/unitFusioneAzione.test.mjs.

import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { provaUnitSullaFusione, campoPerIlServer, testoProva, TETTO_ROSSI } from './lib/unit-sulla-fusione.mjs';

// Il server cerca la riga che COMINCIA così, l'ultima del registro: l'uscita dei test provati è rientrata, mai in colonna.
export const MARCA = 'FILO-UNIT-FUSIONE';
// La riga di una parte: non comincia come MARCA, così il server non la scambia per l'esito.
export const MARCA_PARTE = 'ESITO-PARTE-UNIT';
const SHA = /^[0-9a-f]{40}$/;
const NOME_PARTE = /^[a-z]{1,20}$/;
// Gli esiti con cui il server porta il lavoro alla fusione: la corsa verde li dice anche a chi guarda Actions.
const SI_FONDE = new Set(['verde', 'main_contenuto', 'rosso_anche_su_main']);
const NON_SI_FONDE = new Set(['rosso_sulla_fusione', 'conflitto']);
// Fra due esiti che fondono vale quello che dice di più: un rosso anche su main non si perde dietro un verde.
const PESO_SI_FONDE = ['main_contenuto', 'verde', 'rosso_anche_su_main'];

/** `tutti`, o qualunque altro valore, vuoto compreso, che vale `toccati`: la prova veloce è il default. PURA. */
export function modoUnit(v) {
  return v === 'tutti' ? 'tutti' : 'toccati';
}

/** --root <cartella> --ramo <sha> --main <sha> [--parte <nome> --unit <modo>] | --unisci <nomi> --ramo --main. PURA. */
export function leggiArgomenti(argv) {
  const out = { root: '', ramo: '', main: '', parte: '', unit: 'tutti', unisci: [], errori: [] };
  const a = Array.isArray(argv) ? argv : [];
  for (let i = 0; i < a.length; i++) {
    const k = String(a[i]);
    if (!['--root', '--ramo', '--main', '--parte', '--unit', '--unisci'].includes(k)) { out.errori.push(`argomento sconosciuto: ${k.slice(0, 60)}`); continue; }
    const v = String(a[i + 1] ?? '');
    i++;
    if (k === '--unit') out.unit = modoUnit(v);
    else if (k === '--unisci') out.unisci = v.split(',').filter(Boolean);
    else out[k.slice(2)] = v;
  }
  if (out.unisci.length) {
    if (out.root || out.parte) out.errori.push('--unisci non prova niente: niente --root né --parte');
    for (const n of out.unisci) if (!NOME_PARTE.test(n)) out.errori.push(`parte non valida: ${n.slice(0, 30)}`);
  } else if (!out.root) out.errori.push('manca --root');
  if (out.parte && !NOME_PARTE.test(out.parte)) out.errori.push('--parte: solo lettere minuscole');
  for (const k of ['ramo', 'main']) {
    out[k] = out[k].toLowerCase();
    if (!SHA.test(out[k])) out.errori.push(`--${k} dev'essere uno sha intero`);
  }
  return out;
}

/** Il campo dell'esito per il server: quello della richiesta di fusione (#929), più la coppia provata. PURA. */
export function campoEsito({ ramo, main, prova }) {
  const p = prova || {};
  const campo = campoPerIlServer(p) || { esito: 'non_provata', motivo: String(p.motivo || 'prova non fatta').slice(0, 300) };
  return { ramo, main, ...campo };
}

/** La riga che il server legge. PURA. Una riga sola: niente a capo nel JSON. */
export function rigaEsito(campo) {
  return `${MARCA} ${JSON.stringify(campo)}`;
}

/** 0 = si fonde, 1 = non si fonde (rossi o conflitto), 2 = prova non fatta. PURA. */
export function codiceUscita(campo) {
  const e = String((campo && campo.esito) || '');
  if (SI_FONDE.has(e)) return 0;
  if (NON_SI_FONDE.has(e)) return 1;
  return 2;
}

const etichetta = (nome) => (nome === 'linux' ? '' : ` [${nome.charAt(0).toUpperCase()}${nome.slice(1)}]`);
const intero = (n) => Math.max(0, Math.floor(Number(n) || 0));

/**
 * L'esito unico dalle parti (#2225). PURA. `parti`: [{ nome, risultato, campo }], `risultato` quello del lavoro di Actions
 * e `campo` il JSON della parte. Una parte saltata (spenta) non conta; una senza esito valido per la coppia fa
 * `non_provata`. Conflitto > rossi sulla fusione > non provata > l'esito che fonde e dice di più. I rossi di
 * un sistema che non è Linux portano il suo nome in coda, dopo il nome del test.
 */
export function unisciParti({ ramo, main, parti = [] } = {}) {
  const lette = [];
  const mancate = [];
  for (const p of parti) {
    const nome = String((p && p.nome) || '?');
    const risultato = String((p && p.risultato) || 'assente');
    if (risultato === 'skipped') continue;
    let c = null;
    try { c = JSON.parse(String((p && p.campo) || '')); } catch (_) { c = null; }
    const valido = c && typeof c === 'object' && c.ramo === ramo && c.main === main
      && (SI_FONDE.has(c.esito) || NON_SI_FONDE.has(c.esito) || c.esito === 'non_provata');
    if (!valido) { mancate.push(`${nome}: ${risultato === 'success' ? 'nessun esito per questa coppia' : `corsa ${risultato}`}`); continue; }
    if (c.esito === 'non_provata') { mancate.push(`${nome}: ${String(c.motivo || 'prova non fatta')}`); continue; }
    lette.push({ nome, c });
  }
  const base = { ramo, main };
  const conSha = lette.find((l) => SHA.test(String(l.c.mainSha || '')));
  const mainSha = conSha ? conSha.c.mainSha : main;
  const conStoriaParte = lette.find((l) => l.nome === 'linux' && l.c.storia) || lette.find((l) => l.c.storia);
  const conStoria = conStoriaParte ? { storia: conStoriaParte.c.storia } : {};
  const conflitto = lette.find((l) => l.c.esito === 'conflitto');
  if (conflitto) return { ...base, esito: 'conflitto', mainSha, ...conStoria, ...(Array.isArray(conflitto.c.file) ? { file: conflitto.c.file } : {}) };
  const rosse = lette.filter((l) => l.c.esito === 'rosso_sulla_fusione');
  if (rosse.length) {
    const rossi = rosse.flatMap((l) => (Array.isArray(l.c.rossi) ? l.c.rossi : []).map((r) => `${String(r).slice(0, 280)}${etichetta(l.nome)}`));
    const totale = rosse.reduce((n, l) => n + (Array.isArray(l.c.rossi) ? l.c.rossi.length : 0) + intero(l.c.altriRossi), 0);
    const out = { ...base, esito: 'rosso_sulla_fusione', mainSha, ...conStoria, rossi: rossi.slice(0, TETTO_ROSSI) };
    if (totale > out.rossi.length) out.altriRossi = totale - out.rossi.length;
    return out;
  }
  if (mancate.length || !lette.length) {
    return { ...base, esito: 'non_provata', motivo: (mancate.join('; ') || 'nessuna parte provata').slice(0, 300), ...conStoria };
  }
  const esito = lette.map((l) => l.c.esito).reduce((a, b) => (PESO_SI_FONDE.indexOf(b) > PESO_SI_FONDE.indexOf(a) ? b : a));
  return { ...base, esito, mainSha, ...conStoria };
}

/** Le parti dall'ambiente del lavoro che unisce: CAMPO_<NOME> e RISULTATO_<NOME>, scritti dal workflow. PURA. */
export function partiDaAmbiente(nomi, env) {
  return nomi.map((nome) => ({ nome, campo: env[`CAMPO_${nome.toUpperCase()}`] || '', risultato: env[`RISULTATO_${nome.toUpperCase()}`] || '' }));
}

function riassunto(titolo, testo, riga) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  try { appendFileSync(file, `## ${titolo}\n\n\`\`\`\n${testo}\n\`\`\`\n\n\`${riga}\`\n`, 'utf8'); } catch (_) { /* il riassunto è per chi guarda, l'esito è nel registro */ }
}

function main() {
  const a = leggiArgomenti(process.argv.slice(2));
  if (a.errori.length) {
    console.error(`unit-fusione-azione: ${a.errori.join('; ')}`);
    process.exit(2);
  }
  if (a.unisci.length) {
    const campo = unisciParti({ ramo: a.ramo, main: a.main, parti: partiDaAmbiente(a.unisci, process.env) });
    const riga = rigaEsito(campo);
    riassunto('Unit sulla fusione: esito per il server', a.unisci.join(' + '), riga);
    console.log(riga);
    process.exit(codiceUscita(campo));
  }
  const prova = provaUnitSullaFusione({ root: resolve(a.root), punta: a.ramo, mainSha: a.main, unit: a.unit, scrivi: (s) => console.log(s) });
  const testo = testoProva(prova);
  console.log(testo);
  const campo = campoEsito({ ramo: a.ramo, main: a.main, prova });
  if (!a.parte) {
    const riga = rigaEsito(campo);
    riassunto('Unit sulla fusione', testo, riga);
    console.log(riga);
    process.exit(codiceUscita(campo));
  }
  // Una parte non decide la corsa: esce verde con l'esito scritto, e lo giudica il lavoro che unisce.
  const json = JSON.stringify(campo);
  riassunto(`Unit sulla fusione (${a.parte}, ${a.unit})`, testo, json);
  console.log(`${MARCA_PARTE} ${a.parte} ${json}`);
  if (process.env.GITHUB_OUTPUT) {
    try { appendFileSync(process.env.GITHUB_OUTPUT, `campo=${json}\n`, 'utf8'); } catch (e) {
      console.error(`unit-fusione-azione: non riesco a scrivere l'esito della parte (${e.message})`);
      process.exit(2);
    }
  }
  process.exit(0);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main();
