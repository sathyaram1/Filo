// #874 — volume, Bluetooth e Wi-Fi a comando (src/main/services/comandiSistema.js): costruttori, uscite, nomi, cammini.
// Gli script di Linux e Mac girano davvero su una shell POSIX con programmi finti; quelli di Windows si leggono e,
// su Windows, si fanno analizzare a PowerShell. Che i comandi funzionino su un computer vero lo dice il report.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const C = require(join(ROOT, 'src', 'main', 'services', 'comandiSistema.js'));

// Nomi scelti da altri (il bar sotto casa, chi ha rinominato le cuffie): ognuno prova a uscire dal suo parametro.
const NOMI_CATTIVI = [
  'Casa"; touch PRESO; echo "',
  "Casa'; touch PRESO; echo '",
  '$(touch PRESO)',
  '`touch PRESO`',
  'a; touch PRESO',
  'a && touch PRESO',
  'a | touch PRESO',
  '-rf',
  '*',
  '  spazi  doppi  ',
  '%PATH% $env:PATH @(touch PRESO)',
  '\\\\server\\share',
  'Caffè ☕ "Ölè" 🎧',
  '\'"\'"`$\\',
];

const COMANDI_CON_PARAMETRI = {
  volume: [{ livello: 40 }, { passo: -10 }, { muto: true }],
  radio: [{ radio: 'bluetooth', acceso: false }, { radio: 'wifi', acceso: true }],
  'bt-elenco': [{}],
  'wifi-elenco': [{}],
};

test('lo script di un comando è sempre lo stesso testo: i parametri stanno solo nell\'ambiente', () => {
  for (const piattaforma of C.PIATTAFORME) {
    for (const [comando, prove] of Object.entries(COMANDI_CON_PARAMETRI)) {
      for (const p of prove) {
        const b = C.costruisci(comando, p, piattaforma);
        assert.equal(b.script, C.SCRIPT[piattaforma][comando], `${piattaforma}/${comando}: lo script cambia coi parametri`);
        assert.equal(b.shell, piattaforma === 'win32' ? 'powershell' : 'sh');
        for (const k of Object.keys(b.env)) assert.match(k, /^FILO_SIS_[A-Z]+$/);
      }
    }
    const indirizzo = { win32: '001122aabbcc', linux: '00:11:22:AA:BB:CC', darwin: '00-11-22-aa-bb-cc' }[piattaforma];
    const b = C.costruisci('bt-collega', { indirizzo, collega: true }, piattaforma);
    assert.deepEqual(b.env, { FILO_SIS_INDIRIZZO: indirizzo, FILO_SIS_COLLEGA: '1' });
  }
});

test('un nome di rete con virgolette o caratteri speciali arriva intero nel suo parametro, su ogni piattaforma', () => {
  for (const nome of NOMI_CATTIVI) {
    for (const piattaforma of ['win32', 'darwin']) {
      const b = C.costruisci('wifi-collega', { rete: nome }, piattaforma);
      assert.equal(b.script, C.SCRIPT[piattaforma]['wifi-collega'], `${piattaforma}: il nome ha cambiato lo script`);
      assert.deepEqual(b.env, { FILO_SIS_RETE: nome });
    }
    // Su Linux il nome non raggiunge nemmeno la shell: si passa l'identificativo che NetworkManager ha dato alla rete.
    const l = C.costruisci('wifi-collega', { rete: nome, uuid: '0b9c3f4e-1d2a-4c7e-9f00-123456789abc' }, 'linux');
    assert.deepEqual(l.env, { FILO_SIS_UUID: '0b9c3f4e-1d2a-4c7e-9f00-123456789abc' });
  }
});

test('i parametri che non sono quello che dicono di essere non arrivano al sistema', () => {
  const rifiuta = (comando, p, piattaforma = 'linux') => assert.throws(() => C.costruisci(comando, p, piattaforma), Error, `${comando} ${JSON.stringify(p)}`);
  rifiuta('volume', { livello: 101 });
  rifiuta('volume', { livello: -1 });
  rifiuta('volume', { livello: '40; touch x' });
  rifiuta('volume', { livello: 40.5 });
  rifiuta('volume', { passo: 0 });
  rifiuta('volume', { muto: 'sì' });
  rifiuta('volume', {});
  rifiuta('radio', { radio: 'nfc', acceso: true });
  rifiuta('radio', { radio: 'wifi', acceso: 'true' });
  rifiuta('bt-collega', { indirizzo: '00:11:22:33:44:55; touch x', collega: true });
  rifiuta('bt-collega', { indirizzo: '00:11:22:33:44:55', collega: true }, 'win32');
  rifiuta('bt-collega', { indirizzo: '001122334455', collega: true }, 'darwin');
  rifiuta('wifi-collega', { rete: 'riga\nnuova' }, 'win32');
  rifiuta('wifi-collega', { rete: 'nul\u0000dentro' }, 'darwin');
  rifiuta('wifi-collega', { rete: 'x'.repeat(C.NOME_MAX + 1) }, 'darwin');
  rifiuta('wifi-collega', { rete: '' }, 'darwin');
  rifiuta('wifi-collega', { uuid: '$(touch x)' }, 'linux');
  rifiuta('sconosciuto', {});
  assert.throws(() => C.costruisci('volume', { livello: 4 }, 'aix'));
});

