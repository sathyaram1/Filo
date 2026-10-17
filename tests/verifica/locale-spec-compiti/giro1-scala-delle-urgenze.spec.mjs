// Giro 1 della verifica di «compiti nella spec dei ruoli invertiti»: le decisioni dell'owner del 12/10
// sulla scala delle urgenze devono reggere sui numeri scritti, non solo sulle frasi. Non apre Filo.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const spec = () => readFileSync(join(ROOT, 'SPEC-DOMANDE.md'), 'utf8').replace(/\r\n/g, '\n');
const sezione = (titolo) => {
  const t = spec();
  const i = t.indexOf(titolo);
  if (i < 0) throw new Error(`sezione assente: ${titolo}`);
  const resto = t.slice(i + titolo.length);
  const fine = resto.search(/\n#{2,3} /);
  return fine < 0 ? resto : resto.slice(0, fine);
};
const riga = (testo, inizio) => testo.split('\n').find((l) => l.startsWith(`| ${inizio}`));

const FASI = ['Primo lavoro', 'Verifica', 'Correzione', 'Controllo cieco'];
const INIZIATE = ['Verifica', 'Correzione', 'Controllo cieco'];

function caselle() {
  const s = sezione('### 6.3');
  const out = {};
  for (const f of FASI) {
    const r = riga(s, f);
    expect(r, `riga della fase «${f}» nella tabella delle urgenze`).toBeTruthy();
    const celle = [...r.matchAll(/(\d+)\s*[–-]\s*(\d+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    expect(celle, `quattro caselle p0–p3 per «${f}»`).toHaveLength(4);
    out[f] = celle;
  }
  return out;
}

function senzaFeedback() {
  const s = sezione('### 6.3');
  const n = (nome) => {
    const r = riga(s, nome);
    expect(r, `riga «${nome}» fra i compiti senza feedback`).toBeTruthy();
    const m = r.split('|')[2].match(/\d+/);
    return m ? Number(m[0]) : null;
  };
  return {
    risposta: n('Gestisci la risposta'),
    monitoraggio: n('Monitoraggio'),
    domande: n('Revisione delle domande'),
    unione: n('Unione'),
    potatura: n('Potatura'),
    esplorazione: riga(s, 'Esplorazione'),
  };
}

test('i compiti senza feedback hanno le urgenze decise (47, 45, 30, 20, 5, esplorazione sotto tutto)', () => {
  const u = senzaFeedback();
  expect(u.risposta).toBe(47);
  expect(u.monitoraggio).toBe(45);
  expect(riga(sezione('### 6.3'), 'Monitoraggio')).toMatch(/audit/i);
  expect(riga(sezione('### 6.3'), 'Monitoraggio')).toMatch(/riordino/i);
  expect(u.domande).toBe(30);
  expect(riga(sezione('### 6.3'), 'Revisione delle domande')).toMatch(/posta/i);
  expect(u.unione).toBe(20);
  expect(u.potatura).toBe(5);
  expect(u.esplorazione).toMatch(/sotto tutto/i);
});

test('la priorità 3 sta sopra ogni altra casella e ogni compito senza feedback', () => {
  const c = caselle();
  const minP3 = Math.min(...FASI.map((f) => c[f][3][0]));
  const altri = FASI.flatMap((f) => c[f].slice(0, 3).map((x) => x[1]));
  const u = senzaFeedback();
  const fissi = [u.risposta, u.monitoraggio, u.domande, u.unione, u.potatura];
  expect(minP3).toBeGreaterThan(Math.max(...altri, ...fissi));
});

test('sotto il 3 un feedback iniziato passa davanti a uno nuovo con un gradino in più, non con due', () => {
  const c = caselle();
  for (let p = 0; p < 3; p++) {
    for (const f of INIZIATE) {
      const [minIniz, maxIniz] = c[f][p];
      if (p + 1 < 3) {
        expect(minIniz, `${f} p${p} contro primo lavoro p${p + 1}`).toBeGreaterThan(c['Primo lavoro'][p + 1][1]);
      }
      if (p + 2 <= 3) {
        expect(maxIniz, `${f} p${p} contro primo lavoro p${p + 2}`).toBeLessThan(c['Primo lavoro'][p + 2][0]);
      }
    }
  }
});

test('fiducia e figli sono quattro gradini dentro la casella, e fra due caselle resta un numero libero', () => {
  const c = caselle();
  const tutte = [];
  for (const f of FASI) for (const [a, b] of c[f]) { expect(b - a).toBe(3); tutte.push(`${a}-${b}`); }
  const distinte = [...new Set(tutte)].map((s) => s.split('-').map(Number)).sort((x, y) => x[0] - y[0]);
  for (let i = 1; i < distinte.length; i++) {
    expect(distinte[i][0] - distinte[i - 1][1], `fra ${distinte[i - 1].join('–')} e ${distinte[i].join('–')}`)
      .toBeGreaterThanOrEqual(2);
  }
  const s = sezione('### 6.3');
  expect(s).toMatch(/\+3 fidato/);
  expect(s).toMatch(/\+0 non\s+fidato e figlio/);
  expect(s).toMatch(/al posto degli spareggi/);
});

test('i ricorrenti hanno le stesse urgenze della tabella dei compiti senza feedback', () => {
  const s = sezione('### 4.1');
  const urg = (nome) => {
    const r = s.split('\n').find((l) => l.startsWith('|') && l.toLowerCase().includes(nome));
    expect(r, `ricorrente «${nome}»`).toBeTruthy();
    return Number(r.split('|')[4].trim());
  };
  expect(urg('revisione delle domande')).toBe(30);
  expect(urg('posta')).toBe(30);
  expect(urg('monitoraggio')).toBe(45);
  expect(urg('riordino')).toBe(45);
  expect(urg('potatura')).toBe(5);
  expect(urg('audit')).toBe(45);
});

test('il compito è un oggetto a sé: porta modello e sforzo, il feedback no; scheda e numerazione proprie', () => {
  const s6 = sezione('## 6. Feedback e compiti');
  expect(s6).toMatch(/Non porta un modello/);
  expect(s6).toMatch(/\*\*Compito\*\*: una chiamata di un agente/);
  expect(sezione('### 6.4')).toMatch(/sforzo/);
  const s65 = sezione('### 6.5');
  expect(s65).toMatch(/I compiti ne hanno una\s+loro/);
  expect(s65).toMatch(/Routine → Compiti/);
  expect(s65).toMatch(/restano in Gestione → Feedback/);
  expect(sezione('### 2.1')).toMatch(/Compiti · Compiti ricorrenti/);
  const s62 = sezione('### 6.2');
  expect(s62).toMatch(/Verifica:\*\* un compito solo, compresa la correzione/);
  expect(s62).toMatch(/solo come ripresa/);
  expect(sezione('## 13. Ordine di lavoro')).toMatch(/compiti \(§ 6\)/);
});
