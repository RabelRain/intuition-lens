
let controller = null;
let currentAtom = null;
let allClaims = [];
let atomOptions = [];
let currentTokens = [];

const els = {
  currentHost: document.getElementById('currentHost'),
  resolveBtn: document.getElementById('resolveBtn'),
  resetBtn: document.getElementById('resetBtn'),
  tokenSection: document.getElementById('tokenSection'),
  tokensBox: document.getElementById('tokensBox'),
  selectAllBtn: document.getElementById('selectAllBtn'),
  searchSelectedBtn: document.getElementById('searchSelectedBtn'),
  searchInput: document.getElementById('searchInput'),
  searchBtn: document.getElementById('searchBtn'),
  resultsSection: document.getElementById('resultsSection'),
  atomSelect: document.getElementById('atomSelect'),
  atomCard: document.getElementById('atomCard'),
  atomLabel: document.getElementById('atomLabel'),
  atomType: document.getElementById('atomType'),
  creatorId: document.getElementById('creatorId'),
  atomId: document.getElementById('atomId'),
  atomMaxCap: document.getElementById('atomMaxCap'),
  atomTotalCap: document.getElementById('atomTotalCap'),
  copyCreator: document.getElementById('copyCreator'),
  copyAtom: document.getElementById('copyAtom'),
  openOnPortal: document.getElementById('openOnPortal'),
  claimsControls: document.getElementById('claimsControls'),
  sortSelect: document.getElementById('sortSelect'),
  claimsCount: document.getElementById('claimsCount'),
  claimsList: document.getElementById('claimsList'),
  status: document.getElementById('status'),
  tradeBtn: document.getElementById('tradeBtn'),
  agentBtn: document.getElementById('agentBtn'),
  settingsBtn: document.getElementById('settingsBtn'),
  modalSoon: document.getElementById('modalSoon'),
  closeSoon: document.getElementById('closeSoon')
};

function setStatus(msg){ els.status.textContent = msg || ''; }
function showSoon(show){ els.modalSoon.style.display = show ? 'flex' : 'none'; }

function resetUI(){
  if (controller) controller.abort();
  controller = new AbortController();
  currentAtom = null;
  allClaims = [];
  atomOptions = [];
  currentTokens = [];
  els.resultsSection.classList.add('hidden');
  els.atomCard.classList.add('hidden');
  els.claimsControls.classList.add('hidden');
  els.claimsList.innerHTML = '';
  els.atomSelect.innerHTML = '';
  els.tokensBox.innerHTML = '';
  els.tokenSection.classList.add('hidden');
  els.atomMaxCap.textContent = '—';
  els.atomTotalCap.textContent = '—';
  setStatus('');
}

function getHostname(urlStr){
  try{ return new URL(urlStr).hostname; }catch(e){ return ''; }
}

function getDomainTokens(hostname){
  const parts = hostname.toLowerCase().split('.').filter(Boolean);
  const blacklist = new Set(['www','m','app','beta','staging','dev','test']);
  const tldLike  = new Set(['com','org','net','io','xyz','app','co','ai','fi','info','me','site','tech']); // include 'systems' as requested
  const cleaned = parts.filter(p => !blacklist.has(p) && !tldLike.has(p));
  const tokens = cleaned.flatMap(p => p.split('-'));
  const pretty = tokens.map(t => t.charAt(0).toUpperCase()+t.slice(1));
  return Array.from(new Set(tokens.concat(pretty).concat(['systems','Systems']))); // ensure systems present
}

async function gql(query, variables){
  const res = await fetch(CONFIG.GRAPHQL_URL, {
    method:'POST', headers: CONFIG.HEADERS, body: JSON.stringify({query, variables})
  });
  if(!res.ok) throw new Error('GraphQL HTTP '+res.status);
  const json = await res.json();
  if(json.errors) throw new Error(json.errors.map(e=>e.message).join('; '));
  return json.data;
}

