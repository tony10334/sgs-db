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

/* ---------- 武將資料：整理與檢查 ---------- */
const FACTIONS = ['魏', '蜀', '吳', '群'];
const DIFF = ['', '新手友善', '中等', '進階'];
const str = (v) => (v == null ? '' : String(v)).trim();
const strList = (v) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
const splitList = (s) => str(s).split(/[,，、\n]/).map((x) => x.trim()).filter(Boolean);

// 只留下認得的欄位，型別轉好（資料可能來自上傳的 JSON 或資料庫）
function normalizeHero(h) {
  h = h && typeof h === 'object' ? h : {};
  return {
    id: str(h.id), name: str(h.name), version: str(h.version), title: str(h.title),
    faction: str(h.faction), hp: Number(h.hp), difficulty: Number(h.difficulty),
    aliases: strList(h.aliases), tagline: str(h.tagline), roles: strList(h.roles),
    skills: (Array.isArray(h.skills) ? h.skills : []).map((s) => ({ name: str(s?.name), plain: str(s?.plain), tip: str(s?.tip) })),
  };
}
// 單一武將的欄位檢查，回傳錯誤訊息陣列
function validateHero(h) {
  const e = [];
  if (!/^[a-z0-9_-]+$/.test(h.id)) e.push('id 要填，只能用小寫英文、數字、_ 或 -');
  if (!h.name) e.push('名字沒填');
  if (!h.version) e.push('版本沒填');
  if (!FACTIONS.includes(h.faction)) e.push(`勢力只能是 ${FACTIONS.join('／')}`);
  if (!Number.isInteger(h.hp) || h.hp < 1 || h.hp > 10) e.push('血量要是 1–10 的整數');
  if (![1, 2, 3].includes(h.difficulty)) e.push('難度要是 1、2 或 3');
  if (!h.tagline) e.push('一句話定位沒填');
  if (!h.skills.length) e.push('至少要有一個技能');
  h.skills.forEach((s, j) => { if (!s.name || !s.plain) e.push(`第 ${j + 1} 個技能的名稱和白話說明都要填`); });
  return e;
}
// 整批檢查（含 id、名字不可重複）
function validateHeroes(list) {
  const errors = [];
  const heroes = list.map(normalizeHero);
  const ids = new Map();
  const names = new Map();
  heroes.forEach((h, i) => {
    const who = `第 ${i + 1} 筆${h.name ? `（${h.name}）` : ''}`;
    validateHero(h).forEach((m) => errors.push(`${who}：${m}`));
    if (h.id && ids.has(h.id)) errors.push(`${who}：id「${h.id}」跟第 ${ids.get(h.id) + 1} 筆重複`);
    else ids.set(h.id, i);
    if (h.name && names.has(h.name)) errors.push(`${who}：名字「${h.name}」跟第 ${names.get(h.name) + 1} 筆重複`);
    else names.set(h.name, i);
  });
  return { errors, heroes };
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
      const u = ls.get('sgs_users', []).find((x) => x.uid === uid);
      // 本機模式：登入就有管理權限，方便測試管理頁
      store.user = u ? { ...u, isAdmin: true } : null;
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
      store.user = { ...u, isAdmin: true };
      onChange(store.user);
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
    // 武將：管理頁存過才有，沒有就回傳 null（改用 data/heroes.json）
    async loadHeroes() { return ls.get('sgs_heroes', null); },
    async saveHeroes(list) { ls.set('sgs_heroes', list); },
    // 管理員名單（本機模式只是讓畫面可以測試）
    async listAdmins() { return ls.get('sgs_admins', []); },
    async addAdmin(email) {
      ls.set('sgs_admins', [...ls.get('sgs_admins', []), { email, addedBy: store.user.name, addedAt: Date.now() }]);
    },
    async removeAdmin(email) { ls.set('sgs_admins', ls.get('sgs_admins', []).filter((a) => a.email !== email)); },
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
  const heroesRef = F.doc(db, 'site', 'heroes');

  // admins/{email} 存在就是管理員（規則允許每個人查自己那一筆）
  async function checkAdmin(email) {
    if (!email) return false;
    try {
      return (await F.getDoc(F.doc(db, 'admins', email))).exists();
    } catch (e) {
      console.error(e);
      return false;
    }
  }

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
              // email 只留在這支手機的記憶體，不寫進 users（users 所有登入者都看得到）
              const email = (fu.email || '').toLowerCase();
              store.user = { uid: fu.uid, name, photo: fu.photoURL || '', email, isAdmin: await checkAdmin(email) };
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
    // 武將：全部放在 site/heroes 一份文件（每次開網頁只算 1 次讀取）
    async loadHeroes() {
      const snap = await F.getDoc(heroesRef);
      return snap.exists() ? snap.data().heroes : null;
    },
    async saveHeroes(list) {
      await F.setDoc(heroesRef, { heroes: list, updatedAt: Date.now(), updatedBy: store.user.email });
    },
    async listAdmins() {
      const s = await F.getDocs(F.collection(db, 'admins'));
      return s.docs.map((d) => ({ email: d.id, ...d.data() }));
    },
    async addAdmin(email) {
      await F.setDoc(F.doc(db, 'admins', email), { addedBy: store.user.email, addedAt: Date.now() });
    },
    async removeAdmin(email) { await F.deleteDoc(F.doc(db, 'admins', email)); },
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
  heroSource: 'file', // 'db' = 管理頁存過的資料，'file' = data/heroes.json
  admin: { tab: 'heroes', q: '', editing: null, isNew: false, upload: { text: '', mode: 'merge' } },
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
  const diff = DIFF[h.difficulty] || '';
  const hp = Math.max(0, Math.min(10, h.hp | 0));
  return `<div class="card clickable" data-hero="${esc(h.id)}">
    <div class="hero-head">
      <div class="faction ${esc(h.faction)}">${esc(h.faction)}</div>
      <div>
        <div class="hero-name">${esc(h.name)} <span class="hero-sub">${esc(h.version)}・${esc(h.title || '')}</span></div>
        <div class="hp">${'●'.repeat(hp)} <span class="hero-sub">${hp} 血</span></div>
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
      <div style="display:flex;gap:8px">
        <button class="btn secondary small" id="logout">登出</button>
        ${store.user.isAdmin ? '<button class="btn secondary small" id="to-admin">🛠 管理頁</button>' : ''}
      </div>
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
  $('#to-admin')?.addEventListener('click', () => { go('admin'); window.scrollTo(0, 0); });
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

/* ---------- 頁面：管理（隱藏，網址 #admin，只有管理員能用） ---------- */
const ADMIN_TABS = { heroes: '武將', upload: '上傳 JSON', admins: '管理員' };
const field = (label, html) => `<label class="field"><span>${label}</span>${html}</label>`;
const errorBox = (errs) => (errs.length
  ? `<div class="errors">${errs.slice(0, 20).map((e) => `<div>⚠️ ${esc(e)}</div>`).join('')}${errs.length > 20 ? `<div>…還有 ${errs.length - 20} 個問題</div>` : ''}</div>`
  : '');
const saveErrorText = (e) => (e.code === 'permission-denied' ? '沒有權限（管理權限可能被移除了，請重新整理）' : e.code || e.message);

async function saveHeroList(list) {
  const bytes = new TextEncoder().encode(JSON.stringify(list)).length;
  if (bytes > 950000) throw new Error(`資料太大（${Math.round(bytes / 1024)} KB），超過資料庫單份上限，需要拆開存`);
  await store.saveHeroes(list);
  state.heroes = list;
  state.heroSource = 'db';
}

async function renderAdmin() {
  if (!store.user) {
    view.innerHTML = '<h2>管理頁</h2>' + loginBox('管理頁需要先登入。');
    bindLogin();
    return;
  }
  if (!store.user.isAdmin) {
    view.innerHTML = `<h2>管理頁</h2><div class="card">
      <p>你沒有管理權限。</p>
      <p class="muted">需要的話，請把你的登入信箱給管理員，請他在管理頁把你加進名單，加好後重新整理這頁。</p>
      ${store.user.email ? `<p class="muted">你的登入信箱：${esc(store.user.email)}</p>` : ''}
    </div>`;
    return;
  }
  const a = state.admin;
  view.innerHTML = `
    <h2>管理頁</h2>
    <div class="chips">${Object.entries(ADMIN_TABS).map(([k, v]) => `<button class="chip atab ${k === a.tab ? 'on' : ''}" data-t="${k}">${v}</button>`).join('')}</div>
    ${store.mode === 'local' ? '<p class="muted">本機模式：改動只存在這個瀏覽器，登入就有管理權限。</p>' : ''}
    <div id="admin-box" style="margin-top:12px"></div>`;
  $$('.atab').forEach((b) => {
    b.onclick = () => { a.tab = b.dataset.t; a.editing = null; renderAdmin(); };
  });
  if (a.tab === 'heroes') renderAdminHeroes();
  else if (a.tab === 'upload') renderAdminUpload();
  else await renderAdminAdmins();
}

/* 管理頁：武將列表 */
function renderAdminHeroes() {
  const a = state.admin;
  const box = $('#admin-box');
  if (a.editing) { renderHeroForm(box); return; }
  const src = state.heroSource === 'db' ? '管理頁存過的資料' : '預設檔 heroes.json（還沒在管理頁存過）';
  box.innerHTML = `
    <p class="muted" style="margin-top:0">共 ${state.heroes.length} 位，目前來源：${src}</p>
    <div class="btn-row" style="margin-bottom:8px">
      <button class="btn small" id="hero-add">＋ 新增武將</button>
      <button class="btn secondary small" id="hero-dl">⬇ 下載 JSON</button>
    </div>
    <input id="admin-q" type="search" placeholder="搜尋要改的武將" value="${esc(a.q)}" autocomplete="off">
    <div id="admin-hero-list" style="margin-top:8px"></div>`;

  const drawList = () => {
    const list = state.heroes.filter((h) => heroMatch(h, a.q.trim()));
    const el = $('#admin-hero-list');
    el.innerHTML = list.length
      ? list.map((h) => `<div class="card admin-row">
          <div class="faction ${esc(h.faction)}">${esc(h.faction)}</div>
          <div style="flex:1;min-width:0">
            <div class="ellipsis"><b>${esc(h.name)}</b> <span class="hero-sub">${esc(h.version)}・${esc(h.id)}</span></div>
            <div class="muted ellipsis">${esc(h.tagline)}</div>
          </div>
          <button class="btn secondary small" data-edit="${esc(h.id)}" style="flex:0 0 auto">編輯</button>
        </div>`).join('')
      : '<div class="empty">找不到</div>';
    $$('[data-edit]', el).forEach((b) => {
      b.onclick = () => {
        a.editing = structuredClone(state.heroes.find((h) => h.id === b.dataset.edit));
        a.isNew = false;
        renderAdminHeroes();
        window.scrollTo(0, 0);
      };
    });
  };
  $('#admin-q').addEventListener('input', (e) => { a.q = e.target.value; drawList(); });
  $('#hero-add').onclick = () => {
    a.editing = normalizeHero({ version: '標準', faction: '蜀', hp: 4, difficulty: 1, skills: [{}] });
    a.isNew = true;
    renderAdminHeroes();
    window.scrollTo(0, 0);
  };
  $('#hero-dl').onclick = downloadHeroes;
  drawList();
}

function downloadHeroes() {
  const blob = new Blob([JSON.stringify({ heroes: state.heroes }, null, 2) + '\n'], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'heroes.json';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* 管理頁：單一武將編輯／新增 */
function renderHeroForm(box) {
  const a = state.admin;
  const h = a.editing;
  box.innerHTML = `
    <div class="card">
      <h3 style="margin-top:0">${a.isNew ? '新增武將' : '編輯：' + esc(h.name)}</h3>
      ${field('id（英文代號，不能重複）', `<input id="f-id" value="${esc(h.id)}" ${a.isNew ? '' : 'disabled'} placeholder="例如 jie_guanyu" autocapitalize="off" autocomplete="off">`)}
      ${field('名字', `<input id="f-name" value="${esc(h.name)}" placeholder="例如 界關羽">`)}
      <div class="row">
        ${field('版本', `<input id="f-version" value="${esc(h.version)}" placeholder="標準／界限突破…">`)}
        ${field('稱號', `<input id="f-title" value="${esc(h.title)}" placeholder="可不填">`)}
      </div>
      <div class="row">
        ${field('勢力', `<select id="f-faction">${FACTIONS.map((f) => `<option ${f === h.faction ? 'selected' : ''}>${f}</option>`).join('')}</select>`)}
        ${field('血量', `<input id="f-hp" type="number" inputmode="numeric" min="1" max="10" value="${Number.isFinite(h.hp) ? h.hp : ''}">`)}
        ${field('難度', `<select id="f-diff">${[1, 2, 3].map((n) => `<option value="${n}" ${n === h.difficulty ? 'selected' : ''}>${DIFF[n]}</option>`).join('')}</select>`)}
      </div>
      ${field('一句話定位', `<input id="f-tagline" value="${esc(h.tagline)}">`)}
      ${field('別名（用頓號或逗號分隔）', `<input id="f-aliases" value="${esc(h.aliases.join('、'))}" placeholder="簡體字、俗稱、常見錯字">`)}
      ${field('標籤（用頓號或逗號分隔）', `<input id="f-roles" value="${esc(h.roles.join('、'))}" placeholder="輸出、新手推薦">`)}
    </div>
    <h3>技能</h3>
    ${h.skills.map((s, i) => `<div class="card skill-edit" data-i="${i}">
        <div class="row">
          <input class="s-name" value="${esc(s.name)}" placeholder="技能名">
          <button class="btn danger small s-del" style="flex:0 0 auto">刪除技能</button>
        </div>
        <textarea class="s-plain" rows="3" placeholder="白話說明（用自己的話寫）">${esc(s.plain)}</textarea>
        <div style="height:6px"></div>
        <input class="s-tip" value="${esc(s.tip)}" placeholder="小技巧（可不填）">
      </div>`).join('')}
    <button class="btn secondary" id="s-add">＋ 新增技能</button>
    <div id="f-errors"></div>
    <div style="height:12px"></div>
    <div class="btn-row">
      <button class="btn secondary" id="f-cancel">取消</button>
      <button class="btn" id="f-save">${a.isNew ? '新增' : '儲存'}</button>
    </div>
    ${a.isNew ? '' : '<div style="height:28px"></div><button class="btn danger" id="f-delete">刪除這個武將</button>'}
    <div style="height:8px"></div>`;

  // 把表單內容寫回 a.editing（新增／刪除技能重畫時才不會弄丟已輸入的字）
  const readForm = () => {
    if (a.isNew) h.id = $('#f-id').value.trim();
    h.name = $('#f-name').value.trim();
    h.version = $('#f-version').value.trim();
    h.title = $('#f-title').value.trim();
    h.faction = $('#f-faction').value;
    h.hp = $('#f-hp').value === '' ? NaN : Number($('#f-hp').value);
    h.difficulty = Number($('#f-diff').value);
    h.tagline = $('#f-tagline').value.trim();
    h.aliases = splitList($('#f-aliases').value);
    h.roles = splitList($('#f-roles').value);
    h.skills = $$('.skill-edit').map((el) => ({
      name: $('.s-name', el).value.trim(), plain: $('.s-plain', el).value.trim(), tip: $('.s-tip', el).value.trim(),
    }));
  };

  $('#s-add').onclick = () => { readForm(); h.skills.push({ name: '', plain: '', tip: '' }); renderHeroForm(box); };
  $$('.s-del').forEach((b) => {
    b.onclick = () => {
      readForm();
      h.skills.splice(+b.closest('.skill-edit').dataset.i, 1);
      renderHeroForm(box);
    };
  });
  $('#f-cancel').onclick = () => { a.editing = null; renderAdminHeroes(); };

  $('#f-save').onclick = async () => {
    readForm();
    const hero = normalizeHero(h);
    const others = state.heroes.filter((x) => a.isNew || x.id !== hero.id);
    const errs = validateHero(hero);
    if (others.some((x) => x.id === hero.id)) errs.push(`id「${hero.id}」已經有人用了`);
    if (others.some((x) => x.name === hero.name)) errs.push(`名字「${hero.name}」跟其他武將重複`);
    $('#f-errors').innerHTML = errorBox(errs);
    if (errs.length) return;
    const list = a.isNew ? [...state.heroes, hero] : state.heroes.map((x) => (x.id === hero.id ? hero : x));
    const btn = $('#f-save');
    btn.disabled = true;
    try {
      await saveHeroList(list);
      toast(a.isNew ? `已新增 ${hero.name}` : `已儲存 ${hero.name}`);
      a.editing = null;
      renderAdminHeroes();
    } catch (e) {
      console.error(e);
      toast('儲存失敗：' + saveErrorText(e));
      btn.disabled = false;
    }
  };

  $('#f-delete')?.addEventListener('click', async () => {
    if (!confirm(`確定刪除「${h.name}」？\n（已經記錄的對局不受影響）`)) return;
    try {
      await saveHeroList(state.heroes.filter((x) => x.id !== h.id));
      toast(`已刪除 ${h.name}`);
      a.editing = null;
      renderAdminHeroes();
    } catch (e) {
      console.error(e);
      toast('刪除失敗：' + saveErrorText(e));
    }
  });
}

/* 管理頁：上傳 JSON */
function renderAdminUpload() {
  const u = state.admin.upload;
  const box = $('#admin-box');
  box.innerHTML = `
    <div class="card">
      <p class="muted" style="margin-top:0">選一個 .json 檔，或直接把內容貼到下面。格式可以是 <code>{"heroes": […]}</code> 或直接一個陣列 <code>[…]</code>，每位武將的欄位跟「下載 JSON」的一樣。</p>
      <input type="file" id="up-file" accept=".json,application/json">
      <div style="height:8px"></div>
      <textarea id="up-text" rows="8" placeholder='{"heroes": [ … ]}' spellcheck="false" autocapitalize="off">${esc(u.text)}</textarea>
      <h3>匯入方式</h3>
      <div class="radio-group">
        ${[['merge', '合併'], ['replace', '整份取代']].map(([v, l]) => `<label class="${u.mode === v ? 'on' : ''}"><input type="radio" name="up-mode" value="${v}" ${u.mode === v ? 'checked' : ''}>${l}</label>`).join('')}
      </div>
      <p class="muted">${u.mode === 'merge'
        ? '合併：同 id 的武將會被檔案內容覆蓋，新的會加進來，其他的保留不動。'
        : '整份取代：發布後只剩檔案裡的武將，<b>檔案裡沒有的會被刪掉</b>。'}</p>
      <button class="btn secondary" id="up-check">檢查內容</button>
    </div>
    <div id="up-result"></div>`;

  const clearResult = () => { $('#up-result').innerHTML = ''; };
  $('#up-text').addEventListener('input', (e) => { u.text = e.target.value; clearResult(); });
  $('#up-file').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    u.text = await file.text();
    $('#up-text').value = u.text;
    clearResult();
  };
  $$('input[name=up-mode]').forEach((r) => { r.onchange = () => { u.mode = r.value; renderAdminUpload(); }; });

  $('#up-check').onclick = () => {
    const out = $('#up-result');
    let data;
    try {
      data = JSON.parse(u.text);
    } catch (e) {
      out.innerHTML = `<div class="card">${errorBox([`JSON 格式錯誤：${e.message}`])}<p class="muted">常見原因：少了逗號、多了最後一個逗號、引號用到中文的「」或“”。</p></div>`;
      return;
    }
    const incoming = Array.isArray(data) ? data : data?.heroes;
    if (!Array.isArray(incoming) || !incoming.length) {
      out.innerHTML = `<div class="card">${errorBox(['找不到武將清單：要有 "heroes": [ … ]，或整個檔案就是一個陣列'])}</div>`;
      return;
    }
    const { errors, heroes } = validateHeroes(incoming);
    if (errors.length) {
      out.innerHTML = `<div class="card"><b>有 ${errors.length} 個問題，修好再檢查一次</b>${errorBox(errors)}</div>`;
      return;
    }

    // 算出發布後的完整清單與差異
    const cur = new Map(state.heroes.map((h) => [h.id, h]));
    const inc = new Map(heroes.map((h) => [h.id, h]));
    const added = heroes.filter((h) => !cur.has(h.id));
    const changed = heroes.filter((h) => cur.has(h.id) && JSON.stringify(cur.get(h.id)) !== JSON.stringify(h));
    const removed = u.mode === 'replace' ? state.heroes.filter((h) => !inc.has(h.id)) : [];
    const final = u.mode === 'replace'
      ? heroes
      : [...state.heroes.map((h) => inc.get(h.id) || h), ...added];
    // 合併後名字也不能重複
    const seen = new Map();
    const dup = [];
    final.forEach((h) => { if (seen.has(h.name)) dup.push(`名字「${h.name}」重複（id：${seen.get(h.name)}、${h.id}）`); else seen.set(h.name, h.id); });
    if (dup.length) {
      out.innerHTML = `<div class="card"><b>合併後有名字重複</b>${errorBox(dup)}</div>`;
      return;
    }
    const names = (arr) => arr.map((h) => esc(h.name)).join('、');
    if (!added.length && !changed.length && !removed.length) {
      out.innerHTML = '<div class="card">✅ 檢查通過，但內容跟目前一樣，不用發布。</div>';
      return;
    }
    out.innerHTML = `<div class="card">
      <b>✅ 檢查通過</b>
      <p style="margin:6px 0">新增 ${added.length} 位、修改 ${changed.length} 位、刪除 ${removed.length} 位；發布後共 ${final.length} 位。</p>
      ${added.length ? `<div class="muted">新增：${names(added)}</div>` : ''}
      ${changed.length ? `<div class="muted">修改：${names(changed)}</div>` : ''}
      ${removed.length ? `<div class="muted" style="color:var(--lose)">刪除：${names(removed)}</div>` : ''}
      <div style="height:10px"></div>
      <button class="btn" id="up-publish">確認發布</button>
    </div>`;
    $('#up-publish').onclick = async () => {
      if (removed.length && !confirm(`會刪掉 ${removed.length} 位武將，確定要發布嗎？`)) return;
      const btn = $('#up-publish');
      btn.disabled = true;
      try {
        await saveHeroList(final);
        u.text = '';
        toast(`已發布，共 ${final.length} 位武將`);
        state.admin.tab = 'heroes';
        renderAdmin();
      } catch (e) {
        console.error(e);
        toast('發布失敗：' + saveErrorText(e));
        btn.disabled = false;
      }
    };
  };
}

/* 管理頁：管理員名單 */
async function renderAdminAdmins() {
  const box = $('#admin-box');
  box.innerHTML = '<div class="empty">載入中…</div>';
  let admins;
  try {
    admins = (await store.listAdmins()).sort((x, y) => (x.addedAt || 0) - (y.addedAt || 0));
  } catch (e) {
    console.error(e);
    box.innerHTML = `<div class="card">讀取名單失敗：${esc(saveErrorText(e))}</div>`;
    return;
  }
  const me = store.user.email;
  box.innerHTML = `
    <div class="card">
      <p class="muted" style="margin-top:0">名單上的 Google 信箱登入後就有管理權限，會在「我的」看到「管理頁」按鈕。</p>
      <div class="row" style="margin-bottom:0">
        <input id="ad-email" type="email" inputmode="email" autocapitalize="off" autocomplete="off" placeholder="對方的 Gmail，例如 friend@gmail.com">
        <button class="btn small" id="ad-add" style="flex:0 0 auto">新增</button>
      </div>
    </div>
    ${admins.map((x) => `<div class="card admin-row">
        <div style="flex:1;min-width:0">
          <div class="ellipsis"><b>${esc(x.email)}</b>${x.email === me ? ' <span class="badge">你</span>' : ''}</div>
          <div class="muted">${x.addedBy && x.addedBy !== x.email ? `由 ${esc(x.addedBy)} 加入・` : ''}${x.addedAt ? fmtDate(x.addedAt) : ''}</div>
        </div>
        ${x.email === me ? '' : `<button class="btn danger small ad-del" data-e="${esc(x.email)}" style="flex:0 0 auto">移除</button>`}
      </div>`).join('') || '<div class="empty">名單是空的</div>'}
    <p class="muted">不能移除自己，避免最後沒有人能管理。</p>`;

  const add = async () => {
    const email = $('#ad-email').value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast('信箱格式不對'); return; }
    if (admins.some((x) => x.email === email)) { toast('已經在名單上了'); return; }
    try {
      await store.addAdmin(email);
      toast(`已加入 ${email}`);
      renderAdminAdmins();
    } catch (e) {
      console.error(e);
      toast('新增失敗：' + saveErrorText(e));
    }
  };
  $('#ad-add').onclick = add;
  $('#ad-email').addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
  $$('.ad-del').forEach((b) => {
    b.onclick = async () => {
      const email = b.dataset.e;
      if (!confirm(`確定移除 ${email} 的管理權限？`)) return;
      try {
        await store.removeAdmin(email);
        toast(`已移除 ${email}`);
        renderAdminAdmins();
      } catch (e) {
        console.error(e);
        toast('移除失敗：' + saveErrorText(e));
      }
    };
  });
}

/* ---------- 路由 ---------- */
// admin 不在底部分頁列，只能從網址 #admin 或「我的」的管理頁按鈕進入
const PAGES = { heroes: renderHeroes, new: renderNew, me: renderMe, rank: renderRank, admin: renderAdmin };

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

// 先讀管理頁存過的武將資料，沒有（或讀不到）就用 data/heroes.json
async function loadHeroes() {
  let list = null;
  try {
    list = await store.loadHeroes();
  } catch (e) {
    console.error(e);
  }
  state.heroSource = list ? 'db' : 'file';
  if (!list) {
    try {
      const data = await (await fetch('data/heroes.json', { cache: 'no-cache' })).json();
      list = data.heroes || data;
    } catch (e) {
      console.error(e);
      toast('武將資料載入失敗');
      list = [];
    }
  }
  state.heroes = list.map(normalizeHero);
}

async function main() {
  const useFirebase = firebaseConfig.apiKey && firebaseConfig.apiKey !== 'PASTE_ME';
  try {
    store = useFirebase ? await createFirebaseStore() : createLocalStore();
  } catch (e) {
    console.error(e);
    store = createLocalStore();
    toast('Firebase 載入失敗，先用本機模式');
  }
  await loadHeroes();

  $$('.tabbar button').forEach((b) => { b.onclick = () => { go(b.dataset.tab); window.scrollTo(0, 0); }; });
  state.tab = PAGES[location.hash.slice(1)] ? location.hash.slice(1) : 'heroes';
  // 手動改網址的 #（例如打 #admin）也能切頁
  window.addEventListener('hashchange', () => {
    const t = location.hash.slice(1);
    if (PAGES[t] && t !== state.tab) { state.tab = t; render(); }
  });

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
