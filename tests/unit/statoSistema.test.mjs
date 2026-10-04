// #873 — i lettori di batteria, rete e Bluetooth per piattaforma (src/main/services/statoSistema.js).
// Linux su un sysfs finto, Mac e Windows sulle loro uscite: qui gira tutto ovunque, senza Electron.
// Che Filo legga davvero un Mac o un Windows non lo prova nessuna di queste righe: lo dice il report.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const L = require(join(ROOT, 'src', 'main', 'services', 'statoSistema.js'));
const SORGENTE = readFileSync(join(ROOT, 'src', 'main', 'services', 'statoSistema.js'), 'utf8');

function albero(file) {
  const radice = cartellaTemporanea('filo-sysfs-');
  for (const [p, contenuto] of Object.entries(file)) {
    const pieno = join(radice, ...p.split('/'));
    mkdirSync(dirname(pieno), { recursive: true });
    if (contenuto === null) mkdirSync(pieno, { recursive: true });
    else writeFileSync(pieno, contenuto);
  }
  return radice;
}

const ROUTE = 'Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT\n';

test('Linux, portatile: due batterie pesate sulla capacità, il mouse non conta, il caricatore dice «collegata»', () => {
  const r = albero({
    'sys/class/power_supply/BAT0/type': 'Battery\n', 'sys/class/power_supply/BAT0/capacity': '80\n',
    'sys/class/power_supply/BAT0/status': 'Discharging\n', 'sys/class/power_supply/BAT0/energy_full': '60000000\n',
    'sys/class/power_supply/BAT1/type': 'Battery\n', 'sys/class/power_supply/BAT1/capacity': '20\n',
    'sys/class/power_supply/BAT1/status': 'Discharging\n', 'sys/class/power_supply/BAT1/energy_full': '20000000\n',
    'sys/class/power_supply/hidpp_battery_0/type': 'Battery\n', 'sys/class/power_supply/hidpp_battery_0/scope': 'Device\n',
    'sys/class/power_supply/hidpp_battery_0/capacity': '3\n',
    'sys/class/power_supply/AC/type': 'Mains\n', 'sys/class/power_supply/AC/online': '0\n',
  });
  try {
    assert.deepEqual(L.batteriaLinux(r), { livello: 65, inCarica: false, collegata: false });
    writeFileSync(join(r, 'sys/class/power_supply/AC/online'), '1\n');
    writeFileSync(join(r, 'sys/class/power_supply/BAT0/status'), 'Charging\n');
    assert.deepEqual(L.batteriaLinux(r), { livello: 65, inCarica: true, collegata: true });
    writeFileSync(join(r, 'sys/class/power_supply/BAT0/status'), 'Not charging\n');
    assert.deepEqual(L.batteriaLinux(r), { livello: 65, inCarica: false, collegata: true });
  } finally { rmSync(r, { recursive: true, force: true }); }
});

test('Linux: senza «capacity» la carica si conta da energia o carica; un fisso non ha batteria', () => {
  const r = albero({
    'sys/class/power_supply/BAT0/type': 'Battery\n', 'sys/class/power_supply/BAT0/charge_now': '1500\n',
    'sys/class/power_supply/BAT0/charge_full': '3000\n', 'sys/class/power_supply/BAT0/status': 'Full\n',
  });
  const fisso = albero({ 'sys/class/power_supply/ucsi-source-psy-USBC000:001/type': 'USB\n', 'sys/class/power_supply/ucsi-source-psy-USBC000:001/online': '1\n' });
  try {
    assert.deepEqual(L.batteriaLinux(r), { livello: 50, inCarica: false, collegata: true });
    assert.equal(L.batteriaLinux(fisso), null);
    assert.equal(L.batteriaLinux(join(fisso, 'non-esiste')), null);
  } finally {
    rmSync(r, { recursive: true, force: true });
    rmSync(fisso, { recursive: true, force: true });
  }
});