test('negli script di Linux e Mac un parametro si cita solo fra virgolette, e nessuno script esegue testo', () => {
  for (const piattaforma of ['linux', 'darwin']) {
    for (const [comando, script] of Object.entries(C.SCRIPT[piattaforma])) {
      for (const m of script.matchAll(/\$\{?FILO_SIS_[A-Z]+\}?/g)) {
        const prima = script[m.index - 1];
        const dentroApplescript = /system attribute "$/.test(script.slice(0, m.index));
        assert.ok(prima === '"' || dentroApplescript, `${piattaforma}/${comando}: ${m[0]} senza virgolette`);
      }
      assert.ok(!/\beval\b|\bsh -c\b|\bbash -c\b|\bsource\b|(^|\s)\.\s/m.test(script), `${piattaforma}/${comando}: esegue testo`);
    }
  }
  for (const [comando, script] of Object.entries(C.SCRIPT.win32)) {
    assert.ok(!/Invoke-Expression|\biex\b|Start-Process|\[scriptblock\]::Create|cmd\.exe|netsh/i.test(script), `win32/${comando}: esegue testo`);
    for (const m of script.matchAll(/FILO_SIS_[A-Z]+/g)) {
      assert.equal(script.slice(m.index - 5, m.index), '$env:', `win32/${comando}: ${m[0]} letto fuori da $env:`);
    }
  }
});

// ── Gli script veri, su una shell vera, con programmi finti ─────────────────

const SENZA_SH = process.platform === 'win32' && 'gli script di Linux e Mac vogliono una shell POSIX';

// Ogni programma finto scrive i suoi argomenti separati da NUL: un argomento spezzato o fuso si vede.
function computerFinto(programmi) {
  const dove = cartellaTemporanea('filo-comandi-');
  const bin = join(dove, 'bin');
  const lavoro = join(dove, 'lavoro');
  mkdirSync(bin, { recursive: true });
  mkdirSync(lavoro, { recursive: true });
  for (const [nome, corpo] of Object.entries(programmi)) {
    const f = join(bin, nome);
    writeFileSync(f, `#!/bin/sh\nfor a in "$@"; do printf '%s\\0' "$a"; done >> "${join(dove, `${nome}.argv`)}"\nprintf '\\n\\0' >> "${join(dove, `${nome}.argv`)}"\n${corpo || ''}\n`);
    chmodSync(f, 0o755);
  }
  const esegui = (comando, p, piattaforma) => {
    const b = C.costruisci(comando, p, piattaforma);
    return execFileSync('/bin/sh', ['-c', b.script], {
      cwd: lavoro, env: { PATH: `${bin}:/usr/bin:/bin`, ...b.env }, encoding: 'utf8',
    });
  };
  const chiamate = (nome) => {
    const f = join(dove, `${nome}.argv`);
    if (!existsSync(f)) return [];
    return readFileSync(f, 'utf8').split('\n\u0000').filter(Boolean).map((c) => c.split('\u0000').filter((x, i, a) => i < a.length - 1 || x));
  };
  return { esegui, chiamate, lavoro };
}

test('Mac: il nome della rete arriva a networksetup come UN argomento, uguale, e niente altro parte', { skip: SENZA_SH }, () => {
  const pc = computerFinto({
    networksetup: `case "$1" in
  -listallhardwareports) printf 'Hardware Port: Wi-Fi\\nDevice: en0\\nEthernet Address: aa\\n' ;;
  -getairportnetwork) echo "Current Wi-Fi Network: $3" ;;
esac`,
  });
  for (const nome of NOMI_CATTIVI) {
    const out = pc.esegui('wifi-collega', { rete: nome }, 'darwin');
    const r = C.interpretaWifiCollega(C.leggiUscita(out), 'darwin', nome);
    assert.equal(r.ok, true, `${nome}: ${out}`);
  }
  const join_ = pc.chiamate('networksetup').filter((a) => a[0] === '-setairportnetwork');
  assert.deepEqual(join_.map((a) => a.slice(1)), NOMI_CATTIVI.map((n) => ['en0', n]));
  assert.deepEqual(readdirSync(pc.lavoro), [], 'un nome ha eseguito qualcosa');
});

