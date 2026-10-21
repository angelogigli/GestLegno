/* Ottimizzatore di taglio profili (1D, magazzino a lunghezze miste).
 *
 * Regole ricavate dall'archivio del vecchio GestLegno:
 *  - da una barra di magazzino si tagliano uno o più pezzi richiesti, anche di lunghezze diverse;
 *  - la lunghezza richiesta è la misura netta minima; si preferisce la lunghezza esatta;
 *  - lo sfrido accettato è piccolo (mediana 5 cm, 90% entro 25 cm / 14%);
 *  - in mancanza si usa la stessa sezione di un altro articolo ("equivalente").
 *
 * Metodo: euristica sequenziale a schemi (Sequential Heuristic Procedure).
 * A ogni passo, per ogni lunghezza di magazzino si cerca lo schema di taglio che lascia
 * meno sfrido; si applica lo schema migliore quante più volte possibile; si ripete.
 * Si provano due strategie e si tiene la migliore (più pezzi consegnati, poi meno sfrido).
 *
 * Miglioramenti v2 (ottobre 2026):
 *  - tolleranzaCorta: accetta pezzi leggermente più lunghi del resto (es. resto 0,60m, pezzo 0,61m)
 *  - penalizzazione sfrido alto: evita barre con sfrido inevitabile quando ci sono alternative
 *  - recupero resti: cerca di riempire i resti con pezzi corti
 *
 * Unità: input/output in metri; calcoli interni in millimetri interi.
 */