const Q_FIND_ATOMS = `
query FindAtoms($q: String!, $qLike: String!) {
  atoms_exact: atoms(
    where: {
      _or: [
        { label: { _eq: $q } },
        { value: { thing: { name: { _eq: $q } } } }
      ],
      type: { _neq: "TextObject" }
    }
    limit: 40
  ) {
    term_id type label creator_id
    value { thing { id name url image description } person { id name } organization { id name } }
  }
  atoms_fuzzy: atoms(
    where: {
      _or: [
        { label: { _ilike: $qLike } },
        { value: { thing: { name: { _ilike: $qLike } } } }
      ],
      type: { _neq: "TextObject" }
    }
    limit: 60
  ) {
    term_id type label creator_id
    value { thing { id name url image description } person { id name } organization { id name } }
  }
}`;

const Q_TRIPLES_AROUND = `
query TriplesAround($id: String!, $limit: Int = 200) {
  triples(
    where: { _or: [{ subject_id: { _eq: $id } }, { object_id: { _eq: $id } }] }
    order_by: { created_at: desc }
    limit: $limit
  ) {
    created_at
    subject { term_id label value { thing { name } } }
    predicate { term_id label value { thing { name } } }
    object { term_id label value { thing { name } } }
    triple_vault { market_cap total_assets total_shares position_count updated_at }
    triple_term  { total_market_cap total_assets total_position_count: total_position_count updated_at }
  }
}`;

const Q_ATOM_AND_VALUE = `
query AtomAndValue($termId: String!) {
  atom(term_id: $termId) {
    term_id
    type
    label
    creator_id
    value {
      id
      account_id
      thing { id name url image description }
      person { id name }
      organization { id name }
    }
  }
}`;

// 18 decimal scaling
function scale18(x){
  if (x === null || x === undefined) return 0;
  if (typeof x === 'number') return x / 1e18;
  if (typeof x === 'bigint') return Number(x) / 1e18;
  if (typeof x === 'string') {
    if (/^\d+$/.test(x)) {
      const big = BigInt(x); const q = big / BigInt(1e18); const r = big % BigInt(1e18);
      return Number(q) + Number(r) / 1e18;
    }
    return parseFloat(x) / 1e18;
  }
  return 0;
}
function humanCapScaled(raw){
  const n = scale18(raw);
  if (!isFinite(n)) return String(raw);
  const abs = Math.abs(n);
  const fmt = Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
  if (abs >= 1e12) return fmt.format(n/1e12) + 'T';
  if (abs >= 1e9)  return fmt.format(n/1e9)  + 'B';
  if (abs >= 1e6)  return fmt.format(n/1e6)  + 'M';
  if (abs >= 1e3)  return fmt.format(n/1e3)  + 'K';
  return fmt.format(n);
}

async function rankAtomsByMarketCap(atoms){
  const ranked = [];
  for(const a of atoms){
    try{
      const data = await gql(Q_TRIPLES_AROUND, { id: a.term_id, limit: 50 });
      const caps = (data.triples||[]).map(t => scale18(t.triple_vault?.market_cap || 0));
      const maxCap = caps.length ? Math.max(...caps) : 0;
      ranked.push({...a, _rankCap: maxCap});
    }catch(e){
      ranked.push({...a, _rankCap: 0});
    }
  }
  ranked.sort((x,y) => (y._rankCap||0) - (x._rankCap||0));
  return ranked;
}

function dedupeAtoms(list){
  const map = new Map();
  for(const a of list){
    const key = a.term_id || `${a.label}::${a.type}`;
    if(!map.has(key)) map.set(key, a);
  }
  return Array.from(map.values());
}

function renderAtomOptions(list){
  els.atomSelect.innerHTML = '';
  list.forEach(a => {
    const opt = document.createElement('option');
    opt.value = a.term_id;
    const name = a.label || a.value?.thing?.name || a.term_id;
    opt.textContent = `${name} (${a.type})`;
    els.atomSelect.appendChild(opt);
  });
}

function renderAtomCard(atom){
  currentAtom = atom;
  els.atomLabel.textContent = atom.label || atom.value?.thing?.name || '—';
  els.atomType.textContent = atom.type || '—';
  els.creatorId.textContent = atom.creator_id || '—';
  els.atomId.textContent = atom.term_id || '—';
  const url = CONFIG.PORTAL_URL.replace('TERMID', encodeURIComponent(atom.term_id));
  els.openOnPortal.href = url;
  els.atomCard.classList.remove('hidden');
}

