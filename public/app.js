/* GestLegno Web — interfaccia */
const $ = id => document.getElementById(id);
const esc = s => s == null ? '' : String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = (v, max = 3) => v == null || v === '' ? '' : Number(v).toLocaleString('it-IT', { maximumFractionDigits: max });
const dt = v => { if (!v) return ''; const d = new Date(v); return isNaN(d) ? esc(v) : d.toLocaleDateString('it-IT'); };
const letter = i => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => t.hidden = true, 2600); }

async function api(url, opt) {
  const fetchOpt = { credentials: 'include' };
  if (opt && opt.body) {
    fetchOpt.method = opt.method || 'POST';
    fetchOpt.headers = { 'Content-Type': 'application/json' };
    fetchOpt.body = JSON.stringify(opt.body);
  }
  const r = await fetch(url, fetchOpt);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Errore ${r.status}`);
  return data;
}
function showDbError(e) { const a = $('dbError'); a.hidden = false; a.textContent = 'Errore dal database: ' + e.message; }
function debounce(fn, ms) { let h; return (...a) => { clearTimeout(h); h = setTimeout(() => fn(...a), ms); }; }

/* Tabella generica per righe con colonne non note a priori */
function genericTable(rows, first = []) {
  if (!rows || !rows.length) return '<div class="empty">Nessun dato</div>';
  const keys = Object.keys(rows[0]);
  const cols = [...first.filter(k => keys.includes(k)), ...keys.filter(k => !first.includes(k))];
  const cell = v => {
    if (v === true) return '<td>✓</td>';
    if (v === false) return '<td class="muted">–</td>';
    if (typeof v === 'number') return `<td class="n">${num(v)}</td>`;
    if (typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v)) return `<td class="n">${dt(v)}</td>`;
    return `<td>${esc(v)}</td>`;
  };
  return `<div class="tbl-wrap"><table><thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>${cols.map(c => cell(r[c])).join('')}</tr>`).join('')}</tbody></table></div>`;
}

/* ================= Schede ================= */
document.querySelectorAll('.tab').forEach(b => b.onclick = () => showTab(b.dataset.tab));
function showTab(t) {
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
  $('tab-archivio').hidden = t !== 'archivio';
  $('tab-nuova').hidden = t !== 'nuova';
  if (t === 'nuova' && !N.ready) initNuova();
}