test('Linux: il volume al 40% arriva a wpctl come 40%, e alzarlo da muto toglie il muto', { skip: SENZA_SH }, () => {
  const pc = computerFinto({
    wpctl: `S="$(dirname "$0")/../stato"
[ -f "$S.v" ] || echo 0.25 > "$S.v"; [ -f "$S.m" ] || echo 1 > "$S.m"
case "$1" in
  get-volume) if [ "$(cat "$S.m")" = 1 ]; then echo "Volume: $(cat "$S.v") [MUTED]"; else echo "Volume: $(cat "$S.v")"; fi ;;
  set-volume) n=\${3%\\%}; awk -v n="$n" 'BEGIN { printf "%.2f\\n", n / 100 }' > "$S.v" ;;
  set-mute) echo "$3" > "$S.m" ;;
esac`,
  });
  const r = C.interpretaVolume(C.leggiUscita(pc.esegui('volume', { livello: 40 }, 'linux')));
  assert.deepEqual(r, { ok: true, volume: 40, muto: false, prima: 25 });
  assert.ok(pc.chiamate('wpctl').some((a) => a.join(' ') === 'set-volume @DEFAULT_AUDIO_SINK@ 40%'));
  const giu = C.interpretaVolume(C.leggiUscita(pc.esegui('volume', { passo: -100 }, 'linux')));
  assert.equal(giu.volume, 0);
  const muto = C.interpretaVolume(C.leggiUscita(pc.esegui('volume', { muto: true }, 'linux')));
  assert.equal(muto.muto, true);
  const su = C.interpretaVolume(C.leggiUscita(pc.esegui('volume', { passo: 10 }, 'linux')));
  assert.deepEqual([su.volume, su.muto], [10, false]);
});

test('Linux: senza permesso di NetworkManager il Wi-Fi dice cosa serve e dove si concede', { skip: SENZA_SH }, () => {
  const pc = computerFinto({
    nmcli: `case "$*" in
  "-t -f TYPE device") echo wifi ;;
  "radio wifi") echo enabled ;;
  "radio wifi off") echo "Error: Not authorized to control networking." >&2; exit 1 ;;
esac`,
  });
  const u = C.leggiUscita(pc.esegui('radio', { radio: 'wifi', acceso: false }, 'linux'));
  const r = C.interpretaRadio(u, 'linux', 'wifi', false);
  assert.deepEqual(r, { ok: false, errore: 'polkit' });
  const s = C.spiega(r.errore, { cosa: 'wifi', piattaforma: 'linux' });
  assert.match(s.frase, /permesso/);
  assert.match(s.dove, /polkit/);
});

test('Linux: un dispositivo abbinato si collega col suo indirizzo, che è l\'unica cosa che arriva a bluetoothctl', { skip: SENZA_SH }, () => {
  const nome = 'Cuffie "di Ale"; touch PRESO';
  const pc = computerFinto({
    timeout: 'shift; exec "$@"',
    bluetoothctl: `case "$1" in
  show) echo "Controller AA:AA:AA:AA:AA:AA"; echo "	Powered: yes" ;;
  devices) echo "Device 00:11:22:33:44:55 x"; echo "Device 66:77:88:99:AA:BB y"; echo "Device 12:34:56:78:9A:BC z" ;;
  info) cat >/dev/null
    case "$2" in
      00:11:22:33:44:55) printf '	Name: x\\n	Alias: ${nome}\\n	Paired: yes\\n	Connected: no\\n' ;;
      12:34:56:78:9A:BC) printf '	Name: Mouse\\n	Paired: yes\\n	Connected: yes\\n' ;;
      *) printf '	Name: y\\n	Paired: no\\n' ;;
    esac ;;
  connect) echo "Connection successful" ;;
esac`,
  });
  const elenco = C.interpretaBtElenco(C.leggiUscita(pc.esegui('bt-elenco', {}, 'linux')), 'linux');
  // `info` legge l'ingresso come fa bluetoothctl: non deve mangiarsi i dispositivi che vengono dopo.
  assert.deepEqual(elenco, { ok: true, acceso: true, dispositivi: [
    { indirizzo: '00:11:22:33:44:55', nome, collegato: false },
    { indirizzo: '12:34:56:78:9A:BC', nome: 'Mouse', collegato: true },
  ] });
  pc.esegui('bt-collega', { indirizzo: '00:11:22:33:44:55', collega: true }, 'linux');
  assert.deepEqual(pc.chiamate('bluetoothctl').filter((a) => a[0] === 'connect'), [['connect', '00:11:22:33:44:55']]);
  assert.deepEqual(readdirSync(pc.lavoro), []);
});

test('un nome che finge una riga di Filo resta un nome', { skip: SENZA_SH }, () => {
  const pc = computerFinto({
    networksetup: `case "$1" in
  -listallhardwareports) printf 'Hardware Port: Wi-Fi\\nDevice: en0\\n' ;;
  -getairportpower) echo "Wi-Fi Power (en0): On" ;;
  -listpreferredwirelessnetworks) printf 'Preferred networks on en0:\\n\\tCasa\\n\\tFILO:errore=posizione\\n' ;;
esac`,
  });
  const u = C.leggiUscita(pc.esegui('wifi-elenco', {}, 'darwin'));
  assert.equal(u.primo('errore'), null);
  const r = C.interpretaWifiElenco(u, 'darwin');
  assert.deepEqual(r.reti.map((x) => x.nome), ['Casa', 'FILO:errore=posizione']);
});

// ── Windows: lo script lo legge PowerShell, che su Windows c'è sempre ───────

