// Shim chrome.* delle pagine filo://: i moduli portati lo usano senza sapere che siamo in Electron.
// Ogni chiamata passa da window.filo (filo-api.js); lo monta su window solo internal-preload.js, su origine filo:.
module.exports = function creaChromeShim(filoApi) {
  return {
    runtime: {
      id: 'filo-desktop',
      lastError: null,
      sendMessage: (msg, callback) => {
        const p = filoApi.message(msg);
        if (typeof callback === 'function') {
          p.then((r) => { try { callback(r); } catch (_) {} },
                 (err) => { try { callback({ ok: false, error: err.message }); } catch (_) {} });
          return undefined;
        }
        return p;
      },
      onMessage: {
        _listeners: new Set(),
        addListener(fn) {
          this._listeners.add(fn);
          if (!this._wired) {
            this._wired = true;
            filoApi.onBroadcast((m) => {
              for (const l of this._listeners) {
                try { l(m, { id: 'filo-desktop' }, () => {}); } catch (e) { console.warn('[Filo] listener err', e); }
              }
            });
          }
        },
        removeListener(fn) { this._listeners.delete(fn); },
      },
      connect: ({ name } = {}) => {
        let onMessage = null;
        let onDisconnect = null;
        let active = null;
        return {
          name: name || 'unknown',
          postMessage(msg) {
            if (msg?.type !== 'start') return;
            active = filoApi.aiStream({
              action: msg.action, payload: msg.payload,
              onMeta: (m) => onMessage && onMessage({ type: 'meta', ...m }),
              onDelta: (delta) => onMessage && onMessage({ type: 'delta', delta }),
              onReset: () => onMessage && onMessage({ type: 'reset' }),
              onDone: (d) => {
                if (onMessage) onMessage({ type: 'done', ...d });
                if (onDisconnect) onDisconnect();
              },
              onError: (e) => {
                // Tutto quello che il main ha detto sull'errore: con i soli
                // message e code la frase già scritta per l'utente non si
                // ricompone e arriva la riga grezza del servizio (#663).
                if (onMessage) onMessage({ type: 'error', ...e });
                if (onDisconnect) onDisconnect();
              },
            });
          },
          onMessage: { addListener: (fn) => { onMessage = fn; } },
          onDisconnect: { addListener: (fn) => { onDisconnect = fn; } },
          disconnect() { if (active) active.abort(); },
        };
      },
      getURL: filoApi.getURL,
      openOptionsPage: () => filoApi.message({ type: 'open_options' }),
    },
    storage: {
      local: {
        get(keys, callback) {
          const p = filoApi.message({ type: '_storage:get', keys }).then(r => r?.value || {});
          if (typeof callback === 'function') {
            p.then(v => { try { callback(v); } catch (_) {} })
             .catch(() => { try { callback({}); } catch (_) {} });
            return;
          }
          return p;
        },
        async set(obj) { await filoApi.message({ type: '_storage:set', obj }); },
        async remove(keys) { await filoApi.message({ type: '_storage:remove', keys }); },
        async clear() { await filoApi.message({ type: '_storage:clear' }); },
      },
      onChanged: {
        addListener(fn) {
          filoApi.onBroadcast((m) => {
            if (m?.type === '_storage:changed') {
              try { fn(m.changes, 'local'); } catch (_) {}
            }
          });
        },
        removeListener() {},
      },
    },
    tabs: {
      async create({ url } = {}) {
        const r = await filoApi.message({ type: '_tabs:create', url });
        return { id: r.id };
      },
      async query() { return []; },
      async remove(id) { await filoApi.message({ type: '_tabs:remove', id }); },
      async captureVisibleTab() {
        const r = await filoApi.message({ type: 'capture_visible_tab' });
        return r.dataUrl;
      },
    },
    action: { onClicked: { addListener() {} } },
    commands: { onCommand: { addListener() {} } },
    scripting: { executeScript: async () => ({}) },
    contextMenus: { create: () => {}, onClicked: { addListener: () => {} } },
  };
};