/* ================= ARCHIVIO ================= */
const A = { rows: [], sel: null };
async function initArchivio() {
  try {
    const info = await api('/api/info');
    $('dbInfo').textContent = `${info.db} · ${info.server} · scrittura ${info.allowWrite ? 'attiva' : 'disattivata'}${info.utenteApp ? ' · ' + info.utenteApp : ''}`;
    N.allowWrite = info.allowWrite;
    const anni = await api('/api/anni');
    const cur = new Date().getFullYear();
    $('fAnno').innerHTML = `<option value="">Tutti</option>` + anni.map(a => `<option value="${a.anno}">${a.anno} (${a.n})</option>`).join('');
    $('fAnno').value = anni.some(a => a.anno === cur) ? cur : (anni[0]?.anno ?? '');
    await loadArchivio();
  } catch (e) { $('dbInfo').textContent = 'Database non raggiungibile'; showDbError(e); }
}
async function loadArchivio() {
  const p = new URLSearchParams({ anno: $('fAnno').value, q: $('fTesto').value, prop: $('fProp').checked ? '1' : '0', top: 500 });
  $('archCount').textContent = 'Caricamento…';
  try { A.rows = await api('/api/richieste?' + p); } catch (e) { showDbError(e); A.rows = []; }
  renderArchivio();
}
function stato(r) {
  const p = [];
  if (r.proposte) p.push(`<span class="pill ok" title="Righe in Bit_ProfiliProposte">Proposta ${r.proposte}</span>`);
  if (r.impegni || r.impegnato) p.push(`<span class="pill warn" title="BIT_PROFILI_impegni">Impegnato</span>`);
  if (r.fatt) p.push(`<span class="pill off">Fatturato</span>`);
  if (!p.length) p.push(`<span class="pill off">Solo richiesta</span>`);
  return `<div class="pills">${p.join('')}</div>`;
}
function renderArchivio() {
  $('archEmpty').hidden = A.rows.length > 0;
  $('archRows').innerHTML = A.rows.map(r => `
    <tr data-id="${r.id}" class="${r.id === A.sel ? 'sel' : ''}">
      <td class="n">${dt(r.data)}</td>
      <td class="n">${r.num ?? ''}/${String(r.anno ?? '').slice(-2)}</td>
      <td class="cli">${esc(r.rag || '(cliente ' + r.mbpc + ')')}<small>${esc([r.rif, r.rif1].filter(Boolean).join(' · '))}</small></td>
      <td class="n">${r.righe}</td>
      <td class="n">${num(r.pz, 0)}</td>
      <td>${stato(r)}</td>
    </tr>`).join('');
  $('archCount').textContent = `${A.rows.length} richieste${A.rows.length >= 500 ? ' (prime 500: restringi la ricerca)' : ''}`;
  $('archRows').querySelectorAll('tr').forEach(tr => tr.onclick = () => openRichiesta(+tr.dataset.id));
}
async function openRichiesta(id) {
  A.sel = id; renderArchivio();
  const box = $('archDetail');
  box.innerHTML = '<div class="empty">Caricamento…</div>';
  let d;
  try { d = await api('/api/richieste/' + id); } catch (e) { box.innerHTML = `<div class="alert">${esc(e.message)}</div>`; return; }
  A.det = d;
  const t = d.testata;
  const tot = d.righe.reduce((s, r) => s + (+r.lung || 0) * (+r.pz || 0), 0);
  const sec = (titolo, nota, res, first) => {
    if (!res) return '';
    if (!res.rows.length && !res.error) return '';
    return `<div class="sec"><h4>${titolo}<small>${nota}</small></h4>
      ${res.error ? `<div class="err">${esc(res.error)}</div>` : genericTable(res.rows, first)}</div>`;
  };
  box.innerHTML = `
    <div class="d-head">
      <div><h3>Ordine ${t.BITPRT_NumOrd}/${t.BITPRT_Anno} · ${esc(t.rag || '')}</h3>
        <div class="sub">${dt(t.BITPRT_DATA)} · conto ${esc(t.conto)}.${esc(t.sotto)} · id richiesta ${t.BITRPT_ID}</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" id="btnCopiaRich" title="Crea una nuova richiesta con le stesse righe">Copia in una nuova richiesta</button>
        <button type="button" id="btnRielabora" class="primary">Apri ed elabora</button>
      </div>
    </div>
    <div class="kv">
      <div><span>Ordinario</span> <b>${t.BITPRT_ORDINARIO ? 'sì' : 'no'}</b></div>
      <div><span>Impegnato</span> <b>${t.BITPRT_IMPEGNATO ? 'sì' : 'no'}</b></div>
      <div><span>Fatturato</span> <b>${t.BITPRT_Fatt ? 'sì' : 'no'}</b></div>
      ${[t.BITPRT_Riferimento, t.BITPRT_Riferimento1, t.BITPRT_Riferimento2].filter(Boolean).map(r => `<div><span>Rif.</span> <b>${esc(r)}</b></div>`).join('')}
    </div>
    <div class="sec"><h4>Richiesta cliente<small>BIT_RichProfDett · ${d.righe.length} righe · totale ${num(tot)}</small></h4>
      <div class="tbl-wrap"><table>
        <thead><tr><th>Rif</th><th>Sezione</th><th>Profilo</th><th class="n">Lung</th><th class="n">Pz</th><th class="n">Da</th><th class="n">A</th><th class="n">Totale</th></tr></thead>
        <tbody>${d.righe.map((r, i) => `<tr><td><span class="rif">${letteraArchivio(d, r)}</span></td><td><b>${esc(r.vdescr || r.vcod)}</b></td>
          <td class="muted">${esc(r.adescr)}</td><td class="n">${num(r.lung)}</td><td class="n">${num(r.pz, 0)}</td>
          <td class="n">${num(r.da)}</td><td class="n">${num(r.a)}</td><td class="n">${num(r.lung * r.pz)}</td></tr>`).join('')}</tbody>
      </table></div></div>
    ${vecchiaProposta(d)}
    ${sec('Impegni di magazzino', 'BIT_PROFILI_impegni', d.impegni, ['vdescr', 'BITPRIM_BITPR_Lung', 'BITPRIM_BITPR_PZ_IMP', 'BITPRIM_MGVR_ID_ALT', 'BITPRIM_BITPR_PZ_IMP_ALT', 'BITPRIM_BITPR_ID'])}
    ${sec('Profili di magazzino usati', 'BIT_PROFILI richiamati da proposta e impegni', d.profili, ['BITPR_ID', 'vdescr', 'BITPR_Lung', 'BITPR_PZ', 'BITPR_PZ_EVA', 'BITPR_PZIMPEGNATI', 'BITPR_PROT'])}
    ${sec('Palmare · testata', 'BITPLA_PalmA', d.palmA)}
    ${sec('Palmare · righe', 'BITPLA_PalmB', d.palmB)}
    ${sec('Errori in preparazione', 'BITPLA_Errori', d.errori)}
    ${!d.proposte.rows.length && !d.impegni.rows.length ? '<p class="muted">Per questa richiesta non ci sono proposte né impegni salvati nelle tabelle note.</p>' : ''}
  `;
  $('btnCopiaRich').onclick = () => copiaInNuova(d, 'copia');
  $('btnRielabora').onclick = async () => { await copiaInNuova(d, 'apri'); await elabora(); $('solPanel').scrollIntoView({ behavior: 'smooth', block: 'start' }); };
}
$('fAnno').onchange = loadArchivio;
$('fProp').onchange = loadArchivio;
$('fTesto').oninput = debounce(loadArchivio, 350);
$('btnExport').onclick = async () => {
  const b = $('btnExport'); b.disabled = true; b.textContent = 'Esportazione…';
  try { const r = await api('/api/export?n=150', { method: 'POST' }); toast(`Salvate ${r.richieste} richieste in ${r.file}`); }
  catch (e) { toast('Export non riuscito: ' + e.message); }
  b.disabled = false; b.textContent = 'Esporta campione';
};

/* ================= NUOVA RICHIESTA ================= */
const N = {
  ready: false, allowWrite: false, cliente: null, cliQuery: '', cliOpen: false, cliIdx: 0, cliList: [],
  articoli: [], varianti: {}, stock: {}, sel: { art: null, mgvr: null },
  righe: [], focusRow: null, editId: null, seq: 1
};
const varById = id => { for (const [art, list] of Object.entries(N.varianti)) { const v = list.find(x => x.id === id); if (v) return { ...v, art: +art }; } return null; };
const artById = id => N.articoli.find(a => a.id === id);
const sezLabel = v => v ? (v.descr || `${v.sp} x ${v.la}`) : '?';

async function initNuova() {
  N.ready = true;
  try {
    N.articoli = await api('/api/articoli');
    if (N.articoli.length) { N.sel.art = N.articoli[0].id; await loadVarianti(N.sel.art); }
  } catch (e) { showDbError(e); }
  await nuovaRichiesta();
}
async function loadVarianti(art) {
  if (!N.varianti[art]) N.varianti[art] = await api('/api/varianti?art=' + art);
  if (!N.varianti[art].some(v => v.id === N.sel.mgvr)) N.sel.mgvr = N.varianti[art][0]?.id ?? null;
}
async function loadStock(mgvr) {
  if (mgvr == null) return [];
  if (!N.stock[mgvr]) N.stock[mgvr] = await api('/api/stock?mgvr=' + mgvr);
  return N.stock[mgvr];
}
async function nuovaRichiesta() {
  const oggi = new Date();
  N.cliente = null; N.cliQuery = ''; N.righe = []; N.focusRow = null; N.editId = null; N.sol = null; N.origine = null; if (N.esclusi) { N.esclusi.clear(); renderEscl(); }
  $('ordData').value = oggi.toISOString().slice(0, 10);
  $('ordAnno').value = oggi.getFullYear();
  [0, 1, 2].forEach(i => $('rif' + i).value = '');
  $('ordOrdinario').checked = true; $('sqlPanel').hidden = true;
  await prossimoNumero();
  renderAll();
}
async function prossimoNumero() {
  try { const r = await api('/api/prossimo-numero?anno=' + $('ordAnno').value); $('ordNum').value = r.num; } catch (e) { showDbError(e); }
}