test('Linux: la rotta predefinita dice da dove si esce, e la cartella dell\'interfaccia se è Wi-Fi o cavo', async () => {
  const r = albero({
    'proc/net/route': `${ROUTE}docker0\t000011AC\t00000000\t0001\t0\t0\t0\t0000FFFF\t0\t0\t0\n`
      + 'eth0\t00000000\t0101A8C0\t0003\t0\t0\t600\t00000000\t0\t0\t0\n'
      + 'wlp2s0\t00000000\t0101A8C0\t0003\t0\t0\t100\t00000000\t0\t0\t0\n',
    'sys/class/net/wlp2s0/type': '1\n', 'sys/class/net/wlp2s0/wireless': null,
    'sys/class/net/eth0/type': '1\n', 'sys/class/net/eth0/device': null,
    'sys/class/net/tun0/type': '65534\n',
  });
  try {
    assert.equal(L.interfacciaVersoFuori(r), 'wlp2s0', 'vince la metrica più bassa');
    assert.equal(L.tipoInterfacciaLinux(r, 'wlp2s0'), 'wifi');
    assert.equal(L.tipoInterfacciaLinux(r, 'eth0'), 'cavo');
    assert.equal(L.tipoInterfacciaLinux(r, 'tun0'), null);
    assert.equal(L.tipoInterfacciaLinux(r, '../../etc'), null);
    const chiesti = [];
    const esec = async (file, args) => {
      chiesti.push(file);
      if (file === 'iw') return 'Connected to 00:11:22:33:44:55 (on wlp2s0)\n\tSSID: Caff\\xc3\\xa8 \\x5cBar\\x20\n\tfreq: 2412\n';
      return null;
    };
    const letto = await L.leggiLinux(r, esec);
    assert.deepEqual(letto.rete, { tipo: 'wifi', nome: 'Caffè \\Bar ' });
    assert.equal(letto.batteria, null);
    assert.equal(letto.bluetooth, null);
    assert.ok(!chiesti.includes('nmcli'), 'con iw che risponde non serve chiedere a NetworkManager');
  } finally { rmSync(r, { recursive: true, force: true }); }
});

test('Linux: solo IPv6, oppure nessuna rotta: l\'interfaccia la dice ipv6_route, o non c\'è', () => {
  const v6 = albero({
    'proc/net/route': ROUTE,
    'proc/net/ipv6_route': '00000000000000000000000000000000 00 00000000000000000000000000000000 00 00000000000000000000000000000000 ffffffff 00000001 00000000 00200200       lo\n'
      + '00000000000000000000000000000000 00 00000000000000000000000000000000 00 fe800000000000000000000000000001 00000400 00000001 00000000 00000003   enp0s3\n',
  });
  const niente = albero({ 'proc/net/route': ROUTE });
  try {
    assert.equal(L.interfacciaVersoFuori(v6), 'enp0s3');
    assert.equal(L.interfacciaVersoFuori(niente), null);
  } finally {
    rmSync(v6, { recursive: true, force: true });
    rmSync(niente, { recursive: true, force: true });
  }
});

test('Linux: senza iw il nome lo dà NetworkManager, coi suoi due punti protetti', async () => {
  assert.equal(L.connessioneDaNmcli('Rete\\: di casa\\\\2\n'), 'Rete: di casa\\2');
  assert.equal(L.connessioneDaNmcli('--\n'), null);
  assert.equal(L.connessioneDaNmcli(''), null);
  assert.equal(L.ssidDaIw('Not connected.\n'), null);
});

const BLUEZ = (powered, dispositivi) => JSON.stringify({
  type: 'a{oa{sa{sv}}}',
  data: [{
    '/org/bluez': { 'org.bluez.AgentManager1': {} },
    '/org/bluez/hci0': { 'org.bluez.Adapter1': { Powered: { type: 'b', data: powered }, Alias: { type: 's', data: 'pc' } } },
    ...Object.fromEntries(dispositivi.map(([nome, conn], i) => [`/org/bluez/hci0/dev_0${i}`, {
      'org.bluez.Device1': { Alias: { type: 's', data: nome }, Connected: { type: 'b', data: conn } },
    }])),
  }],
});

test('Linux: BlueZ dal bus dice acceso o spento e chi è collegato; senza adattatore non dice niente', async () => {
  assert.deepEqual(L.bluetoothDaBluez(BLUEZ(true, [['Cuffie', true], ['Tastiera', false], ['Mouse', true]])),
    { acceso: true, dispositivi: ['Cuffie', 'Mouse'] });
  assert.deepEqual(L.bluetoothDaBluez(BLUEZ(false, [['Cuffie', true]])), { acceso: false, dispositivi: [] });
  assert.equal(L.bluetoothDaBluez(JSON.stringify({ type: 'a{oa{sa{sv}}}', data: [{ '/org/bluez': {} }] })), null);
  assert.equal(L.bluetoothDaBluez('Failed to connect to bus'), null);
  assert.equal(L.bluetoothDaBluez('{"data":[null]}'), null);
});