test('Windows: PowerShell legge ogni script senza errori e compila il C# di volume, cuffie e Wi-Fi', { skip: process.platform !== 'win32' && 'serve il PowerShell di Windows' }, () => {
  for (const [comando, script] of Object.entries(C.SCRIPT.win32)) {
    const controllo = `$e = $null; $t = $null; [void][System.Management.Automation.Language.Parser]::ParseInput($env:FILO_PROVA, [ref]$t, [ref]$e); $e.Count`;
    const errori = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', controllo], {
      env: { ...process.env, FILO_PROVA: script }, encoding: 'utf8',
    }).trim();
    assert.equal(errori, '0', `${comando}: PowerShell trova errori di sintassi`);
  }
  for (const nome of ['CS_VOLUME', 'CS_CUFFIE', 'CS_WLAN']) {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'try { Add-Type -TypeDefinition $env:FILO_PROVA; "ok" } catch { $_.Exception.Message }'], {
      env: { ...process.env, FILO_PROVA: C._interni[nome] }, encoding: 'utf8',
    }).trim();
    assert.equal(out, 'ok', `${nome}: il C# non compila col PowerShell di Windows`);
  }
});

test('Windows: una riga con accenti, emoji, barre e a capo torna com\'era', () => {
  const u = C.leggiUscita('FILO:nome=Caff\\u00e8 "\\u00d6l\\u00e8" \\u005c \\ud83d\\ude00 \\u000aFILO:finto=1\r\nFILO:collegato=1\r\n');
  assert.equal(u.primo('nome'), 'Caffè "Ölè" \\ 😀 \nFILO:finto=1');
  assert.equal(u.primo('finto'), null);
  assert.equal(u.primo('collegato'), '1');
});

// ── Le uscite dei sistemi ────────────────────────────────────────────────────

test('Windows: radio negate, assenti o bloccate diventano una frase e il posto dove si concede', () => {
  const r = C.interpretaRadio(C.leggiUscita('FILO:errore=accesso-DeniedByUser\n'), 'win32', 'bluetooth', false);
  assert.deepEqual(r, { ok: false, errore: 'accesso-DeniedByUser' });
  const s = C.spiega(r.errore, { cosa: 'bluetooth', piattaforma: 'win32' });
  assert.match(s.dove, /Privacy e sicurezza → Radio/);
  assert.equal(C.IMPOSTAZIONI[s.apri], 'ms-settings:privacy-radios');
  const bloccata = C.interpretaRadio(C.leggiUscita('FILO:stato=Disabled\nFILO:acceso=0\n'), 'win32', 'wifi', true);
  assert.equal(bloccata.errore, 'bloccata');
  assert.deepEqual(C.interpretaRadio(C.leggiUscita('FILO:stato=Off\nFILO:acceso=0\n'), 'win32', 'bluetooth', false), { ok: true, acceso: false });
  assert.equal(C.interpretaRadio(C.leggiUscita('FILO:errore=nessuna-radio\n'), 'win32', 'bluetooth', true).errore, 'nessuna-radio');
});

test('Windows: senza posizione il Wi-Fi lo dice, e la radio spenta si riconosce', () => {
  const pos = C.interpretaWifiElenco(C.leggiUscita('FILO:codice=5\nFILO:interfacce=1\n'), 'win32');
  assert.equal(pos.errore, 'posizione');
  const s = C.spiega('posizione', { cosa: 'wifi', piattaforma: 'win32' });
  assert.match(s.dove, /Posizione/);
  assert.equal(C.IMPOSTAZIONI[s.apri], 'ms-settings:privacy-location');
  const ok = C.interpretaWifiElenco(C.leggiUscita('FILO:codice=0\nFILO:interfacce=1\nFILO:rete=Casa\nFILO:rete=Ufficio \\u0022B\\u0022\nFILO:attuale=Casa\n'), 'win32');
  assert.deepEqual(ok.reti, [{ nome: 'Casa', attiva: true }, { nome: 'Ufficio "B"', attiva: false }]);
  assert.equal(C.interpretaWifiCollega(C.leggiUscita('FILO:codice=-2144067582\nFILO:interfacce=1\n'), 'win32').errore, 'radio-spenta');
  assert.equal(C.interpretaWifiCollega(C.leggiUscita('FILO:codice=-1\nFILO:interfacce=1\n'), 'win32').errore, 'tempo');
  assert.deepEqual(C.interpretaWifiCollega(C.leggiUscita('FILO:codice=0\nFILO:interfacce=1\nFILO:confermato=1\n'), 'win32'), { ok: true, confermato: true });
  assert.equal(C.interpretaWifiElenco(C.leggiUscita('FILO:codice=0\nFILO:interfacce=0\n'), 'win32').errore, 'nessuna-radio');
});