/* --- Cliente --- */
const searchClienti = debounce(async () => {
  try { N.cliList = await api('/api/clienti?q=' + encodeURIComponent(N.cliQuery)); } catch (e) { N.cliList = []; showDbError(e); }
  N.cliIdx = 0; renderCliente(true);
}, 250);
function renderCliente(keepFocus) {
  const box = $('cliBox');
  if (N.cliente) {
    const c = N.cliente;
    box.innerHTML = `<label>Cliente</label><div class="cli-card"><div><div class="cli-name">${esc(c.rag)}</div>
      <div class="codes">${esc(c.conto)} · ${esc(c.sotto)} — ${esc(c.com || '')} ${c.prov ? '(' + esc(c.prov) + ')' : ''}</div></div>
      <button type="button" class="ghost" id="cliChange">Cambia</button></div>`;
    $('cliChange').onclick = () => { N.cliente = null; N.cliQuery = ''; N.cliList = []; renderAll(); $('cliInput').focus(); };
    return;
  }
  const list = N.cliList;
  box.innerHTML = `<div class="cli-search"><label for="cliInput">Cliente
    <input id="cliInput" type="text" autocomplete="off" placeholder="Ragione sociale o sottoconto (es. 0000005)" value="${esc(N.cliQuery)}"></label>
    ${N.cliOpen ? `<div class="cli-list" role="listbox">${list.length ? list.map((c, i) => `
      <div class="cli-item${i === N.cliIdx ? ' active' : ''}" data-i="${i}" role="option">
        <span class="cli-code">${esc(c.conto)}<br>${esc(c.sotto)}</span><span class="cli-name">${esc(c.rag)}</span>
        <span class="cli-place">${esc(c.com || '')} ${c.prov ? '(' + esc(c.prov) + ')' : ''}</span></div>`).join('')
      : `<div class="cli-item"><span></span><span class="cli-place">${N.cliQuery ? 'Nessun cliente trovato' : 'Scrivi per cercare'}</span></div>`}</div>` : ''}
  </div>`;
  const inp = $('cliInput');
  if (keepFocus) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
  inp.oninput = e => { N.cliQuery = e.target.value; N.cliOpen = true; searchClienti(); };
  inp.onfocus = () => { if (!N.cliOpen) { N.cliOpen = true; searchClienti(); } };
  inp.onkeydown = e => {
    if (e.key === 'ArrowDown') { N.cliIdx = Math.min(N.cliIdx + 1, list.length - 1); e.preventDefault(); renderCliente(true); }
    else if (e.key === 'ArrowUp') { N.cliIdx = Math.max(N.cliIdx - 1, 0); e.preventDefault(); renderCliente(true); }
    else if (e.key === 'Enter' && list[N.cliIdx]) pickCliente(list[N.cliIdx]);
    else if (e.key === 'Escape') { N.cliOpen = false; renderCliente(true); }
  };
  box.querySelectorAll('.cli-item[data-i]').forEach(el => el.onmousedown = e => { e.preventDefault(); pickCliente(list[+el.dataset.i]); });
}
function pickCliente(c) { N.cliente = c; N.cliOpen = false; renderAll(); setTimeout(() => $('inLung')?.focus(), 0); }
document.addEventListener('mousedown', e => { if (N.cliOpen && !e.target.closest('.cli-search')) { N.cliOpen = false; renderCliente(); } });

/* --- Inserimento righe --- */
function renderEntry() {
  const box = $('entryBox');
  if (!N.cliente) { box.innerHTML = `<div class="locked">Scegli prima il cliente nell'anagrafica ordine.</div>`; return; }
  const vars = N.varianti[N.sel.art] || [];
  const editing = N.editId != null ? N.righe.find(r => r.id === N.editId) : null;
  box.innerHTML = `<div class="panel-b"><div class="entry">
    <label for="inArt">Profilo<select id="inArt">${N.articoli.map(a => `<option value="${a.id}"${a.id === N.sel.art ? ' selected' : ''}>${esc(a.descr)}</option>`).join('')}</select></label>
    <label for="inVar">Sezione<select id="inVar">${vars.map(v => `<option value="${v.id}"${v.id === N.sel.mgvr ? ' selected' : ''}>${esc(sezLabel(v))}</option>`).join('')}</select></label>
    <label for="inLung">Lung m<input id="inLung" type="number" class="num" min="0" step="any" value="${editing ? editing.lung : ''}"></label>
    <label for="inPz">Pz<input id="inPz" type="number" class="num" min="1" step="1" value="${editing ? editing.pz : ''}"></label>
    <div class="btn-cell" style="display:flex;gap:6px"><button id="btnIns" type="button" class="primary">${editing ? 'Aggiorna' : 'Inserisci'}</button>
      ${editing ? '<button id="btnAnn" type="button">Annulla</button>' : ''}</div>
  </div><p class="hint">Lunghezza in metri (es. 2,45), come nel gestionale. Invio su Pz inserisce la riga; stessa sezione e lunghezza sommano i pezzi.</p></div>`;
  $('inArt').onchange = async e => { N.sel.art = +e.target.value; await loadVarianti(N.sel.art); renderEntry(); renderStock(); };
  $('inVar').onchange = e => { N.sel.mgvr = +e.target.value; renderStock(); };
  $('inLung').oninput = renderStock;
  $('inLung').onkeydown = e => { if (e.key === 'Enter') $('inPz').focus(); };
  $('inPz').onkeydown = e => { if (e.key === 'Enter') addRow(); };
  $('btnIns').onclick = addRow;
  if (editing) $('btnAnn').onclick = () => { N.editId = null; renderEntry(); renderStock(); };
}
async function addRow() {
  let lung = +$('inLung').value; const pz = Math.round(+$('inPz').value);
  if (!(lung > 0)) { toast('Inserisci la lunghezza in metri'); $('inLung').focus(); return; }
  // Le lunghezze in LEGNOEURO sono in metri: valori grandi sono quasi certamente centimetri
  if (lung >= 10) { const m = lung / 100; toast(`Le lunghezze sono in metri: ${num(lung)} cm → ${num(m)} m`); lung = m; }
  lung = Math.round(lung * 1000) / 1000;
  if (!(pz > 0)) { toast('Inserisci il numero di pezzi'); $('inPz').focus(); return; }
  const mgvr = N.sel.mgvr;
  await loadStock(mgvr);
  if (N.editId != null) {
    const r = N.righe.find(x => x.id === N.editId); Object.assign(r, { mgvr, lung, pz }); N.focusRow = r.id; N.editId = null;
  } else {
    const dup = N.righe.find(r => r.mgvr === mgvr && r.lung === lung);
    if (dup) { dup.pz += pz; N.focusRow = dup.id; toast(`Pezzi sommati alla riga ${dup.rif}`); }
    else { const r = { id: N.seq++, mgvr, lung, pz }; N.righe.push(r); N.focusRow = r.id; }
  }
  relabel(); renderAll();
  setTimeout(() => { const l = $('inLung'); if (l) { l.value = ''; $('inPz').value = ''; l.focus(); } }, 0);
}
// Lettere come nel vecchio programma: per sezione, dalla lunghezza maggiore
function relabel() {
  const by = {};
  N.righe.forEach(r => (by[r.mgvr] = by[r.mgvr] || []).push(r));
  for (const rr of Object.values(by)) { const L = Ottimizzatore.lettere(rr.map(r => r.lung)); rr.forEach(r => r.rif = L.get(Number(r.lung))); }
}