test('Linux: senza BlueZ resta l\'interruttore radio; acceso, spento, o nessuna radio Bluetooth', async () => {
  const r = albero({
    'sys/class/rfkill/rfkill0/type': 'wlan\n', 'sys/class/rfkill/rfkill0/soft': '0\n', 'sys/class/rfkill/rfkill0/hard': '0\n',
    'sys/class/rfkill/rfkill1/type': 'bluetooth\n', 'sys/class/rfkill/rfkill1/soft': '1\n', 'sys/class/rfkill/rfkill1/hard': '0\n',
  });
  try {
    assert.deepEqual(L.bluetoothDaRfkill(r), { acceso: false, dispositivi: [] });
    writeFileSync(join(r, 'sys/class/rfkill/rfkill1/soft'), '0\n');
    assert.deepEqual(L.bluetoothDaRfkill(r), { acceso: true, dispositivi: null });
    const letto = await L.leggiLinux(r, async () => null);
    assert.deepEqual(letto.bluetooth, { acceso: true, dispositivi: null }, 'busctl assente: si ripiega sulla radio');
    const conBus = await L.leggiLinux(r, async (f) => (f === 'busctl' ? BLUEZ(true, [['Cuffie', true]]) : null));
    assert.deepEqual(conBus.bluetooth, { acceso: true, dispositivi: ['Cuffie'] });
    rmSync(join(r, 'sys/class/rfkill/rfkill1'), { recursive: true, force: true });
    assert.equal(L.bluetoothDaRfkill(r), null);
  } finally { rmSync(r, { recursive: true, force: true }); }
});

test('Mac: pmset in carica, scarica, carica completa, alimentatore senza carica, Mac senza batteria', () => {
  const batt = (riga, fonte = 'AC Power') => `Now drawing from '${fonte}'\n -InternalBattery-0 (id=4653155)\t${riga} present: true\n`;
  assert.deepEqual(L.batteriaDaPmset(batt('56%; charging; 1:20 remaining')), { livello: 56, inCarica: true, collegata: true });
  assert.deepEqual(L.batteriaDaPmset(batt('81%; discharging; 4:12 remaining', 'Battery Power')), { livello: 81, inCarica: false, collegata: false });
  assert.deepEqual(L.batteriaDaPmset(batt('100%; charged; 0:00 remaining')), { livello: 100, inCarica: false, collegata: true });
  assert.deepEqual(L.batteriaDaPmset(batt('80%; AC attached; not charging')), { livello: 80, inCarica: false, collegata: true });
  assert.equal(L.batteriaDaPmset("Now drawing from 'AC Power'\n"), null);
  assert.equal(L.batteriaDaPmset(null), null);
});

test('Mac: da route e networksetup Wi-Fi o cavo; l\'SSID nascosto senza permesso non compare', async () => {
  const porte = 'Hardware Port: Wi-Fi\nDevice: en0\nEthernet Address: aa\n\nHardware Port: Thunderbolt Bridge\nDevice: bridge0\nEthernet Address: bb\n\nHardware Port: USB 10/100/1000 LAN\nDevice: en7\nEthernet Address: cc\n';
  assert.equal(L.interfacciaDaRoute('   route to: default\ndestination: default\n  gateway: 192.168.1.1\n  interface: en0\n'), 'en0');
  assert.equal(L.tipoDaPortaMac(L.portaDaNetworksetup(porte, 'en0')), 'wifi');
  assert.equal(L.tipoDaPortaMac(L.portaDaNetworksetup(porte, 'en7')), 'cavo');
  assert.equal(L.tipoDaPortaMac(L.portaDaNetworksetup(porte, 'bridge0')), null);
  assert.equal(L.ssidDaIpconfig('<dictionary> {\n  SSID : Casa\n}'), 'Casa');
  assert.equal(L.ssidDaIpconfig('<dictionary> {\n  SSID : <redacted>\n}'), null);
  assert.deepEqual(L.bluetoothDaDefaults('1\n'), { acceso: true, dispositivi: null });
  assert.deepEqual(L.bluetoothDaDefaults('0'), { acceso: false, dispositivi: [] });
  assert.equal(L.bluetoothDaDefaults(null), null);
  const uscite = {
    pmset: "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t30%; discharging; 2:00 remaining present: true\n",
    route: 'interface: en0\n', networksetup: porte, ipconfig: '  SSID : Ufficio\n', defaults: '1\n',
  };
  const letto = await L.leggiMac(async (file) => uscite[file] ?? null);
  assert.deepEqual(letto, {
    batteria: { livello: 30, inCarica: false, collegata: false },
    rete: { tipo: 'wifi', nome: 'Ufficio' },
    bluetooth: { acceso: true, dispositivi: null },
  });
});