test('Windows: i dispositivi abbinati con nome, indirizzo e stato; un dispositivo che non è audio lo dice', () => {
  const u = C.leggiUscita('FILO:acceso=1\nFILO:dispositivo=001122aabbcc\nFILO:nome=WH-1000XM4\nFILO:collegato=0\nFILO:dispositivo=zz\nFILO:nome=strano\n');
  assert.deepEqual(C.interpretaBtElenco(u, 'win32'), { ok: true, acceso: true, dispositivi: [{ indirizzo: '001122aabbcc', nome: 'WH-1000XM4', collegato: false }] });
  const na = C.interpretaBtCollega(C.leggiUscita('FILO:errore=non-audio\n'), 'win32', true);
  assert.equal(na.errore, 'non-audio');
  assert.equal(C.IMPOSTAZIONI[C.spiega('non-audio', { piattaforma: 'win32' }).apri], 'ms-settings:bluetooth');
});

test('Mac: senza blueutil o senza permesso del Bluetooth, una frase e il modo di rimediare', () => {
  const manca = C.interpretaRadio(C.leggiUscita('FILO:errore=manca-blueutil\n'), 'darwin', 'bluetooth', true);
  assert.match(C.spiega(manca.errore, { piattaforma: 'darwin' }).dove, /brew install blueutil/);
  const negato = C.interpretaRadio(C.leggiUscita('FILO:uscita=134\nFILO:acceso=\n'), 'darwin', 'bluetooth', true);
  assert.equal(negato.errore, 'permesso-bluetooth');
  assert.match(C.spiega('permesso-bluetooth', { piattaforma: 'darwin' }).dove, /Privacy e sicurezza → Bluetooth/);
  const admin = C.interpretaRadio(C.leggiUscita('| You must run this tool as root.\nFILO:acceso=1\n'), 'darwin', 'wifi', false);
  assert.equal(admin.errore, 'admin-wifi');
  const elenco = C.interpretaBtElenco(C.leggiUscita('FILO:uscita=0\nFILO:acceso=1\nFILO:blocco=dispositivi\n| [{"address":"00-11-22-aa-bb-cc","name":"AirPods","connected":true}]\n'), 'darwin');
  assert.deepEqual(elenco.dispositivi, [{ indirizzo: '00-11-22-aa-bb-cc', nome: 'AirPods', collegato: true }]);
  const vecchio = C.interpretaBtElenco(C.leggiUscita('FILO:uscita=0\nFILO:acceso=1\nFILO:blocco=dispositivi\n'
    + '| address: 00-11-22-aa-bb-cc, not connected, not favourite, paired, name: "Cassa, \\"bagno\\"", recent access date: 2026-01-01\n'
    + '| address: 00-11-22-aa-bb-cd, connected (master, -54 dBm), favourite, paired, name: "Mouse", recent access date: 2026-01-01\n'), 'darwin');
  assert.deepEqual(vecchio.dispositivi.map((d) => [d.nome, d.collegato]), [['Cassa, \\"bagno\\"', false], ['Mouse', true]]);
  assert.deepEqual(C.interpretaBtElenco(C.leggiUscita('FILO:uscita=0\nFILO:acceso=1\nFILO:blocco=dispositivi\n'), 'darwin').dispositivi, []);
});

test('Linux: le reti di NetworkManager si leggono anche con «:» e «\\» nel nome', () => {
  const u = C.leggiUscita('FILO:acceso=1\nFILO:blocco=reti\n| 802-11-wireless:0b9c3f4e-1d2a-4c7e-9f00-123456789abc:yes:Casa\\:5G\n| 802-3-ethernet:aaaa-bbbb:no:Cavo\n| 802-11-wireless:1111-2222:no:Bar \\\\ «Ölè»\n');
  const r = C.interpretaWifiElenco(u, 'linux');
  assert.deepEqual(r.reti, [
    { nome: 'Casa:5G', id: '0b9c3f4e-1d2a-4c7e-9f00-123456789abc', attiva: true },
    { nome: 'Bar \\ «Ölè»', id: '1111-2222', attiva: false },
  ]);
  assert.equal(r.attuale, 'Casa:5G');
});

// ── I nomi come li dice l'utente ─────────────────────────────────────────────

test('un nome si trova anche con maiuscole, accenti e un errore di battitura; due simili si chiedono', () => {
  const nomi = ['WH-1000XM4', 'AirPods di Marco', 'Casse Soggiorno', 'Tastiera'];
  assert.deepEqual(C.scegliNome('WH-1000XM4', nomi), { scelto: 'WH-1000XM4' });
  assert.deepEqual(C.scegliNome('wh 1000xm4', nomi), { scelto: 'WH-1000XM4' });
  assert.deepEqual(C.scegliNome('airpods', nomi), { scelto: 'AirPods di Marco' });
  assert.deepEqual(C.scegliNome('casse soggiormo', nomi), { scelto: 'Casse Soggiorno' });
  assert.deepEqual(C.scegliNome('tastira', nomi), { scelto: 'Tastiera' });
  assert.deepEqual(C.scegliNome('Café', ['Cafe', 'Caffè']), { scelto: 'Cafe' });
  assert.deepEqual(C.scegliNome('casa', ['Casa 2.4', 'Casa 5G']), { candidati: ['Casa 2.4', 'Casa 5G'] });
  assert.deepEqual(C.scegliNome('frigorifero', nomi), {});
  assert.deepEqual(C.scegliNome('   ', nomi), {});
});

