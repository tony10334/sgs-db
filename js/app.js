import { firebaseConfig } from './firebase-config.js';

/* ---------- 小工具 ---------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (w, n) => (n ? Math.round((w / n) * 100) + '%' : '-');
const view = $('#view');

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}
const ls = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 無痕模式等情況 */ } },
};

/* ---------- 身份局規則 ---------- */
const IDENTITIES = ['主公', '忠臣', '反賊', '內奸'];
const SIDES = ['主公方', '反賊', '內奸'];
// 人數 → [主公, 忠臣, 反賊, 內奸]
const TABLE = { 4: [1, 1, 1, 1], 5: [1, 1, 2, 1], 6: [1, 1, 3, 1], 7: [1, 2, 3, 1], 8: [1, 2, 4, 1], 9: [1, 3, 4, 1], 10: [1, 3, 4, 2] };

function identityList(n) {
  const [a, b, c, d] = TABLE[n];
  return [...Array(a).fill('主公'), ...Array(b).fill('忠臣'), ...Array(c).fill('反賊'), ...Array(d).fill('內奸')];
}
function countText(n) {
  const [a, b, c, d] = TABLE[n];
  return `${n} 人局：主公 ${a}、忠臣 ${b}、反賊 ${c}、內奸 ${d}`;
}
function isWin(identity, winner) {
  if (winner === '主公方') return identity === '主公' || identity === '忠臣';
  return identity === winner;
}
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ---------- 資料層：本機模式 ---------- */
function createLocalStore() {
  let onChange = () => {};
  const store = {
    mode: 'local',
    user: null,
    async init(cb) {
      onChange = cb;
      const uid = ls.get('sgs_me', null);
      store.user = ls.get('sgs_users', []).find((u) => u.uid === uid) || null;
      onChange(store.user);
    },
    async signIn(name) {
      name = (name || '').trim();
      if (!name) throw new Error('請輸入暱稱');
      const users = ls.get('sgs_users', []);
      let u = users.find((x) => x.name === name);
      if (!u) {
        u = { uid: 'local_' + Math.random().toString(36).slice(2, 10), name, photo: '' };
        users.push(u);
        ls.set('sgs_users', users);
      }
      ls.set('sgs_me', u.uid);
      store.user = u;
      onChange(u);
    },
    async signOut() { ls.set('sgs_me', null); store.user = null; onChange(null); },
    async rename(name) {
      const users = ls.get('sgs_users', []);
      const u = users.find((x) => x.uid === store.user.uid);
      if (u) { u.name = name; ls.set('sgs_users', users); }
      store.user = { ...store.user, name };
    },
    async listUsers() { return ls.get('sgs_users', []); },
    async listGames() { return ls.get('sgs_games', []).sort((a, b) => b.createdAt - a.createdAt); },
    async addGame(g) {
      const games = ls.get('sgs_games', []);
      const id = 'g_' + Date.now().toString(36);
      games.push({ ...g, id });
      ls.set('sgs_games', games);
      return id;
    },
    async deleteGame(id) { ls.set('sgs_games', ls.get('sgs_games', []).filter((g) => g.id !== id)); },
  };
  return store;
}

