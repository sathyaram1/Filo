// Una scimmia, in attesa di Bombadil.
//
// Bombadil non ha un eseguibile per Windows (vedi README), e su questa macchina
// non c'era modo di dargli un Linux. Questo file fa la cosa più rozza che
// risponde comunque alla domanda dell'esperimento — «clicchi e digiti a caso su
// una pagina interna di Filo: qualcosa si rompe?» — con le STESSE proprietà
// scritte in `pagina-interna.ts`, così il giorno che Bombadil gira il confronto è
// diretto. Quello che NON fa, e che è il motivo per cui Bombadil esiste:
//
//   - non ha logica temporale (niente «prima o poi», niente «nello stato dopo»);
//   - non guarda la copertura del codice per decidere dove insistere: pesca a
//     caso e basta, quindi esplora molto peggio;
//   - non minimizza la sequenza che ha trovato il guasto.
//
// Uso (con Filo già aperto da apri-filo.mjs):
//   node tests/bombadil/scimmia.mjs [azioni] [seme]

import { chromium } from '@playwright/test';

const AZIONI = Number(process.argv[2] || 300);
const SEME = Number(process.argv[3] || 1);
const PORTA = Number(process.env.FILO_BOMBADIL_PORTA || 9222);

// Generatore suo, seminato: una sequenza che trova un guasto si ripete passando
// lo stesso seme e lo stesso numero di azioni.
let stato = SEME >>> 0;
function caso() {
  stato = (stato * 1664525 + 1013904223) >>> 0;
  return stato / 4294967296;
}
const scegli = (a) => a[Math.floor(caso() * a.length)];

