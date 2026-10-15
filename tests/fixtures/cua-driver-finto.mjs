// Un Cua Driver finto: parla MCP su stdio come `cua-driver mcp`, con le stesse forme di risposta, e scrive in
// FINTO_REGISTRO (se c'è) ogni chiamata e l'ambiente con cui è partito. FINTO_PROFILO sceglie gli schemi:
// 'contratto' (target/delivery_mode come nel manifesto) o 'linux' (pid piatto, niente button: right_click a parte).
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const PROFILO = process.env.FINTO_PROFILO || 'contratto';
const REGISTRO = process.env.FINTO_REGISTRO || '';
const SEGRETO = 'segreto-123';
const PNG_1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const registra = (voce) => { if (REGISTRO) appendFileSync(REGISTRO, `${JSON.stringify(voce)}\n`); };
registra({ avvio: true, argv: process.argv.slice(2), env: process.env });

const finestra = { pid: { type: 'integer' }, window_id: { type: 'integer' } };
const schemi = {
  list_windows: { type: 'object', properties: { pid: { type: 'integer' }, on_screen_only: { type: 'boolean' } } },
  get_window_state: {
    type: 'object', required: ['pid', 'window_id'],
    properties: { ...finestra, include_screenshot: { type: 'boolean' }, include_accessibility_tree: { type: 'boolean' }, tree_format: { type: 'string' }, max_elements: { type: 'integer' }, timeout_ms: { type: 'integer' }, query: { type: 'string' } },
  },
  get_desktop_state: { type: 'object', properties: {} },
  check_permissions: { type: 'object', properties: {} },
  type_text: { type: 'object', required: ['pid', 'text'], properties: { ...finestra, text: { type: 'string' }, element_token: { type: 'string' } } },
  scroll: { type: 'object', required: ['direction'], properties: { ...finestra, direction: { type: 'string' }, amount: { type: 'integer' }, by: { type: 'string' }, element_token: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' } } },
  press_key: { type: 'object', required: ['pid', 'key'], properties: { ...finestra, key: { type: 'string' }, modifiers: { type: 'array' }, element_token: { type: 'string' } } },
  hotkey: { type: 'object', required: ['pid', 'keys'], properties: { pid: { type: 'integer' }, keys: { type: 'array' } } },
  drag: { type: 'object', required: ['from_x', 'from_y', 'to_x', 'to_y'], properties: { ...finestra, from_x: { type: 'number' }, from_y: { type: 'number' }, to_x: { type: 'number' }, to_y: { type: 'number' } } },
  // Strumenti che Filo non deve chiamare mai: se arrivano, il registro lo dice.
  kill_app: { type: 'object', properties: { pid: { type: 'integer' } } },
  clipboard_read: { type: 'object', properties: {} },
  bring_to_front: { type: 'object', properties: { ...finestra } },
};
if (PROFILO === 'linux') {
  schemi.click = { type: 'object', required: ['pid'], properties: { ...finestra, element_token: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' } } };
  schemi.right_click = { type: 'object', required: ['pid'], properties: { ...finestra, element_token: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' } } };
  schemi.double_click = { type: 'object', required: ['pid'], properties: { ...finestra, element_token: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' } } };
} else {
  schemi.click = {
    type: 'object', required: ['pid'],
    properties: { ...finestra, element_token: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, button: { type: 'string' }, count: { type: 'integer' }, delivery_mode: { type: 'string' } },
  };
  schemi.type_text.properties.delivery_mode = { type: 'string' };
  schemi.press_key.properties.delivery_mode = { type: 'string' };
}
if (process.env.FINTO_SENZA_DRAG === '1') delete schemi.drag;

// Un albero con un campo password per ognuno dei tre modi in cui un sistema lo dice (o non lo dice).
const elementi = [
  { element_index: 0, element_token: 's00000001:0', role: 'Window', depth: 0, label: 'Accesso' },
  { element_index: 1, element_token: 's00000001:1', role: 'Edit', depth: 1, parent_index: 0, label: 'Utente', value: 'mario', enabled: true, frame: { x: 10, y: 20, w: 200, h: 24 } },
  // Windows: il driver non riporta IsPassword e il nome, senza etichetta, è il valore stesso.
  { element_index: 2, element_token: 's00000001:2', role: 'Edit', depth: 1, parent_index: 0, label: SEGRETO, value: SEGRETO, automation_id: 'PasswordBox' },
  // macOS: il campo sicuro.
  { element_index: 3, element_token: 's00000001:3', role: 'AXTextField', subrole: 'AXSecureTextField', depth: 1, parent_index: 0, label: 'Codice', value: SEGRETO },
  // Linux: il ruolo dice password.
  { element_index: 4, element_token: 's00000001:4', role: 'password text', depth: 1, parent_index: 0, label: 'Chiave', value: SEGRETO },
  { element_index: 5, element_token: 's00000001:5', role: 'Button', depth: 1, parent_index: 0, label: 'Entra', enabled: true, actions: ['invoke'] },
];

function risposta(id, result) { process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`); }
function errore(id, code, message) { process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`); }
const testo = (t, structuredContent, isError = false) => ({ content: [{ type: 'text', text: t }], structuredContent, ...(isError ? { isError: true } : {}) });

function chiama(nome, a) {
  registra({ chiamata: nome, argomenti: a });
  switch (nome) {
    case 'list_windows':
      return testo('2 finestre', {
        windows: [
          { window_id: 4242, pid: 777, app_name: 'Blocco note', title: 'Senza nome - Blocco note', bounds: { x: 0, y: 0, width: 800, height: 600 }, is_on_screen: true, z_index: 2 },
          { window_id: 99, pid: 778, app_name: 'Calcolatrice', title: 'Calcolatrice', bounds: { x: 900, y: 0, width: 300, height: 400 }, is_on_screen: false, minimized: true, z_index: null },
        ],
      });
    case 'get_window_state': {
      const s = { pid: a.pid, window_id: a.window_id, app_name: 'Accesso', window_title: 'Accedi', window_bounds: { x: 0, y: 0, width: 400, height: 300 } };
      if (a.include_screenshot) return { content: [{ type: 'text', text: 'ok' }, { type: 'image', data: PNG_1x1, mimeType: 'image/png' }], structuredContent: { ...s, screenshot_width: 1, screenshot_height: 1 } };
      // Il markdown porta il segreto in chiaro, come farebbe un driver vero: Filo non deve usarlo.
      if (a.tree_format !== 'elements') return testo(`- [2] Edit "${SEGRETO}"`, { ...s, tree_markdown: `- [2] Edit "${SEGRETO}"` });
      return testo('(tree is in structuredContent.elements)', { ...s, elements: elementi, total_element_count: 6, truncated: false });
    }
    case 'get_desktop_state':
      return { content: [{ type: 'image', data: PNG_1x1, mimeType: 'image/png' }], structuredContent: { screenshot_width: 1, screenshot_height: 1 } };
    case 'check_permissions':
      return testo('ok', { x11: true, wayland: false, atspi: process.env.FINTO_ATSPI !== '0' });
    case 'click':
    case 'right_click':
    case 'double_click':
      if (a.element_token === 's00000001:5' && process.env.FINTO_SFONDO_NO === '1') {
        return testo('Background delivery is not available', { code: 'background_unavailable', escalation: { recommended: 'foreground', reason: 'background input is dropped' } }, true);
      }
      return testo(`clic ${SEGRETO}`, { effect: 'confirmed', route: 'accessibility', evidence: [{ kind: 'value_readback', detail: SEGRETO }] });
    case 'type_text':
      return testo(`scritto ${a.text}`, { effect: 'confirmed', route: 'accessibility', evidence: [{ kind: 'value_readback', detail: a.text }] });
    case 'scroll':
    case 'press_key':
    case 'hotkey':
    case 'drag':
      return testo('ok', { effect: 'unverifiable', route: 'synthetic_events' });
    default:
      return testo('ok', {});
  }
}

const righe = createInterface({ input: process.stdin });
righe.on('line', (riga) => {
  let m;
  try { m = JSON.parse(riga); } catch (_) { return; }
  if (m.method === 'initialize') {
    if (process.env.FINTO_MUORE === '1') process.exit(3);
    return risposta(m.id, { protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'cua-driver', version: 'finto' } });
  }
  if (m.method === 'notifications/initialized') return undefined;
  if (m.method === 'tools/list') {
    const tutti = Object.entries(schemi).map(([name, inputSchema]) => ({ name, description: name, inputSchema }));
    // In due pagine, come può fare un server vero.
    if (!m.params || !m.params.cursor) return risposta(m.id, { tools: tutti.slice(0, 5), nextCursor: 'p2' });
    return risposta(m.id, { tools: tutti.slice(5) });
  }
  if (m.method === 'tools/call') return risposta(m.id, chiama(m.params.name, m.params.arguments || {}));
  if (m.id !== undefined) return errore(m.id, -32601, 'method not found');
  return undefined;
});
righe.on('close', () => process.exit(0));
// Una domanda del server al cliente, come un ping: Filo deve rispondere senza confondersi.
process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: 'srv-1', method: 'ping' })}\n`);