/* ---------- 資料層：Firebase 模式 ---------- */
async function createFirebaseStore() {
  const base = 'https://www.gstatic.com/firebasejs/10.12.2';
  const [{ initializeApp }, A, F] = await Promise.all([
    import(`${base}/firebase-app.js`),
    import(`${base}/firebase-auth.js`),
    import(`${base}/firebase-firestore.js`),
  ]);
  const app = initializeApp(firebaseConfig);
  const auth = A.getAuth(app);
  const db = F.getFirestore(app);

  const store = {
    mode: 'firebase',
    user: null,
    init(cb) {
      return new Promise((resolve) => {
        let first = true;
        A.onAuthStateChanged(auth, async (fu) => {
          try {
            if (fu) {
              const ref = F.doc(db, 'users', fu.uid);
              const snap = await F.getDoc(ref);
              const name = (snap.exists() && snap.data().name) || fu.displayName || '玩家';
              await F.setDoc(ref, { name, photo: fu.photoURL || '', lastLogin: Date.now() }, { merge: true });
              store.user = { uid: fu.uid, name, photo: fu.photoURL || '' };
            } else {
              store.user = null;
            }
          } catch (e) {
            console.error(e);
            toast('讀取使用者資料失敗，請檢查 Firestore 規則');
          }
          cb(store.user);
          if (first) { first = false; resolve(); }
        });
      });
    },
    async signIn() {
      const provider = new A.GoogleAuthProvider();
      try {
        await A.signInWithPopup(auth, provider);
      } catch (e) {
        if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
          await A.signInWithRedirect(auth, provider);
        } else if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') {
          throw e;
        }
      }
    },
    async signOut() { await A.signOut(auth); },
    async rename(name) {
      await F.setDoc(F.doc(db, 'users', store.user.uid), { name }, { merge: true });
      store.user = { ...store.user, name };
    },
    async listUsers() {
      const s = await F.getDocs(F.collection(db, 'users'));
      return s.docs.map((d) => ({ uid: d.id, ...d.data() }));
    },
    async listGames() {
      const s = await F.getDocs(F.query(F.collection(db, 'games'), F.orderBy('createdAt', 'desc')));
      return s.docs.map((d) => ({ id: d.id, ...d.data() }));
    },
    async addGame(g) { return (await F.addDoc(F.collection(db, 'games'), g)).id; },
    async deleteGame(id) { await F.deleteDoc(F.doc(db, 'games', id)); },
  };
  return store;
}

/* ---------- 狀態 ---------- */
let store;
const state = {
  tab: 'heroes',
  heroes: [],
  q: '',
  faction: '全部',
  openHero: null,
  users: [],
  games: null,
  minGames: 1,
  draft: ls.get('sgs_draft', null) || newDraft(5),
};

function newDraft(count) {
  return { count, seats: identityList(count).map((identity) => ({ uid: '', name: '', hero: '', identity })), winner: '', note: '' };
}
const saveDraft = () => ls.set('sgs_draft', state.draft);
const heroByName = (name) => {
  if (!name) return null;
  const n = name.trim();
  return state.heroes.find((h) => h.name === n || (h.aliases || []).includes(n)) || null;
};
const userName = (uid) => state.users.find((u) => u.uid === uid)?.name;

async function ensureData(force = false) {
  if (force || !state.games) {
    const [games, users] = await Promise.all([store.listGames(), store.listUsers()]);
    state.games = games;
    state.users = users;
  }
}

/* ---------- 共用元件 ---------- */
function renderUser() {
  const u = store.user;
  const badge = store.mode === 'local' ? '<span class="badge">本機模式</span>' : '';
  $('#user-area').innerHTML = u
    ? `${badge}${u.photo ? `<img src="${esc(u.photo)}" alt="" referrerpolicy="no-referrer">` : ''}<span>${esc(u.name)}</span>`
    : `${badge}<button class="btn small" id="top-login">登入</button>`;
  const b = $('#top-login');
  if (b) b.onclick = () => go('me');
}

function loginBox(msg) {
  return `<div class="card">
    <p>${msg}</p>
    ${store.mode === 'local'
      ? `<p class="muted">目前是本機模式（還沒填 Firebase 設定），先用暱稱模擬登入，資料只存在這支手機。</p>
         <input id="nick" placeholder="輸入暱稱"><div style="height:8px"></div>
         <button class="btn" id="login-btn">登入</button>`
      : `<button class="btn" id="login-btn">用 Google 登入</button>`}
  </div>`;
}
function bindLogin() {
  const b = $('#login-btn');
  if (!b) return;
  b.onclick = async () => {
    try { await store.signIn($('#nick')?.value); } catch (e) { console.error(e); toast(e.message || '登入失敗'); }
  };
  $('#nick')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') b.click(); });
}

