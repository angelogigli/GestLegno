# Mappa database LEGNOEURO (GestLegno)

Fonti: `C:\GESTLEGNO\BitLegno.ini`, `report_db_clean.txt` (inventario tabelle al 16/09/2026), query estratte da `GestLegno.exe` (VB6, nessun sorgente presente), colonne lette da `sys.columns` il 03/10/2026, campione di 89 richieste esportato dall'app il 03/10/2026.
Diagrammi: artifact "Schema LEGNOEURO".

## Connessione
- SQL Server 2022 Express (16.0), istanza predefinita, server `127.0.0.1`, database `LEGNOEURO`
- Il VB usa SQLOLEDB; nel .ini credenziali `sa` / password **in chiaro**
- Backup: `LegnoEuro202609170500.bak` (1,2 GB, 17/09/2026)

## Architettura
- **2380 tabelle, 1795 vuote.** ERP italiano generico (moduli a prefisso) con sopra un modulo custom di produzione legno (`BIT_`).
- Convenzione: `PREF_Campo`, FK = `PREF_PREFPADRE_Id` → `PADRE.PREFPADRE_Id`. Nessuna FK dichiarata: join scritte nel codice.
- Quasi tutte le tabelle hanno `*_MBSC_Id` (società) e `*_MBDV_Id` (divisione).
- Personalizzazioni della segheria su tabelle standard: campi `*_Z_*` (`MGMV_Z_*`, `BLAR_Z_BITPC_Id`, `BLAR_Z_CMS_Id`, `BAAR_Z_CMS_Id`).
- Tabelle temporanee per utente: `BIT_TMP_<utente>`, `BIT_TMP_ELA_/ORD_/SOL_/ESI_<utente>` (→ `create_angelo_tables.sql`).
- Stored procedure `BIT_*` presenti (es. `BIT_CaricoDistinta`, `BIT_INSPACCHI`, `BIT_BL_ANAG_INSERT_LEGNO`, `BIT_UT_CalcDispo_*`): da leggere prima di scrivere documenti dall'app.

| Prefisso | Modulo | Tabelle piene |
|---|---|---|
| MB | Base: anagrafiche, piano conti, tabelle | 121 |
| MG | Magazzino | 37 |
| BIT / BITPLA / BITWEB | Produzione legno (custom) | 51+ |
| BL | DDT di vendita | 14 |
| BA | DDT di acquisto | 11 |
| FT | Fatture | 29 |
| CA | Contabilità | 36 |
| PO | Portafoglio effetti | 12 |
| AG | Provvigioni agenti | 6 |
| WLGN | Commesse | 5 |

## Clienti / fornitori
L'anagrafica è unica; il ruolo dipende dal sottoconto.
- `MB_Anagr` (4.495) — `MBAN_ID`, `MBAN_Nomignolo` (sigla), `MBAN_RagSoc`, `MBAN_PartitaIva`, `MBAN_CodFiscale`, `MBAN_PersFG`, `MBAN_InUso`, `MBAN_Vettore`. Comune/provincia come testo libero. Autoriferimenti: `MBAN_StaOrg_MBAN_Id`, `MBAN_RapFisc_MBAN_Id`.
- `MB_PiaCon` (5.176) — `MBPC_Id`, `MBPC_MBAN_Id`, `MBPC_MBTC_Id`, `MBPC_Conto`, `MBPC_SottoConto`, `MBPC_DataFineVal`
- `MB_TipoConto` — `MBTC_FlagCliente`, `MBTC_FlagFornitore`, `MBTC_FlagAgente`, `MBTC_FlagBanca`
- `MB_CliFor` (4.149) — una riga per sottoconto: `MBCF_MBAN_ID`, `MBCF_MBPC_ID`, `MBCF_Agente_MBPC_Id`, `MBCF_CliFatt_MBPC_ID`, `MBCF_ImpFido`, `MBCF_MBZN_Id`
- `MB_CliForPagam` (`MBPA_MBCF_Id`), `MB_CliforAgenti` (`MBCAG_MBCF_Id`, `MBCAG_MBAG_Id`), `MB_Agenti` (`MBAG_MBAN_ID`), `MB_PersRif` (`MBPR_MBAN_ID`)
- **Documenti e tabelle BIT puntano al sottoconto `MBPC_Id`**, non a `MBAN_ID`.