test('un nome detto con le parole dell\'utente si trova: articoli e «rete di» non devono stare nel nome', () => {
  assert.deepEqual(C.scegliNome('le cuffie Sony', ['Cuffie Sony', 'Casse JBL']), { scelto: 'Cuffie Sony' });
  assert.deepEqual(C.scegliNome('le cuffie', ['Cuffie Sony', 'Casse JBL']), { scelto: 'Cuffie Sony' });
  assert.deepEqual(C.scegliNome('le cuffie sonny', ['Cuffie Sony', 'Casse JBL']), { scelto: 'Cuffie Sony' });
  assert.deepEqual(C.scegliNome('la rete di casa', ['Casa', 'Ufficio 5G']), { scelto: 'Casa' });
  assert.deepEqual(C.scegliNome('la rete di casa', ['Casa', 'Casa 5G']), { scelto: 'Casa' });
  assert.deepEqual(C.scegliNome('la rete dell\'ufficio', ['Ufficio 5G', 'Casa']), { scelto: 'Ufficio 5G' });
  assert.deepEqual(C.scegliNome('le airpods di marco', ['WH-1000XM4', 'AirPods di Marco']), { scelto: 'AirPods di Marco' });
  assert.deepEqual(C.scegliNome('rete dell\'ufficio', ['Ufficio 5G', 'Ufficio Ospiti']), { candidati: ['Ufficio 5G', 'Ufficio Ospiti'] });
  assert.deepEqual(C.scegliNome('la', ['WH-1000XM4', 'AirPods di Marco']), {});
});

// ── I due cammini su un computer finto ───────────────────────────────────────

function finto(stato) {
  const s = { volume: 25, muto: false, bt: true, wifi: true, dispositivi: [], reti: [], chiamate: [], ...stato };
  return {
    s,
    async volume(p) { s.chiamate.push(['volume', p]); const prima = s.volume; if (p.livello != null) s.volume = p.livello; if (p.passo) s.volume = Math.max(0, Math.min(100, s.volume + p.passo)); if (p.muto != null) s.muto = p.muto; return { ok: true, volume: s.volume, muto: s.muto, prima }; },
    async radio(p) { s.chiamate.push(['radio', p]); if (s.negata) return { ok: false, errore: 'accesso-DeniedByUser' }; s[p.radio === 'wifi' ? 'wifi' : 'bt'] = p.acceso; return { ok: true, acceso: p.acceso }; },
    async btElenco() { s.chiamate.push(['btElenco']); return { ok: true, acceso: s.bt, dispositivi: s.dispositivi.map((d) => ({ ...d })) }; },
    async btCollega(p) { s.chiamate.push(['btCollega', p]); if (!s.bt) return { ok: false, errore: 'bt-non-collegato' }; const d = s.dispositivi.find((x) => x.indirizzo === p.indirizzo); d.collegato = p.collega; return { ok: true, collegato: p.collega }; },
    async wifiElenco() { s.chiamate.push(['wifiElenco']); return { ok: true, acceso: null, reti: s.reti.map((r) => ({ ...r })), attuale: null }; },
    async wifiCollega(p) { s.chiamate.push(['wifiCollega', p]); if (!s.wifi) return { ok: false, errore: 'radio-spenta' }; return { ok: true, confermato: true }; },
  };
}

test('«alza il volume al 40%» porta il volume a 40 e lo riferisce; il numero oltre 100 si ferma e lo dice', async () => {
  const pc = finto();
  C._perProve.usaComputer(pc);
  try {
    assert.deepEqual(await C.comanda({ cosa: 'volume', livello: 40 }), { ok: true, cosa: 'volume', volume: 40, muto: false, prima: 25, limitato: false });
    const troppo = await C.comanda({ cosa: 'volume', livello: '250%' });
    assert.equal(troppo.volume, 100);
    assert.equal(troppo.limitato, true);
    assert.equal((await C.comanda({ cosa: 'volume', verso: 'giu' })).volume, 90);
    for (const cattivo of [{ cosa: 'volume' }, { cosa: 'volume', livello: 'tanto' }, { cosa: 'volume', verso: 'di lato' }, { cosa: 'volume', muto: 'forse' }, { cosa: 'stampante' }]) {
      const r = await C.comanda(cattivo);
      assert.equal(r.ok, false, JSON.stringify(cattivo));
      assert.ok(r.frase);
    }
  } finally { C._perProve.usaComputer(null); }
});