// Niente `undefined` né `NaN` fra le parole da digitare: la pagina le rimanda a
// schermo (in una chat, per esempio) e la proprietà sul testo sporco si accende
// su quello che ha scritto la scimmia. Un rilievo finto che costa un giro.
const PAROLE = ['', ' ', 'aaaa', '0', '-1', '9999999999', 'à è ì', '<script>x</script>',
  '%s %d', '"\'`', '\n', 'x'.repeat(10000), '🙂🙂', '0.0.0.0', '../../etc'];

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORTA}`);
const pagina = browser.contexts()[0].pages()
  .find((p) => p.url().startsWith('filo://') && !p.url().includes('shell'));
if (!pagina) throw new Error('nessuna pagina interna aperta: lancia prima apri-filo.mjs');

const erroriConsole = [];
pagina.on('console', (m) => { if (m.type() === 'error') erroriConsole.push(m.text()); });
pagina.on('pageerror', (e) => erroriConsole.push(`eccezione: ${e.message}`));

// Le stesse tre proprietà di pagina-interna.ts, in una sola passata nel DOM.
async function proprieta() {
  return pagina.evaluate(() => {
    const SPORCO = ['undefined', 'NaN', '[object Object]', '[object Undefined]'];
    const sporco = [];
    const cammino = document.createTreeWalker(document.body, 4);
    let nodo = cammino.nextNode();
    while (nodo) {
      const testo = (nodo.textContent || '').trim();
      if (testo) {
        const padre = nodo.parentElement;
        const disegnato = padre ? (padre.offsetParent !== null || padre === document.body) : false;
        if (disegnato) {
          for (const brutto of SPORCO) {
            if (testo.includes(brutto)) {
              sporco.push(`${brutto} in <${padre.tagName.toLowerCase()}${padre.id ? '#' + padre.id : ''}>: ${testo.slice(0, 100)}`);
            }
          }
        }
      }
      nodo = cammino.nextNode();
    }
    const stile = getComputedStyle(document.documentElement);
    const sfondoCorpo = getComputedStyle(document.body).backgroundColor;
    return {
      testo: (document.body.innerText || '').trim().length,
      elementi: document.body.querySelectorAll('*').length,
      sporco,
      sfondoGettone: stile.getPropertyValue('--sn-bg').trim(),
      testoGettone: stile.getPropertyValue('--sn-fg').trim(),
      sfondoCorpo,
    };
  });
}

function violazioni(s) {
  const rilievi = [];
  if (s.testo < 20 || s.elementi < 10) rilievi.push(`paginaNonVuota: testo=${s.testo} elementi=${s.elementi}`);
  if (s.sporco.length) rilievi.push(`nienteValoriSporchi: ${s.sporco.join(' ;; ')}`);
  if (!s.sfondoGettone || !s.testoGettone
    || s.sfondoCorpo === 'rgba(0, 0, 0, 0)' || s.sfondoCorpo === 'transparent') {
    rilievi.push(`temaCoerente: bg=${s.sfondoGettone} fg=${s.testoGettone} corpo=${s.sfondoCorpo}`);
  }
  return rilievi;
}

// Elementi su cui ha senso agire: visibili, e senza collegamenti che portino
// fuori dalla pagina (da un'altra pagina i rilievi non sarebbero attribuibili).
async function bersagli() {
  return pagina.evaluate(() => {
    const sel = 'button, select, input, textarea, [role=button], [tabindex], a[href^="#"], summary, label';
    const fuori = [];
    document.querySelectorAll(sel).forEach((e, i) => {
      const r = e.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      if (e.offsetParent === null) return;
      if (r.top < 0 || r.top > (window.innerHeight || 0)) return;
      e.setAttribute('data-scimmia', String(i));
      fuori.push({
        chiave: String(i),
        tag: e.tagName.toLowerCase(),
        tipo: e.getAttribute('type') || '',
        id: e.id || '',
        testo: (e.textContent || '').trim().slice(0, 40),
      });
    });
    return fuori;
  });
}

const diario = [];
const trovati = [];
const inizio = Date.now();

for (let n = 1; n <= AZIONI; n += 1) {
  const elenco = await bersagli();
  const tipo = scegli(['clic', 'clic', 'clic', 'scrivi', 'tasto', 'rotella']);
  let descrizione = tipo;
  try {
    if (tipo === 'clic' && elenco.length) {
      const b = scegli(elenco);
      descrizione = `clic su <${b.tag}${b.id ? '#' + b.id : ''}> "${b.testo}"`;
      await pagina.click(`[data-scimmia="${b.chiave}"]`, { timeout: 1500, force: true });
    } else if (tipo === 'scrivi') {
      const campi = elenco.filter((e) => e.tag === 'textarea'
        || (e.tag === 'input' && !['checkbox', 'radio', 'range', 'color'].includes(e.tipo)));
      if (campi.length) {
        const c = scegli(campi);
        const parola = scegli(PAROLE);
        descrizione = `scrivo ${JSON.stringify(parola.slice(0, 20))}${parola.length > 20 ? `…(${parola.length})` : ''} in <${c.tag}${c.id ? '#' + c.id : ''}>`;
        await pagina.fill(`[data-scimmia="${c.chiave}"]`, parola, { timeout: 1500 });
      }
    } else if (tipo === 'tasto') {
      const t = scegli(['Enter', 'Escape', 'Tab', 'ArrowDown', 'ArrowUp', 'Backspace', 'Space', 'End', 'Home']);
      descrizione = `tasto ${t}`;
      await pagina.keyboard.press(t);
    } else {
      const giu = caso() > 0.4;
      descrizione = `rotella ${giu ? 'giù' : 'su'}`;
      await pagina.mouse.wheel(0, giu ? 400 : -400);
    }
  } catch (e) {
    descrizione += ` [non eseguita: ${String(e.message).split('\n')[0].slice(0, 60)}]`;
  }
  diario.push(`${n}. ${descrizione}`);
  await pagina.waitForTimeout(120);

  let stato2;
  try {
    stato2 = await proprieta();
  } catch (e) {
    trovati.push({ n, proprieta: 'pagina non interrogabile', dettaglio: String(e.message).slice(0, 120) });
    break;
  }
  for (const v of violazioni(stato2)) {
    const chiave = v.split(':')[0] + v.slice(0, 140);
    if (!trovati.some((t) => t.chiave === chiave)) {
      trovati.push({ chiave, n, proprieta: v.split(':')[0], dettaglio: v });
      console.log(`\n[!] azione ${n}: ${v}`);
      console.log(`    ultime azioni:\n      ${diario.slice(-5).join('\n      ')}\n`);
    }
  }
  if (erroriConsole.length) {
    for (const e of erroriConsole.splice(0)) {
      const chiave = `console:${e.slice(0, 120)}`;
      if (!trovati.some((t) => t.chiave === chiave)) {
        trovati.push({ chiave, n, proprieta: 'noConsoleErrors', dettaglio: e.slice(0, 300) });
        console.log(`\n[!] azione ${n}: errore in console: ${e.slice(0, 200)}`);
        console.log(`    ultime azioni:\n      ${diario.slice(-5).join('\n      ')}\n`);
      }
    }
  }
}

const secondi = ((Date.now() - inizio) / 1000).toFixed(1);
console.log(`\n=== ${AZIONI} azioni in ${secondi}s su ${pagina.url()} (seme ${SEME})`);
if (!trovati.length) console.log('nessuna proprietà violata.');
for (const t of trovati) console.log(`- azione ${t.n} · ${t.proprieta} · ${t.dettaglio}`);
await browser.close();