```sql
SELECT * FROM MB_PiaCon, MB_TipoConto, MB_Anagr
WHERE MBPC_MBTC_ID = MBTC_ID AND MBPC_MBAN_ID = MBAN_ID
  AND MBTC_FlagCliente = 1
ORDER BY MBAN_RagSoc
```

## Magazzino
- `MG_AnaArt` (731) — `MGAA_Id`, `MGAA_MBDC_Classe` (`'ES'` = essenze), `MGAA_Matricola`, `MGAA_Descr`, `MGAA_MBUM_Codice`, `MGAA_Stato` (4 = escluso), costi `CMedio/CUltimo/CStandard`, `PVendita`
- `MG_Varianti` (1.913) — **sezione**: `MGVR_MGAA_Id`, `MGVR_Codice`, `MGVR_Descr` (es. "72 x 96"), `MGVR_Spes`, `MGVR_Larg`. La lunghezza non è nella variante.
- `MG_Registrazioni` (testata) — `MGRG_MBMG_Id`, `MGRG_MBCS_Id`, `MGRG_MBPC_Id`, `MGRG_Data`, `MGRG_Num`, `MGRG_Modulo`, `MGRG_IdProv`
- `MG_Movimenti` (righe) — `MGMV_MGRG_Id`, `MGMV_Prog`, `MGMV_MGAA_Id`, `MGMV_MGVR_Id`, `MGMV_Quantita`, `MGMV_Importo`, campi segheria `MGMV_Z_Spessore/Larghezza/Lunghezza/MetriCubi/Etichetta/Scelta/CMS_Id`
- `MG_GiacenzeArticoli` (per magazzino + variante, `MGGA_QtaGiac`); `MG_GiacenzeVarianti` (totale, **senza magazzino**)
- `MB_Mag` (3), `MB_Caus` (`MBCS_Caus`, `MBCS_Tipo`, `MBCS_Ctp_MBCS_Id`), `MB_Dep`

## Produzione legno (BIT_)
**Pacchi**
- `BIT_PACCHI` — `BITPC_ID`, `BITPC_CODICE`, `BITPC_Prot`, `BITPC_MGAA_ID`, `BITPC_FORN_MBPC_ID` (obbligatorio), `BITPC_MBPC_ID` (cliente, opz.), `BITPC_QTA`, `BITPC_PRU`, `BITPC_CARICATO`, `BITPC_EVASO`, `BITPC_BITCON_ID/BITCOL_ID/BITSTA_ID`, `BITPC_CMS_Id`, `BITPC_RifNumOrd`
- → `BIT_SottoPacchi` (`BITSPC_BITPAC_ID` = `BITPC_ID`; dimensioni, tavole, qta, qta evasa)
- → `BIT_ClientiPacchi` (`BITPCL_BITSPC_ID`, `BITPCL_MBPC_ID`, `BITPCL_FTAN_ID` + `BITPCL_TipoDoc` 'B' = BL_Anag / 'F' = FT_Anag)
- Decodifiche: `BIT_Colore` (`BITCOL_Des`), `BIT_Conf` (`BITCON_Des`), `BIT_Stagionatura` (`BITSTA_Des`)