(function (root) {
  const MM = m => Math.round(Number(m) * 1000);
  const M = mm => mm / 1000;

  // Miglior schema per una barra di lunghezza L (mm): massimizza la lunghezza usata.
  // items: [{len, rem}] ordinati per len decrescente. forced: indice da includere almeno una volta.
  // tolCorta: tolleranza in mm per accettare pezzi leggermente più lunghi del resto (es. 20mm)
  function bestPattern(L, items, maxPezzi, taglio, forced, maxNodi, tolCorta = 0) {
    const cap = L + taglio;               // l'ultimo pezzo non richiede il taglio se finisce a filo
    const capTol = cap + tolCorta;        // capacità con tolleranza per l'ultimo pezzo
    const cnt = new Array(items.length).fill(0);
    let best = null, bestUsed = -1, bestOverflow = Infinity, nodi = 0;
    let used0 = 0, n0 = 0;
    if (forced != null) {
      if (items[forced].len + taglio > capTol || items[forced].rem < 1) return null;
      cnt[forced] = 1; used0 = items[forced].len + taglio; n0 = 1;
    }
    function dfs(j, used, n) {
      if (++nodi > maxNodi) return;
      // Calcola overflow: quanto si sfora oltre la capacità reale (0 se entro cap)
      const overflow = Math.max(0, used - cap);
      // Preferisci: più usato, poi meno overflow
      if (used > bestUsed || (used === bestUsed && overflow < bestOverflow)) {
        bestUsed = used; bestOverflow = overflow; best = cnt.slice();
      }
      if (bestUsed >= cap && bestOverflow === 0) return; // ottimo senza sforamento
      if (n >= maxPezzi) return;
      for (let i = j; i < items.length; i++) {
        const it = items[i], step = it.len + taglio;
        if (used + step > capTol) continue;
        const disp = it.rem - cnt[i];
        if (disp <= 0) continue;
        // Per pezzi che sforano, ne mettiamo al massimo 1 (l'ultimo)
        const kmax = Math.min(disp, maxPezzi - n, Math.floor((capTol - used) / step));
        for (let k = kmax; k >= 1; k--) {
          // Se sforerebbe, accetta solo se è l'ultimo pezzo e sfora di poco
          const newUsed = used + k * step;
          if (newUsed > cap && k > 1) continue; // più pezzi non possono sforare
          cnt[i] += k;
          dfs(i + 1, newUsed, n + k);
          cnt[i] -= k;
          if (bestUsed >= cap && bestOverflow === 0) return;
          if (nodi > maxNodi) return;
        }
      }
    }
    dfs(0, used0, n0);
    if (!best || best.every(c => c === 0)) return null;
    const pezzi = best.reduce((s, c) => s + c, 0);
    const netto = best.reduce((s, c, i) => s + c * items[i].len, 0);
    const sfrido = Math.max(0, L - netto); // sfrido può essere negativo se sforato, ma lo consideriamo 0
    return { cnt: best, pezzi, netto, sfrido, overflow: bestOverflow };
  }

  function risolvi(input, strategia) {
    const p = Object.assign({
      taglioMm: 0, maxPezzi: 4, sfridoMaxM: 0.25, sfridoMaxPerc: 15,
      fuoriSoglia: true, maxNodi: 6000, priorita: 'corti', tolleranzaM: 0.10,
      tolleranzaCortaM: 0.02,    // accetta pezzi fino a 2cm più lunghi del resto
      penalizzaSfridoAlto: true, // evita barre con sfrido alto se ci sono alternative
      sfridoAltoPenalizzaM: 0.40, // considera "alto" sfrido >= 40cm
      usaBarreEsatte: true       // NUOVO: preferisci barre con lunghezza uguale o quasi al pezzo
    }, input.param || {});
    const taglio = Math.max(0, Math.round(p.taglioMm));
    const sogliaMm = MM(p.sfridoMaxM);
    const tolCortaMm = MM(p.tolleranzaCortaM);
    const sfridoAltoMm = MM(p.sfridoAltoPenalizzaM);
    const tolEsattaMm = 50; // tolleranza per considerare una barra "esatta" (5cm)
    // domanda: lunghezze distinte
    const mapD = new Map();
    for (const r of input.righe) {
      const len = MM(r.lung);
      if (!(len > 0) || !(r.pz > 0)) continue;
      const d = mapD.get(len) || { len, rem: 0, pz: 0, keys: [], lettera: r.lettera };
      d.rem += r.pz; d.pz += r.pz; d.keys.push(r.key); mapD.set(len, d);
    }
    const items = [...mapD.values()].sort((a, b) => b.len - a.len);
    const stock = input.stock.map(s => ({ ...s, L: MM(s.lung), disp: Math.floor(s.pz), usati: 0, schemi: new Map() }))
      .filter(s => s.L > 0 && s.disp > 0)
      .sort((a, b) => (a.alt - b.alt) || (a.L - b.L));
    const esclusi = new Set();            // indici di domanda che nessuna barra può soddisfare
    let fuoriSoglia = 0, giri = 0;

    // FASE 1: Usa prima le barre con lunghezza esatta o quasi (sfrido <= 5cm)
    if (p.usaBarreEsatte) {
      for (const it of items) {
        if (it.rem <= 0) continue;
        // Cerca barre con lunghezza uguale o leggermente maggiore (max 5cm di sfrido)
        const barreEsatte = stock.filter(s =>
          !s.alt &&
          s.disp - s.usati > 0 &&
          s.L >= it.len &&
          s.L <= it.len + tolEsattaMm
        ).sort((a, b) => a.L - b.L); // preferisci la più corta

        for (const s of barreEsatte) {
          const disponibili = s.disp - s.usati;
          const daUsare = Math.min(disponibili, it.rem);
          if (daUsare <= 0) continue;

          // Assegna queste barre
          it.rem -= daUsare;
          s.usati += daUsare;
          const sfrido = s.L - it.len;
          const chiave = `1x${it.len}`;
          const sc = s.schemi.get(chiave) || {
            n: 0, sfrido, fuoriSoglia: false,
            pezzi: [{ lung: M(it.len), c: 1, lettera: it.lettera }]
          };
          sc.n += daUsare;
          s.schemi.set(chiave, sc);

          if (it.rem <= 0) break;
        }
      }
    }

    // FASE 2: Algoritmo combinatorio per i pezzi rimanenti
    while (giri++ < 5000) {
      const attivi = items.map((it, i) => ({ it, i })).filter(x => x.it.rem > 0 && !esclusi.has(x.i));
      if (!attivi.length) break;
      const sub = attivi.map(x => x.it);
      let forced = null;
      if (strategia === 'lunghi') forced = 0;   // il pezzo più lungo ancora da fare deve entrare
      let migliore = null;
      const tolMm = MM(p.tolleranzaM);
      for (const pass of ['primario', 'equivalente']) {
        const cands = [];
        for (const s of stock) {
          if (s.disp - s.usati <= 0) continue;
          if ((pass === 'primario') === !!s.alt) continue;
          if (s.L < sub[sub.length - 1].len - tolCortaMm) continue; // considera tolleranza
          const pat = bestPattern(s.L, sub, p.maxPezzi, taglio, forced, p.maxNodi, tolCortaMm);
          if (!pat) continue;
          const perc = pat.sfrido / s.L * 100;
          const ok = (pat.sfrido <= sogliaMm || perc <= p.sfridoMaxPerc) && (!pat.overflow || pat.overflow <= tolCortaMm);
          // Penalizza schemi con sfrido alto se ci sono pezzi corti che potrebbero riempirlo
          let sfridoAlto = false;
          if (p.penalizzaSfridoAlto && pat.sfrido >= sfridoAltoMm) {
            // Verifica se esiste un pezzo corto che potrebbe quasi entrare nel resto
            const pezzoCorto = sub.find(it => it.rem > 0 && it.len <= pat.sfrido + tolCortaMm && it.len >= pat.sfrido * 0.5);
            if (pezzoCorto) sfridoAlto = true;
          }
          const cand = { s, pat, ok, perc, resto: s.disp - s.usati, sfridoAlto };
          cands.push(cand);
          if (!migliore || meglio(cand, migliore, 'sfrido')) migliore = cand;
        }
        // Tra gli schemi con sfrido vicino al migliore (entro la tolleranza):
        //  'corti'         -> la barra più corta (si consumano prima gli spezzoni, le barre lunghe restano)
        //  'disponibilita' -> la barra con più pezzi in magazzino
        if ((p.priorita === 'corti' || p.priorita === 'disponibilita') && migliore && migliore.ok) {
          const limite = migliore.pat.sfrido + tolMm;
          const piuAdatta = p.priorita === 'corti'
            ? (c, m) => c.s.L < m.s.L || (c.s.L === m.s.L && c.pat.sfrido < m.pat.sfrido)
            : (c, m) => c.resto > m.resto || (c.resto === m.resto && c.pat.sfrido < m.pat.sfrido);
          for (const c of cands) if (c.ok && c.pat.sfrido <= limite && piuAdatta(c, migliore)) migliore = c;
        }
        if (migliore && migliore.ok) break;     // equivalenti solo se il primario non basta
      }
      if (!migliore) {
        if (forced != null) { esclusi.add(attivi[0].i); continue; }
        break;
      }
      if (!migliore.ok) {
        if (!p.fuoriSoglia) {
          if (forced != null) { esclusi.add(attivi[0].i); continue; }
          break;
        }
      }
      // quante volte applicare lo schema
      const { s, pat } = migliore;
      let k = s.disp - s.usati;
      pat.cnt.forEach((c, j) => { if (c > 0) k = Math.min(k, Math.floor(sub[j].rem / c)); });
      if (k < 1) k = 1;
      pat.cnt.forEach((c, j) => { sub[j].rem -= c * k; });
      s.usati += k;
      if (!migliore.ok) fuoriSoglia += k;
      const chiave = pat.cnt.map((c, j) => c ? `${c}x${sub[j].len}` : '').filter(Boolean).join('+');
      const sc = s.schemi.get(chiave) || {
        n: 0, sfrido: pat.sfrido, fuoriSoglia: !migliore.ok,
        pezzi: pat.cnt.map((c, j) => c ? { lung: M(sub[j].len), c, lettera: sub[j].lettera } : null).filter(Boolean)
      };
      sc.n += k; s.schemi.set(chiave, sc);
    }

    const righe = items.map(it => ({ lung: M(it.len), lettera: it.lettera, keys: it.keys, pz: it.pz, ottenuti: it.pz - Math.max(0, it.rem), mancanti: Math.max(0, it.rem) }));
    const barre = stock.filter(s => s.usati > 0).map(s => ({
      mgvr: s.mgvr, alt: !!s.alt, descr: s.descr, lung: s.lung, disponibili: s.disp, usati: s.usati,
      schemi: [...s.schemi.values()].map(sc => ({ ...sc, sfrido: M(sc.sfrido) }))
    })).sort((a, b) => (a.alt - b.alt) || (b.lung - a.lung));
    const usatoMm = stock.reduce((t, s) => t + s.usati * s.L, 0);
    const consegnatoMm = items.reduce((t, it) => t + (it.pz - Math.max(0, it.rem)) * it.len, 0);
    const richiestoMm = items.reduce((t, it) => t + it.pz * it.len, 0);
    return {
      strategia, righe, barre,
      totali: {
        barre: stock.reduce((t, s) => t + s.usati, 0),
        pezziRichiesti: items.reduce((t, it) => t + it.pz, 0),
        pezziOttenuti: righe.reduce((t, r) => t + r.ottenuti, 0),
        metriRichiesti: M(richiestoMm), metriConsegnati: M(consegnatoMm), metriUsati: M(usatoMm),
        sfridoM: M(usatoMm - consegnatoMm),
        sfridoPerc: usatoMm ? (usatoMm - consegnatoMm) / usatoMm * 100 : 0,
        barreFuoriSoglia: fuoriSoglia
      }
    };
  }

  // a è meglio di b? Sempre prima gli schemi entro soglia.
  // Meno sfrido, poi barra più corta, poi più pezzi. (La priorità alla disponibilità è applicata in risolvi.)
  // Penalizza schemi con sfrido alto quando potrebbero contenere pezzi corti.
  function meglio(a, b, priorita) {
    if (a.ok !== b.ok) return a.ok;
    // Penalizza sfrido alto: preferisci schemi senza sfrido alto
    if (a.sfridoAlto !== b.sfridoAlto) return !a.sfridoAlto;
    // Preferisci schemi senza overflow (tolleranza corta usata)
    const aOver = a.pat.overflow || 0, bOver = b.pat.overflow || 0;
    if (aOver !== bOver) return aOver < bOver;
    if (!a.ok) return a.perc < b.perc - 1e-9 || (Math.abs(a.perc - b.perc) < 1e-9 && a.resto > b.resto);
    if (a.pat.sfrido !== b.pat.sfrido) return a.pat.sfrido < b.pat.sfrido;
    if (a.s.L !== b.s.L) return a.s.L < b.s.L;
    return a.pat.pezzi > b.pat.pezzi;
  }

  const migliorRisultato = (a, b) =>
    (b.totali.metriConsegnati - a.totali.metriConsegnati) ||
    (a.totali.sfridoM - b.totali.sfridoM) ||
    (a.totali.barre - b.totali.barre);

  function ottimizza(input) {
    const prova = inp => ['sfrido', 'lunghi'].map(st => risolvi(inp, st)).sort(migliorRisultato)[0];
    let best = prova(input);
    // Miglioramento: l'euristica è "golosa"; a volte togliere una lunghezza usata porta a una soluzione
    // migliore. Si prova a escludere una alla volta le lunghezze usate e si tiene il risultato migliore.
    // Solo con priorità allo sfrido: con le altre priorità l'obiettivo è un altro.
    if (((input.param || {}).priorita || 'corti') === 'sfrido') {
      let stock = input.stock;
      for (let giro = 0; giro < 3; giro++) {
        let migliorato = false;
        for (const b of best.barre) {
          const ridotto = stock.filter(s => !(s.mgvr === b.mgvr && Math.abs(s.lung - b.lung) < 1e-9));
          const r = prova({ ...input, stock: ridotto });
          if (r.totali.metriConsegnati >= best.totali.metriConsegnati - 1e-9 && r.totali.sfridoM < best.totali.sfridoM - 1e-9) {
            best = r; stock = ridotto; migliorato = true; break;
          }
        }
        if (!migliorato) break;
      }
    }
    return best;
  }

  // Lettere come nel vecchio programma: per sezione, lunghezze dalla più lunga
  function lettere(lunghezze) {
    const uniche = [...new Set(lunghezze.map(Number))].sort((a, b) => b - a);
    const nome = i => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
    return new Map(uniche.map((l, i) => [l, nome(i)]));
  }

  // Decodifica la colonna "Compos." (BITPR_PZFATTI) del vecchio programma: "20C,3A" "4C+4K"
  function decodificaComposizione(testo) {
    return String(testo || '').split(',').map(g => g.trim()).filter(Boolean)
      .map(g => [...g.matchAll(/(\d+)([A-Z]+)/g)].map(m => ({ n: +m[1], lettera: m[2] })));
  }

  const api = { ottimizza, risolvi, lettere, decodificaComposizione, bestPattern };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Ottimizzatore = api;
})(typeof window !== 'undefined' ? window : globalThis);
