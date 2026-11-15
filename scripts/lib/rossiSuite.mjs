// I rossi della suite completa per il lavoro settimanale (#2501): quale prova è rossa adesso, da quale corsa, e quali
// sono instabili. Logica pura sulle righe del registro che scrive scripts/suite-verdict.mjs. Prove: tests/unit/rossiSuite.test.mjs.

import { SEGNO_REGISTRO } from '../suite-verdict.mjs';

/** Le righe di una corsa che non arriva in fondo: dicono la corsa, non una prova. */
const RIGA_DI_CORSA = /^parte \d+ di \d+ della suite senza esito|^la suite ha passato il suo tetto di tempo/;

/**
 * Il registro di una corsa letto dal suo log, o null se il log non ne ha (corsa di prima, o verdetto mai partito);
 * `commit` è il commit provato, se il registro lo scrive. PURA.
 */
export function leggiRegistro(log) {
  let esito = '';
  let commit = '';
  const rossi = new Set();
  const instabili = new Set();
  for (const riga of String(log || '').split(/\r?\n/)) {
    const i = riga.indexOf(SEGNO_REGISTRO);
    if (i < 0) continue;
    const resto = riga.slice(i + SEGNO_REGISTRO.length).trim();
    const tab = resto.indexOf('\t');
    if (tab < 0) continue;
    const tipo = resto.slice(0, tab).trim();
    const valore = resto.slice(tab + 1).trim();
    if (!valore) continue;
    if (tipo === 'esito') esito = valore;
    else if (tipo === 'commit' && /^[0-9a-f]{40}$/.test(valore)) commit = valore;
    else if (tipo === 'rosso') rossi.add(valore);
    else if (tipo === 'instabile') instabili.add(valore);
  }
  if (!esito) return leggiRiassuntoVecchio(log);
  return { completo: esito === 'completo', rossi, instabili, ...(commit ? { commit } : {}) };
}

// Le corse di prima del registro hanno solo il riassunto a schermo («Rossi NUOVI: n», poi «  ✗ <prova>»): senza
// questo la prima settimana partirebbe vuota. Le instabili lì non hanno il nome.
function leggiRiassuntoVecchio(log) {
  const righe = String(log || '').split(/\r?\n/).map((r) => r.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z /, ''));
  if (!righe.some((r) => r.startsWith('Casi: '))) return null;
  const rossi = new Set();
  let completo = true;
  let dentro = false;
  for (const r of righe) {
    if (r.startsWith('Rossi NUOVI:')) { dentro = true; continue; }
    if (dentro && !r.startsWith('  ✗ ')) dentro = false;
    if (!dentro) continue;
    const prova = r.slice(4).trim();
    if (RIGA_DI_CORSA.test(prova)) completo = false;
    if (!/\(strascico di /.test(prova)) rossi.add(prova);
  }
  return { completo, rossi, instabili: new Set() };
}

/**
 * Dalle corse in ordine (la più vecchia per prima, ognuna `{ sha, url, quando, registro }`): ogni prova rossa adesso,
 * con la prima corsa rossa della sua serie (la fusione che l'ha rotta) e l'ultima corsa verde prima di lei; a parte le
 * instabili, rosse e verdi sullo stesso commit o verdi dopo un tentativo, che non contano come rosse. Rossa adesso è
 * rossa dall'ultima corsa completa in poi: una corsa incompleta non fa verde una prova che non ha girato, e quella
 * rimasta fuori dall'ultima corsa porta `daRicontrollare`. PURA.
 */