// ── Windows ──

test('Windows: una riga del PowerShell diventa una lettura; una riga storta non cancella quella buona', () => {
  const riga = JSON.stringify({
    batteria: { livello: 73, inCarica: true, collegata: true },
    rete: { tipo: 'wifi', nome: 'Caffè' },
    bluetooth: { acceso: true, dispositivi: ['Cuffie'] },
  });
  assert.deepEqual(L.datiDaWindows(riga), {
    batteria: { livello: 73, inCarica: true, collegata: true },
    rete: { tipo: 'wifi', nome: 'Caffè' },
    bluetooth: { acceso: true, dispositivi: ['Cuffie'] },
  });
  assert.deepEqual(L.datiDaWindows('{"batteria":null,"rete":null,"bluetooth":null}'), { batteria: null, rete: null, bluetooth: null });
  assert.deepEqual(L.datiDaWindows('{"bluetooth":{"acceso":true,"dispositivi":{"value":["Mouse"],"Count":1}}}').bluetooth,
    { acceso: true, dispositivi: ['Mouse'] }, 'la forma {value, Count} di PowerShell 5.1');
  for (const storta of ['', 'WARNING: qualcosa', '[1,2]', 'null', '{"batteria":']) assert.equal(L.datiDaWindows(storta), null, storta);
});

function figlioFinto() {
  const f = new EventEmitter();
  f.stdout = new PassThrough();
  f.uccisi = 0;
  f.kill = () => { f.uccisi += 1; setImmediate(() => f.emit('exit', null, 'SIGTERM')); };
  return f;
}

test('Windows: un processo solo, nascosto, che scrive a pezzi; il lettore aspetta la prima riga e la tiene', async () => {
  const avviati = [];
  let cambi = 0;
  const w = L.lettoreWindows({
    pid: 4242,
    quandoCambia: () => { cambi += 1; },
    avvia: (file, args, opzioni) => { const f = figlioFinto(); avviati.push({ file, args, opzioni, f }); return f; },
  });
  w.assicura();
  w.assicura();
  assert.equal(avviati.length, 1, 'un PowerShell solo, non uno per richiesta');
  const { file, args, opzioni, f } = avviati[0];
  assert.equal(file, 'powershell.exe');
  assert.equal(opzioni.windowsHide, true, 'su Windows nessuna finestra di console');
  assert.ok(args.includes('-NoProfile') && args.includes('-NonInteractive'));
  assert.ok(args[args.length - 1].includes('$genitore = 4242'), 'il PowerShell esce quando Filo non c\'è più');
  const pronto = w.pronto(5000);
  // La riga arriva spezzata, e la «è» a metà fra due pezzi non si perde.
  const riga = Buffer.from('{"batteria":{"livello":55,"inCarica":false,"collegata":false},"rete":{"tipo":"wifi","nome":"Caffè"},"bluetooth":null}\n', 'utf8');
  const taglio = riga.indexOf(0xc3) + 1;
  f.stdout.write(riga.subarray(0, taglio));
  f.stdout.write(riga.subarray(taglio));
  await pronto;
  assert.deepEqual(w.ultimo().rete, { tipo: 'wifi', nome: 'Caffè' });
  assert.equal(cambi, 1);
  w.ferma();
  assert.equal(f.uccisi, 1);
  await new Promise((r) => setImmediate(r));
  w.assicura();
  assert.equal(avviati.length, 2, 'fermato da noi non è un guasto: riparte alla richiesta dopo');
  w.ferma();
});

