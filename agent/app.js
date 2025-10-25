
// Read context from query params
const params = new URLSearchParams(location.search);
const ctx = {
  atom: params.get('atom') || '',
  label: params.get('label') || '',
  tokens: (params.get('tokens') || '').split(',').filter(Boolean)
};

const MOCK = {
  agents: [
    { id:'a1', name:'Token Scout', desc:'Tracks token pages + caps', sources:['CoinGecko','DeFiLlama'], freq:'*/10 * * * *', active:true },
    { id:'a2', name:'Repo Watcher', desc:'Follows GitHub commits', sources:['GitHub'], freq:'*/15 * * * *', active:false },
    { id:'a3', name:'DeFi Feeds', desc:'Reads protocol metrics', sources:['Etherscan','Dune'], freq:'*/20 * * * *', active:true },
  ],
  feed: [
    { id:'f1', src:'GitHub', url:'https://github.com/base-org/base/commit/abc123', ts:Date.now()-1000*60, summary:'New commit in base-org/base: fix build pipeline' },
    { id:'f2', src:'DeFiLlama', url:'https://defillama.com/protocol/base', ts:Date.now()-1000*120, summary:'TVL increased by 3.2% over 24h' },
    { id:'f3', src:'Etherscan', url:'https://etherscan.io/address/0x1234...', ts:Date.now()-1000*300, summary:'Contract verified, compiler v0.8.24' },
    { id:'f4', src:'CoinGecko', url:'https://www.coingecko.com/en/coins/base', ts:Date.now()-1000*500, summary:'Listed price update: +1.1%' },
  ],
  claims: [
    { id:'c1', s:'Base', p:'has change', o:'build pipeline fix', conf:82, src:'https://github.com/base-org/base/commit/abc123', approved:true },
    { id:'c2', s:'Base TVL', p:'increased by', o:'3.2% (24h)', conf:76, src:'https://defillama.com/protocol/base', approved:false },
    { id:'c3', s:'0x1234…', p:'is', o:'verified contract', conf:88, src:'https://etherscan.io/address/0x1234...', approved:true },
  ]
};

// Context banner
document.getElementById('ctxAtom').textContent = ctx.atom ? `Atom: ${ctx.label || ctx.atom}` : '';
document.getElementById('ctxTokens').textContent = ctx.tokens.length ? `Tokens: ${ctx.tokens.join(', ')}` : '';

document.getElementById('backBtn').addEventListener('click', () => history.back());

const els = {
  agents: document.getElementById('agents'),
  feed: document.getElementById('feed'),
  claims: document.getElementById('claims'),
  startAll: document.getElementById('startAll'),
  stopAll: document.getElementById('stopAll'),
  submit: document.getElementById('submit')
};

function renderAgents(){
  els.agents.innerHTML = '';
  MOCK.agents.forEach(a => {
    const div = document.createElement('div');
    div.className = 'card';
    div.innerHTML = `
      <div><strong>${a.name}</strong></div>
      <div class="small dim">${a.desc}</div>
      <div class="small dim">Sources: ${a.sources.join(', ')}</div>
      <div class="small dim">Freq: ${a.freq}</div>
      <div class="inline">
        <span class="badge ${a.active?'':'stop'}">${a.active?'active':'stopped'}</span>
        <button class="mini toggle">${a.active?'Stop':'Start'}</button>
      </div>
    `;
    div.querySelector('.toggle').addEventListener('click', () => { a.active = !a.active; renderAgents(); });
    els.agents.appendChild(div);
  });
}
function renderFeed(){
  els.feed.innerHTML = '';
  MOCK.feed.forEach(f => {
    const div = document.createElement('div');
    div.className = 'card';
    div.innerHTML = `
      <div class="small dim">${new Date(f.ts).toLocaleString()} &middot; <strong>${f.src}</strong></div>
      <div class="mono small"><a href="${f.url}" target="_blank">${f.url}</a></div>
      <div>${f.summary}</div>
    `;
    els.feed.appendChild(div);
  });
}
function renderClaims(){
  els.claims.innerHTML = '';
  MOCK.claims.forEach(c => {
    const div = document.createElement('div');
    div.className = 'card';
    div.innerHTML = `
      <div class="inline"><strong>Claim</strong><span class="small dim"><a href="${c.src}" target="_blank">source</a></span></div>
      <div class="inline">
        <input type="text" value="${c.s}" style="flex:1"/>
        <select>
          <option ${c.p==='is'?'selected':''}>is</option>
          <option ${c.p==='has change'?'selected':''}>has change</option>
          <option ${c.p==='increased by'?'selected':''}>increased by</option>
          <option ${c.p==='listed on'?'selected':''}>listed on</option>
        </select>
        <input type="text" value="${c.o}" style="flex:1"/>
      </div>
      <div class="inline">
        <span class="small dim">Confidence</span>
        <input type="range" min="0" max="100" value="${c.conf}" class="slider"/>
        <span class="small">${c.conf}%</span>
      </div>
      <div class="inline">
        <button class="mini approve">${c.approved?'Approved':'Approve'}</button>
        <button class="mini reject">Reject</button>
      </div>
    `;
    const inputs = div.querySelectorAll('input[type="text"]');
    const sel = div.querySelector('select');
    const slider = div.querySelector('.slider');
    const confSpan = div.querySelectorAll('span.small')[1];
    const approveBtn = div.querySelector('.approve');
    const rejectBtn = div.querySelector('.reject');
    inputs[0].addEventListener('input', e => c.s = e.target.value);
    sel.addEventListener('change', e => c.p = e.target.value);
    inputs[1].addEventListener('input', e => c.o = e.target.value);
    slider.addEventListener('input', e => { c.conf = +e.target.value; confSpan.textContent = c.conf+'%'; });
    approveBtn.addEventListener('click', () => { c.approved = !c.approved; approveBtn.textContent = c.approved?'Approved':'Approve'; });
    rejectBtn.addEventListener('click', () => { c.approved = false; div.style.opacity = 0.5; });
    els.claims.appendChild(div);
  });
}

els.startAll.addEventListener('click', () => { MOCK.agents.forEach(a => a.active = true); renderAgents(); alert('All agents started (mock)'); });
els.stopAll.addEventListener('click', () => { MOCK.agents.forEach(a => a.active = false); renderAgents(); alert('All agents stopped (mock)'); });
els.submit.addEventListener('click', () => {
  const count = MOCK.claims.filter(c => c.approved).length;
  alert(`(Mock) Submitted ${count} claims`);
});

renderAgents(); renderFeed(); renderClaims();
