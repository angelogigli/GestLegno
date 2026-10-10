# GestLegno Web — contesto per Claude

Questo file serve a riprendere il lavoro sul server di produzione. Lingua di lavoro: italiano.
Proprietario del progetto: Angelo (sviluppatore/sistemista). Cliente: segheria/produzione profili e pannelli in legno (Gruppo Legno S.r.l.).
Documentazione completa del database: `docs/mappa-db-legnoeuro.md` (anche nel Project claude.ai "GESTLEGNO").

## Cos'è
Sostituto web di una parte del gestionale VB6 **GestLegno.exe** (C:\GESTLEGNO sul PC di sviluppo, nessun sorgente disponibile).
L'app gestisce le **richieste profili dei clienti** e calcola la **proposta di taglio** dal magazzino profili.
Database: SQL Server, `LEGNOEURO` (produzione) / `LEGNOEURO_TEST` (copia per le prove, da `sql/01-crea-db-test.sql`).

## Struttura
- `server.js` — Express + mssql. API: `/api/info`, `/api/clienti`, `/api/articoli`, `/api/varianti`, `/api/stock`, `/api/equivalenti`,
  `/api/anni`, `/api/richieste` (lista), `/api/richieste/:id` (dettaglio con proposta/impegni del vecchio programma),
  `/api/prossimo-numero`, `POST /api/richieste` (salva; solo se `allowWrite`), `/api/diagnostica`, `POST /api/export` (campione JSON in `export/`).
  Accesso HTTP Basic da `config.accesso`. Connessione SQL (`auth: sql`) o Windows (`auth: windows`, via msnodesqlv8 con prova dei driver ODBC).