function renderClaims(claims){
  els.claimsList.innerHTML = '';
  els.claimsCount.textContent = `${claims.length} claims`;
  claims.forEach(t => {
    const li = document.createElement('li');
    li.className = 'item';
    const rawCap = (t.triple_vault && t.triple_vault.market_cap) || 0;
    const capH = humanCapScaled(rawCap);
    const created = new Date(t.created_at).toLocaleString();
    li.innerHTML = `
      <div class="mono small dim">${created}</div>
      <div class="mono wrap">
        <strong>S:</strong> ${t.subject?.label || t.subject?.value?.thing?.name || t.subject?.term_id}<br/>
        <strong>P:</strong> ${t.predicate?.label || t.predicate?.value?.thing?.name || t.predicate?.term_id}<br/>
        <strong>O:</strong> ${t.object?.label || t.object?.value?.thing?.name || t.object?.term_id}
      </div>
      <div class="row">
        <span class="dim small" title="raw: ${rawCap}">market cap: ${capH}</span>
        <a target="_blank" href="${CONFIG.PORTAL_URL.replace('TERMID', encodeURIComponent(t.subject?.term_id || ''))}">Open S</a>
        <a target="_blank" href="${CONFIG.PORTAL_URL.replace('TERMID', encodeURIComponent(t.predicate?.term_id || ''))}">Open P</a>
        <a target="_blank" href="${CONFIG.PORTAL_URL.replace('TERMID', encodeURIComponent(t.object?.term_id || ''))}">Open O</a>
      </div>
    `;
    els.claimsList.appendChild(li);
  });
}

function computeAtomCaps(){
  const values = allClaims.map(t => scale18(t.triple_vault?.market_cap || 0));
  const total = values.reduce((a,b)=>a+b,0);
  const max = values.length ? Math.max(...values) : 0;
  const totalRaw = String(Math.floor(total*1e18));
  const maxRaw = String(Math.floor(max*1e18));
  els.atomMaxCap.textContent = humanCapScaled(maxRaw);
  els.atomTotalCap.textContent = humanCapScaled(totalRaw);
}

function sortClaims(list, key){
  const a = [...list];
  if (key === 'marketCap') {
    a.sort((x,y) => (scale18(y.triple_vault?.market_cap||0) - scale18(x.triple_vault?.market_cap||0)) || (new Date(y.created_at) - new Date(x.created_at)));
  } else if (key === 'newest') {
    a.sort((x,y) => new Date(y.created_at) - new Date(x.created_at));
  } else {
    a.sort((x,y) => (x.predicate?.label||'').localeCompare(y.predicate?.label||''));
  }
  return a;
}

// tokens UI
function renderTokens(tokens){
  els.tokensBox.innerHTML = '';
  tokens.forEach(t => {
    const wrap = document.createElement('label');
    wrap.className = 'token';
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.value = t; cb.checked = true;
    wrap.appendChild(cb);
    const span = document.createElement('span'); span.textContent = t;
    wrap.appendChild(span);
    els.tokensBox.appendChild(wrap);
  });
  els.tokenSection.classList.remove('hidden');
}

function selectedTokens(){
  const boxes = els.tokensBox.querySelectorAll('input[type="checkbox"]');
  return Array.from(boxes).filter(b => b.checked).map(b => b.value);
}

// handlers
async function handleGetTokens(){
  resetUI();
  setStatus('Reading current tab...');
  const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
  const host = getHostname(tab?.url || '');
  els.currentHost.textContent = host || '—';
  if(!host){ setStatus('No hostname'); return; }
  currentTokens = getDomainTokens(host);
  if(!currentTokens.length){ setStatus('No domain tokens'); return; }
  renderTokens(currentTokens);
  setStatus('Pick tokens then click "Search selected".');
}