/* Indicatore di copertura: esatta, oppure ricavabile tagliando pezzi più lunghi. Non è l'ottimizzazione. */
function copertura(r) {
  const st = N.stock[r.mgvr];
  if (!st) return { cls: 'off', txt: '…' };
  const exact = (st.find(s => s.lung === r.lung) || { pz: 0 }).pz;
  if (exact >= r.pz) return { cls: 'ok', txt: 'Lunghezza esatta' };
  let resa = exact;
  st.filter(s => s.lung > r.lung).forEach(s => { resa += Math.floor(s.lung / r.lung) * s.pz; });
  if (resa >= r.pz) return { cls: 'warn', txt: 'Serve taglio' };
  return { cls: 'bad', txt: `Mancano ${r.pz - resa} pz` };
}
function renderRows() {
  $('emptyRows').hidden = N.righe.length > 0;
  $('rows').innerHTML = N.righe.map((r, i) => {
    const v = varById(r.mgvr), a = v && artById(v.art), c = copertura(r);
    return `<tr data-id="${r.id}" class="${r.id === N.focusRow ? 'sel' : ''}">
      <td><span class="rif">${r.rif}</span></td>
      <td><div class="prof"><b>${esc(sezLabel(v))}</b><small>${esc(a ? a.descr : '')}</small></div></td>
      <td class="n">${num(r.lung)}</td><td class="n">${r.pz}</td><td class="n">${num(r.lung * r.pz)}</td>
      <td><span class="pill ${c.cls}">${c.txt}</span></td>
      <td><div class="rowact">
        <button type="button" class="ghost" data-act="up" aria-label="Sposta su"${i === 0 ? ' disabled' : ''}>↑</button>
        <button type="button" class="ghost" data-act="down" aria-label="Sposta giù"${i === N.righe.length - 1 ? ' disabled' : ''}>↓</button>
        <button type="button" class="ghost" data-act="edit">Modifica</button>
        <button type="button" class="ghost" data-act="del">Elimina</button></div></td></tr>`;
  }).join('');
  $('rows').querySelectorAll('tr').forEach(tr => tr.onclick = async e => {
    const id = +tr.dataset.id, act = e.target.closest('button')?.dataset.act;
    const i = N.righe.findIndex(r => r.id === id), r = N.righe[i];
    if (act === 'del') { N.righe.splice(i, 1); if (N.editId === id) N.editId = null; relabel(); renderAll(); return; }
    if (act === 'up' && i > 0) [N.righe[i - 1], N.righe[i]] = [N.righe[i], N.righe[i - 1]];
    if (act === 'down' && i < N.righe.length - 1) [N.righe[i + 1], N.righe[i]] = [N.righe[i], N.righe[i + 1]];
    if (act === 'edit') N.editId = id;
    N.focusRow = id;
    const v = varById(r.mgvr); if (v) { N.sel.art = v.art; await loadVarianti(v.art); N.sel.mgvr = r.mgvr; }
    relabel(); renderAll();
    if (act === 'edit') setTimeout(() => $('inLung')?.focus(), 0);
  });
  const pz = N.righe.reduce((s, r) => s + r.pz, 0), tot = N.righe.reduce((s, r) => s + r.lung * r.pz, 0);
  $('tRighe').textContent = N.righe.length; $('tPz').textContent = pz; $('tMl').textContent = num(tot);
  $('rowsCount').textContent = !N.cliente ? '' : N.origine
    ? `Ordine ${N.origine.num}/${N.origine.anno} · già salvato` : `Ordine ${$('ordNum').value}/${$('ordAnno').value} · nuovo`;
  const bs = $('btnSalva');
  bs.textContent = N.origine ? 'Già salvata' : 'Salva richiesta';
  bs.title = N.origine ? 'Questo ordine è già nel database. Per modificarlo usa per ora GestLegno.' : '';
  bs.disabled = !!N.origine || !N.cliente || !N.righe.length;
  ['ordNum', 'ordAnno'].forEach(id => $(id).disabled = !!N.origine);
}
async function renderStock() {
  const v = varById(N.sel.mgvr);
  if (!v) { $('stockTitle').textContent = 'Scegli una sezione'; $('stockBars').innerHTML = ''; return; }
  const a = artById(v.art);
  const typed = $('inLung') ? +$('inLung').value : 0;
  const fr = N.righe.find(r => r.id === N.focusRow && r.mgvr === v.id);
  const L = typed > 0 ? typed : (fr ? fr.lung : 0);
  $('stockTitle').textContent = `${sezLabel(v)} · ${a ? a.descr : ''}${L ? ' · richiesta ' + num(L) : ''}`;
  let st;
  try { st = await loadStock(v.id); } catch (e) { showDbError(e); st = []; }
  if (N.sel.mgvr !== v.id) return;
  const max = Math.max(1, ...st.map(s => s.pz));
  $('stockBars').innerHTML = st.length ? st.map(s => {
    const cls = !L ? '' : s.lung === L ? 'exact' : s.lung > L ? 'cut' : '';
    const ex = N.esclusi && N.esclusi.has(kEscl(v.id, s.lung)) ? ' excluded' : '';
    return `<div class="bar ${cls}${ex}" data-lung="${s.lung}" title="${ex ? 'Esclusa: clic per ripristinare' : 'Clic per escludere dal calcolo'}"><span class="len">${num(s.lung)}</span><span class="track"><span class="fill" style="width:${s.pz / max * 100}%"></span></span><span class="pz">${num(s.pz, 0)}</span></div>`;
  }).join('') : '<div class="empty">Nessun profilo disponibile per questa sezione.</div>';
  $('stockPz').textContent = num(st.reduce((s, x) => s + x.pz, 0), 0);
  $('stockMl').textContent = num(st.reduce((s, x) => s + x.lung * x.pz, 0));
  renderRows();
}
function renderAll() { renderCliente(); renderEntry(); renderRows(); renderStock(); renderSol(); }

