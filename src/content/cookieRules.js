// Motore delle regole Consent-O-Matic (MIT, © CAVI Aarhus University; avviso in src/vendor/consent-o-matic/LICENSE).
// Esegue una regola scelta da cookies.js, con ogni categoria di consenso a «no»: non decide quando, e non chiude mai la scheda.
// Le regole arrivano dal main (services/consentRules.js); la semantica è quella di Consent-O-Matic, file per file.

(function (global) {
  'use strict';

  // Rifiuto di tutto quello che si può rifiutare: preferenze, statistiche, archiviazione, contenuti, pubblicità, altro.
  const REJECT_ALL = Object.freeze({ A: false, B: false, D: false, E: false, F: false, X: false });

  const IN_FRAME = (() => { try { return window.top !== window.self; } catch (_) { return true; } })();

  function asList(v) {
    if (Array.isArray(v)) return v.filter(Boolean);
    return v ? [v] : [];
  }

  const SPACES = /\s{2,}/gm;
  function norm(s) { return String(s || '').toLowerCase().replace(SPACES, ' '); }

  function wait(ms) { return new Promise((r) => setTimeout(r, Math.max(0, ms || 0))); }

  // ─── selezione (Tools.js) ──────────────────────────────────────────────────

  function findElements(ctx, opts, parent) {
    if (!opts || typeof opts.selector !== 'string') return [];
    let list;
    if (opts.selector.trim() === ':scope') {
      list = [parent || ctx.base || document];
    } else {
      let top = parent || ctx.base || document;
      if (top.shadowRoot) top = top.shadowRoot;
      try { list = Array.from(top.querySelectorAll(opts.selector)); } catch (_) { return []; }
    }
    if (opts.textFilter != null) {
      const filters = asList(opts.textFilter).map(norm);
      list = list.filter((el) => {
        const t = norm(el.textContent);
        return filters.some((f) => t.indexOf(f) !== -1);
      });
    }
    if (Array.isArray(opts.styleFilters)) {
      list = list.filter((el) => {
        let cs;
        try { cs = getComputedStyle(el); } catch (_) { return false; }
        return opts.styleFilters.every((f) => (f.negated ? cs[f.option] !== f.value : cs[f.option] === f.value));
      });
    }
    if (opts.displayFilter != null) {
      list = list.filter((el) => {
        if (ctx.noDetect.has(el)) return !opts.displayFilter;
        const shown = el.offsetHeight !== 0;
        return opts.displayFilter ? shown : !shown;
      });
    }
    if (opts.iframeFilter != null) list = opts.iframeFilter === IN_FRAME ? list : [];
    if (opts.childFilter != null) {
      list = list.filter((el) => {
        const saved = ctx.base;
        ctx.base = el;
        const hit = find(ctx, opts.childFilter).target != null;
        ctx.base = saved;
        return opts.childFilterNegated ? !hit : hit;
      });
    }
    return list;
  }

  function find(ctx, options, multiple) {
    const results = [];
    const push = (parent, targets) => {
      for (const t of targets) results.push({ parent, target: t });
    };
    if (options.parent != null) {
      const parents = findElements(ctx, options.parent, null);
      const use = multiple ? parents : parents.slice(0, 1);
      for (const p of use) {
        const t = findElements(ctx, options.target, p);
        push(p, multiple ? t : t.slice(0, 1));
      }
    } else {
      const t = findElements(ctx, options.target, null);
      push(null, multiple ? t : t.slice(0, 1));
    }
    if (!results.length) results.push({ parent: null, target: null });
    return multiple ? results : results[0];
  }

  // ─── matcher (Matcher.js) ──────────────────────────────────────────────────

  function matches(ctx, m) {
    switch (m && m.type) {
      case 'css': return find(ctx, m).target != null;
      case 'checkbox': {
        const t = find(ctx, m).target;
        if (!t) throw new Error('checkbox assente');
        return m.negated ? !t.checked : !!t.checked;
      }
      case 'url': {
        const url = String(ctx.topUrl || '');
        let hit = false;
        for (const u of asList(m.url).map(String)) {
          if (m.regexp) { try { if (new RegExp(u).test(url)) { hit = true; break; } } catch (_) {} }
          else if (url.indexOf(u) !== -1) { hit = true; break; }
        }
        return m.negated ? !hit : hit;
      }
      case 'onoff': {
        const on = find(ctx, m.onMatcher || {}).target != null;
        const off = find(ctx, m.offMatcher || {}).target != null;
        if (on === off) throw new Error('stato on/off ambiguo');
        return on;
      }
      default: throw new Error('matcher sconosciuto');
    }
  }

  // ─── azioni (Action.js) ────────────────────────────────────────────────────

  async function run(ctx, a, consents) {
    if (!a || ctx.stopped) return;
    switch (a.type) {
      case 'list':
        for (const x of asList(a.actions)) await run(ctx, x, consents);
        return;
      case 'click': {
        const t = find(ctx, a).target;
        if (!t) return;
        const showing = t.offsetHeight !== 0;
        if (showing && a.noTimeout !== true) await wait(a.timeout);
        try { t.click(); ctx.clicks++; } catch (_) {}
        if (showing && a.noTimeout !== true) await wait(a.timeout);
        return;
      }
      case 'multiclick':
        for (const r of find(ctx, a, true)) {
          if (r.target) { try { r.target.click(); ctx.clicks++; } catch (_) {} }
        }
        return;
      case 'consent':
        for (const c of asList(a.consents)) await setConsent(ctx, c, !!consents[c.type]);
        return;
      case 'ifcss': {
        const hit = find(ctx, a).target != null;
        await run(ctx, hit ? a.trueAction : a.falseAction, consents);
        return;
      }
      case 'waitcss': {
        let retries = a.retries || 10;
        const every = a.waitTime || 250;
        for (;;) {
          const hit = find(ctx, a).target != null;
          if (a.negated ? !hit : hit) return;
          if (retries-- <= 0 || ctx.stopped) return;
          await wait(every);
        }
      }
      case 'foreach': {
        if (!a.action) return;
        const saved = ctx.base;
        for (const r of find(ctx, a, true)) {
          if (!r.target) continue;
          ctx.base = r.target;
          await run(ctx, a.action, consents);
        }
        ctx.base = saved;
        return;
      }
      case 'hide': {
        const t = find(ctx, a).target;
        if (!t) return;
        if (a.hideFromDetection === true) ctx.noDetect.add(t);
        if (!ctx.hidden.has(t)) {
          ctx.hidden.set(t, t.style.getPropertyValue('opacity') + '|' + t.style.getPropertyPriority('opacity'));
          t.style.setProperty('opacity', '0', 'important');
        }
        return;
      }
      case 'slide': {
        const t = find(ctx, a).target;
        const d = find(ctx, a.dragTarget || {}).target;
        if (!t || !d) return;
        const tb = t.getBoundingClientRect();
        const db = d.getBoundingClientRect();
        const axis = String(a.axis || '').toLowerCase();
        const dx = axis === 'y' ? 0 : db.left - tb.left;
        const dy = axis === 'x' ? 0 : db.top - tb.top;
        const x = tb.left + tb.width / 2;
        const y = tb.top + tb.height / 2;
        const ev = (type, cx, cy) => new MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy });
        t.dispatchEvent(ev('mousedown', x, y));
        await wait(10);
        t.dispatchEvent(ev('mousemove', x + dx, y + dy));
        await wait(10);
        t.dispatchEvent(ev('mouseup', x + dx, y + dy));
        ctx.clicks++;
        return;
      }
      case 'wait':
        await wait(a.waitTime);
        return;
      case 'ifallowall':
        await run(ctx, Object.values(consents).every((v) => v !== false) ? a.trueAction : a.falseAction, consents);
        return;
      case 'ifallownone':
        await run(ctx, Object.values(consents).every((v) => v !== true) ? a.trueAction : a.falseAction, consents);
        return;
      case 'runrooted': {
        if (!a.action) return;
        const saved = ctx.base;
        if (a.ignoreOldRoot === true) ctx.base = null;
        const t = find(ctx, a).target;
        if (t) { ctx.base = t; await run(ctx, a.action, consents); }
        ctx.base = saved;
        return;
      }
      case 'runmethod': {
        const name = String(a.method || '').toUpperCase();
        const m = ctx.methods.get(name);
        if (m && m.custom === true) await run(ctx, m.action, consents);
        return;
      }
      default:
        // 'close' chiuderebbe la scheda dell'utente: Filo non lo fa mai. Il resto è sconosciuto e non fa niente.
    }
  }

  async function setConsent(ctx, c, enabled) {
    const matcher = c.matcher || null;
    if (c.toggleAction) {
      if (!matcher) return;
      try { if (matches(ctx, matcher) !== enabled) await run(ctx, c.toggleAction, REJECT_ALL); } catch (_) {}
      return;
    }
    if (matcher && matcher.type === 'onoff') {
      try {
        const on = matches(ctx, matcher);
        if (on && !enabled) await run(ctx, c.falseAction, REJECT_ALL);
        else if (!on && enabled) await run(ctx, c.trueAction, REJECT_ALL);
        return;
      } catch (_) { /* stato illeggibile: si fa l'azione piena, come Consent-O-Matic */ }
    }
    await run(ctx, enabled ? c.trueAction : c.falseAction, REJECT_ALL);
  }

  // ─── una regola (CMP.js / Detector.js) ─────────────────────────────────────

  function makeCmp(name, config, topUrl) {
    const methods = new Map();
    for (const m of asList(config && config.methods)) {
      if (m && m.action != null && typeof m.name === 'string') methods.set(m.name, m);
    }
    const ctx = {
      base: null, topUrl, clicks: 0, stopped: false,
      noDetect: new WeakSet(), hidden: new Map(), methods,
    };
    const detectors = asList(config && config.detectors);

    function firstDetector() {
      return detectors.find((d) => {
        const pm = asList(d.presentMatcher);
        if (!pm.length) return false;
        try { return pm.every((m) => matches(ctx, m)); } catch (_) { return false; }
      }) || null;
    }

    function unhideAll() {
      for (const [el, prev] of ctx.hidden) {
        const [v, p] = prev.split('|');
        if (v) el.style.setProperty('opacity', v, p || '');
        else el.style.removeProperty('opacity');
      }
      ctx.hidden.clear();
    }

    async function method(n) {
      const m = methods.get(n);
      if (m) await run(ctx, m.action, REJECT_ALL);
      else await wait(0);
    }

    return {
      name,
      isUtility: methods.size === 1 && methods.has('UTILITY'),
      detect: () => firstDetector() != null,
      isShowing() {
        const d = firstDetector();
        if (!d) return false;
        const sm = asList(d.showingMatcher);
        if (!sm.length) return true;
        try { return sm.every((m) => matches(ctx, m)); } catch (_) { return false; }
      },
      // Ordine di Consent-O-Matic: nascondi, apri le opzioni, nascondi, scegli, salva; poi si rimette tutto com'era.
      async reject() {
        ctx.clicks = 0;
        try {
          if (this.isUtility) { await method('UTILITY'); return { clicks: ctx.clicks, utility: true }; }
          await method('HIDE_CMP');
          await method('OPEN_OPTIONS');
          await method('HIDE_CMP');
          await method('DO_CONSENT');
          await method('SAVE_CONSENT');
          return { clicks: ctx.clicks };
        } catch (_) {
          return { clicks: ctx.clicks, error: true };
        } finally {
          unhideAll();
        }
      },
      stop() { ctx.stopped = true; unhideAll(); },
    };
  }

  // Quali regole dell'indice hanno in pagina il primo elemento di un loro rilevatore. Economico: solo querySelector.
  function presentInIndex(index, skip) {
    const out = [];
    for (const entry of Array.isArray(index) ? index : []) {
      const [name, dets] = entry;
      if (skip && skip.has(name)) continue;
      const hit = (dets || []).some((sels) => (sels || []).every((s) => {
        try { return !!document.querySelector(s); } catch (_) { return false; }
      }));
      if (hit) out.push(name);
    }
    return out;
  }

  global.SN_COOKIE_RULES = { makeCmp, presentInIndex, REJECT_ALL };
})(typeof globalThis !== 'undefined' ? globalThis : self);