async function handleSearchSelected(){
  const tokens = selectedTokens();
  if(!tokens.length){ setStatus('Select at least one token.'); return; }
  setStatus('Searching...');
  let collected = [];
  for(const tok of tokens){
    try{
      const data = await gql(Q_FIND_ATOMS, { q: tok, qLike: `%${tok}%` });
      const merged = [...(data.atoms_exact||[]), ...(data.atoms_fuzzy||[])];
      collected = collected.concat(merged);
    }catch(e){ /* continue */ }
  }
  let found = dedupeAtoms(collected);
  if(!found.length){ setStatus('No matching atom found. Try manual search.'); return; }
  setStatus('Ranking matches...');
  const ranked = await rankAtomsByMarketCap(found);
  atomOptions = ranked;
  els.resultsSection.classList.remove('hidden');
  renderAtomOptions(ranked);
  await selectAtomById(ranked[0].term_id);
  setStatus('');
}

async function selectAtomById(termId){
  try{
    setStatus('Loading atom...');
    const data = await gql(Q_ATOM_AND_VALUE, { termId });
    renderAtomCard(data.atom);
    setStatus('Loading claims...');
    const triplesData = await gql(Q_TRIPLES_AROUND, { id: termId, limit: 200 });
    allClaims = triplesData.triples || [];
    els.claimsControls.classList.remove('hidden');
    const sorted = sortClaims(allClaims, els.sortSelect.value);
    renderClaims(sorted);
    computeAtomCaps();
    setStatus('');
  }catch(e){
    setStatus('Error: ' + e.message);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  resetUI();
  const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
  els.currentHost.textContent = getHostname(tab?.url || '') || '—';

  document.getElementById('resolveBtn').addEventListener('click', handleGetTokens);
  els.searchSelectedBtn.addEventListener('click', handleSearchSelected);
  els.selectAllBtn.addEventListener('click', () => {
    els.tokensBox.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
  });
  els.resetBtn.addEventListener('click', resetUI);
  els.searchBtn.addEventListener('click', async () => {
    const q = (els.searchInput.value || '').trim();
    resetUI();
    els.searchInput.value = q;
    if(!q){ setStatus('Enter a search string'); return; }
    setStatus('Searching...');
    try{
      const data = await gql(Q_FIND_ATOMS, { q, qLike: `%${q}%` });
      const merged = [...(data.atoms_exact||[]), ...(data.atoms_fuzzy||[])];
      let list = dedupeAtoms(merged);
      if(!list.length){ setStatus('No results'); return; }
      const ranked = await rankAtomsByMarketCap(list);
      atomOptions = ranked;
      els.resultsSection.classList.remove('hidden');
      renderAtomOptions(ranked);
      await selectAtomById(ranked[0].term_id);
    }catch(e){
      setStatus('Error: ' + e.message);
    }
  });
  els.atomSelect.addEventListener('change', async (e) => { await selectAtomById(e.target.value); });
  els.sortSelect.addEventListener('change', () => {
    const sorted = sortClaims(allClaims, els.sortSelect.value);
    renderClaims(sorted);
  });
  els.copyAtom.addEventListener('click', () => navigator.clipboard.writeText(els.atomId.textContent || ''));
  els.copyCreator.addEventListener('click', () => navigator.clipboard.writeText(els.creatorId.textContent || ''));

  // bottom bar
  els.tradeBtn.addEventListener('click', ()=> showSoon(true));
  els.settingsBtn.addEventListener('click', ()=> showSoon(true));
  els.closeSoon.addEventListener('click', ()=> showSoon(false));

  // open Agent full-page
  els.agentBtn.addEventListener('click', async () => {
    const params = new URLSearchParams();
    if (currentAtom) {
      params.set('atom', currentAtom.term_id || '');
      params.set('label', currentAtom.label || currentAtom.value?.thing?.name || '');
    }
    const toks = Array.from(new Set(selectedTokens()));
    if (toks.length) params.set('tokens', toks.join(','));
    const url = chrome.runtime.getURL('agent/index.html') + (params.toString() ? ('?' + params.toString()) : '');
    await chrome.tabs.create({ url });
  });
});