// modo 'copia' = nuova richiesta con le stesse righe; 'apri' = lavora sull'ordine già salvato
async function copiaInNuova(d, modo = 'copia') {
  showTab('nuova');
  if (!N.articoli.length) await initNuova();
  const t = d.testata;
  N.cliente = { id: t.BITPRT_MBPC_ID, conto: t.conto, sotto: t.sotto, rag: t.rag };
  N.righe = []; N.editId = null; N.sol = null;
  N.origine = modo === 'apri' ? { id: t.BITRPT_ID, num: t.BITPRT_NumOrd, anno: t.BITPRT_Anno, impegni: d.impegni.rows || [] } : null;
  for (const r of d.righe) {
    if (r.art && !N.varianti[r.art]) N.varianti[r.art] = await api('/api/varianti?art=' + r.art);
    await loadStock(r.mgvr);
    N.righe.push({ id: N.seq++, mgvr: r.mgvr, lung: +r.lung, pz: +r.pz });
  }
  if (N.origine) {
    $('ordNum').value = t.BITPRT_NumOrd; $('ordAnno').value = t.BITPRT_Anno;
    if (t.BITPRT_DATA) $('ordData').value = String(t.BITPRT_DATA).slice(0, 10);
    $('rif0').value = t.BITPRT_Riferimento || ''; $('rif1').value = t.BITPRT_Riferimento1 || ''; $('rif2').value = t.BITPRT_Riferimento2 || '';
    $('ordOrdinario').checked = !!t.BITPRT_ORDINARIO;
  } else { $('sqlPanel').hidden = true; await prossimoNumero(); }
  if (d.righe[0]?.art) { N.sel.art = d.righe[0].art; N.sel.mgvr = d.righe[0].mgvr; }
  N.focusRow = N.righe[0]?.id ?? null;
  relabel(); renderAll();
  toast(N.origine ? `Aperto l'ordine ${t.BITPRT_NumOrd}/${t.BITPRT_Anno}` : `Copiate ${N.righe.length} righe in una nuova richiesta`);
}

