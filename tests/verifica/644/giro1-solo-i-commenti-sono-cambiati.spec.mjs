// Verifica #644, giro 1 — la potatura dei commenti HTML/CSS non deve spostare
// una virgola di markup o di regole CSS.
//
// La guardia è meccanica e usa il parser vero: le due versioni di ogni file
// (quella prima della potatura e quella di adesso) vengono date da mangiare al
// motore di Electron, e si confrontano l'albero del DOM senza i nodi commento e
// l'elenco delle regole CSS come le serializza il browser. Gli script
// incorporati nelle pagine si confrontano a commenti tolti, e devono restare
// sintatticamente validi.
//
// Il commit di partenza è fissato a mano: dopo la fusione `origin/main`
// conterrebbe già la potatura e il confronto diventerebbe vuoto. Va rimesso a
// mano a ogni ribasatura del ramo, altrimenti il confronto si porta dentro
// anche il lavoro che la linea principale ha fatto nel frattempo, e i file che
// altri hanno cambiato risultano diversi senza che la potatura c'entri.

import { test, expect } from '../../fixtures/electron.mjs';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const BASE = '13793c5b06bbd3123352446f016e2b2d5f4d730e';

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const esiste = () => { try { git('cat-file', '-e', `${BASE}^{commit}`); return true; } catch (_) { return false; } };

const potati = () => git('diff', '--name-only', `${BASE}...HEAD`, '--', 'src')
  .split('\n').filter((f) => f.endsWith('.html') || f.endsWith('.css'));

const prima = (f) => git('show', `${BASE}:${f}`);
const adesso = (f) => readFileSync(join(ROOT, f), 'utf8');

// Corpi grezzi di <script> e <style>: dentro non c'è markup, e il parser HTML
// non li tocca.
function grezzi(t) {
  const out = [];
  const re = /<(script|style)\b([^>]*)>/gi;
  let m;
  while ((m = re.exec(t))) {
    const tag = m[1].toLowerCase();
    const inizio = m.index + m[0].length;
    const chiusura = t.toLowerCase().indexOf(`</${tag}`, inizio);
    const fine = chiusura === -1 ? t.length : chiusura;
    out.push({ tag, attrs: m[2], body: t.slice(inizio, fine) });
    re.lastIndex = fine;
  }
  return out;
}

// Stripper di commenti JS scritto qui apposta: regex, stringhe e template
// letterali non sono commenti, e una regex ingenua li mangerebbe.
function senzaCommentiJs(t) {
  let out = '', i = 0, prev = '';
  const tpl = [];
  const regexOk = () => (!prev ? true : (/[)\]]$/.test(prev) ? false : (/[\w$]$/.test(prev) ? /\b(return|typeof|case|do|else|in|of|instanceof|new|delete|void|throw|yield|await)$/.test(prev) : true)));
  const dentroTemplate = () => {
    while (i < t.length) {
      if (t[i] === '\\') { out += t.slice(i, i + 2); i += 2; continue; }
      if (t[i] === '`') { out += t[i]; i++; return; }
      if (t[i] === '$' && t[i + 1] === '{') { out += '${'; i += 2; tpl.push(true); return; }
      out += t[i]; i++;
    }
  };
  while (i < t.length) {
    const c = t[i];
    if (c === '/' && t[i + 1] === '/') { while (i < t.length && t[i] !== '\n') i++; continue; }
    if (c === '/' && t[i + 1] === '*') { i += 2; while (i < t.length && !(t[i] === '*' && t[i + 1] === '/')) i++; i += 2; continue; }
    if (c === '"' || c === "'") {
      const q = c; out += c; i++;
      while (i < t.length) { if (t[i] === '\\') { out += t.slice(i, i + 2); i += 2; continue; } out += t[i]; const fine = t[i] === q; i++; if (fine) break; }
      prev = 'x'; continue;
    }
    if (c === '`') { out += c; i++; dentroTemplate(); prev = 'x'; continue; }
    if (c === '}' && tpl.length) { tpl.pop(); out += c; i++; dentroTemplate(); prev = 'x'; continue; }
    if (c === '/' && regexOk()) {
      let j = i + 1, classe = false, chiusa = false;
      while (j < t.length) {
        if (t[j] === '\\') { j += 2; continue; }
        if (t[j] === '[') classe = true;
        else if (t[j] === ']') classe = false;
        else if (t[j] === '/' && !classe) { chiusa = true; break; }
        else if (t[j] === '\n') break;
        j++;
      }
      if (chiusa) { j++; while (j < t.length && /[a-z]/i.test(t[j])) j++; out += t.slice(i, j); i = j; prev = 'x'; continue; }
    }
    out += c;
    if (/\S/.test(c)) prev = c;
    i++;
  }
  return out;
}

const aRighe = (s) => s.replace(/[ \t\r]+/g, ' ').replace(/ ?\n[\s\n]*/g, '\n').trim();

