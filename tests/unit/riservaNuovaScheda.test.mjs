// #1128 — la home pronta per la scheda nuova si tiene allineata come le schede aperte: chi annuncia alle schede passa
// da `vistePerAnnunci`, che la comprende, e non da un giro su `tabs` scritto a mano. Il resto: riserva-nuova-scheda.spec.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { RiservaNuovaScheda, vistePerAnnunci } = require('../../src/main/tabs/riservaNuovaScheda.js');
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const wc = (id) => ({ id, isDestroyed: () => false });
const tm = (riserva) => ({ activeId: 'a', tabs: [{ id: 'a', view: { webContents: wc(1) } }, { id: 'b', view: { webContents: wc(2) } }], riserva });

test('gli annunci arrivano alle schede e alla riserva, che non è mai davanti', () => {
  const r = new RiservaNuovaScheda(tm(null));
  r.vista = { webContents: wc(3) };
  const viste = vistePerAnnunci(tm(r));
  assert.deepEqual(viste.map((v) => [v.wc.id, v.inVista]), [[1, true], [2, false], [3, false]]);
});

test('senza riserva (spenta, o fra una consegna e la prossima) restano le schede', () => {
  assert.deepEqual(vistePerAnnunci(tm(null)).map((v) => v.wc.id), [1, 2]);
  const vuota = new RiservaNuovaScheda(tm(null));
  assert.deepEqual(vistePerAnnunci(tm(vuota)).map((v) => v.wc.id), [1, 2]);
  assert.deepEqual(vistePerAnnunci(null), []);
});

test('quello che la pagina dice di sé vale per la scheda che diventerà, e per nessun\'altra', () => {
  const r = new RiservaNuovaScheda(tm(null));
  r.vista = { webContents: wc(3) };
  r.id = 'futura';
  assert.equal(r.campiPer('futura'), r.campi);
  assert.equal(r.campiPer('a'), null);
  assert.equal(r.campiPer(null), null);
});

test('nelle prove la riserva parte spenta e si riaccende a richiesta', () => {
  const prima = process.env.FILO_RISERVA_NUOVA_SCHEDA;
  try {
    process.env.FILO_RISERVA_NUOVA_SCHEDA = '0';
    assert.equal(new RiservaNuovaScheda(tm(null)).spenta, true);
    process.env.FILO_RISERVA_NUOVA_SCHEDA = '1';
    assert.equal(new RiservaNuovaScheda(tm(null)).spenta, false);
    delete process.env.FILO_RISERVA_NUOVA_SCHEDA;
    assert.equal(new RiservaNuovaScheda(tm(null)).spenta, false, 'fuori dalle prove è sempre accesa');
  } finally {
    if (prima === undefined) delete process.env.FILO_RISERVA_NUOVA_SCHEDA;
    else process.env.FILO_RISERVA_NUOVA_SCHEDA = prima;
  }
  const config = readFileSync(join(ROOT, 'playwright.config.js'), 'utf8');
  assert.match(config, /FILO_RISERVA_NUOVA_SCHEDA = '0'/);
});

// Un giro su `.tabs` che spinge messaggi alle pagine lascerebbe la riserva indietro: alla consegna mostrerebbe carte,
// tema o impostazioni di prima. Le eccezioni dicono cosa mandano e perché alla riserva non serve.
const ECCEZIONI = new Map([
  // Lo stato della singola scheda (la riserva lo riceve alla consegna); i campi da ricontrollare per la pulizia, che la riserva non tocca.
  ['src/main/tabs.js', /tab_in_vista|FORM_RECHECK/],
  ['src/main/services/riquadriRotti.js', /RIQUADRO_COOKIE_AGGIORNA/], // solo ai riquadri dei siti
]);

function fileJs(dir) {
  const out = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...fileJs(p));
    else if (n.endsWith('.js')) out.push(p);
  }
  return out;
}

test('nessun giro sulle schede manda annunci alle pagine senza passare da vistePerAnnunci', () => {
  const violazioni = [];
  for (const file of fileJs(join(ROOT, 'src', 'main'))) {
    const rel = relative(ROOT, file).replace(/\\/g, '/');
    const righe = readFileSync(file, 'utf8').split('\n');
    righe.forEach((riga, i) => {
      const giro = /for \(const \w+ of [\w.?]*\.tabs\b/.exec(riga);
      if (!giro) return;
      const rientro = riga.match(/^\s*/)[0].length;
      const corpo = [riga];
      for (let j = i + 1; j < righe.length && j < i + 40; j++) {
        const r = righe[j];
        if (r.trim() && r.match(/^\s*/)[0].length <= rientro) { if (/^\s*}/.test(r)) corpo.push(r); break; }
        corpo.push(r);
      }
      const testo = corpo.join('\n');
      if (!/spingiAllaScheda\(|aFilo\(|\.send\(/.test(testo)) return;
      const eccezione = ECCEZIONI.get(rel);
      if (eccezione && eccezione.test(testo)) return;
      violazioni.push(`${rel}:${i + 1}`);
    });
  }
  assert.deepEqual(violazioni, [], 'questi giri mandano annunci alle schede senza la riserva: usa vistePerAnnunci');
});