$('ordAnno').addEventListener('change', prossimoNumero);
['ordNum', 'ordAnno'].forEach(id => $(id).addEventListener('input', renderRows));
$('btnNuovo').onclick = () => { nuovaRichiesta(); toast('Nuova richiesta'); };
$('btnSalva').onclick = async () => {
  const body = {
    mbpc: N.cliente.id, data: $('ordData').value, num: +$('ordNum').value, anno: +$('ordAnno').value,
    ordinario: $('ordOrdinario').checked, rif: [0, 1, 2].map(i => $('rif' + i).value.trim()),
    righe: N.righe.map(r => ({ mgvr: r.mgvr, lung: r.lung, pz: r.pz }))
  };
  try {
    const r = await api('/api/richieste', { body });
    $('sqlOut').textContent = r.anteprima; $('sqlPanel').hidden = false;
    const m = $('saveMsg');
    if (r.salvato) {
      m.className = 'save-msg ok'; m.textContent = `Richiesta salvata come ordine ${body.num}/${body.anno} (BITRPT_ID ${r.id}).`; toast('Richiesta salvata');
      N.origine = { id: r.id, num: body.num, anno: body.anno, impegni: [] }; renderRows();
    }
    else { m.className = 'save-msg warn'; m.textContent = r.messaggio; }
    $('sqlPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) { toast(e.message); }
};
$('btnCopy').onclick = () => {
  navigator.clipboard?.writeText($('sqlOut').textContent).then(() => toast('SQL copiato')).catch(() => toast('Copia non riuscita: seleziona il testo a mano'));
};

initArchivio();


/* ================= Archivio: lettura della proposta del vecchio programma ================= */
const normSez = s => String(s || '').replace(/\s/g, '').toUpperCase();
function mappeLettere(d) {
  const by = {};
  d.righe.forEach(r => (by[r.mgvr] = by[r.mgvr] || []).push(r));
  const m = {};
  for (const [v, rr] of Object.entries(by)) m[v] = { sez: normSez(rr[0].vdescr), map: Ottimizzatore.lettere(rr.map(r => +r.lung)) };
  return m;
}
function letteraArchivio(d, r) { const m = mappeLettere(d)[r.mgvr]; return m ? m.map.get(+r.lung) : ''; }
function vecchiaProposta(d) {
  const res = d.proposte;
  if (res.error) return `<div class="sec"><h4>Soluzione proposta<small>Bit_ProfiliProposte</small></h4><div class="err">${esc(res.error)}</div></div>`;
  if (!res.rows.length) return '';
  const mappe = mappeLettere(d);
  const mappaPer = p => mappe[p.BITPR_MGVR_ID] || Object.values(mappe).find(m => m.sez === normSez(p.vdescr));
  let usato = 0, consegnato = 0;
  const righe = res.rows.map(p => {
    const m = mappaPer(p), L = +p.BITPR_Lung, n = +p.BITPR_TMPEVA || 0;
    usato += L * n;
    const inv = m ? new Map([...m.map].map(([l, x]) => [x, l])) : new Map();
    const gruppi = Ottimizzatore.decodificaComposizione(p.BITPR_PZFATTI);
    const lettura = gruppi.map(g => g.map(({ n, lettera }) => {
      const l = inv.get(lettera); if (l) consegnato += n * l;
      return `${n}×${lettera}${l ? ' ' + num(l) : ''}`;
    }).join(' + ')).join(' · ');
    const alt = !mappe[p.BITPR_MGVR_ID];
    return `<tr><td>${esc(p.vdescr)}${alt ? ' <span class="tag">equivalente</span>' : ''}</td><td class="n">${num(L)}</td>
      <td class="n">${num(p.BITPR_PZ_EVA, 0)}</td><td class="n"><b>${num(n, 0)}</b></td>
      <td class="muted">${esc(p.BITPR_PZFATTI)}</td><td>${lettura}</td></tr>`;
  }).join('');
  const sfr = usato - consegnato;
  return `<div class="sec"><h4>Soluzione del vecchio programma<small>Bit_ProfiliProposte · barre ${num(usato, 2)} m · pezzi ${num(consegnato, 2)} m · sfrido ${num(sfr, 2)} m (${num(usato ? sfr / usato * 100 : 0, 1)}%)</small></h4>
    <div class="tbl-wrap"><table><thead><tr><th>Sezione</th><th class="n">Barra m</th><th class="n">Disp.</th><th class="n">Usate</th><th>Compos.</th><th>Lettura</th></tr></thead>
    <tbody>${righe}</tbody></table></div>
    <p class="hint">Lettura: "4×C 2,25 + 4×K 1,15" vuol dire che da quelle barre si tagliano in tutto 4 pezzi C e 4 pezzi K. Lettere per sezione, dalla lunghezza maggiore.</p></div>`;
}

/* ================= Soluzione proposta (nuovo algoritmo) ================= */
N.equiv = {}; N.sol = null; N.esclusi = new Set();
const kEscl = (mgvr, lung) => `${mgvr}|${Math.round(Number(lung) * 1000)}`;
const firma = () => JSON.stringify(N.righe.map(r => [r.mgvr, r.lung, r.pz]));
function parametri() {
  return {
    sfridoMaxM: +$('pSfridoM').value || 0, sfridoMaxPerc: +$('pSfridoP').value || 0,
    taglioMm: +$('pTaglio').value || 0, maxPezzi: Math.min(10, Math.max(1, +$('pMaxPz').value || 4)),
    fuoriSoglia: $('pFuori').checked, priorita: $('pPrior').value, tolleranzaM: +$('pToll').value || 0
  };
}
async function elabora() {
  if (!N.righe.length) { toast('Inserisci almeno una riga'); return; }
  const b = $('btnElabora'); b.disabled = true; b.textContent = 'Elaborazione…';
  try {
    const param = parametri(), equiv = false; // mai usare sezioni equivalenti
    const by = {};
    N.righe.forEach(r => (by[r.mgvr] = by[r.mgvr] || []).push(r));
    const gruppi = [];
    for (const [mgvrS, rr] of Object.entries(by)) {
      const mgvr = +mgvrS;
      const stock = (await loadStock(mgvr)).map(s => ({ mgvr, lung: s.lung, pz: s.pz, alt: false }));
      if (equiv) {
        if (!N.equiv[mgvr]) N.equiv[mgvr] = await api('/api/equivalenti?mgvr=' + mgvr);
        for (const e of N.equiv[mgvr]) (await loadStock(e.id)).forEach(s => stock.push({ mgvr: e.id, lung: s.lung, pz: s.pz, alt: true, descr: e.adescr }));
      }
      // ordine già impegnato: i suoi pezzi impegnati tornano disponibili per questa elaborazione
      for (const im of (N.origine?.impegni || [])) {
        const v = im.BITPRIM_BITPR_MGVR_ID, l = +im.BITPRIM_BITPR_Lung, q = +im.BITPRIM_BITPR_PZ_IMP || 0;
        const tgt = stock.find(s => s.mgvr === v && Math.abs(s.lung - l) < 1e-6);
        if (tgt) tgt.pz += q;
        else if (v === mgvr || stock.some(s => s.mgvr === v)) stock.push({ mgvr: v, lung: l, pz: q, alt: v !== mgvr, descr: stock.find(s => s.mgvr === v)?.descr });
      }
      const stockUsabile = stock.filter(s => !N.esclusi.has(kEscl(s.mgvr, s.lung)));
      const ris = Ottimizzatore.ottimizza({ righe: rr.map(r => ({ key: r.id, lung: r.lung, pz: r.pz, lettera: r.rif })), stock: stockUsabile, param });
      gruppi.push({ mgvr, v: varById(mgvr), ris });
    }
    N.sol = { firma: firma(), gruppi };
    renderSol();
  } catch (e) { toast('Elaborazione non riuscita: ' + e.message); }
  b.disabled = false; b.textContent = 'Elabora';
}
function renderSol() {
  const box = $('solBox');
  if (!box) return;
  if (!N.sol) { box.innerHTML = `<div class="empty">Compila la richiesta e premi Elabora: l'app propone da quali barre di magazzino tagliare ogni pezzo.</div>`; return; }
  const G = N.sol.gruppi;
  const T = G.reduce((t, g) => { const x = g.ris.totali; t.barre += x.barre; t.usati += x.metriUsati; t.cons += x.metriConsegnati; t.rich += x.metriRichiesti; t.manc += x.pezziRichiesti - x.pezziOttenuti; t.fuori += x.barreFuoriSoglia; return t; }, { barre: 0, usati: 0, cons: 0, rich: 0, manc: 0, fuori: 0 });
  const stale = N.sol.firma !== firma();
  box.innerHTML = `
    ${stale ? '<div class="alert" style="margin:12px 14px 0">La richiesta è cambiata dopo l\'elaborazione: premi di nuovo Elabora.</div>' : ''}
    <div class="sol-tot">
      <div class="tot"><span>Barre da prelevare</span><b>${T.barre}</b></div>
      <div class="tot"><span>Metri prelevati</span><b>${num(T.usati, 2)}</b></div>
      <div class="tot"><span>Metri consegnati</span><b>${num(T.cons, 2)}</b></div>
      <div class="tot"><span>Sfrido</span><b>${num(T.usati - T.cons, 2)} m · ${num(T.usati ? (T.usati - T.cons) / T.usati * 100 : 0, 1)}%</b></div>
      <div class="tot"><span>Pezzi mancanti</span><b class="${T.manc ? 'miss' : ''}">${T.manc}</b></div>
      ${T.fuori ? `<div class="tot"><span>Barre oltre soglia</span><b class="miss">${T.fuori}</b></div>` : ''}
    </div>
    ${G.map(g => renderGruppo(g)).join('')}`;
}
function renderGruppo(g) {
  const { ris, v } = g, a = v && artById(v.art);
  const x = ris.totali;
  const righe = ris.righe.map(r => `<tr><td><span class="rif">${esc(r.lettera)}</span></td><td class="n">${num(r.lung)}</td>
    <td class="n">${r.pz}</td><td class="n">${r.ottenuti}</td>
    <td>${r.mancanti ? `<span class="pill bad">Mancano ${r.mancanti}</span>` : '<span class="pill ok">Completa</span>'}</td></tr>`).join('');
  const barre = ris.barre.map(b => `
    <div>
      <div class="cut-head"><span>Barra <b>${num(b.lung)} m</b> · prelevare <b>${b.usati}</b> di ${num(b.disponibili, 0)}
        ${b.alt ? `<span class="tag" title="Stessa sezione di un altro articolo">equivalente: ${esc(b.descr || '')}</span>` : ''}</span>
        <button type="button" class="btn-x" data-escl="${b.mgvr}|${b.lung}" title="Non usare questa lunghezza e rielabora">Escludi e rielabora</button></div>
      ${b.schemi.map(sc => {
        const segs = sc.pezzi.flatMap(p => Array.from({ length: p.c }, () => p));
        return `<div class="schema"><span class="n">${sc.n} ×</span>
          <div class="bar-cut" title="Sfrido ${num(sc.sfrido)} m per barra">${segs.map(p => `<span class="seg" style="width:${p.lung / b.lung * 100}%">${esc(p.lettera)} ${num(p.lung)}</span>`).join('')}</div>
          <span class="w${sc.fuoriSoglia ? ' hi' : ''}">sfr ${num(sc.sfrido, 3)}</span></div>`;
      }).join('')}
    </div>`).join('');
  return `<div class="sol-grp">
    <h3>${esc(sezLabel(v))}<small>${esc(a ? a.descr : '')} · ${x.barre} barre · sfrido ${num(x.sfridoM, 2)} m (${num(x.sfridoPerc, 1)}%)</small></h3>
    <div class="sol-cols">
      <div class="tbl-wrap"><table><thead><tr><th>Rif</th><th class="n">Lung</th><th class="n">Rich.</th><th class="n">Ott.</th><th></th></tr></thead><tbody>${righe}</tbody></table></div>
      <div class="cut-list">${barre || '<div class="empty">Nessuna barra adatta in magazzino.</div>'}</div>
    </div></div>`;
}
$('btnElabora').onclick = elabora;
$('pPrior').onchange = () => { if (N.sol) elabora(); };

function descrEscl(k) {
  const [mgvr, mm] = k.split('|').map(Number);
  const v = varById(mgvr);
  let nome = v ? sezLabel(v) : '';
  if (!v) for (const list of Object.values(N.equiv)) { const e = list.find(x => x.id === mgvr); if (e) nome = `${e.descr} (${e.adescr})`; }
  return `${nome || 'variante ' + mgvr} · ${num(mm / 1000)} m`;
}
function renderEscl() {
  const box = $('exclBox');
  box.hidden = N.esclusi.size === 0;
  box.innerHTML = N.esclusi.size ? `<span class="muted">Lunghezze escluse:</span>
    ${[...N.esclusi].map(k => `<span class="chip">${esc(descrEscl(k))}<button type="button" data-ripr="${k}" aria-label="Ripristina">×</button></span>`).join('')}
    <button type="button" class="ghost" id="btnRipristinaTutte">Ripristina tutte</button>` : '';
  box.querySelectorAll('[data-ripr]').forEach(b => b.onclick = () => { N.esclusi.delete(b.dataset.ripr); dopoEscl(); });
  $('btnRipristinaTutte')?.addEventListener('click', () => { N.esclusi.clear(); dopoEscl(); });
}
function dopoEscl() { renderEscl(); renderStock(); if (N.sol || N.righe.length) elabora(); }
function toggleEscl(mgvr, lung) {
  const k = kEscl(mgvr, lung);
  if (N.esclusi.has(k)) N.esclusi.delete(k); else N.esclusi.add(k);
  dopoEscl();
}
$('solBox').addEventListener('click', e => {
  const b = e.target.closest('[data-escl]'); if (!b) return;
  const [mgvr, lung] = b.dataset.escl.split('|'); toggleEscl(+mgvr, +lung);
});
$('stockBars').addEventListener('click', e => {
  const b = e.target.closest('.bar[data-lung]'); if (!b) return;
  toggleEscl(N.sel.mgvr, +b.dataset.lung);
});

/* ================= STAMPA REPORT ================= */
$('btnStampa').onclick = stampaReport;

function stampaReport() {
  if (!N.sol || !N.cliente) { toast('Elabora prima la soluzione'); return; }

  const oggi = new Date().toLocaleDateString('it-IT');
  const ordNum = $('ordNum').value;
  const ordAnno = $('ordAnno').value;
  const ordData = $('ordData').value ? new Date($('ordData').value).toLocaleDateString('it-IT') : oggi;
  const rif = [$('rif0').value, $('rif1').value, $('rif2').value].filter(Boolean).join(' · ');

  // Raggruppa per sezione/profilo
  const gruppiHtml = N.sol.gruppi.map(g => {
    const v = varById(g.mgvr), a = v && artById(v.art);
    const sez = sezLabel(v);
    const profilo = a ? a.descr : '';
    const ris = g.ris;

    // Tabella Richiesto
    const richiesteRows = ris.righe.map(r =>
      `<tr><td>${esc(r.lettera)}</td><td class="n">${num(r.lung, 3)}</td><td class="n">${r.pz}</td><td class="n">${num(r.lung * r.pz, 2)}</td></tr>`
    ).join('');
    const totRichiesto = ris.righe.reduce((s, r) => s + r.lung * r.pz, 0);

    // Tabella Consegnato (barre usate)
    const consegnatoRows = ris.barre.flatMap(b =>
      b.schemi.map(sc => {
        const compos = sc.pezzi.map(p => `${p.c}${p.lettera}`).join('+');
        const totPezzi = sc.pezzi.reduce((s, p) => s + p.c, 0);
        const totBarra = b.lung * sc.n;
        return `<tr>
          <td class="n">${num(b.lung, 2)}</td>
          <td class="n">${sc.n}</td>
          <td class="n">${num(totBarra, 2)}</td>
          <td class="n">${num(sc.sfrido, 3)}</td>
          <td>${compos} = ${totPezzi} pz</td>
        </tr>`;
      })
    ).join('');

    return `
      <div class="report-grp">
        <h3>Sezione: ${esc(sez)} — ${esc(profilo)}</h3>
        <div class="report-cols">
          <div>
            <div class="report-section">Richiesto</div>
            <table class="report-tbl">
              <thead><tr><th>Rif</th><th>Lung. m</th><th>Pz</th><th>Totale m</th></tr></thead>
              <tbody>${richiesteRows}</tbody>
              <tfoot><tr><td colspan="3">Totale</td><td class="n">${num(totRichiesto, 2)}</td></tr></tfoot>
            </table>
          </div>
          <div>
            <div class="report-section">Consegnato</div>
            <table class="report-tbl">
              <thead><tr><th>Barra m</th><th>Pz</th><th>Tot. m</th><th>Sfrido</th><th>Compos.</th></tr></thead>
              <tbody>${consegnatoRows}</tbody>
              <tfoot><tr><td colspan="2">Totale</td><td class="n">${num(ris.totali.metriUsati, 2)}</td><td class="n">${num(ris.totali.sfridoM, 2)}</td><td></td></tr></tfoot>
            </table>
          </div>
        </div>
      </div>`;
  }).join('');

  // Totali globali
  const T = N.sol.gruppi.reduce((t, g) => {
    const x = g.ris.totali;
    t.barre += x.barre; t.usati += x.metriUsati; t.cons += x.metriConsegnati;
    t.rich += x.metriRichiesti; t.sfrido += x.sfridoM;
    return t;
  }, { barre: 0, usati: 0, cons: 0, rich: 0, sfrido: 0 });

  const html = `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <title>Report Ordine ${ordNum}/${ordAnno}</title>
  <style>
    body { font-family: Arial, sans-serif; font-size: 11pt; color: #000; margin: 0; padding: 20px; }
    h1 { font-size: 16pt; margin: 0 0 4px; }
    .report-head { border: 1px solid #000; padding: 12px; margin-bottom: 16px; }
    .report-head table { width: 100%; border-collapse: collapse; }
    .report-head td { padding: 2px 8px 2px 0; vertical-align: top; }
    .report-head .label { font-weight: bold; width: 100px; }
    .report-essenza { font-size: 13pt; font-weight: bold; font-style: italic; margin: 16px 0 8px; }
    table.report-tbl { width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 10pt; }
    table.report-tbl th, table.report-tbl td { border: 1px solid #999; padding: 4px 6px; }
    table.report-tbl th { background: #e8e8e8; font-weight: bold; text-align: left; }
    table.report-tbl td.n { text-align: right; font-family: "Courier New", monospace; }
    table.report-tbl tfoot td { font-weight: bold; background: #f4f4f4; }
    .report-section { font-weight: bold; margin: 10px 0 6px; }
    .report-totals { margin-top: 16px; padding: 10px; background: #f4f4f4; border: 1px solid #999; }
    .report-totals div { margin: 3px 0; }
    .report-totals span { font-weight: bold; }
    .report-grp { margin-bottom: 20px; page-break-inside: avoid; }
    .report-grp h3 { font-size: 12pt; margin: 0 0 8px; border-bottom: 1px solid #000; padding-bottom: 4px; }
    .report-cols { display: flex; gap: 20px; }
    .report-cols > div { flex: 1; }
    .no-print { margin-bottom: 16px; }
    @media print { .no-print { display: none; } }
  </style>
</head>
<body>
  <div class="no-print">
    <button onclick="window.print()" style="padding:8px 16px;font-size:14px;cursor:pointer">🖨️ Stampa</button>
    <button onclick="window.close()" style="padding:8px 16px;font-size:14px;cursor:pointer;margin-left:8px">Chiudi</button>
  </div>

  <div class="report-head">
    <table>
      <tr><td class="label">Cliente:</td><td colspan="3"><strong>${esc(N.cliente.rag)}</strong></td></tr>
      <tr>
        <td class="label">Ordine N°</td><td><strong>${ordNum}</strong></td>
        <td class="label" style="width:60px">Del</td><td>${ordData}</td>
      </tr>
      ${rif ? `<tr><td class="label">Riferimento:</td><td colspan="3">${esc(rif)}</td></tr>` : ''}
    </table>
  </div>

  ${gruppiHtml}

  <div class="report-totals">
    <div><span>Barre da prelevare:</span> ${T.barre}</div>
    <div><span>Metri prelevati:</span> ${num(T.usati, 2)} m</div>
    <div><span>Metri consegnati:</span> ${num(T.cons, 2)} m</div>
    <div><span>Sfrido totale:</span> ${num(T.sfrido, 2)} m (${num(T.usati ? T.sfrido / T.usati * 100 : 0, 1)}%)</div>
  </div>

  <p style="margin-top:24px;font-size:9pt;color:#666">
    Generato da GestLegno Web il ${oggi}
  </p>
</body>
</html>`;

  const win = window.open('', '_blank', 'width=900,height=700');
  win.document.write(html);
  win.document.close();
}
