// Verifica del lavoro «#680», terzo giro — il freno sulle scansioni.
//
// Quello che la segnalazione chiedeva (punto 5) è che il PROSSIMO strumento di
// manutenzione non possa dimenticarsi di dire quali campi gli servono: una
// sentinella che diventa rossa. Il freno però riconosce dei MODI DI SCRIVERE,
// non il fatto, e i due giri precedenti hanno già trovato due grafie che gli
// passavano davanti (l'elenco dei metodi scritto a mano, la sottocartella degli
// attrezzi, il nome della variabile). Qui si prova la stessa cosa dall'altro
// lato: si scrive uno strumento che scarica la collezione intera, in una grafia
// per volta, e si guarda se il freno scatta.
//
// Ogni caso è uno strumento vero messo dentro `scripts/`, non una stringa data
// in pasto a una regex: è l'unico modo in cui la prova dice qualcosa sul freno
// che gira davvero.
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const SENTINELLA = 'tests/unit/letturePerCampi.test.mjs';

// Lo strumento finto, lasciato in `scripts/` per il tempo di una corsa della
// sentinella. `finally` lo toglie sempre: un file dimenticato lì dentro
// renderebbe rossa la sentinella per sempre, e per il motivo sbagliato.
function frenoScatta(nomeFile, corpo) {
  const percorso = join(ROOT, 'scripts', nomeFile);
  writeFileSync(percorso, `// strumento finto di una prova: lo toglie la prova stessa.\n${corpo}\n`, 'utf8');
  try {
    execFileSync(process.execPath, ['--test', SENTINELLA], { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });
    return false;
  } catch (_) {
    return true;
  } finally {
    rmSync(percorso, { force: true });
  }
}

test('il freno scatta su uno strumento che chiede la collezione senza dire i campi', () => {
  // Il caso di controllo: se questo non è rosso, la prova qui sotto non dice
  // niente. È la grafia che gli script del ramo usano davvero.
  expect(frenoScatta('__prova-freno-nudo.mjs', `
import { createRequire } from 'node:module';
const FB = globalThis.SN_FEEDBACK;
export async function tutti(token) {
  const r = await FB.listAllPaged({ idToken: token });
  return r.rows;
}
`)).toBe(true);
});

// Le grafie che passano. Ognuna scarica la collezione INTERA per guardarne tre
// campi: è la spesa che la segnalazione voleva fermare, e nessuno lo dice.
const GRAFIE = {
  'chiesta col punto di domanda (FB?.listAllPaged)': `
const FB = globalThis.SN_FEEDBACK;
export async function tutti(token) {
  const r = await FB?.listAllPaged({ idToken: token });
  return r.rows;
}
`,
  'il metodo preso dal modulo e chiamato da solo': `
const FB = globalThis.SN_FEEDBACK;
const { listAllPaged } = FB;
export async function tutti(token) {
  const r = await listAllPaged({ idToken: token });
  return r.rows;
}
`,
  'la domanda al database scritta dentro la richiesta': `
export async function tutti(base, chiave, token) {
  const res = await fetch(\`\${base}:runQuery?key=\${chiave}\`, {
    method: 'POST',
    headers: { Authorization: \`Bearer \${token}\` },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'feedback' }], limit: 500 } }),
  });
  return (await res.json()).filter((r) => r.document).map((r) => r.document);
}
`,
  'l\'elenco chiesto con la chiave davanti al numero di pagina': `
export async function tutti(base, chiave, token) {
  const res = await fetch(\`\${base}/feedback?key=\${chiave}&pageSize=300\`, {
    headers: { Authorization: \`Bearer \${token}\` },
  });
  return (await res.json()).documents || [];
}
`,
  'l\'indirizzo dell\'elenco messo insieme con un più': `
export async function tutti(base, qs, token) {
  const res = await fetch(base + '/feedback?' + qs, { headers: { Authorization: \`Bearer \${token}\` } });
  return (await res.json()).documents || [];
}
`,
};

let i = 0;
for (const [come, corpo] of Object.entries(GRAFIE)) {
  i += 1;
  test(`il freno scatta anche se la scansione è scritta così: ${come}`, () => {
    expect(frenoScatta(`__prova-freno-${i}.mjs`, corpo),
      `«${come}» scarica la collezione intera e la sentinella resta verde`).toBe(true);
  });
}