test('Windows: dopo il sonno chi chiede aspetta la riga nuova, non riceve quella di prima come fresca', async () => {
  let avvii = 0;
  const w = L.lettoreWindows({
    avvia: () => {
      const f = figlioFinto();
      avvii += 1;
      const b = avvii === 1 ? { livello: 80, inCarica: true, collegata: true } : { livello: 30, inCarica: false, collegata: false };
      setTimeout(() => f.stdout.write(`${JSON.stringify({ batteria: b })}\n`), 30);
      return f;
    },
  });
  w.assicura();
  await w.pronto(2000);
  assert.equal(w.ultimo().batteria.livello, 80);
  w.ferma();
  assert.equal(w.ultimo(), null, 'fermo, il lettore non ha niente di vero da dire');
  // Il caricatore si stacca mentre il lettore dorme; poi qualcuno chiede.
  w.assicura();
  assert.equal(w.ultimo(), null, 'mentre riparte la riga di prima non è una lettura');
  assert.equal(w.ultimaRiga().batteria.livello, 80, 'mentre riparte chi disegna tiene l\'ultima riga');
  assert.equal(w.inAttesa(), true);
  await w.pronto(2000);
  assert.deepEqual(w.ultimo().batteria, { livello: 30, inCarica: false, collegata: false });
  assert.equal(w.inAttesa(), false);
  w.ferma();
});

test('Windows: un PowerShell che riparte più lento dell\'attesa non fa passare la riga di prima del sonno per nuova', async () => {
  let avvii = 0;
  const w = L.lettoreWindows({
    avvia: () => {
      const f = figlioFinto();
      avvii += 1;
      const b = avvii === 1 ? { livello: 80, inCarica: true, collegata: true } : { livello: 30, inCarica: false, collegata: false };
      setTimeout(() => f.stdout.write(`${JSON.stringify({ batteria: b })}\n`), avvii === 1 ? 10 : 400);
      return f;
    },
  });
  w.assicura();
  await w.pronto(2000);
  w.ferma();
  w.assicura();
  await w.pronto(100);
  assert.equal(w.ultimo(), null, 'scaduta l\'attesa, il lettore non ha ancora niente di nuovo da dire');
  assert.equal(w.inAttesa(), true);
  await w.pronto(2000);
  assert.equal(w.ultimo().batteria.livello, 30);
  w.ferma();
});

test('Windows: un PowerShell che muore subito si riprova tre volte, poi il lettore si arrende senza girare a vuoto', async () => {
  const avviati = [];
  const w = L.lettoreWindows({ avvia: () => { const f = figlioFinto(); avviati.push(f); setImmediate(() => f.emit('exit', 1, null)); return f; } });
  for (let i = 0; i < 6; i++) {
    w.assicura();
    await w.pronto(1000);
    await new Promise((r) => setImmediate(r));
  }
  assert.equal(avviati.length, 3);
  assert.equal(w.ultimo(), null);
  const senza = L.lettoreWindows({ avvia: () => { throw new Error('ENOENT'); } });
  senza.assicura();
  await senza.pronto(1000);
  assert.equal(senza.attivo(), false);
});