- `public/index.html`, `app.js`, `style.css` — interfaccia, due schede: Archivio e Nuova richiesta (con Soluzione proposta).
- `public/ottimizzatore.js` — algoritmo di taglio, puro JS (funziona anche in Node: `require('./public/ottimizzatore.js')`).
- `verifica-db.js` — test connessione e permessi. `installa.ps1` / `riavvia.ps1` / `disinstalla.ps1` — gestione su Windows Server.
- Avvio in produzione: attività pianificata **GestLegnoWeb** (SYSTEM, all'avvio) → `avvia-servizio.cmd` (ciclo di riavvio) → `node server.js`, log in `logs/server.log`.
- Pubblicazione: **https://gestlegno.mapnet.it** via IIS, sito "GestLegno" (`C:\inetpub\gestlegno`, `iis/web.config`): URL Rewrite + ARR inoltrano a
  `http://127.0.0.1:3010`, redirect HTTP→HTTPS, HSTS. Node ascolta solo su 127.0.0.1 (`config.host`), `trust proxy` loopback.
  Certificato: esistente per il dominio/*.mapnet.it oppure win-acme. Script: `iis/configura-iis.ps1`.
- Login HTTP Basic (`config.accesso.utenti`) con blocco dopo 10 errori in 15 minuti per IP.

## Regole del dominio (verificate sui dati)
- **Lunghezze in metri** ovunque (2,45 = 245 cm). L'interfaccia converte valori ≥ 10 da cm a m.
- Cliente = sottoconto: documenti e tabelle BIT usano `MB_PiaCon.MBPC_Id`, non `MB_Anagr.MBAN_ID`.
- Sezione = `MG_Varianti` (descrizione tipo "72 x 96"); articolo/essenza = `MG_AnaArt`.
- Richiesta: `BIT_RichProfAnag` (testata, `BITRPT_ID` identity, `BITPRT_NumOrd`/`BITPRT_Anno`) → `BIT_RichProfDett`
  (`BITPR_BITPR_ID` = `BITRPT_ID`; `BITPR_DA`/`BITPR_A` lasciati NULL come fa il VB).
- Numero ordine = max tra `BIT_RichProfAnag` e `BIT_PrenotaNumOrd` (numeri riservati dal VB durante l'inserimento) + 1.
- Magazzino profili: `BIT_PROFILI` (una riga per lotto); disponibile = `SUM(BITPR_PZ) - SUM(BITPR_PZ_EVA + ISNULL(BITPR_PZIMPEGNATI,0))` per variante e lunghezza.
- Proposta del vecchio programma: `Bit_ProfiliProposte` (`BITPR_BITRPT_Id`; `BITPR_Lung` = barra, `BITPR_TMPEVA` = barre usate,
  `BITPR_PZFATTI` = composizione tipo "20C,3A" o "4C+4K"). Lettere per sezione dalla lunghezza maggiore.
- Impegni: `BIT_PROFILI_impegni` (`BITPRIM_BITPR_ID` = riga di `BIT_PROFILI`, `BITPRIM_BITRPT_ID` = ordine, `BITPRIM_BITPR_PZ_IMP`).
- Il vecchio programma **taglia** (non giunta): 1 pezzo per barra nel 75% dei casi, fino a 5. Sfrido mediano 5 cm.
- Sezioni equivalenti: stessa descrizione variante su altro articolo, usate se manca materiale.

## Algoritmo (ottimizzatore.js)
Euristica sequenziale a schemi: a ogni passo, per ogni lunghezza di barra disponibile cerca (DFS limitata) lo schema che massimizza
la lunghezza usata con al massimo `maxPezzi` pezzi; sceglie lo schema migliore e lo applica più volte possibile.
Due strategie (min sfrido / pezzo più lungo forzato), si tiene la migliore per pezzi consegnati poi sfrido.
Parametri: `sfridoMaxM` (0,25) o `sfridoMaxPerc` (15), `taglioMm` (0), `maxPezzi` (4), `fuoriSoglia`, `priorita`, `tolleranzaM` (0,10).
- `priorita: 'corti'` (predefinita, richiesta del cliente): tra schemi con sfrido entro la tolleranza dal migliore → barra più corta.
- `'sfrido'`: minimo sfrido + miglioramento iterativo (prova a escludere una lunghezza usata alla volta).
- `'disponibilita'`: tra schemi entro tolleranza → lunghezza con più pezzi in magazzino.
Dall'interfaccia si possono escludere lunghezze (rielabora subito). Un ordine già impegnato rielaborato rimette a disposizione i propri impegni.
Benchmark su 75 ordini d'archivio, stesse barre usate dal vecchio programma: sfrido 0,79% contro 3,23% (priorità sfrido).

## Stato (ottobre 2026)
Fatto: archivio con lettura proposte vecchie, nuova richiesta con dati reali, salvataggio richiesta, ottimizzatore con priorità ed esclusioni,
installazione su server.
**Da fare (prossimo passo): pulsante "Registra"** = scrivere la proposta (`Bit_ProfiliProposte`) e gli impegni per riga di `BIT_PROFILI`
(`BIT_PROFILI_impegni` + aggiornamento `BITPR_PZIMPEGNATI`) come fa GestLegno, e `BITPRT_IMPEGNATO = 1`.
Prima: leggere le stored procedure `BIT_*` del database (es. `BIT_CaricoDistinta`, `BIT_UT_CalcDispo_*`) e uno o più ordini impegnati dal VB
per replicare esattamente i campi. Provare solo su `LEGNOEURO_TEST`.
Poi: stampa distinta di taglio; modifica di una richiesta già salvata.

## Cautele
- Scrivere solo su `LEGNOEURO_TEST` finché il cliente non approva. `verifica-db.js` avvisa se la scrittura è attiva su LEGNOEURO.
- Nessuna FK dichiarata nel DB: le relazioni sono solo per convenzione di nomi (vedi docs). Tre tabelle hanno PK chiamata `BITPR_ID`.
- La vista `BITPLA_V_Errori` citata nel VB non esiste; gli errori di preparazione sono in `BITPLA_Errori` (`ERRO_BITRPT_Id`).
- Non modificare `config.json` dentro risposte o log: contiene password.