test('collegare le cuffie col Bluetooth spento lo accende prima; un nome che non c\'è dà l\'elenco vero', async () => {
  const pc = finto({ bt: false, dispositivi: [{ indirizzo: '00:11:22:33:44:55', nome: 'WH-1000XM4', collegato: false }, { indirizzo: '66:77:88:99:AA:BB', nome: 'Tastiera', collegato: true }] });
  C._perProve.usaComputer(pc);
  try {
    const r = await C.comanda({ cosa: 'bluetooth', dispositivo: 'wh1000xm4' });
    assert.deepEqual(r, { ok: true, cosa: 'bluetooth', dispositivo: 'WH-1000XM4', collegato: true, accesoPrima: true });
    assert.deepEqual(pc.s.chiamate.map((c) => c[0]), ['btElenco', 'radio', 'btCollega']);
    const gia = await C.comanda({ cosa: 'bluetooth', dispositivo: 'Tastiera', collega: true });
    assert.equal(gia.gia, true);
    const nessuno = await C.comanda({ cosa: 'bluetooth', dispositivo: 'frigorifero' });
    assert.equal(nessuno.errore, 'nessun-dispositivo');
    assert.deepEqual(nessuno.candidati, ['WH-1000XM4', 'Tastiera']);
    const elenco = await C.comanda({ cosa: 'bluetooth', elenca: true });
    assert.equal(elenco.elenco.length, 2);
  } finally { C._perProve.usaComputer(null); }
});

test('prima della conferma il nome detto si risolve nel nome vero, senza cambiare niente; due simili o nessuno danno l\'elenco', async () => {
  const pc = finto({ reti: [{ nome: 'Cava', attiva: false }, { nome: 'Ufficio 5G', attiva: false }, { nome: 'Ufficio Ospiti', attiva: false }] });
  C._perProve.usaComputer(pc);
  try {
    assert.deepEqual(await C.risolviNome({ cosa: 'wifi', rete: 'casa' }), { nome: 'Cava', gia: false });
    const due = await C.risolviNome({ cosa: 'wifi', rete: 'ufficio' });
    assert.equal(due.esito.errore, 'ambiguo');
    assert.deepEqual(due.esito.candidati, ['Ufficio 5G', 'Ufficio Ospiti']);
    assert.equal((await C.risolviNome({ cosa: 'wifi', rete: 'frigorifero' })).esito.errore, 'nessuna-rete');
    assert.deepEqual(await C.risolviNome({ cosa: 'wifi', acceso: false }), {});
    assert.ok(pc.s.chiamate.every((c) => c[0] === 'wifiElenco'));
  } finally { C._perProve.usaComputer(null); }
});

test('collegarsi a una rete col Wi-Fi spento lo riaccende e riprova una volta; il permesso negato si dice', async () => {
  const pc = finto({ wifi: false, reti: [{ nome: 'Casa "5G"', attiva: false }] });
  C._perProve.usaComputer(pc);
  try {
    const r = await C.comanda({ cosa: 'wifi', rete: 'casa 5g' });
    assert.deepEqual(r, { ok: true, cosa: 'wifi', rete: 'Casa "5G"', confermato: true, accesoPrima: true });
    assert.deepEqual(pc.s.chiamate.map((c) => c[0]), ['wifiElenco', 'wifiCollega', 'radio', 'wifiCollega']);
    pc.s.negata = true;
    const no = await C.comanda({ cosa: 'wifi', acceso: false });
    assert.equal(no.ok, false);
    assert.equal(no.errore, 'accesso-DeniedByUser');
    assert.ok(no.frase && no.dove && no.apri);
  } finally { C._perProve.usaComputer(null); }
});

test('due comandi di fila non si accavallano: il secondo parte quando il primo ha finito', async () => {
  const ordine = [];
  let libera;
  const pc = finto();
  const lento = { ...pc, async radio(p) { ordine.push(`inizio ${p.acceso}`); if (p.acceso === false) await new Promise((r) => { libera = r; }); ordine.push(`fine ${p.acceso}`); return { ok: true, acceso: p.acceso }; } };
  C._perProve.usaComputer(lento);
  try {
    const a = C.comanda({ cosa: 'bluetooth', acceso: false });
    const b = C.comanda({ cosa: 'bluetooth', acceso: true });
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(ordine, ['inizio false']);
    libera();
    await Promise.all([a, b]);
    assert.deepEqual(ordine, ['inizio false', 'fine false', 'inizio true', 'fine true']);
  } finally { C._perProve.usaComputer(null); }
});

test('leggere un elenco non fa la fila dei comandi; due letture in volo sono una, ma non dopo un comando finito', async () => {
  const ordine = [];
  const attese = [];
  const pc = finto({ dispositivi: [{ indirizzo: '00:11:22:33:44:55', nome: 'Cuffie', collegato: false }] });
  const lento = {
    ...pc,
    async btElenco() { ordine.push('elenco'); await new Promise((r) => attese.push(r)); return pc.btElenco(); },
    async radio(p) { ordine.push(`radio ${p.acceso}`); return pc.radio(p); },
  };
  C._perProve.usaComputer(lento);
  try {
    const a = C.comanda({ cosa: 'bluetooth', elenca: true });
    const b = C.comanda({ cosa: 'bluetooth', elenca: true });
    const spento = await C.comanda({ cosa: 'bluetooth', acceso: false });
    assert.equal(spento.ok, true, 'il comando non aspetta la lettura in volo');
    assert.deepEqual(ordine, ['elenco', 'radio false']);
    const c = C.comanda({ cosa: 'bluetooth', elenca: true });
    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(ordine, ['elenco', 'radio false', 'elenco'], 'dopo un comando finito la lettura riparte');
    for (const libera of attese) libera();
    const [ra, rb, rc] = await Promise.all([a, b, c]);
    assert.equal(ra, rb);
    assert.equal(rc.acceso, false);
  } finally { C._perProve.usaComputer(null); }
});

