# Bombadil contro le pagine interne di Filo (esperimento)

[Bombadil](https://github.com/antithesishq/bombadil) è il fuzzer a proprietà di
Antithesis per interfacce web: clicca e digita a caso e controlla che certe
affermazioni restino vere a ogni stato.

## Cosa c'è qui

- `apri-filo.mjs` — apre Filo col debugger remoto su una porta fissa e ci lascia
  dentro una sola pagina interna, quella da provare.
- `pagina-interna.ts` — la specifica: proprietà di serie più tre di Filo (pagina
  non vuota, nessun valore di servizio a schermo, tema dichiarato).
- `package.json` — cartella sua, così il `package.json` di Filo non si sporca.

## Come si lancia

Due terminali. Nel primo, Filo:

```bash
node tests/bombadil/apri-filo.mjs filo://preferences/preferences.html 9222
```

Nel secondo, Bombadil. **Non gira su Windows**: l'eseguibile esiste solo per
Linux e macOS, quindi da Windows serve WSL (o una macchina Linux che arrivi al
debugger):

```bash
wsl -d Ubuntu-24.04 -- ~/bombadil browser test-external \
  --remote-debugger http://127.0.0.1:9222 \
  --time-limit=5m --exit-on-violation \
  --output-path=/tmp/bombadil-filo \
  filo://preferences/preferences.html \
  /mnt/c/.../tests/bombadil/pagina-interna.ts
```

Note sul perché di queste opzioni:

- `test-external` invece di `test`: è la modalità che si aggancia a un debugger
  già aperto, e l'unica praticabile con Electron. Senza `--create-target`
  Bombadil non apre una scheda sua ma prende la **prima** pagina che il debugger
  elenca: per questo `apri-filo.mjs` chiude tutte le altre schede e controlla
  l'ordine prima di dichiarare pronto.
- l'URL passato come origine serve solo da confine di navigazione: in questa
  modalità Bombadil non ci va da solo.
- da WSL il `127.0.0.1` del debugger si raggiunge solo con la rete
  *rispecchiata*: in `%USERPROFILE%\.wslconfig` serve

  ```ini
  [wsl2]
  networkingMode=mirrored
  ```

I risultati si guardano con `bombadil browser inspect /tmp/bombadil-filo`.
