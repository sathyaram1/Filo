// La cartella di una prova da utente (tests/agent/prova.mjs) pronta per la consegna (#2539): schermate cifrate e caricate
// nel deposito degli allegati con la stessa strada dell'app, esito letto intero. Il turno lo compone il server.
// Regole: tests/unit/provaAllegata.test.mjs.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHARED = fileURLToPath(new URL('../../src/shared/', import.meta.url));
const IMMAGINE_RE = /\.(png|jpe?g|webp)$/i;
const RIMANDO_RE = /!\[[^\]\n]*\]\(([^)\n]+)\)/g;
const TIPO = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
const CONCORRENZA = 4;

/** Il modulo degli allegati dell'app, con cifratura e chiave pubblica: `SN_FEEDBACK` su globalThis. */
export function moduloAllegati() {
  if (!globalThis.SN_FEEDBACK || !globalThis.SN_FEEDBACK_CRYPTO) {
    const req = createRequire(import.meta.url);
    for (const f of ['feedbackPublicKey.js', 'feedbackCrypto.js', 'feedback.js']) req(join(SHARED, f));
  }
  return globalThis.SN_FEEDBACK;
}

/** Una schermata cifrata per l'owner e caricata: l'URL col codice di scarico. Lancia col motivo. */
async function caricaSchermata(byte, nome) {
  const FB = moduloAllegati();
  const est = (IMMAGINE_RE.exec(nome) || [])[1] || 'png';
  const sigillato = await FB.sealForUpload(new Blob([byte], { type: TIPO[est.toLowerCase()] }));
  return (await FB.uploadImage(sigillato)).url;
}

/**
 * Le schermate nell'ordine in cui l'esito le cita, poi le altre della cartella per nome: l'owner le legge nell'ordine
 * dei passi. PURA.
 */
export function ordineSchermate(esito, nomi) {
  const ci = new Set(nomi);
  const citate = [];
  for (const m of String(esito || '').matchAll(RIMANDO_RE)) {
    const n = basename(m[1].trim());
    if (ci.has(n) && !citate.includes(n)) citate.push(n);
  }
  return [...citate, ...nomi.filter((n) => !citate.includes(n)).sort()];
}

/**
 * `--prova <cartella>` → { ok: true, prova: { esito, schermate: [{ nome, url }] } } | { ok: false, errore }. Una
 * schermata che non si carica ferma tutto: la prova o arriva intera o non parte, e chi consegna sceglie.
 */
export async function provaDaAllegare(cartella, { carica = caricaSchermata, concorrenza = CONCORRENZA } = {}) {
  const dir = resolve(String(cartella || ''));
  const fermo = (perche) => ({ ok: false, errore: `--prova ${cartella}: ${perche} Non ho consegnato niente.` });
  let esito = '';
  try { esito = readFileSync(join(dir, 'esito.md'), 'utf8'); } catch (e) {
    return fermo(`non leggo esito.md (${e.code || e.message}): serve la cartella che la prova da utente ha scritto (tests/agent/.out/prova-…).`);
  }
  if (!esito.trim()) return fermo('esito.md è vuoto.');
  const nomi = readdirSync(dir).filter((n) => IMMAGINE_RE.test(n) && statSync(join(dir, n)).isFile());
  const tetto = moduloAllegati().TETTO_ALLEGATO;
  const ordinati = ordineSchermate(esito, nomi);
  const grosse = ordinati.map((n) => ({ n, byte: statSync(join(dir, n)).size })).filter((x) => x.byte > tetto);
  if (grosse.length) {
    const mb = (b) => (b / 1024 / 1024).toFixed(1);
    return fermo(`${grosse.map((x) => `${x.n} è di ${mb(x.byte)} MB`).join(', ')}, il deposito ne prende al più ${mb(tetto)} per schermata: toglila dalla cartella e rilancia, o consegna senza --prova.`);
  }
  const schermate = new Array(ordinati.length);
  const errori = [];
  let prossima = 0;
  const lavora = async () => {
    while (prossima < ordinati.length) {
      const i = prossima++;
      const nome = ordinati[i];
      try { schermate[i] = { nome, url: await carica(readFileSync(join(dir, nome)), nome) }; } catch (e) {
        errori.push(`${nome} (${String((e && e.message) || e).slice(0, 200)})`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concorrenza, ordinati.length) }, lavora));
  if (errori.length) {
    return fermo(`${errori.length} schermate su ${ordinati.length} non sono salite nel deposito: ${errori.join('; ')}. Rilancia lo stesso comando, o consegna senza --prova e scrivi nel report la riga dell'esito.`);
  }
  return { ok: true, prova: { esito, schermate } };
}

/** La riga per chi ha consegnato con `--prova`: scritta, non scritta col perché, o server che non ne sa niente. PURA. */
export function testoProvaConsegnata(inviata, risposta) {
  if (!inviata) return '';
  const n = inviata.schermate.length;
  if (!risposta || typeof risposta !== 'object') {
    return 'ATTENZIONE: il server non dice se ha scritto la prova (server vecchio?): scrivi nel report la riga dell\'esito.';
  }
  if (risposta.ok !== true) {
    return `ATTENZIONE: la consegna è registrata ma la prova no (${String(risposta.detail || 'senza motivo')}): mandala con deliver note --notes "…" --prova <cartella>.`;
  }
  return `Prova allegata al report per l'owner: esito e ${n} ${n === 1 ? 'schermata' : 'schermate'}.`;
}