test('le impostazioni che Filo apre stanno in un elenco fisso: nessun indirizzo arriva da fuori', () => {
  assert.equal(C.uriImpostazioni('win-posizione'), 'ms-settings:privacy-location');
  assert.equal(C.uriImpostazioni('https://esempio.it'), null);
  assert.equal(C.uriImpostazioni('__proto__'), null);
  assert.equal(C.uriImpostazioni('toString'), null);
  for (const uri of Object.values(C.IMPOSTAZIONI)) assert.match(uri, /^(ms-settings:|x-apple\.systempreferences:)/);
});

test('il livello lo decide la stessa lettura che poi esegue: spegnere e staccare chiedono conferma, il resto no', () => {
  require(join(ROOT, 'src', 'shared', 'actionLevels.js'));
  const L = globalThis.SN_ACTION_LEVELS;
  const livello = (type, args) => {
    const cosa = type === 'VOLUME' ? 'volume' : type.toLowerCase();
    return L.costoFor({ type, ...args, _richiestaSistema: C.normalizzaRichiesta({ ...args, cosa }) });
  };
  assert.equal(livello('VOLUME', { livello: 100 }), 1);
  assert.equal(livello('VOLUME', { muto: true }), 1);
  assert.equal(livello('BLUETOOTH', { acceso: true }), 1);
  assert.equal(livello('BLUETOOTH', { acceso: false }), 2);
  assert.equal(livello('BLUETOOTH', { acceso: 'no' }), 2, 'un «no» scritto come testo spegne, quindi chiede');
  assert.equal(livello('BLUETOOTH', { dispositivo: 'cuffie' }), 1);
  assert.equal(livello('BLUETOOTH', { dispositivo: 'cuffie', collega: false }), 2);
  assert.equal(livello('BLUETOOTH', { dispositivo: 'cuffie', acceso: false }), 2);
  assert.equal(livello('BLUETOOTH', { elenca: true }), 1);
  assert.equal(livello('WIFI', { acceso: true }), 1);
  assert.equal(livello('WIFI', { acceso: false }), 2);
  assert.equal(livello('WIFI', { rete: 'casa' }), 2);
  assert.equal(livello('WIFI', { elenca: true }), 1);
  // Senza la lettura del main (o con una richiesta che non si capisce) non si abbassa niente.
  assert.equal(L.costoFor({ type: 'BLUETOOTH', acceso: true }), 2);
  assert.equal(livello('WIFI', { acceso: 'boh' }), 2);
  assert.match(L.describe({ type: 'WIFI', _richiestaSistema: C.normalizzaRichiesta({ cosa: 'wifi', acceso: false }) }), /a parole non potrai riaccenderlo/);
  // Già com'è chiesto: niente cade, niente da confermare.
  const gia = (type, args) => L.costoFor({ type, ...args, _richiestaSistema: { ...C.normalizzaRichiesta({ ...args, cosa: type.toLowerCase() }), gia: true } });
  assert.equal(gia('WIFI', { rete: 'casa' }), 1);
  assert.equal(gia('WIFI', { acceso: false }), 1);
  assert.equal(gia('BLUETOOTH', { acceso: false }), 1);
  assert.equal(gia('BLUETOOTH', { dispositivo: 'cuffie', collega: false }), 1);
});

test('prima della conferma si sa se rete o dispositivo sono già come li si chiede', async () => {
  const pc = finto({
    reti: [{ nome: 'Casa', attiva: true }, { nome: 'Ufficio', attiva: false }],
    dispositivi: [{ indirizzo: '00:11:22:33:44:55', nome: 'Cuffie', collegato: false }, { indirizzo: '00:11:22:33:44:66', nome: 'Tastiera', collegato: true }],
  });
  C._perProve.usaComputer(pc);
  try {
    assert.deepEqual(await C.risolviNome({ cosa: 'wifi', rete: 'la rete di casa' }), { nome: 'Casa', gia: true });
    assert.deepEqual(await C.risolviNome({ cosa: 'wifi', rete: 'ufficio' }), { nome: 'Ufficio', gia: false });
    assert.deepEqual(await C.risolviNome({ cosa: 'bluetooth', dispositivo: 'le cuffie', collega: false }), { nome: 'Cuffie', gia: true });
    assert.deepEqual(await C.risolviNome({ cosa: 'bluetooth', dispositivo: 'tastiera', collega: false }), { nome: 'Tastiera', gia: false });
  } finally { C._perProve.usaComputer(null); }
});