test.describe('#644 — fuori dai commenti non cambia niente', () => {
  test('le regole CSS parsate dal browser sono identiche a prima della potatura', async ({ shell }) => {
    test.skip(!esiste(), 'il commit di partenza non è in questo clone');
    const fogli = [];
    for (const f of potati()) {
      if (f.endsWith('.css')) { fogli.push({ nome: f, a: prima(f), b: adesso(f) }); continue; }
      const ga = grezzi(prima(f)).filter((x) => x.tag === 'style');
      const gb = grezzi(adesso(f)).filter((x) => x.tag === 'style');
      expect(gb.length, `${f}: numero di <style> incorporati`).toBe(ga.length);
      ga.forEach((x, k) => fogli.push({ nome: `${f} <style> #${k}`, a: x.body, b: gb[k].body }));
    }
    expect(fogli.length, 'nessun foglio da confrontare: la potatura non ha toccato niente?').toBeGreaterThan(10);

    const diversi = await shell.evaluate((elenco) => {
      const regole = (testo) => {
        const s = document.createElement('style');
        s.textContent = testo;
        document.head.appendChild(s);
        const dentro = (lista) => [...lista].map((r) => (r.cssRules ? `${r.cssText.split('{')[0].trim()}{${dentro(r.cssRules)}}` : r.cssText)).join('\n');
        const out = dentro(s.sheet.cssRules);
        s.remove();
        return out;
      };
      const fuori = [];
      for (const f of elenco) {
        const a = regole(f.a), b = regole(f.b);
        if (a !== b) {
          let k = 0; while (k < a.length && k < b.length && a[k] === b[k]) k++;
          fuori.push(`${f.nome}: prima ${JSON.stringify(a.slice(k, k + 160))} / adesso ${JSON.stringify(b.slice(k, k + 160))}`);
        }
      }
      return fuori;
    }, fogli);

    expect(diversi, 'la potatura ha cambiato delle regole CSS').toEqual([]);
  });

  test('il DOM delle pagine potate è identico a prima, tolti i nodi commento', async ({ shell }) => {
    test.skip(!esiste(), 'il commit di partenza non è in questo clone');
    const pagine = potati().filter((f) => f.endsWith('.html')).map((f) => ({ nome: f, a: prima(f), b: adesso(f) }));
    expect(pagine.length, 'nessuna pagina da confrontare').toBeGreaterThan(5);

    const diversi = await shell.evaluate((elenco) => {
      const albero = (html) => {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const w = doc.createTreeWalker(doc, NodeFilter.SHOW_COMMENT);
        const via = [];
        while (w.nextNode()) via.push(w.currentNode);
        via.forEach((n) => n.remove());
        // I corpi di script e style si confrontano a parte: qui conta solo che
        // ci siano, nello stesso posto.
        let k = 0;
        doc.querySelectorAll('script, style').forEach((el) => { el.textContent = `\u0000${k++}\u0000`; });
        return doc.documentElement.outerHTML.replace(/[ \t\r\n\f]+/g, ' ').trim();
      };
      const fuori = [];
      for (const p of elenco) {
        const a = albero(p.a), b = albero(p.b);
        if (a !== b) {
          let k = 0; while (k < a.length && k < b.length && a[k] === b[k]) k++;
          fuori.push(`${p.nome}: prima ${JSON.stringify(a.slice(k, k + 160))} / adesso ${JSON.stringify(b.slice(k, k + 160))}`);
        }
      }
      return fuori;
    }, pagine);

    expect(diversi, 'la potatura ha cambiato il markup').toEqual([]);
  });

  test('gli script incorporati restano validi e uguali a commenti tolti', () => {
    test.skip(!esiste(), 'il commit di partenza non è in questo clone');
    const rotti = [], cambiati = [];
    for (const f of potati().filter((x) => x.endsWith('.html'))) {
      const ga = grezzi(prima(f)).filter((x) => x.tag === 'script' && !/\bsrc\s*=/.test(x.attrs));
      const gb = grezzi(adesso(f)).filter((x) => x.tag === 'script' && !/\bsrc\s*=/.test(x.attrs));
      expect(gb.length, `${f}: numero di <script> incorporati`).toBe(ga.length);
      gb.forEach((x, k) => {
        try { new Function(x.body); } catch (e) { rotti.push(`${f} <script> #${k}: ${e.message}`); }
        if (aRighe(senzaCommentiJs(ga[k].body)) !== aRighe(senzaCommentiJs(x.body))) cambiati.push(`${f} <script> #${k}`);
      });
    }
    expect(rotti, 'uno script incorporato non compila più').toEqual([]);
    expect(cambiati, 'uno script incorporato è cambiato fuori dai commenti').toEqual([]);
  });
});

test('i file di partenza esistono ancora: la guardia non passa a vuoto', () => {
  expect(existsSync(join(ROOT, 'tests/unit/commentiRegola.test.mjs')), 'la sentinella dei commenti è sparita').toBe(true);
});