**Profili**
- Ordine: `BIT_RichProfAnag` (`BITRPT_ID`, `BITPRT_MBPC_ID`, `Anno`, `NumOrd`, `Fatt`, `ORDINARIO`, `IMPEGNATO`, `Riferimento/1/2`) → `BIT_RichProfDett` (`BITPR_BITPR_ID` = `BITRPT_ID`, `BITPR_MGVR_ID`, `LungRich`, `PzRich`; `DA`/`A` vuoti negli ordini recenti)
- `BIT_PROFILI` (magazzino profili, una riga per lotto/lunghezza) — `BITPR_ID`, `BITPR_MGVR_ID`, `BITPR_Lung`, `BITPR_PZ`, `BITPR_PZ_EVA`, `BITPR_PROT`, `BITPR_PZIMPEGNATI` (tipi `money`). Disponibile = `SUM(PZ) - SUM(PZ_EVA + ISNULL(PZIMPEGNATI,0))` per variante e lunghezza.
- `Bit_ProfiliProposte` — `BITPR_BITRPT_Id` (ordine), `BITPR_MGVR_ID`, `BITPR_Lung` (barra), `BITPR_PZ_EVA`, `BITPR_TMPEVA`, `BITPR_PZFATTI`, `BITPR_LETTERA`
- `BIT_PROFILI_impegni` — `BITPRIM_BITPR_ID` (riga di `BIT_PROFILI`), `BITPRIM_BITRPT_ID` (ordine), `BITPRIM_BITPR_Lung`, `BITPRIM_BITPR_PZ_IMP`, `BITPRIM_MGVR_ID_ALT`
- Attenzione: tre tabelle con PK chiamata `BITPR_ID`.

**Pannelli**
- `BIT_PANNELLI` — `BITPL_MGAA_ID`, dimensioni, `BITPL_NUMPZ/NUMPZEVA`, `BITPL_TIPO` (testo → `BIT_TIPOPANNELI.BITPT_DESCR`), `BITPL_Qualita` (testo)
- Ordine: `BIT_RichPannAnag` (`BITPAN_ID`, `BITPAN_MBPC_ID`) → `BIT_RichPannDett` (`BITPAD_BITAN_ID` = `BITPAN_ID`; il codice VB usa per errore `bitpad_bitpan_id`)
- `BIT_LISTINO_PANNELLI` (`BITLIS_MGAA_ID`, dimensioni, `IMP`, `CA/LA/CB/LB`, `TIPO`), `BIT_TIPOPANNELI` (flag dimensioni a listino / variabili), `BIT_QUALPANN`

**Commesse**
- `WLGN_Commesse` — `CMS_Id`, `CMS_Num`, `CMS_AlfaAnno`, `CMS_Chiusa`, `WLGN_MGAA_Essenza`
- Referenziata da `BITPC_CMS_Id`, `BITSPC_CMS_Id`, `MGMV_Z_CMS_Id`, `BLAR_Z_CMS_Id`, `BAAR_Z_CMS_Id`, `BIT_DatiCommessa.BPDC_CMS_Id`

## Logica ordini profili (ricostruita dall'archivio, 75 ordini con proposta)
- **Unità**: tutte le lunghezze di profili e richieste sono in **metri** (2,45 = 245 cm).
- **Flusso**: richiesta (`BIT_RichProfAnag/Dett`) → elaborazione nelle tabelle per utente → proposta (`Bit_ProfiliProposte`) → impegno per singola riga di magazzino (`BIT_PROFILI_impegni`).
- `Bit_ProfiliProposte.BITPR_DataIns` vale 1900-01-01 (lo scrive così il VB): non indica la data della proposta.
- Una riga di proposta = una lunghezza di barra. `BITPR_PZ_EVA` = disponibili all'epoca, `BITPR_TMPEVA` = barre usate, `BITPR_PZFATTI` = composizione.
- **Lettere**: per sezione, lunghezze richieste ordinate dalla maggiore (A = più lunga).
- **Composizione**: gruppi separati da virgola; "20C,3A" = 20 pezzi C e 3 pezzi A da quelle barre; "4C+4K" = pezzi C e K tagliati dalle stesse barre (2,25 + 1,15 su barra 3,40).
- **Taglio, non giunzione**. Da una barra: 1 pezzo nel 75% dei casi, 2 nel 18%, 3-5 nel resto. Lama ~0 (combinazioni a filo frequenti).
- **Sfrido**: mediana 4,8 cm; 90% entro 25 cm / 13,6%; occasionali sfridi alti quando non c'è di meglio.
- **Sezioni equivalenti**: in mancanza usa la stessa sezione (descrizione variante uguale) di un altro articolo.
- Tabelle di lavoro per utente: `BIT_TMP_ESI_<u>` (Id, Lung, Qta, Variante = esistenze), `BIT_TMP_ORD_<u>` (Id, Variante, Lung, SwFatto, Lettera = un pezzo richiesto per riga), `BIT_TMP_SOL_<u>` (Id, EsiId, Resto, OrdId1..OrdId10 = barra con fino a 10 pezzi e resto), `Bit_TMP_<u>` (proposta di lavoro, + `BITPR_ESCLUDI`, `BITPR_QtaLetta`).
- Errori di preparazione: `BITPLA_Errori` (`ERRO_BITRPT_Id`, `ERRO_Descr`, `ERRO_MGVR_Id`, `ERRO_Lung`, `ERRO_QtaLetta`, `ERRO_Barcode`). La vista `BITPLA_V_Errori` citata nel VB non esiste.