test('Windows: lo script non chiede permessi e non usa le API del Wi-Fi, e scrive solo ASCII', () => {
  const s = L.SCRIPT_WINDOWS;
  assert.ok(!/RequestAccessAsync|netsh|Wlan|WiFiAdapter|Geolocat|Get-WmiObject|GetConnectedSsid/i.test(s),
    'una lettura che vuole un permesso (radio, posizione) si omette, non si chiede');
  assert.match(s, /GetProcessById\(\$genitore\)/);
  assert.match(s, /\[regex\]::Replace\(\$json, '\[\^ -~\]'/, 'l\'uscita è tutta ASCII: la console non può storpiare un nome');
  assert.match(s, /OutputEncoding/);
  assert.match(s, /Start-Sleep -Milliseconds \d+/);
  assert.ok(!/"/.test(s), 'niente virgolette doppie: la riga di comando di Windows le riscriverebbe');
  assert.ok(!/`/.test(s), 'niente apici inversi: in PowerShell sono escape');
  assert.ok(!/\$\{/.test(s));
  assert.match(SORGENTE, /'-Command', scriptWindows\(pid\)\]/);
  // Ogni lettura del sistema passa da execFile/spawn con la finestra nascosta.
  for (const m of SORGENTE.matchAll(/\b(execFile|avvia)\(([^;]*?)\{([^}]*)\}/g)) {
    assert.match(m[3], /windowsHide: true/, `${m[1]} senza windowsHide`);
  }
});

test('online lo decide Chromium: offline toglie tipo e nome, online tiene quello che la piattaforma sa', () => {
  const parti = { batteria: { livello: 5 }, rete: { tipo: 'wifi', nome: 'Casa' }, bluetooth: null };
  assert.deepEqual(L.componi(parti, false).rete, { online: false });
  assert.deepEqual(L.componi(parti, true).rete, { online: true, tipo: 'wifi', nome: 'Casa' });
  assert.deepEqual(L.componi({}, true).rete, { online: true, tipo: null, nome: null });
  assert.deepEqual(L.componi(parti, null).rete, { online: true, tipo: 'wifi', nome: 'Casa' });
  assert.equal(L.componi({}, null).rete, null);
});

test('ogni piattaforma ha il suo ramo, scritto intero', () => {
  const f = SORGENTE.slice(SORGENTE.indexOf('async function lettoreDiSistema'), SORGENTE.indexOf('function annuncia'));
  assert.match(f, /process\.platform === 'win32'/);
  assert.match(f, /process\.platform === 'darwin'/);
  assert.match(f, /\} else \{[\s\S]*leggiLinux/);
});

// Il monitor gira in un Node a parte, con la piattaforma e l'avviso del caricatore finti: qui il contenitore è Linux.
function simula(corpo) {
  const MODULO = JSON.stringify(join(ROOT, 'src', 'main', 'services', 'statoSistema.js'));
  const codice = `
const { EventEmitter } = require('node:events');
const Module = require('node:module');
const pm = new EventEmitter();
const vero = Module._load;
Module._load = function (r, ...a) { return r === 'electron' ? { powerMonitor: pm, app: { on() {} }, net: { isOnline: () => true } } : vero.call(this, r, ...a); };
const attesa = (ms) => new Promise((r) => setTimeout(r, ms));
const storia = [];
const MODULO = ${MODULO};
const nota = (S) => storia.push(S.stato() && S.stato().batteria ? S.stato().batteria.collegata : null);
${corpo}`;
  return JSON.parse(execFileSync(process.execPath, ['-e', codice], { encoding: 'utf8', timeout: 20_000 }).trim().split('\n').pop());
}

test('staccando il caricatore la voce non torna «collegata» per una lettura fatta prima dell\'avviso (Windows e Mac)', () => {
  // Windows: l'avviso arriva subito, il PowerShell scrive la riga nuova al suo giro.
  const windows = simula(`
Object.defineProperty(process, 'platform', { value: 'win32' });
const cp = require('node:child_process');
const { PassThrough } = require('node:stream');
let figlio;
cp.spawn = () => { figlio = new EventEmitter(); figlio.stdout = new PassThrough(); figlio.kill = () => {}; return figlio; };
const S = require(MODULO);
const riga = (c) => JSON.stringify({ batteria: { livello: 100, inCarica: false, collegata: c }, rete: null, bluetooth: null }) + '\\n';
(async () => {
  S.richiedi();
  await attesa(50); figlio.stdout.write(riga(true)); await attesa(100);
  pm.emit('on-battery');
  for (let i = 0; i < 6; i++) { await attesa(100); nota(S); }
  figlio.stdout.write(riga(false)); await attesa(50); nota(S);
  pm.emit('on-ac'); await attesa(50); nota(S);
  console.log(JSON.stringify(storia)); process.exit(0);
})();`);
  assert.deepEqual(windows, [false, false, false, false, false, false, false, true]);
  // Mac: il caricatore si stacca mentre la lettura del giro è in corso.
  const mac = simula(`
Object.defineProperty(process, 'platform', { value: 'darwin' });
const cp = require('node:child_process');
let collegata = true;
cp.execFile = (file, args, opts, cb) => {
  const c = collegata;
  const out = file === 'pmset' ? "Now drawing from '" + (c ? 'AC Power' : 'Battery Power') + "'\\n -InternalBattery-0 (id=1)\\t100%; " + (c ? 'charged' : 'discharging') + "; 0:00 remaining present: true\\n" : '';
  setTimeout(() => cb(null, out), 400);
};
const S = require(MODULO);
(async () => {
  S.richiedi();
  await attesa(3100);
  collegata = false; pm.emit('on-battery');
  for (let i = 0; i < 6; i++) { await attesa(150); nota(S); }
  console.log(JSON.stringify(storia)); process.exit(0);
})();`);
  assert.deepEqual(mac, [false, false, false, false, false, false]);
});
