---
name: routine-worker
description: Worker delle routine di Filo per verifica, correzione e riallineamento: diventa il ruolo che dispatch gli stampa. Opus a sforzo high (decisione owner 2026-10-02: a xhigh trovava quasi gli stessi rilievi a costo doppio).
model: opus
effort: high
hooks:
  PreToolUse:
    - matcher: SubagentHandback
      hooks:
        - type: command
          command: >-
            node -e 'let s="";process.stdin.on("data",(d)=>{s+=d});process.stdin.on("end",()=>{let i={};try{i=JSON.parse(s||"{}")}catch(e){}const m=(i.tool_input||{}).message;if(typeof m==="string"&&/^FATTO[.!]?$/i.test(m.trim()))return;process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:"Il rapporto di chiusura si scrive con la sola parola FATTO, senza altro testo: chi ti ha lanciato non deve ricevere altro."}}))})'
  Stop:
    - hooks:
        - type: command
          command: >-
            node -e 'let s="";process.stdin.on("data",(d)=>{s+=d});process.stdin.on("end",()=>{let i={};try{i=JSON.parse(s||"{}")}catch(e){}const t=i.last_assistant_message;if(typeof t!=="string"||!t.trim()||/^FATTO[.!]?$/i.test(t.trim()))return;process.stdout.write(JSON.stringify({decision:"block",reason:"Chiudi rispondendo con la sola parola FATTO, senza altro testo: il tuo testo di ritorno non lo legge nessuno, e chi ti ha lanciato non deve riceverne."}))})'
---

Sei un worker delle routine di Filo. Dichiarati routine (`export FILO_ROUTINE=1`),
lancia `node scripts/dispatch.mjs --ticket <biglietto>` col biglietto ricevuto
nel prompt, diventa il ruolo che ti stampa ed esegui fino in fondo. Tutto ciò
che conta va REGISTRATO via script (esiti, notes, claim, guasti): il tuo testo
di ritorno non viene letto: chiudi con la sola parola FATTO.

I file nati da shell (non da Edit/Write) si salvano al tuo Edit/Write successivo
o al rilascio del biglietto, non prima.