export function rossiDaCorse(corse) {
  const lette = (Array.isArray(corse) ? corse : []).filter((c) => c && c.registro);
  const instabili = new Map();
  const segnaInstabile = (k, c) => {
    const x = instabili.get(k) || { prova: k, corse: [] };
    if (!x.corse.some((y) => y.sha === c.sha)) x.corse.push({ sha: c.sha, url: c.url || '' });
    instabili.set(k, x);
  };
  const perSha = new Map();
  for (const c of lette) {
    for (const k of c.registro.instabili) segnaInstabile(k, c);
    if (!perSha.has(c.sha)) perSha.set(c.sha, []);
    perSha.get(c.sha).push(c);
  }
  // Rossa in una corsa e verde in un'altra sullo stesso commit: instabile.
  for (const stesse of perSha.values()) {
    if (stesse.length < 2) continue;
    for (const c of stesse) {
      for (const k of c.registro.rossi) {
        if (stesse.some((d) => d !== c && d.registro.completo && !d.registro.rossi.has(k))) segnaInstabile(k, c);
      }
    }
  }
  const ultima = lette[lette.length - 1];
  const rossi = [];
  if (ultima) {
    let base = lette.length - 1;
    while (base > 0 && !lette[base].registro.completo) base -= 1;
    // Per ogni prova, l'ultima corsa da `base` in poi in cui è rossa; le righe di corsa valgono solo per l'ultima.
    const dove = new Map();
    for (let i = base; i < lette.length; i += 1) {
      for (const k of lette[i].registro.rossi) {
        if (i === lette.length - 1 || !RIGA_DI_CORSA.test(k)) dove.set(k, i);
      }
    }
    for (const [k, j] of dove) {
      const ora = lette[j];
      if (instabili.has(k) && lette.some((c) => c.sha === ora.sha && c !== ora && c.registro.completo && !c.registro.rossi.has(k))) continue;
      let prima = ora;
      let verde = null;
      for (let i = j - 1; i >= 0; i -= 1) {
        const c = lette[i];
        if (c.registro.rossi.has(k)) prima = c;
        else if (c.registro.completo) { verde = c; break; }
      }
      rossi.push({
        prova: k,
        rottaDa: { sha: prima.sha, url: prima.url || '', quando: prima.quando || '' },
        ultimaVerde: verde ? { sha: verde.sha, url: verde.url || '', quando: verde.quando || '' } : null,
        instabile: instabili.has(k),
        ...(j < lette.length - 1 ? { daRicontrollare: true } : {}),
      });
    }
  }
  return {
    ultima: ultima ? { sha: ultima.sha, url: ultima.url || '', completa: ultima.registro.completo } : null,
    rossi,
    instabili: [...instabili.values()].filter((x) => !rossi.some((r) => r.prova === x.prova)),
    lette: lette.length,
    senzaRegistro: (Array.isArray(corse) ? corse : []).length - lette.length,
  };
}

/** L'elenco per chi lavora, intero: niente tagli, l'elenco è quello che il lavoro settimanale deve chiudere. PURA. */
export function testoElenco(r, { fusioni = () => [] } = {}) {
  const breve = (s) => String(s || '').slice(0, 10);
  const righe = [];
  if (!r.ultima) {
    righe.push(`Nessuna corsa della suite con il registro fra quelle lette (${r.senzaRegistro} senza): l'elenco non si fa da qui.`);
    return righe.join('\n');
  }
  righe.push(`Ultima corsa letta: ${breve(r.ultima.sha)}${r.ultima.completa ? '' : ' (incompleta: una parte non è arrivata in fondo)'} ${r.ultima.url}`.trim());
  righe.push(`Corse lette: ${r.lette}; senza registro: ${r.senzaRegistro}.`, '');
  righe.push(`Prove rosse adesso: ${r.rossi.length}`);
  for (const x of r.rossi) {
    righe.push(`- ${x.prova}${x.instabile ? ' (anche instabile in altre corse)' : ''}`);
    righe.push(`  rossa dalla corsa su ${breve(x.rottaDa.sha)} ${x.rottaDa.url}`.trimEnd());
    if (x.ultimaVerde) {
      const elenco = fusioni(x.ultimaVerde.sha, x.rottaDa.sha);
      righe.push(`  ultima verde su ${breve(x.ultimaVerde.sha)}; fusioni entrate fra le due (una l'ha rotta): ${elenco.length || '?'}`);
      for (const f of elenco) righe.push(`    ${f}`);
    } else {
      righe.push('  nessuna corsa verde prima, fra quelle lette: rossa da prima della finestra');
    }
  }
  righe.push('', `Prove instabili (verdi e rosse sullo stesso commit, non contano come rosse): ${r.instabili.length}`);
  for (const x of r.instabili) righe.push(`- ${x.prova}: in ${x.corse.length} ${x.corse.length === 1 ? 'corsa' : 'corse'}`);
  return righe.join('\n');
}
