// Regole Consent-O-Matic (MIT, avviso in src/vendor/consent-o-matic/LICENSE) per il rifiuto dei banner, lato main.
// Tiene il ruleset in memoria: ai content script va solo l'indice dei rilevatori, la regola intera a chi l'ha vista.
// Il motore che le esegue sta in src/content/cookieRules.js; le regole a mano in src/content/cookies.js vincono su queste.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const RULES_FILE = path.join(__dirname, '..', '..', 'vendor', 'consent-o-matic', 'rules.json');

let rules = null;

function load() {
  if (rules) return rules;
  rules = Object.create(null);
  try {
    const data = JSON.parse(fs.readFileSync(RULES_FILE, 'utf8'));
    const src = (data && data.rules) || {};
    for (const name of Object.keys(src)) {
      const r = src[name];
      if (r && Array.isArray(r.detectors) && Array.isArray(r.methods)) rules[name] = r;
    }
  } catch (e) {
    console.warn('[Filo cookie] regole Consent-O-Matic illeggibili', e && e.message);
  }
  return rules;
}

function asList(v) {
  if (Array.isArray(v)) return v.filter(Boolean);
  return v ? [v] : [];
}

// Stessa regola del matcher «url» di Consent-O-Matic: sottostringa, o espressione se `regexp`.
function urlMatches(m, topUrl) {
  const urls = asList(m.url).map(String);
  let hit = false;
  for (const u of urls) {
    if (m.regexp) {
      try { if (new RegExp(u).test(topUrl)) { hit = true; break; } } catch (_) {}
    } else if (topUrl.includes(u)) { hit = true; break; }
  }
  return m.negated ? !hit : hit;
}

// Il primo selettore che DEVE esistere perché il rilevatore scatti: il genitore se c'è, se no il bersaglio.
function coarseSelector(m) {
  const t = m.parent || m.target;
  const sel = t && typeof t.selector === 'string' ? t.selector.trim() : '';
  return sel && sel !== ':scope' ? sel : '';
}

// Indice per il content script: [[nome, [[selettori del rilevatore 1], …]], …]. I matcher «url» si
// decidono qui, sull'indirizzo della scheda; un rilevatore che non li passa non entra.
function detectIndex(topUrl) {
  const all = load();
  const url = String(topUrl || '');
  const out = [];
  for (const name of Object.keys(all)) {
    const dets = [];
    for (const d of all[name].detectors) {
      const matchers = asList(d && d.presentMatcher);
      if (!matchers.length) continue;
      let ok = true;
      const sels = [];
      for (const m of matchers) {
        if (m.type === 'url') { if (!urlMatches(m, url)) { ok = false; break; } continue; }
        if (m.type !== 'css' && m.type !== 'checkbox') { ok = false; break; }
        const s = coarseSelector(m);
        if (s) sels.push(s);
      }
      if (ok) dets.push(sels);
    }
    if (dets.length) out.push([name, dets]);
  }
  return out;
}

function getRule(name) {
  const all = load();
  if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(all, name)) return null;
  return all[name];
}

function count() {
  return Object.keys(load()).length;
}

module.exports = { detectIndex, getRule, count, urlMatches, coarseSelector };