function fmtDate(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function gameCard(g, meUid) {
  const mine = meUid ? g.seats.find((s) => s.uid === meUid) : null;
  const canDelete = store.user && g.createdBy === store.user.uid;
  return `<div class="card">
    <div class="game-row">
      <div><b>${fmtDate(g.createdAt)}</b> <span class="muted">${g.playerCount} 人・${esc(g.winner)}勝</span></div>
      ${mine ? `<span class="${mine.win ? 'win' : 'lose'}">${mine.win ? '勝' : '負'}・${esc(mine.identity)}</span>` : ''}
    </div>
    <div class="game-seats">${g.seats.map((s) => `<span class="${s.win ? 'win' : ''}">${esc(s.uid ? userName(s.uid) || s.name : s.name)}</span>（${esc(s.identity)}${s.hero ? '／' + esc(s.hero) : ''}）`).join('、')}</div>
    ${g.note ? `<div class="muted" style="margin-top:4px">📝 ${esc(g.note)}</div>` : ''}
    ${canDelete ? `<div style="margin-top:8px;text-align:right"><button class="btn danger small del" data-id="${esc(g.id)}">刪除</button></div>` : ''}
  </div>`;
}
function bindDelete() {
  $$('.del').forEach((b) => {
    b.onclick = async () => {
      if (!confirm('確定刪除這局紀錄？')) return;
      try {
        await store.deleteGame(b.dataset.id);
        state.games = null;
        toast('已刪除');
        render();
      } catch (e) { console.error(e); toast('刪除失敗'); }
    };
  });
}

/* ---------- 頁面：武將 ---------- */
function heroMatch(h, q) {
  if (!q) return true;
  q = q.toLowerCase();
  return [h.name, h.title, h.version, ...(h.aliases || [])].some((s) => s && s.toLowerCase().includes(q));
}
function heroCard(h) {
  const open = state.openHero === h.id;
  const diff = ['', '新手友善', '中等', '進階'][h.difficulty] || '';
  return `<div class="card clickable" data-hero="${esc(h.id)}">
    <div class="hero-head">
      <div class="faction ${esc(h.faction)}">${esc(h.faction)}</div>
      <div>
        <div class="hero-name">${esc(h.name)} <span class="hero-sub">${esc(h.version)}・${esc(h.title || '')}</span></div>
        <div class="hp">${'●'.repeat(h.hp)} <span class="hero-sub">${h.hp} 血</span></div>
      </div>
    </div>
    <p class="tagline">${esc(h.tagline)}</p>
    <div class="chips"><span class="chip hard${h.difficulty}">${diff}</span>${(h.roles || []).map((r) => `<span class="chip">${esc(r)}</span>`).join('')}</div>
    ${open
      ? `<div class="hero-body">
          ${h.skills.map((s) => `<div class="skill"><b>【${esc(s.name)}】</b>${esc(s.plain)}${s.tip ? `<div class="tip">💡 ${esc(s.tip)}</div>` : ''}</div>`).join('')}
          ${h.aliases?.length ? `<div class="muted">也叫：${h.aliases.map(esc).join('、')}</div>` : ''}
        </div>`
      : '<div class="muted" style="margin-top:6px">點開看技能白話翻譯 ▾</div>'}
  </div>`;
}
function renderHeroList() {
  const q = state.q.trim();
  const list = state.heroes.filter((h) => (state.faction === '全部' || h.faction === state.faction) && heroMatch(h, q));
  const box = $('#hero-list-box');
  box.innerHTML = list.length ? list.map(heroCard).join('') : '<div class="empty">找不到這個武將，試試別名或少打幾個字</div>';
  $$('[data-hero]', box).forEach((el) => {
    el.onclick = () => {
      state.openHero = state.openHero === el.dataset.hero ? null : el.dataset.hero;
      renderHeroList();
    };
  });
}
function renderHeroes() {
  const factions = ['全部', '魏', '蜀', '吳', '群'];
  view.innerHTML = `
    <div class="search">
      <input id="q" type="search" placeholder="搜尋武將：關羽、謀關羽、界關羽…" value="${esc(state.q)}" autocomplete="off">
      <div class="chips">${factions.map((f) => `<button class="chip fbtn ${f === state.faction ? 'on' : ''}" data-f="${f}">${f}</button>`).join('')}</div>
    </div>
    <div id="hero-list-box"></div>`;
  $('#q').addEventListener('input', (e) => {
    state.q = e.target.value;
    // 只有一筆結果就自動展開
    const hits = state.heroes.filter((h) => heroMatch(h, state.q.trim()));
    if (state.q.trim() && hits.length === 1) state.openHero = hits[0].id;
    renderHeroList();
  });
  $$('.fbtn').forEach((b) => {
    b.onclick = () => {
      state.faction = b.dataset.f;
      $$('.fbtn').forEach((x) => x.classList.toggle('on', x === b));
      renderHeroList();
    };
  });
  renderHeroList();
}

/* ---------- 頁面：開局 ---------- */
function seatHtml(s, i) {
  const me = store.user.uid;
  const opts = state.users
    .map((u) => `<option value="${esc(u.uid)}" ${s.uid === u.uid ? 'selected' : ''}>${esc(u.name)}${u.uid === me ? '（我）' : ''}</option>`)
    .join('');
  const h = heroByName(s.hero);
  return `<div class="seat identity-${s.identity}" data-i="${i}">
    <div class="row">
      <span class="n">${i + 1}</span>
      <select class="who"><option value="">選玩家</option>${opts}<option value="__guest" ${s.uid === '__guest' ? 'selected' : ''}>＋ 訪客</option></select>
      <select class="identity">${IDENTITIES.map((x) => `<option ${x === s.identity ? 'selected' : ''}>${x}</option>`).join('')}</select>
    </div>
    ${s.uid === '__guest' ? `<div class="row"><span class="n"></span><input class="gname" placeholder="訪客名字" value="${esc(s.name)}"></div>` : ''}
    <div class="row"><span class="n"></span><input class="hero" list="hero-dl" placeholder="武將（可打別名）" value="${esc(s.hero)}"></div>
    <div class="hero-hint muted" style="margin-left:36px">${h ? `${esc(h.faction)}・${esc(h.tagline)}` : ''}</div>
  </div>`;
}
function seatLabel(s, i) {
  const n = s.uid === '__guest' ? s.name : userName(s.uid);
  return `${i + 1}號${n ? ' ' + n : ''}`;
}
function winnerHint(d) {
  if (!d.winner) return '選了之後會自動算出每個人勝負。';
  const w = d.seats.map((s, i) => (isWin(s.identity, d.winner) ? seatLabel(s, i) : null)).filter(Boolean);
  return w.length ? `贏家：${w.join('、')}` : '⚠️ 沒有人是這個陣營，確認一下身份';
}

async function renderNew() {
  if (!store.user) {
    view.innerHTML = '<h2>開一局身份局</h2>' + loginBox('登入後才能記錄對局。');
    bindLogin();
    return;
  }
  if (!state.games) view.innerHTML = '<div class="empty">載入中…</div>';
  await ensureData();
  const d = state.draft;
  view.innerHTML = `
    <h2>開一局身份局</h2>
    <div class="card">
      <div class="row"><span style="flex:0 0 auto">人數</span>
        <select id="count">${Object.keys(TABLE).map((n) => `<option value="${n}" ${+n === d.count ? 'selected' : ''}>${n} 人</option>`).join('')}</select>
      </div>
      <p class="muted" style="margin:0 0 10px">${countText(d.count)}</p>
      <div class="btn-row">
        <button class="btn secondary small" id="rand-id">🎲 隨機身份</button>
        <button class="btn secondary small" id="rand-hero">🎲 隨機武將</button>
        <button class="btn secondary small" id="reset">清空</button>
      </div>
    </div>
    <h3>座位（主公坐 1 號位最順）</h3>
    ${d.seats.map(seatHtml).join('')}
    <datalist id="hero-dl">${state.heroes.map((h) => `<option value="${esc(h.name)}">`).join('')}</datalist>
    <h3>誰贏了？</h3>
    <div class="radio-group">${SIDES.map((w) => `<label class="${d.winner === w ? 'on' : ''}"><input type="radio" name="winner" value="${w}" ${d.winner === w ? 'checked' : ''}>${w}</label>`).join('')}</div>
    <p class="muted" id="winner-hint">${esc(winnerHint(d))}</p>
    <textarea id="note" rows="2" placeholder="備註（可不填），例如：內奸單挑主公翻盤">${esc(d.note || '')}</textarea>
    <div style="height:12px"></div>
    <button class="btn" id="save">儲存這局</button>
    <div style="height:8px"></div>`;

  const refreshHint = () => { $('#winner-hint').textContent = winnerHint(d); saveDraft(); };

  $('#count').onchange = (e) => {
    const n = +e.target.value;
    const old = d.seats;
    state.draft = newDraft(n);
    state.draft.seats.forEach((s, i) => { if (old[i]) { s.uid = old[i].uid; s.name = old[i].name; s.hero = old[i].hero; } });
    saveDraft();
    renderNew();
  };
  $('#rand-id').onclick = () => {
    shuffle(identityList(d.count)).forEach((id, i) => { d.seats[i].identity = id; });
    saveDraft();
    renderNew();
  };
  $('#rand-hero').onclick = () => {
    const pool = shuffle(state.heroes.filter((h) => h.difficulty <= 2));
    d.seats.forEach((s, i) => { s.hero = pool[i % pool.length]?.name || ''; });
    saveDraft();
    renderNew();
    toast('已幫每人抽一隻（排除進階武將）');
  };
  $('#reset').onclick = () => {
    if (!confirm('清空這局的所有欄位？')) return;
    state.draft = newDraft(d.count);
    saveDraft();
    renderNew();
  };

  $$('.seat').forEach((el) => {
    const s = d.seats[+el.dataset.i];
    $('.who', el).onchange = (e) => { s.uid = e.target.value; if (s.uid !== '__guest') s.name = ''; saveDraft(); renderNew(); };
    $('.identity', el).onchange = (e) => {
      el.classList.remove('identity-' + s.identity);
      s.identity = e.target.value;
      el.classList.add('identity-' + s.identity);
      refreshHint();
    };
    $('.gname', el)?.addEventListener('input', (e) => { s.name = e.target.value; refreshHint(); });
    $('.hero', el).addEventListener('input', (e) => {
      s.hero = e.target.value;
      const h = heroByName(s.hero);
      $('.hero-hint', el).textContent = h ? `${h.faction}・${h.tagline}` : '';
      saveDraft();
    });
  });

  $$('input[name=winner]').forEach((r) => {
    r.onchange = () => {
      d.winner = r.value;
      $$('.radio-group label').forEach((l) => l.classList.toggle('on', l.contains(r)));
      refreshHint();
    };
  });
  $('#note').addEventListener('input', (e) => { d.note = e.target.value; saveDraft(); });
  $('#save').onclick = saveGame;
}

async function saveGame() {
  const d = state.draft;
  const errs = [];
  if (d.seats.filter((s) => s.identity === '主公').length !== 1) errs.push('主公要剛好 1 位');
  if (!d.winner) errs.push('請選誰贏了');
  if (d.winner && !d.seats.some((s) => isWin(s.identity, d.winner))) errs.push('沒有人屬於獲勝陣營');

  const seats = d.seats.map((s, i) => {
    const isGuest = s.uid === '__guest';
    const name = isGuest ? s.name.trim() : userName(s.uid) || '';
    if (!name) errs.push(`${i + 1} 號位還沒選玩家`);
    const h = heroByName(s.hero);
    return {
      seat: i + 1,
      uid: s.uid && !isGuest ? s.uid : null,
      name,
      hero: h ? h.name : s.hero.trim(),
      identity: s.identity,
      win: isWin(s.identity, d.winner),
    };
  });
  const uids = seats.map((s) => s.uid).filter(Boolean);
  if (new Set(uids).size !== uids.length) errs.push('同一個玩家被選了兩次');
  if (errs.length) { toast(errs[0]); return; }

  const game = {
    createdAt: Date.now(),
    createdBy: store.user.uid,
    mode: '身份局',
    playerCount: d.count,
    winner: d.winner,
    note: (d.note || '').trim(),
    seats,
    playerUids: uids,
  };
  const btn = $('#save');
  btn.disabled = true;
  btn.textContent = '儲存中…';
  try {
    await store.addGame(game);
    // 保留同一批玩家，方便「再來一局」
    const next = newDraft(d.count);
    next.seats.forEach((s, i) => { s.uid = d.seats[i].uid; s.name = d.seats[i].name; });
    state.draft = next;
    saveDraft();
    state.games = null;
    toast('已儲存！同一批人可以直接再來一局');
    window.scrollTo(0, 0);
    renderNew();
  } catch (e) {
    console.error(e);
    toast('儲存失敗：' + (e.code || e.message));
    btn.disabled = false;
    btn.textContent = '儲存這局';
  }
}

/* ---------- 統計 ---------- */
function aggregate(games) {
  const players = new Map();
  const heroes = new Map();
  const sides = { 主公方: 0, 反賊: 0, 內奸: 0 };
  for (const g of games) {
    sides[g.winner] = (sides[g.winner] || 0) + 1;
    for (const s of g.seats) {
      const key = s.uid || 'guest:' + s.name;
      const p = players.get(key) || { key, uid: s.uid, name: s.uid ? userName(s.uid) || s.name : s.name, games: 0, wins: 0 };
      p.games++;
      if (s.win) p.wins++;
      players.set(key, p);
      if (s.hero) {
        const h = heroes.get(s.hero) || { name: s.hero, games: 0, wins: 0 };
        h.games++;
        if (s.win) h.wins++;
        heroes.set(s.hero, h);
      }
    }
  }
  return { players: [...players.values()], heroes: [...heroes.values()], sides };
}

/* ---------- 頁面：我的 ---------- */
async function renderMe() {
  if (!store.user) {
    view.innerHTML = '<h2>我的戰績</h2>' + loginBox('登入後可以看自己的勝率、各身份表現、最常用武將。');
    bindLogin();
    return;
  }
  if (!state.games) view.innerHTML = '<div class="empty">載入中…</div>';
  await ensureData();
  const me = store.user.uid;
  const my = state.games.map((g) => ({ g, s: g.seats.find((s) => s.uid === me) })).filter((x) => x.s);
  const wins = my.filter((x) => x.s.win).length;
  let streak = 0;
  for (const x of my) { if (x.s.win) streak++; else break; }

  const byId = IDENTITIES.map((id) => {
    const a = my.filter((x) => x.s.identity === id);
    return { id, n: a.length, w: a.filter((x) => x.s.win).length };
  });
  const heroMap = new Map();
  for (const { s } of my) {
    if (!s.hero) continue;
    const h = heroMap.get(s.hero) || { name: s.hero, n: 0, w: 0 };
    h.n++;
    if (s.win) h.w++;
    heroMap.set(s.hero, h);
  }
  const topHeroes = [...heroMap.values()].sort((a, b) => b.n - a.n || b.w - a.w).slice(0, 5);

  view.innerHTML = `
    <div class="card">
      <div class="profile">
        ${store.user.photo ? `<img src="${esc(store.user.photo)}" alt="" referrerpolicy="no-referrer">` : ''}
        <div style="flex:1">
          <div class="hero-name">${esc(store.user.name)}</div>
          <div class="muted">${store.mode === 'local' ? '本機帳號' : 'Google 帳號'}</div>
        </div>
      </div>
      <div class="row"><input id="rename" placeholder="改暱稱（別人在開局清單看到的名字）" value="${esc(store.user.name)}"><button class="btn secondary small" id="rename-btn" style="flex:0 0 auto">改名</button></div>
      <button class="btn secondary small" id="logout">登出</button>
    </div>

    <div class="stats">
      <div class="stat"><div class="v">${my.length}</div><div class="l">總場數</div></div>
      <div class="stat"><div class="v">${pct(wins, my.length)}</div><div class="l">勝率</div></div>
      <div class="stat"><div class="v">${streak}</div><div class="l">目前連勝</div></div>
    </div>

    <h3>各身份表現</h3>
    <div class="card"><table>
      <tr><th>身份</th><th class="num">場</th><th class="num">勝</th><th class="num">勝率</th></tr>
      ${byId.map((r) => `<tr><td>${r.id}</td><td class="num">${r.n}</td><td class="num">${r.w}</td><td class="num">${pct(r.w, r.n)}</td></tr>`).join('')}
    </table></div>

    <h3>最常用武將</h3>
    ${topHeroes.length
      ? `<div class="card"><table>
          <tr><th>武將</th><th class="num">場</th><th class="num">勝率</th></tr>
          ${topHeroes.map((h) => `<tr><td>${esc(h.name)}</td><td class="num">${h.n}</td><td class="num">${pct(h.w, h.n)}</td></tr>`).join('')}
        </table></div>`
      : '<p class="muted">還沒有紀錄</p>'}

    <h3>最近對局</h3>
    ${my.length ? my.slice(0, 20).map((x) => gameCard(x.g, me)).join('') : '<div class="empty">還沒打過，去「開局」記一場吧！</div>'}
  `;
  $('#logout').onclick = async () => { await store.signOut(); };
  $('#rename-btn').onclick = async () => {
    const name = $('#rename').value.trim();
    if (!name) return toast('暱稱不能空白');
    try {
      await store.rename(name);
      await ensureData(true);
      renderUser();
      toast('已改名');
      renderMe();
    } catch (e) { console.error(e); toast('改名失敗'); }
  };
  bindDelete();
}

/* ---------- 頁面：排行 ---------- */
async function renderRank() {
  if (store.mode === 'firebase' && !store.user) {
    view.innerHTML = '<h2>排行榜</h2>' + loginBox('登入後才能看大家的戰績。');
    bindLogin();
    return;
  }
  if (!state.games) view.innerHTML = '<div class="empty">載入中…</div>';
  await ensureData();
  const total = state.games.length;
  const { players, heroes, sides } = aggregate(state.games);
  const ps = players
    .filter((p) => p.games >= state.minGames)
    .sort((a, b) => b.wins / b.games - a.wins / a.games || b.games - a.games);
  const hs = heroes.sort((a, b) => b.games - a.games || b.wins - a.wins).slice(0, 15);

  view.innerHTML = `
    <h2>排行榜</h2>
    <div class="stats">
      ${SIDES.map((s) => `<div class="stat"><div class="v">${pct(sides[s] || 0, total)}</div><div class="l">${s}勝（${sides[s] || 0}場）</div></div>`).join('')}
    </div>
    <p class="muted">共 ${total} 局</p>

    <h3>玩家勝率</h3>
    <div class="row"><span style="flex:0 0 auto" class="muted">至少</span>
      <select id="min">${[1, 3, 5, 10].map((n) => `<option value="${n}" ${n === state.minGames ? 'selected' : ''}>${n} 場</option>`).join('')}</select>
    </div>
    ${ps.length
      ? `<div class="card"><table>
          <tr><th>#</th><th>玩家</th><th class="num">場</th><th class="num">勝</th><th class="num">勝率</th></tr>
          ${ps.map((p, i) => `<tr><td>${i + 1}</td><td>${esc(p.name)}${p.uid ? '' : ' <span class="muted">訪客</span>'}</td><td class="num">${p.games}</td><td class="num">${p.wins}</td><td class="num">${pct(p.wins, p.games)}</td></tr>`).join('')}
        </table></div>`
      : '<div class="empty">還沒有資料</div>'}

    <h3>熱門武將</h3>
    ${hs.length
      ? `<div class="card"><table>
          <tr><th>武將</th><th class="num">出場</th><th class="num">勝率</th></tr>
          ${hs.map((h) => `<tr><td>${esc(h.name)}</td><td class="num">${h.games}</td><td class="num">${pct(h.wins, h.games)}</td></tr>`).join('')}
        </table></div>`
      : '<div class="empty">還沒有資料</div>'}

    <h3>最近對局</h3>
    ${state.games.slice(0, 10).map((g) => gameCard(g, store.user?.uid)).join('') || '<div class="empty">還沒有資料</div>'}
  `;
  $('#min').onchange = (e) => { state.minGames = +e.target.value; renderRank(); };
  bindDelete();
}

/* ---------- 路由 ---------- */
const PAGES = { heroes: renderHeroes, new: renderNew, me: renderMe, rank: renderRank };

function go(tab) {
  if (!PAGES[tab]) tab = 'heroes';
  if (location.hash !== '#' + tab) history.replaceState(null, '', '#' + tab);
  state.tab = tab;
  render();
}
async function render() {
  $$('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === state.tab));
  try {
    await PAGES[state.tab]();
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="card"><p>載入失敗：${esc(e.code || e.message)}</p><p class="muted">如果是 permission-denied，請確認 Firestore 規則已貼上、而且已登入。</p></div>`;
  }
}

async function main() {
  try {
    const data = await (await fetch('data/heroes.json', { cache: 'no-cache' })).json();
    state.heroes = data.heroes || data;
  } catch (e) {
    console.error(e);
    toast('武將資料載入失敗');
  }

  const useFirebase = firebaseConfig.apiKey && firebaseConfig.apiKey !== 'PASTE_ME';
  try {
    store = useFirebase ? await createFirebaseStore() : createLocalStore();
  } catch (e) {
    console.error(e);
    store = createLocalStore();
    toast('Firebase 載入失敗，先用本機模式');
  }

  $$('.tabbar button').forEach((b) => { b.onclick = () => { go(b.dataset.tab); window.scrollTo(0, 0); }; });
  state.tab = PAGES[location.hash.slice(1)] ? location.hash.slice(1) : 'heroes';

  let started = false;
  await store.init(() => {
    state.games = null;
    renderUser();
    if (started) render();
  });
  started = true;
  renderUser();
  render();
}

main();