## Ciclo documenti
Stessa forma per i tre moduli: `*_Anag` testata, `*_Artic` righe, `*_Tipo` tipo documento.
- **DDT vendita**: `BL_Anag` (`BLAN_BLTI_Id`, `AnnoBol`, `NumBol`, `DataIns`, `MBPC_Id`, `BLAN_FTAN_Id` = fattura, `Dest_MBAN_Id`, `Scaric`) → `BL_Artic` (`BLAR_BLAN_Id`, articolo/variante, qta, prezzo, `BLAR_InFattura`, `BLAR_Z_BITPC_Id` = pacco, `BLAR_Z_CMS_Id`)
- **Fatture**: `FT_Anag` (`FTTI_Id`, `AnnoFatt`, `NumFatt`, `MBPC_Id`, `TotFattura`, `IdSDI`, `StatoInvFattElettr`) → `FT_Artic` (`FTAR_FTAN_Id`, `FTAR_BLAN_Id`, `FTAR_BLAR_ID` = riga DDT)
- **DDT acquisto**: `BA_Anag` (`BATI_Id`, `BAAN_Num` testo, `Data`, `DataArrivo`, `MBPC_Id` fornitore, `Caric`) → `BA_Artic` (`BAAR_BAAN_Id`, `BAAR_Z_CMS_Id`)
- **Riga documento → movimento**: `MGMV_MGRG_Id = *_MGRG_Id AND MGMV_Prog = *_MGMV_Prog`
- Poi contabilità (`CA_`) ed effetti (`PO_`), non ancora mappati.

## App GestLegno Web (`C:\GESTLEGNO\webapp`)
- Node.js + Express + mssql, pagine HTML/JS. Avvio con `avvia.bat`, http://localhost:3010. Connessione in `config.json` (`auth: sql`, utente sa).
- Schede: Archivio (richieste, proposta del vecchio programma decodificata, impegni, export campione), Nuova richiesta (clienti/profili/sezioni/disponibile reali), Soluzione proposta (ottimizzatore `public/ottimizzatore.js`).
- Scrittura su DB disattivata (`allowWrite: false`) finché non si prova su una copia del DB.
- Ottimizzatore: euristica sequenziale a schemi di taglio, soglie di sfrido configurabili, sezioni equivalenti. Sullo stesso materiale scelto dal vecchio programma (75 ordini): stessi pezzi consegnati, sfrido 0,86% contro 3,23%.

## Query utili (SSMS)
Colonne di più tabelle:
```sql
SELECT t.name tabella, c.column_id, c.name colonna, ty.name tipo, c.max_length, c.is_nullable, c.is_identity
FROM sys.tables t JOIN sys.columns c ON c.object_id = t.object_id
JOIN sys.types ty ON ty.user_type_id = c.user_type_id
WHERE t.name IN ('...') ORDER BY t.name, c.column_id;
```
FK dichiarate:
```sql
SELECT OBJECT_NAME(parent_object_id) figlia, OBJECT_NAME(referenced_object_id) padre, name
FROM sys.foreign_keys ORDER BY 1;
```
