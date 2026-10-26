import { firebaseConfig } from './firebase-config.js';

/* ---------- 小工具 ---------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (w, n) => (n ? Math.round((w / n) * 100) + '%' : '-');
const view = $('#view');

// action = { label, run }：例如「復原」，有動作的提示會停久一點
function toast(msg, action) {
  const t = $('#toast');
  t.textContent = msg;
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'toast-act';
    b.textContent = action.label;
    b.onclick = () => { t.classList.remove('show'); clearTimeout(toast._t); action.run(); };
    t.append(b);
  }
  t.classList.toggle('has-action', !!action);
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), action ? 6000 : 2400);
}
// 把資料庫的錯誤代碼換成白話
function errText(e) {
  const code = e?.code || '';
  if (code.includes('permission-denied')) return '沒有權限，可能登入過期了，重新整理後再試';
  if (code.includes('unavailable') || code.includes('network') || !navigator.onLine) return '連不上資料庫，檢查網路後再試一次';
  if (code.includes('unauthenticated')) return '登入過期了，請重新登入';
  return e?.message || code || '發生未知錯誤';
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

function countText(n) {
  const [a, b, c, d] = TABLE[n];
  return `${n} 人局：主公 ${a}、忠臣 ${b}、反賊 ${c}、內奸 ${d}`;
}
// 各方怎樣算贏（給新手看的白話版）
const SIDE_GOAL = {
  主公方: '主公＋忠臣：反賊和內奸都出局就贏',
  反賊: '主公出局就贏',
  內奸: '其他人都出局、最後單挑贏主公',
};
// 技能說明裡常見、新手看不懂的名詞（用自己的話寫的白話解釋）
const GLOSSARY = [
  ['殺', '基本牌。對攻擊範圍內一個人使用，對方沒出【閃】就扣 1 血。一般每回合只能出一張。'],
  ['閃', '基本牌。有人對你出【殺】時打出來，這張【殺】就沒效。'],
  ['桃', '基本牌。在自己回合可以回 1 血；有人快死時也能拿來救他。'],
  ['決鬥', '錦囊牌。兩人輪流打出【殺】，先拿不出來的人扣 1 血。'],
  ['無懈可擊', '錦囊牌。讓一張錦囊牌失效。'],
  ['南蠻入侵', '錦囊牌。其他每個人都要打出一張【殺】，打不出就扣 1 血。'],
  ['萬箭齊發', '錦囊牌。其他每個人都要打出一張【閃】，打不出就扣 1 血。'],
  ['樂不思蜀', '延時錦囊。輪到對方時先翻一張牌，不是紅心的話，他這回合就不能出牌。'],
  ['判定', '從牌堆頂翻一張牌，看花色或點數決定結果。'],
  ['出牌階段', '你的回合裡可以出牌、發動技能的那段時間。'],
  ['攻擊範圍', '【殺】打得到的距離。一開始是 1，裝備武器可以變遠。'],
  ['主公技', '只有你當主公時才有的技能。'],
  ['鎖定技', '一定會生效的技能，不能選擇不用。'],
  ['限定技', '整局只能用一次的技能。'],
  ['手牌', '拿在手上、別人看不到的牌。'],
];
function glossaryFor(text) {
  return GLOSSARY.filter(([term]) => text.includes(term));
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
// 難度用中性的 ●○○ 刻度，不借勢力或身份的顏色
const diffTag = (d) => (DIFF[d] ? `<span class="tag diff"><b aria-hidden="true">${'●'.repeat(d)}${'○'.repeat(3 - d)}</b>${DIFF[d]}</span>` : '');
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
const SEAT_CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
const ID_SHORT = { 主公: '主', 忠臣: '忠', 反賊: '反', 內奸: '內' };
const STEPS = ['入座', '武將', '亮身份'];

const state = {
  tab: 'heroes',
  heroId: null, // 武將詳情頁（#heroes/<id>）
  heroScroll: 0,
  heroes: [],
  q: '',
  faction: '全部',
  easyOnly: false,
  // 比較：只放在記憶體，不寫進網址或 localStorage，重新整理就清掉（選將是暗的）
  cmpPicks: {}, // 一個名字符合好幾位時，使用者點選的那位：{ 名字: heroId }
  cmpSel: 0,
  users: [],
  games: null,
  minGames: 1,
  rankTab: 'players',
  lastDraft: null, // 剛存的那局的草稿，撤銷時還原
  draft: loadDraft(),
  justSaved: null, // 剛存好的那局，顯示「已記錄」畫面
  heroSource: 'file', // 'db' = 管理頁存過的資料，'file' = data/heroes.json
  admin: { tab: 'heroes', q: '', editing: null, isNew: false, upload: { text: '', mode: 'merge' } },
};

// 身份預設「未定」，結算時才亮
function newDraft(count) {
  return { count, step: 1, seats: Array.from({ length: count }, () => ({ uid: '', name: '', hero: '', identity: '' })), winner: '', note: '' };
}
// 讀回上次沒存完的開局（舊版草稿沒有 step，補成第 1 步）
function loadDraft() {
  const d = ls.get('sgs_draft', null);
  if (!d || !TABLE[d.count] || !Array.isArray(d.seats) || d.seats.length !== d.count) return newDraft(5);
  d.step = [1, 2, 3].includes(d.step) ? d.step : 1;
  d.seats = d.seats.map((s) => ({ uid: str(s.uid), name: str(s.name), hero: str(s.hero), identity: IDENTITIES.includes(s.identity) ? s.identity : '' }));
  return d;
}
const saveDraft = () => ls.set('sgs_draft', state.draft);
const heroByName = (name) => {
  if (!name) return null;
  const n = name.trim();
  return state.heroes.find((h) => h.name === n || (h.aliases || []).includes(n)) || null;
};
const userName = (uid) => state.users.find((u) => u.uid === uid)?.name;
const seatName = (s) => (s.uid === '__guest' ? s.name.trim() : userName(s.uid) || '');
const seatFilled = (s) => !!s.uid && !!seatName(s);

async function ensureData(force = false) {
  if (force || !state.games) {
    const [games, users] = await Promise.all([store.listGames(), store.listUsers()]);
    state.games = games;
    state.users = users;
  }
}

/* ---------- 共用元件 ---------- */
const pctNum = (w, n) => (n ? Math.round((w / n) * 100) : 0);
const pageHead = (title, extra = '') => `<div class="page-head"><h2>${title}</h2>${extra}</div>`;
const seal = (f, cls = '') => `<span class="seal f-${esc(f)} ${cls}">${esc(f || '？')}</span>`;
function hpHtml(hp) {
  const n = Math.max(0, Math.min(10, hp | 0));
  return `<span class="hp" role="img" aria-label="${n} 血">${'<i></i>'.repeat(n)}</span>`;
}
function avatarHtml(u, cls = '') {
  if (u.photo) return `<img class="avatar ${cls}" src="${esc(u.photo)}" alt="" referrerpolicy="no-referrer">`;
  return `<span class="avatar ${cls}">${esc((u.name || '？').slice(0, 1))}</span>`;
}

function renderUser() {
  const u = store.user;
  const badge = store.mode === 'local' ? '<span class="badge">本機模式</span>' : '';
  $('#user-area').innerHTML = u
    ? `${badge}<button class="user-btn" id="top-me">${avatarHtml(u)}<span>${esc(u.name)}</span></button>`
    : `${badge}<button class="btn small gold" id="top-login">登入</button>`;
  ($('#top-login') || $('#top-me')).onclick = () => { go('me'); window.scrollTo(0, 0); };
}

function loginBox(msg) {
  return `<div class="card">
    <p>${msg}</p>
    ${store.mode === 'local'
      ? `<p class="muted">目前是本機模式（還沒填 Firebase 設定），先用暱稱模擬登入，資料只存在這支手機。</p>
         <input id="nick" placeholder="輸入暱稱" aria-label="暱稱" maxlength="20"><div style="height:8px"></div>
         <button class="btn" id="login-btn">登入</button>`
      : '<button class="btn" id="login-btn">用 Google 登入</button>'}
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
    <div class="game-top">
      <span class="date">${fmtDate(g.createdAt)}</span>
      <span class="muted">${g.playerCount} 人</span>
      <span class="side-tag side-${esc(g.winner)}">${esc(g.winner)}勝</span>
      ${mine ? `<span class="mine">${esc(mine.identity)}<span class="stamp ${mine.win ? '' : 'lose'}">${mine.win ? '勝' : '負'}</span></span>` : ''}
    </div>
    <div class="seat-chips">${g.seats.map((s) => `<span class="schip id-${esc(s.identity)} ${s.win ? 'w' : ''}"><i>${ID_SHORT[s.identity] || '？'}</i><span>${esc(s.uid ? userName(s.uid) || s.name : s.name)}${s.hero ? ` <small>${esc(s.hero)}</small>` : ''}</span></span>`).join('')}</div>
    ${g.note ? `<div class="game-note">「${esc(g.note)}」</div>` : ''}
    ${canDelete ? `<details class="more"><summary>更多</summary><button class="btn danger small del" data-id="${esc(g.id)}" data-label="${esc(fmtDate(g.createdAt))}・${esc(g.winner)}勝">刪除這局</button></details>` : ''}
  </div>`;
}
function bindDelete() {
  $$('.del').forEach((b) => {
    b.onclick = async () => {
      if (!confirm(`確定刪除 ${b.dataset.label} 這一局？刪除後所有人的戰績都會少掉這局，不能復原。`)) return;
      b.disabled = true;
      try {
        await store.deleteGame(b.dataset.id);
        state.games = null;
        toast('已刪除這局');
        render();
      } catch (e) { console.error(e); toast('刪除失敗：' + errText(e)); b.disabled = false; }
    };
  });
}

// 一局的結果列表（開局結算預覽、存好後的畫面共用）
function resultList(seats) {
  return `<div class="result-list">${seats.map((s, i) => `<div class="result-row ${s.win ? '' : 'lost'}">
      <span class="no">${SEAT_CN[i]}</span>
      <span class="who"><b>${esc(s.name || '（未填）')}</b>${s.hero ? `<small>${esc(s.hero)}</small>` : ''}</span>
      <span class="idtag id-${esc(s.identity)}">${esc(s.identity)}</span>
      <span class="stamp ${s.win ? '' : 'lose'}">${s.win ? '勝' : '負'}</span>
    </div>`).join('')}</div>`;
}

/* ---------- 頁面：武將 ---------- */
function heroMatch(h, q) {
  if (!q) return true;
  q = q.toLowerCase();
  return [h.name, h.title, h.version, ...(h.aliases || []), ...(h.skills || []).map((s) => s.name)].some((s) => s && s.toLowerCase().includes(q));
}
// 一次打好幾個名字（空格、逗號、頓號隔開）就是比較模式
const CMP_MAX = 5;
const splitTerms = (q) => str(q).split(/[\s,，、/／;；]+/).filter(Boolean);
const isCompareQuery = () => splitTerms(state.q).length >= 2;
function compareSet() {
  const terms = [...new Set(splitTerms(state.q))];
  const found = [];
  const ambiguous = [];
  const missing = [];
  for (const t of terms) {
    const lt = t.toLowerCase();
    // 名字或別名完全相同的優先（「關羽」不會連界關羽、謀關羽一起抓）
    const exact = state.heroes.filter((h) => h.name.toLowerCase() === lt || h.aliases.some((a) => a.toLowerCase() === lt));
    const cands = exact.length ? exact : state.heroes.filter((h) => heroMatch(h, t));
    if (!cands.length) { missing.push(t); continue; }
    const pick = cands.length === 1 ? cands[0] : cands.find((h) => h.id === state.cmpPicks[t]);
    if (cands.length > 1) ambiguous.push({ term: t, cands, pick });
    if (pick && !found.includes(pick)) found.push(pick);
  }
  return { heroes: found.slice(0, CMP_MAX), over: found.length > CMP_MAX, ambiguous, missing };
}
function clearCompare() {
  state.q = '';
  state.cmpPicks = {};
  state.cmpSel = 0;
}
function filteredHeroes() {
  const q = state.q.trim();
  return state.heroes.filter((h) => (state.faction === '全部' || h.faction === state.faction)
    && (!state.easyOnly || h.difficulty === 1)
    && heroMatch(h, q));
}
function heroTile(h) {
  return `<a class="hcard f-${esc(h.faction)}" href="#heroes/${encodeURIComponent(h.id)}">
    <div class="hcard-top">${seal(h.faction)}<div class="hcard-name"><b>${esc(h.name)}</b><span>${esc(h.version)}${h.title ? '・' + esc(h.title) : ''}</span></div></div>
    ${hpHtml(h.hp)}
    <p class="hcard-tag">${esc(h.tagline)}</p>
    <div class="hcard-foot">${diffTag(h.difficulty)}</div>
  </a>`;
}
function renderHeroList() {
  const multi = isCompareQuery();
  $('.filters').classList.toggle('cmp-mode', multi);
  if (multi) { renderCompareList(); return; }
  $('#cmp-note').innerHTML = '';
  $('#cmp-bar').innerHTML = '';
  const list = filteredHeroes();
  const box = $('#hero-list-box');
  const q = state.q.trim();
  const filtered = state.faction !== '全部' || state.easyOnly;
  const filterName = [state.faction !== '全部' ? state.faction : '', state.easyOnly ? '新手友善' : ''].filter(Boolean).join('＋');
  const hiddenByFilter = filtered && state.heroes.some((h) => heroMatch(h, q));
  box.innerHTML = list.length
    ? list.map(heroTile).join('')
    : `<div class="empty" style="grid-column:1/-1">${hiddenByFilter
      ? `「${esc(filterName)}」裡沒有${q ? `「${esc(q)}」` : '武將'}。<br><button class="link-btn clear-filter">改看全部武將</button>`
      : `找不到「${esc(q)}」。試試別名、簡體字，或少打幾個字`}</div>`;
  $('#hero-count').innerHTML = filtered
    ? `顯示 ${list.length}／${state.heroes.length} 位（${esc(filterName)}）<button class="link-btn clear-filter">清除篩選</button>`
    : `${list.length} 位${q ? '' : '<span class="cmp-hint">拿到幾位要選一位？一次打幾個名字，用空格隔開就能比較</span>'}`;
  $$('.clear-filter').forEach((b) => {
    b.onclick = () => {
      state.faction = '全部';
      state.easyOnly = false;
      $$('.fbtn').forEach((x) => { x.classList.toggle('on', x.dataset.f === '全部'); x.setAttribute('aria-pressed', x.dataset.f === '全部'); });
      $('#easy').classList.remove('on');
      $('#easy').setAttribute('aria-pressed', 'false');
      renderHeroList();
    };
  });
  // 記下捲動位置，從詳情頁回來時回到原處
  $$('.hcard', box).forEach((a) => { a.addEventListener('click', () => { state.heroScroll = window.scrollY; }); });
}
// 比較模式的列表：每個名字對到一位武將，下面固定「比較這 N 位」
function renderCompareList() {
  const c = compareSet();
  const box = $('#hero-list-box');
  box.innerHTML = c.heroes.length
    ? c.heroes.map(heroTile).join('')
    : '<div class="empty" style="grid-column:1/-1">這幾個名字都沒找到，檢查一下有沒有打錯</div>';
  $('#hero-count').innerHTML = `比較模式：找到 ${c.heroes.length} 位<button class="link-btn" id="cmp-reset">清除</button>`;
  $('#cmp-note').innerHTML = [
    ...c.ambiguous.map((a) => `<div class="cmp-note">
      <p>「${esc(a.term)}」符合 ${a.cands.length} 位，${a.pick ? '比較的是：' : '點一位加入比較：'}</p>
      <div class="chips">${a.cands.map((h) => `<button class="chip cmp-pick ${a.pick === h ? 'on' : ''}" data-term="${esc(a.term)}" data-id="${esc(h.id)}" aria-pressed="${a.pick === h}">${esc(h.name)}</button>`).join('')}</div>
    </div>`),
    ...c.missing.map((t) => `<p class="cmp-miss">找不到「${esc(t)}」<span class="muted">・圖鑑目前收 ${state.heroes.length} 位</span></p>`),
    c.over ? `<p class="cmp-miss">一次最多比 ${CMP_MAX} 位，先比前 ${CMP_MAX} 位</p>` : '',
  ].join('');
  $('#cmp-bar').innerHTML = c.heroes.length >= 2
    ? `<div class="actionbar"><button class="btn" id="go-cmp">比較這 ${c.heroes.length} 位 ›</button></div>`
    : c.heroes.length === 1 ? '<p class="muted cmp-more">再打一個名字就能比較</p>' : '';
  $$('.cmp-pick').forEach((b) => {
    b.onclick = () => { state.cmpPicks[b.dataset.term] = b.dataset.id; renderCompareList(); };
  });
  $('#cmp-reset').onclick = () => {
    clearCompare();
    $('#q').value = '';
    renderHeroList();
    $('#q').focus();
  };
  $('#go-cmp')?.addEventListener('click', openCompare);
  $$('.hcard', box).forEach((a) => { a.addEventListener('click', () => { state.heroScroll = window.scrollY; }); });
}
function openCompare() {
  state.heroScroll = window.scrollY;
  state.cmpSel = 0;
  location.hash = 'compare';
}
function renderHeroes() {
  if (state.heroId) { renderHeroDetail(); return; }
  const factions = ['全部', ...FACTIONS];
  view.innerHTML = `
    ${pageHead('武將圖鑑')}
    <div class="filters">
      <input id="q" type="search" enterkeyhint="search" aria-label="搜尋武將" placeholder="搜尋武將，比較多位用空格隔開" value="${esc(state.q)}" autocomplete="off">
      <div class="chips scroll-x" role="group" aria-label="篩選">
        ${factions.map((f) => `<button class="chip fbtn f-${f} ${f === state.faction ? 'on' : ''}" data-f="${f}" aria-pressed="${f === state.faction}">${f === '全部' ? '' : '<span class="dot"></span>'}${f}</button>`).join('')}
        <button class="chip ${state.easyOnly ? 'on' : ''}" id="easy" aria-pressed="${state.easyOnly}">新手友善</button>
      </div>
    </div>
    <p class="muted" style="margin:-4px 0 10px" id="hero-count"></p>
    <div id="cmp-note"></div>
    <div id="hero-list-box" class="hgrid"></div>
    <div id="cmp-bar"></div>`;
  $('#q').addEventListener('input', (e) => { state.q = e.target.value; renderHeroList(); });
  // Enter：比較模式就打開比較；只剩一位時直接打開那位
  $('#q').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    if (isCompareQuery()) {
      if (compareSet().heroes.length >= 2) { e.target.blur(); openCompare(); }
      return;
    }
    const list = filteredHeroes();
    if (list.length === 1) location.hash = 'heroes/' + encodeURIComponent(list[0].id);
  });
  $$('.fbtn').forEach((b) => {
    b.onclick = () => {
      state.faction = b.dataset.f;
      $$('.fbtn').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); });
      renderHeroList();
    };
  });
  $('#easy').onclick = (e) => {
    state.easyOnly = !state.easyOnly;
    e.currentTarget.classList.toggle('on', state.easyOnly);
    e.currentTarget.setAttribute('aria-pressed', state.easyOnly);
    renderHeroList();
  };
  renderHeroList();
}
function renderHeroDetail() {
  const h = state.heroes.find((x) => x.id === state.heroId);
  if (!h) {
    view.innerHTML = '<a class="back" href="#heroes">‹ 武將圖鑑</a><div class="empty">找不到這位武將，可能已經被移除了</div>';
    return;
  }
  view.innerHTML = `
    <a class="back" href="#heroes" id="back">‹ 武將圖鑑</a>
    <article class="hdetail f-${esc(h.faction)}">
      <header class="hd-head">
        ${seal(h.faction, 'big')}
        <div style="min-width:0">
          <div class="hd-ver">${esc(h.version)}${h.title ? '・' + esc(h.title) : ''}</div>
          <h2 class="hd-name">${esc(h.name)}</h2>
          <div class="hd-hp">${hpHtml(h.hp)}<span>${h.hp | 0} 血</span></div>
        </div>
      </header>
      <div class="hd-body">
        <p class="hd-tag">${esc(h.tagline)}</p>
        <div class="chips">${diffTag(h.difficulty)}${(h.roles || []).filter((r) => !(h.difficulty === 1 && r === '新手推薦')).map((r) => `<span class="tag">${esc(r)}</span>`).join('')}</div>
      </div>
    </article>
    <div class="sec">技能<span class="muted">白話翻譯</span></div>
    ${skillsHtml(h)}
    ${h.aliases?.length ? `<p class="muted aliases">也叫：${h.aliases.map(esc).join('、')}</p>` : ''}`;
  bindBack();
}
// 技能卡＋看不懂的名詞（詳情頁、比較頁共用）
function skillsHtml(h) {
  const terms = glossaryFor([h.tagline, ...h.skills.flatMap((s) => [s.plain, s.tip])].join(' '));
  return `${h.skills.map((s) => `<section class="skill">
      <h3 class="skill-name">${esc(s.name)}</h3>
      <p>${esc(s.plain)}</p>
      ${s.tip ? `<div class="tip"><b>訣竅</b>${esc(s.tip)}</div>` : ''}
    </section>`).join('')}
    ${terms.length ? `<details class="card glossary">
      <summary>看不懂的名詞：${terms.map(([t]) => esc(t)).join('、')}</summary>
      <dl>${terms.map(([t, d]) => `<dt>${esc(t)}</dt><dd>${esc(d)}</dd>`).join('')}</dl>
    </details>` : ''}`;
}
// 從列表點進來的就用瀏覽器返回，列表會停在原本的位置
function bindBack() {
  $('#back').onclick = (e) => {
    if (state.cameFromList) { e.preventDefault(); history.back(); }
  };
}

/* ---------- 頁面：比較（拿到幾位武將要選一位時用） ---------- */
function renderCompare() {
  const { heroes } = compareSet();
  const back = '<a class="back" href="#heroes" id="back">‹ 武將圖鑑</a>';
  if (heroes.length < 2) {
    view.innerHTML = `${back}${pageHead('比較武將')}
      <div class="empty">還沒有要比較的武將。<br>在圖鑑的搜尋框一次打幾個名字，用空格隔開。
        <p class="muted">比較的內容不會存檔，重新整理就會清掉。</p>
        <a class="btn secondary small" href="#heroes">回武將圖鑑</a></div>`;
    bindBack();
    return;
  }
  const sel = Math.min(state.cmpSel, heroes.length - 1);
  // 最好上手：只有大家難度不一樣時才說
  const easiest = Math.min(...heroes.map((x) => x.difficulty || 9));
  const easy = heroes.filter((x) => x.difficulty === easiest);
  const easyLine = DIFF[easiest] && easy.length < heroes.length
    ? `<p class="cmp-easy">最好上手：<b>${easy.map((x) => esc(x.name)).join('、')}</b><span class="muted">（${DIFF[easiest]}）</span></p>`
    : '';
  view.innerHTML = `${back}
    ${pageHead(`比較${['', '', '兩', '三', '四', '五'][heroes.length]}位`)}
    <div class="cmp-list">${heroes.map((x, i) => `<button class="cmp-row f-${esc(x.faction)} ${i === sel ? 'on' : ''}" data-i="${i}" aria-pressed="${i === sel}">
        ${seal(x.faction)}
        <span class="cmp-name"><b>${esc(x.name)}</b><small>${esc(x.version)}${x.title ? '・' + esc(x.title) : ''}</small></span>
        <span class="cmp-meta">${hpHtml(x.hp)}${diffTag(x.difficulty)}</span>
        <span class="cmp-tag">${esc(x.tagline)}</span>
      </button>`).join('')}</div>
    ${easyLine}
    <div class="cmp-switch"><div class="seg" role="tablist" aria-label="看哪一位的技能">${heroes.map((x, i) => `<button role="tab" id="cmp-tab-${i}" class="${i === sel ? 'on' : ''}" data-i="${i}" aria-selected="${i === sel}" aria-controls="cmp-panel">${esc(x.name)}</button>`).join('')}</div></div>
    <div id="cmp-panel" role="tabpanel"></div>
    <div class="cmp-end">
      <button class="btn secondary" id="cmp-clear">看完了，清除這次比較</button>
      <p class="muted">比較的內容只在這支手機的這個畫面，不會存檔，也不會出現在戰績裡。</p>
    </div>`;
  showCompareHero(sel, false);
  $$('.cmp-row').forEach((b) => { b.onclick = () => showCompareHero(+b.dataset.i, true); });
  $$('.cmp-switch [role=tab]').forEach((b) => { b.onclick = () => showCompareHero(+b.dataset.i, false); });
  // 左右鍵切換分頁（tablist 的標準操作）
  $('.cmp-switch .seg').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const n = heroes.length;
    const i = (state.cmpSel + (e.key === 'ArrowRight' ? 1 : n - 1)) % n;
    showCompareHero(i, false);
    $(`#cmp-tab-${i}`).focus();
  });
  $('#cmp-clear').onclick = () => {
    clearCompare();
    go('heroes');
    window.scrollTo(0, 0);
    toast('已清除這次比較');
  };
  bindBack();
}
// 切換要看哪一位的技能；jump = 從上面的摘要點的，捲到技能那裡
function showCompareHero(i, jump) {
  const heroes = compareSet().heroes;
  const h = heroes[i];
  if (!h) return;
  state.cmpSel = i;
  $$('.cmp-row').forEach((b, j) => { b.classList.toggle('on', j === i); b.setAttribute('aria-pressed', j === i); });
  $$('.cmp-switch [role=tab]').forEach((b, j) => {
    b.classList.toggle('on', j === i);
    b.setAttribute('aria-selected', j === i);
    b.tabIndex = j === i ? 0 : -1;
  });
  const panel = $('#cmp-panel');
  panel.setAttribute('aria-labelledby', `cmp-tab-${i}`);
  panel.innerHTML = `<div class="sec">${esc(h.name)}的技能<span class="muted">白話翻譯</span></div>${skillsHtml(h)}`;
  // 切換列已經黏在頂部時（往下看過技能），換人後回到技能開頭
  const sw = $('.cmp-switch');
  const stuckAt = $('.topbar').offsetHeight + sw.offsetHeight;
  const panelTop = panel.getBoundingClientRect().top;
  if (jump || panelTop < stuckAt) {
    window.scrollTo({ top: window.scrollY + panelTop - stuckAt, behavior: jump ? 'smooth' : 'auto' });
  }
}

/* ---------- 頁面：開局（三步驟：入座 → 武將 → 亮身份） ---------- */
// 實體身份局裡身份要到最後才亮，所以開打前只記座位和武將，身份在結算時才填。
function stepper(step) {
  return `<ol class="stepper">${STEPS.map((t, i) => {
    const n = i + 1;
    const cls = n < step ? 'done' : n === step ? 'cur' : '';
    const inner = `<span>${n}</span>${t}`;
    return `<li class="${cls}">${n < step
      ? `<button type="button" data-step="${n}" aria-label="回到第 ${n} 步：${t}">${inner}</button>`
      : `<div ${n === step ? 'aria-current="step"' : ''}>${inner}</div>`}</li>`;
  }).join('')}</ol>`;
}
// 固定在分頁列上方的主要按鈕，內容再長都按得到
const actionBar = (prev, next, disabled = false) => `<div class="actionbar ${prev ? 'two' : ''}">
    ${prev ? `<button class="btn secondary" id="prev">${prev}</button>` : ''}
    <button class="btn" id="next" ${disabled ? 'disabled' : ''}>${next}</button>
  </div>`;

function setStep(n) {
  state.draft.step = n;
  saveDraft();
  renderNew();
  window.scrollTo(0, 0);
}
// 重畫但留在原本的捲動位置（點身份、選獲勝方時用）
function rerenderKeepScroll() {
  const y = window.scrollY;
  renderNew().then(() => window.scrollTo(0, y));
}
// 各身份目前人數 vs 標準配置
function identityCheck(d) {
  const need = TABLE[d.count];
  return IDENTITIES.map((id, i) => ({ id, need: need[i], have: d.seats.filter((s) => s.identity === id).length }));
}
function sideMembers(d, side) {
  return d.seats.map((s, i) => (s.identity && isWin(s.identity, side) ? `${SEAT_CN[i]}・${seatName(s)}` : null)).filter(Boolean);
}
// 最近用過的訪客名字，下次直接出現在玩家清單
const recentGuests = () => ls.get('sgs_guests', []);
function rememberGuests(names) {
  const list = [...new Set([...names, ...recentGuests()])].slice(0, 12);
  ls.set('sgs_guests', list);
}

async function renderNew() {
  if (!store.user) {
    view.innerHTML = pageHead('開局') + loginBox('登入後才能記錄對局。');
    bindLogin();
    return;
  }
  if (!state.games) view.innerHTML = '<div class="empty">正在讀取玩家名單…</div>';
  await ensureData();
  if (state.justSaved) { renderSaved(); return; }

  const d = state.draft;
  if (d.step > 1 && !d.seats.every(seatFilled)) d.step = 1;
  const body = d.step === 1 ? newStep1(d) : d.step === 2 ? newStep2(d) : newStep3(d);
  view.innerHTML = pageHead('開局') + stepper(d.step) + body;
  $$('.stepper [data-step]').forEach((b) => { b.onclick = () => setStep(+b.dataset.step); });
  if (d.step === 1) bindStep1(d);
  else if (d.step === 2) bindStep2(d);
  else bindStep3(d);
}

/* 第 1 步：人數 + 入座 */
function newStep1(d) {
  const me = store.user.uid;
  const seated = new Set(d.seats.map((s) => s.uid).filter((u) => u && u !== '__guest'));
  const seatedGuests = new Set(d.seats.filter((s) => s.uid === '__guest').map((s) => s.name.trim()));
  // 常一起玩的人排前面
  const freq = new Map();
  for (const g of state.games) for (const s of g.seats) if (s.uid) freq.set(s.uid, (freq.get(s.uid) || 0) + 1);
  const pool = state.users
    .filter((u) => !seated.has(u.uid))
    .sort((a, b) => (b.uid === me) - (a.uid === me) || (freq.get(b.uid) || 0) - (freq.get(a.uid) || 0) || a.name.localeCompare(b.name, 'zh-Hant'));
  const guests = recentGuests().filter((n) => !seatedGuests.has(n));
  const firstEmpty = d.seats.findIndex((s) => !seatFilled(s));
  const filled = d.seats.filter(seatFilled).length;

  return `
    <div class="card">
      <div class="label" id="count-label">幾個人玩？</div>
      <div class="seg count" role="group" aria-labelledby="count-label">${Object.keys(TABLE).map((n) => `<button data-n="${n}" class="${+n === d.count ? 'on' : ''}" aria-pressed="${+n === d.count}">${n}</button>`).join('')}</div>
      <p class="muted" style="margin:8px 0 0">${countText(d.count)}</p>
    </div>
    <div class="card">
      <div class="label-row"><span class="label">座位 ${filled}/${d.count}</span>${filled ? '<button class="link-btn" id="clear-seats">全部清空</button>' : ''}</div>
      <div class="seat-grid">${d.seats.map((s, i) => {
        const on = seatFilled(s);
        return `<button class="seat-slot ${on ? 'on' : ''} ${i === firstEmpty ? 'next' : ''}" data-i="${i}" ${on ? `aria-label="${SEAT_CN[i]}號位 ${esc(seatName(s))}，點一下移除"` : 'disabled'}>
          <span class="no">${SEAT_CN[i]}</span><span class="nm">${on ? esc(seatName(s)) : i === firstEmpty ? '下一位' : '空位'}</span>${on ? '<span class="x" aria-hidden="true">×</span>' : ''}
        </button>`;
      }).join('')}</div>
      <p class="muted" style="margin:8px 0 0">依座位順序點下面的玩家；點已入座的人可以移除。</p>
    </div>
    <div class="card">
      <div class="label">玩家</div>
      <div class="pool">
        ${pool.map((u) => `<button class="pchip ${u.uid === me ? 'me' : ''}" data-uid="${esc(u.uid)}">${esc(u.name)}${u.uid === me ? '（我）' : ''}</button>`).join('')}
        ${guests.map((n) => `<button class="pchip guest" data-guest="${esc(n)}">${esc(n)}<small>訪客</small></button>`).join('')}
        ${!pool.length && !guests.length ? '<span class="muted">大家都入座了</span>' : ''}
      </div>
      <div class="row" style="margin:0">
        <input id="guest" placeholder="沒帳號的朋友：輸入名字" aria-label="訪客名字" maxlength="20" autocomplete="off" enterkeyhint="done">
        <button class="btn small" id="add-guest" style="flex:0 0 auto">入座</button>
      </div>
    </div>
    ${actionBar(null, filled === d.count ? '下一步：選武將 ›' : `還有 ${d.count - filled} 個空位`, filled !== d.count)}`;
}
function bindStep1(d) {
  const fill = (seat) => {
    const i = d.seats.findIndex((s) => !seatFilled(s));
    if (i < 0) { toast('座位滿了，先點座位移除某人'); return; }
    Object.assign(d.seats[i], seat);
    saveDraft();
    rerenderKeepScroll();
  };
  $$('.seg.count button').forEach((b) => {
    b.onclick = () => {
      const old = d.seats;
      const next = newDraft(+b.dataset.n);
      next.seats.forEach((s, i) => { if (old[i]) { s.uid = old[i].uid; s.name = old[i].name; s.hero = old[i].hero; } });
      state.draft = next;
      saveDraft();
      rerenderKeepScroll();
    };
  });
  // 移除和清空都可以在 6 秒內復原（單手誤觸很常見）
  const undoable = (msg, change) => {
    const before = structuredClone(d.seats);
    change();
    saveDraft();
    rerenderKeepScroll();
    toast(msg, { label: '復原', run: () => {
      if (state.draft !== d) return;
      d.seats = before;
      saveDraft();
      rerenderKeepScroll();
    } });
  };
  $$('.seat-slot.on').forEach((b) => {
    b.onclick = () => {
      const s = d.seats[+b.dataset.i];
      const name = seatName(s);
      undoable(`已把 ${name} 移出座位`, () => Object.assign(s, { uid: '', name: '', hero: '', identity: '' }));
    };
  });
  $$('.pchip[data-uid]').forEach((b) => { b.onclick = () => fill({ uid: b.dataset.uid, name: '' }); });
  $$('.pchip[data-guest]').forEach((b) => { b.onclick = () => fill({ uid: '__guest', name: b.dataset.guest }); });
  const addGuest = () => {
    const name = $('#guest').value.trim();
    if (!name) { toast('請先輸入名字'); return; }
    if (d.seats.some((s) => seatFilled(s) && seatName(s) === name)) { toast(`「${name}」已經在座位上了`); return; }
    fill({ uid: '__guest', name });
  };
  $('#add-guest').onclick = addGuest;
  $('#guest').addEventListener('keydown', (e) => { if (e.key === 'Enter') addGuest(); });
  $('#clear-seats')?.addEventListener('click', () => {
    undoable('座位已全部清空', () => d.seats.forEach((s) => Object.assign(s, { uid: '', name: '', hero: '', identity: '' })));
  });
  $('#next').onclick = () => setStep(2);
}

/* 第 2 步：武將（公開資訊，開打前記） */
function heroPickLabel(s) {
  const h = heroByName(s.hero);
  if (h) return `${seal(h.faction, 'sm')}<span>${esc(h.name)}</span>`;
  if (s.hero) return `<span class="seal sm unknown" aria-hidden="true">？</span><span>${esc(s.hero)}</span>`;
  return '<span class="pick-empty">選武將</span>';
}
function newStep2(d) {
  return `
    <div class="label-row"><span class="label">每個人拿哪位武將？</span><button class="link-btn" id="rand-hero">隨機抽武將</button></div>
    <div class="card seat-list">${d.seats.map((s, i) => `<div class="hero-seat">
        <span class="no">${SEAT_CN[i]}</span>
        <span class="nm">${esc(seatName(s))}</span>
        <button class="hero-pick ${s.hero ? 'on' : ''}" data-i="${i}" aria-label="${SEAT_CN[i]}號位 ${esc(seatName(s))} 的武將：${s.hero ? esc(s.hero) : '還沒選'}">${heroPickLabel(s)}</button>
      </div>`).join('')}</div>
    <p class="muted">武將可以不填。身份等打完再亮，下一步才記。</p>
    ${actionBar('‹ 上一步', '開打！')}`;
}
function bindStep2(d) {
  $$('.hero-pick').forEach((b) => { b.onclick = () => openHeroSheet(d, +b.dataset.i); });
  $('#rand-hero').onclick = () => {
    const pool = shuffle(state.heroes.filter((h) => h.difficulty <= 2));
    if (!pool.length) { toast('圖鑑裡沒有可以抽的武將'); return; }
    d.seats.forEach((s, i) => { s.hero = pool[i % pool.length].name; });
    saveDraft();
    renderNew();
    toast('已幫每人抽一位（排除進階武將）');
  };
  $('#prev').onclick = () => setStep(1);
  $('#next').onclick = () => setStep(3);
}

// 從底部彈出的武將選單：印章格子、可搜尋、可依勢力篩選
function openHeroSheet(d, i) {
  const s = d.seats[i];
  let q = '';
  let f = '全部';
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" tabindex="-1">
      <div class="sheet-head">
        <b id="sheet-title">${SEAT_CN[i]}號位・${esc(seatName(s))}</b>
        <button class="link-btn" data-close>關閉</button>
      </div>
      <input type="search" id="sheet-q" placeholder="搜尋武將或別名" aria-label="搜尋武將" autocomplete="off" enterkeyhint="search">
      <div class="chips scroll-x" role="group" aria-label="勢力">${['全部', ...FACTIONS].map((x) => `<button class="chip f-${x} ${x === f ? 'on' : ''}" data-f="${x}" aria-pressed="${x === f}">${x === '全部' ? '' : '<span class="dot"></span>'}${x}</button>`).join('')}</div>
      <div class="sheet-grid" id="sheet-grid"></div>
      ${s.hero ? '<button class="btn secondary" id="sheet-clear">清除這位的武將</button>' : ''}
    </div>`;
  document.body.appendChild(wrap);
  document.body.classList.add('sheet-open');
  const sheet = $('.sheet', wrap);
  const grid = $('#sheet-grid', wrap);

  const close = () => {
    wrap.remove();
    document.body.classList.remove('sheet-open');
    document.removeEventListener('keydown', onKey);
    $(`.hero-pick[data-i="${i}"]`)?.focus();
  };
  const choose = (name) => {
    s.hero = name;
    saveDraft();
    close();
    renderNew().then(() => $(`.hero-pick[data-i="${i}"]`)?.focus());
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { close(); return; }
    if (e.key !== 'Tab') return;
    const items = $$('button, input', sheet).filter((x) => x.offsetParent !== null);
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === sheet)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  const draw = () => {
    const query = q.trim();
    const list = state.heroes.filter((h) => (f === '全部' || h.faction === f) && heroMatch(h, query));
    const exact = list.some((h) => h.name === query || h.aliases.includes(query));
    grid.innerHTML = list.map((h) => `<button class="pick f-${esc(h.faction)} ${heroByName(s.hero)?.id === h.id ? 'on' : ''}" data-name="${esc(h.name)}">
        ${seal(h.faction, 'sm')}<span><b>${esc(h.name)}</b><small>${esc(h.version)}</small></span></button>`).join('')
      + (query && !exact
        ? `<button class="pick free" data-name="${esc(query)}"><span class="seal sm unknown" aria-hidden="true">？</span><span><b>就用「${esc(query)}」</b><small>圖鑑裡沒有，統計會照這個名字記</small></span></button>`
        : '')
      || `<div class="empty">這個勢力還沒有武將，換一個勢力看看</div>`;
    $$('.pick', grid).forEach((b) => { b.onclick = () => choose(b.dataset.name); });
  };

  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  $('[data-close]', wrap).onclick = close;
  $('#sheet-clear', wrap)?.addEventListener('click', () => choose(''));
  $('#sheet-q', wrap).addEventListener('input', (e) => { q = e.target.value; draw(); });
  $$('.chip', wrap).forEach((b) => {
    b.onclick = () => {
      f = b.dataset.f;
      $$('.chip', wrap).forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); });
      draw();
    };
  });
  document.addEventListener('keydown', onKey);
  draw();
  sheet.focus();
}

/* 第 3 步：亮身份 + 誰贏了 */
function idCountHtml(d) {
  return identityCheck(d).map((c) => `<span class="idc id-${c.id} ${c.have > c.need ? 'bad' : c.have === c.need ? 'ok' : ''}"><i>${ID_SHORT[c.id]}</i>${c.have}/${c.need}</span>`).join('');
}
function newStep3(d) {
  const unset = d.seats.filter((s) => !s.identity).length;
  const ready = !unset && d.winner;
  const preview = d.seats.map((s) => ({ name: seatName(s), hero: heroByName(s.hero)?.name || s.hero.trim(), identity: s.identity, win: d.winner ? isWin(s.identity, d.winner) : false }));
  const saveLabel = unset ? `還有 ${unset} 人沒亮身份` : !d.winner ? '選哪一方獲勝' : '儲存這局';
  return `
    <div class="card">
      <div class="label-row"><span class="label">亮身份</span><span class="muted">${d.count - unset}/${d.count} 已亮</span></div>
      <div class="id-count" aria-label="身份人數">${idCountHtml(d)}</div>
      <div class="reveal-list">${d.seats.map((s, i) => {
        const hero = heroByName(s.hero)?.name || s.hero.trim();
        return `<div class="reveal-row" data-i="${i}">
          <span class="no">${SEAT_CN[i]}</span>
          <span class="who"><b>${esc(seatName(s))}</b>${hero ? `<small>${esc(hero)}</small>` : ''}</span>
          <div class="idpick" role="group" aria-label="${SEAT_CN[i]}號位 ${esc(seatName(s))} 的身份">${IDENTITIES.map((id) => `<button class="idbtn id-${id} ${s.identity === id ? 'on' : ''}" data-id="${id}" aria-pressed="${s.identity === id}" aria-label="${id}">${ID_SHORT[id]}</button>`).join('')}</div>
        </div>`;
      }).join('')}</div>
    </div>
    <div class="sec">哪一方獲勝？</div>
    <div class="winners">${SIDES.map((w) => {
      const who = sideMembers(d, w);
      return `<button class="win-btn side-${w} ${d.winner === w ? 'on' : ''}" data-w="${w}" aria-pressed="${d.winner === w}">
        <span class="wb-title">${w}</span>
        <span class="wb-goal">${SIDE_GOAL[w]}</span>
        <span class="wb-who">${who.length ? esc(who.join('、')) : unset ? '（身份亮完會列出成員）' : '（這局沒有人）'}</span>
      </button>`;
    }).join('')}</div>
    ${ready ? `<div class="sec">本局結果</div><div class="card">${resultList(preview)}</div>` : ''}
    <div style="height:12px"></div>
    <textarea id="note" rows="2" aria-label="備註" placeholder="備註（可不填），例如：內奸單挑主公翻盤">${esc(d.note || '')}</textarea>
    ${actionBar('‹ 上一步', saveLabel, !ready)}`;
}
function bindStep3(d) {
  $$('.reveal-row').forEach((row) => {
    const s = d.seats[+row.dataset.i];
    $$('.idbtn', row).forEach((b) => {
      b.onclick = () => {
        s.identity = s.identity === b.dataset.id ? '' : b.dataset.id; // 再點一次可取消
        saveDraft();
        rerenderKeepScroll();
      };
    });
  });
  $$('.win-btn').forEach((b) => {
    b.onclick = () => { d.winner = d.winner === b.dataset.w ? '' : b.dataset.w; saveDraft(); rerenderKeepScroll(); };
  });
  $('#note').addEventListener('input', (e) => { d.note = e.target.value; saveDraft(); });
  $('#prev').onclick = () => setStep(2);
  $('#next').onclick = saveGame;
}

async function saveGame() {
  const d = state.draft;
  const errs = [];
  const unset = d.seats.filter((s) => !s.identity).length;
  if (unset) errs.push(`還有 ${unset} 人沒亮身份`);
  else if (d.seats.filter((s) => s.identity === '主公').length !== 1) errs.push('主公要剛好 1 位，檢查一下身份');
  if (!d.winner) errs.push('請選哪一方獲勝');
  if (!unset && d.winner && !d.seats.some((s) => isWin(s.identity, d.winner))) errs.push(`這局沒有人是${d.winner}，檢查一下身份`);

  const seats = d.seats.map((s, i) => {
    const isGuest = s.uid === '__guest';
    const name = seatName(s);
    if (!name) errs.push(`${SEAT_CN[i]}號位還沒有玩家`);
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
  if (identityCheck(d).some((c) => c.have !== c.need)
    && !confirm(`身份人數跟 ${d.count} 人局的標準配置不一樣（${countText(d.count).split('：')[1]}），確定要這樣存嗎？`)) return;

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
  const btn = $('#next');
  btn.disabled = true;
  btn.textContent = '儲存中…';
  try {
    const id = await store.addGame(game);
    rememberGuests(seats.filter((s) => !s.uid).map((s) => s.name));
    // 先把下一局準備好：同一批人、直接到選武將
    const next = newDraft(d.count);
    next.step = 2;
    next.seats.forEach((s, i) => { s.uid = d.seats[i].uid; s.name = d.seats[i].name; });
    state.lastDraft = structuredClone(d); // 撤銷時可以還原
    state.draft = next;
    saveDraft();
    state.justSaved = { ...game, id };
    state.games = null;
    window.scrollTo(0, 0);
    renderNew();
  } catch (e) {
    console.error(e);
    toast('儲存失敗：' + errText(e) + '。資料還在，可以再按一次');
    btn.disabled = false;
    btn.textContent = '儲存這局';
  }
}

function renderSaved() {
  const g = state.justSaved;
  view.innerHTML = `
    ${pageHead('開局')}
    <div class="card">
      <div class="saved-head">
        <span class="stamp big" aria-hidden="true">錄</span>
        <div><div class="saved-title">本局已記錄</div><div class="muted">${g.playerCount} 人局・${esc(g.winner)}獲勝</div></div>
      </div>
      ${resultList(g.seats)}
      ${g.note ? `<div class="game-note">「${esc(g.note)}」</div>` : ''}
    </div>
    <div class="actions">
      <button class="btn" id="again">同一批人再來一局</button>
      <button class="btn secondary" id="fresh">換一批人開新局</button>
      ${g.id && state.lastDraft ? '<button class="link-btn center" id="undo-save">記錯了？撤銷這局，回去修改</button>' : ''}
    </div>`;
  $('#again').onclick = () => { state.justSaved = null; renderNew(); };
  $('#fresh').onclick = () => {
    state.justSaved = null;
    state.draft = newDraft(state.draft.count);
    saveDraft();
    renderNew();
  };
  $('#undo-save')?.addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    btn.disabled = true;
    try {
      await store.deleteGame(g.id);
      state.draft = state.lastDraft;
      state.lastDraft = null;
      saveDraft();
      state.justSaved = null;
      state.games = null;
      toast('已撤銷，可以修改後再存一次');
      renderNew();
    } catch (e) { console.error(e); toast('撤銷失敗：' + errText(e)); btn.disabled = false; }
  });
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

// 勝率條列：武將或玩家
function heroRow(h, i, rankNo) {
  const hero = heroByName(h.name);
  const lead = rankNo ? `<span class="rank-no">${i + 1}</span>` : seal(hero?.faction || '？', 'sm');
  const inner = `${lead}
    <div class="main"><b>${esc(h.name)}</b><div class="bar"><i style="width:${pctNum(h.wins, h.games)}%;background:var(--fc,var(--gold-text))"></i></div></div>
    <div class="bar-val">${pct(h.wins, h.games)}<small>${h.wins} 勝／${h.games} 場</small></div>`;
  return hero
    ? `<a class="list-row link f-${esc(hero.faction)}" href="#heroes/${encodeURIComponent(hero.id)}">${inner}</a>`
    : `<div class="list-row">${inner}</div>`;
}

/* ---------- 頁面：我的 ---------- */
async function renderMe() {
  if (!store.user) {
    view.innerHTML = pageHead('我的戰績') + loginBox('登入後可以看自己的勝率、各身份表現、最常用武將。');
    bindLogin();
    return;
  }
  if (!state.games) view.innerHTML = '<div class="empty">正在讀取你的戰績…</div>';
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
    const h = heroMap.get(s.hero) || { name: s.hero, games: 0, wins: 0 };
    h.games++;
    if (s.win) h.wins++;
    heroMap.set(s.hero, h);
  }
  const topHeroes = [...heroMap.values()].sort((a, b) => b.games - a.games || b.wins - a.wins).slice(0, 5);

  view.innerHTML = `
    ${pageHead('我的戰績')}
    <div class="card">
      <div class="profile">
        ${avatarHtml(store.user)}
        <div class="who">
          <div class="name">${esc(store.user.name)}</div>
          <div class="muted">${store.mode === 'local' ? '本機帳號' : 'Google 帳號'}</div>
        </div>
        ${store.user.isAdmin ? '<button class="btn secondary small" id="to-admin" style="flex:0 0 auto">管理頁</button>' : ''}
      </div>
    </div>

    <div class="stats">
      <div class="stat"><div class="v">${my.length}</div><div class="l">總場數</div></div>
      <div class="stat"><div class="v">${pct(wins, my.length)}</div><div class="l">勝率</div></div>
      <div class="stat"><div class="v">${streak}</div><div class="l">目前連勝</div></div>
    </div>

    <div class="sec">各身份表現</div>
    <div class="card">${byId.map((r) => `<div class="bar-row id-${r.id}">
        <span class="idtag">${r.id}</span>
        <div class="bar"><i style="width:${pctNum(r.w, r.n)}%"></i></div>
        <span class="bar-val">${pct(r.w, r.n)}<small>${r.w} 勝／${r.n} 場</small></span>
      </div>`).join('')}</div>

    <div class="sec">最常用武將</div>
    ${topHeroes.length ? `<div class="card">${topHeroes.map((h, i) => heroRow(h, i, false)).join('')}</div>` : '<div class="empty">記錄時有填武將，這裡就會出現你最常用的幾位</div>'}

    <div class="sec">最近對局${my.length > 20 ? '<span class="muted">顯示最近 20 場</span>' : ''}</div>
    ${my.length ? my.slice(0, 20).map((x) => gameCard(x.g, me)).join('') : '<div class="empty">你還沒有入座過任何一局。<br><a class="link-btn" href="#new">去開局記一場</a></div>'}

    <div class="sec">帳號</div>
    <details class="card settings">
      <summary>改暱稱、登出</summary>
      <div class="inner">
        <label class="field" for="rename"><span>暱稱（別人在開局玩家清單看到的名字）</span></label>
        <div class="row"><input id="rename" maxlength="20" value="${esc(store.user.name)}"><button class="btn secondary small" id="rename-btn" style="flex:0 0 auto">改名</button></div>
        <button class="btn danger" id="logout">登出</button>
      </div>
    </details>
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
    } catch (e) { console.error(e); toast('改名失敗：' + errText(e)); }
  };
  bindDelete();
}

/* ---------- 頁面：排行 ---------- */
// 勝率相同就同名次（例如兩個 0% 都是第 4 名）
function rankOf(list, i) {
  const rate = (p) => p.wins / p.games;
  let r = i;
  while (r > 0 && rate(list[r - 1]) === rate(list[i])) r--;
  return r + 1;
}
async function renderRank() {
  if (store.mode === 'firebase' && !store.user) {
    view.innerHTML = pageHead('排行榜') + loginBox('登入後才能看大家的戰績。');
    bindLogin();
    return;
  }
  if (!state.games) view.innerHTML = '<div class="empty">正在讀取大家的戰績…</div>';
  await ensureData();
  const total = state.games.length;
  const { players, heroes, sides } = aggregate(state.games);
  const ps = players
    .filter((p) => p.games >= state.minGames)
    .sort((a, b) => b.wins / b.games - a.wins / a.games || b.games - a.games);
  const hs = heroes.sort((a, b) => b.games - a.games || b.wins - a.wins).slice(0, 15);

  const playerList = `
    <div class="min-row"><span class="muted" id="min-label">至少打過</span>
      <div class="chips" id="min" role="group" aria-labelledby="min-label">${[1, 3, 5, 10].map((n) => `<button class="chip ${n === state.minGames ? 'on' : ''}" data-n="${n}" aria-pressed="${n === state.minGames}">${n} 場</button>`).join('')}</div>
    </div>
    ${ps.length
      ? `<div class="card">${ps.map((p, i) => {
          const rank = rankOf(ps, i);
          const isMe = store.user && p.uid === store.user.uid;
          return `<div class="list-row ${isMe ? 'me' : ''}">
          <span class="rank-no ${rank <= 3 ? 'r' + rank : ''}">${rank}</span>
          <div class="main"><b>${esc(p.name)}${isMe ? '（我）' : ''}${p.uid ? '' : ' <span class="muted" style="font-weight:400">訪客</span>'}</b><div class="bar"><i style="width:${pctNum(p.wins, p.games)}%"></i></div></div>
          <div class="bar-val">${pct(p.wins, p.games)}<small>${p.wins} 勝／${p.games} 場</small></div>
        </div>`;
        }).join('')}</div>`
      : `<div class="empty">${state.minGames > 1 ? `還沒有人打滿 ${state.minGames} 場，把門檻調低看看` : '還沒有對局紀錄'}</div>`}`;
  const heroList = hs.length
    ? `<p class="muted">依出場次數排序，前 15 名</p><div class="card">${hs.map((h, i) => heroRow(h, i, true)).join('')}</div>`
    : '<div class="empty">記錄時有填武將，這裡就會列出大家最常用的武將</div>';

  view.innerHTML = `
    ${pageHead('排行榜')}
    <div class="card">
      <div class="label-row"><span class="label">各陣營勝率</span><span class="muted">共 ${total} 局</span></div>
      <div class="stack">${SIDES.map((s) => `<i class="side-${s}" style="width:${pctNum(sides[s] || 0, total)}%"></i>`).join('')}</div>
      <div class="legend">${SIDES.map((s) => `<div class="side-${s}"><b>${pct(sides[s] || 0, total)}</b><span>${s}（${sides[s] || 0}）</span></div>`).join('')}</div>
    </div>

    <div class="seg" id="rank-tabs" role="group" aria-label="排行類別" style="margin:16px 0 12px">
      <button data-t="players" class="${state.rankTab === 'players' ? 'on' : ''}" aria-pressed="${state.rankTab === 'players'}">玩家勝率</button>
      <button data-t="heroes" class="${state.rankTab === 'heroes' ? 'on' : ''}" aria-pressed="${state.rankTab === 'heroes'}">熱門武將</button>
    </div>
    ${state.rankTab === 'players' ? playerList : heroList}

    <div class="sec">最近對局</div>
    ${state.games.slice(0, 10).map((g) => gameCard(g, store.user?.uid)).join('') || '<div class="empty">還沒有對局紀錄。<br><a class="link-btn" href="#new">去開局記第一場</a></div>'}
  `;
  $$('#rank-tabs button').forEach((b) => { b.onclick = () => { state.rankTab = b.dataset.t; renderRank(); }; });
  $$('#min button').forEach((b) => { b.onclick = () => { state.minGames = +b.dataset.n; renderRank(); }; });
  bindDelete();
}

/* ---------- 頁面：管理（隱藏，網址 #admin，只有管理員能用） ---------- */
const ADMIN_TABS = { heroes: '武將', upload: '上傳 JSON', admins: '管理員' };
const field = (label, html) => `<label class="field"><span>${label}</span>${html}</label>`;
const errorBox = (errs) => (errs.length
  ? `<div class="errors">${errs.slice(0, 20).map((e) => `<div>⚠️ ${esc(e)}</div>`).join('')}${errs.length > 20 ? `<div>…還有 ${errs.length - 20} 個問題</div>` : ''}</div>`
  : '');
const saveErrorText = (e) => (e.code === 'permission-denied' ? '沒有權限（管理權限可能被移除了，請重新整理）' : errText(e));

async function saveHeroList(list) {
  const bytes = new TextEncoder().encode(JSON.stringify(list)).length;
  if (bytes > 950000) throw new Error(`資料太大（${Math.round(bytes / 1024)} KB），超過資料庫單份上限，需要拆開存`);
  await store.saveHeroes(list);
  state.heroes = list;
  state.heroSource = 'db';
}

async function renderAdmin() {
  if (!store.user) {
    view.innerHTML = pageHead('管理頁') + loginBox('管理頁需要先登入。');
    bindLogin();
    return;
  }
  if (!store.user.isAdmin) {
    view.innerHTML = `${pageHead('管理頁')}<div class="card">
      <p>你沒有管理權限。</p>
      <p class="muted">需要的話，請把你的登入信箱給管理員，請他在管理頁把你加進名單，加好後重新整理這頁。</p>
      ${store.user.email ? `<p class="muted">你的登入信箱：${esc(store.user.email)}</p>` : ''}
    </div>`;
    return;
  }
  const a = state.admin;
  view.innerHTML = `
    <a class="back" href="#me">‹ 我的</a>
    ${pageHead('管理頁')}
    <div class="seg">${Object.entries(ADMIN_TABS).map(([k, v]) => `<button class="atab ${k === a.tab ? 'on' : ''}" data-t="${k}">${v}</button>`).join('')}</div>
    ${store.mode === 'local' ? '<p class="muted" style="margin-top:8px">本機模式：改動只存在這個瀏覽器，登入就有管理權限。</p>' : ''}
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
    <input id="admin-q" type="search" aria-label="搜尋要改的武將" placeholder="搜尋要改的武將" value="${esc(a.q)}" autocomplete="off">
    <div id="admin-hero-list" style="margin-top:8px"></div>`;

  const drawList = () => {
    const list = state.heroes.filter((h) => heroMatch(h, a.q.trim()));
    const el = $('#admin-hero-list');
    el.innerHTML = list.length
      ? list.map((h) => `<div class="card admin-row">
          ${seal(h.faction)}
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
      <h3 style="margin-top:0;font-family:var(--serif)">${a.isNew ? '新增武將' : '編輯：' + esc(h.name)}</h3>
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
      ${field('一句話定位', `<textarea id="f-tagline" rows="2">${esc(h.tagline)}</textarea>`)}
      ${field('別名（用頓號或逗號分隔）', `<input id="f-aliases" value="${esc(h.aliases.join('、'))}" placeholder="簡體字、俗稱、常見錯字">`)}
      ${field('標籤（用頓號或逗號分隔）', `<input id="f-roles" value="${esc(h.roles.join('、'))}" placeholder="輸出、新手推薦">`)}
    </div>
    <div class="sec">技能</div>
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
      <div class="label" style="margin-top:12px">匯入方式</div>
      <div class="seg" id="up-mode">
        ${[['merge', '合併'], ['replace', '整份取代']].map(([v, l]) => `<button data-v="${v}" class="${u.mode === v ? 'on' : ''}">${l}</button>`).join('')}
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
  $$('#up-mode button').forEach((r) => { r.onclick = () => { u.mode = r.dataset.v; renderAdminUpload(); }; });

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
  box.innerHTML = '<div class="empty">正在讀取管理員名單…</div>';
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
        <input id="ad-email" type="email" inputmode="email" autocapitalize="off" autocomplete="off" aria-label="要加入的管理員信箱" placeholder="對方的 Gmail，例如 friend@gmail.com">
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
// 武將詳情頁用 #heroes/<id>，可以用瀏覽器的返回鍵回列表
// 比較頁 #compare 算在「武將」分頁底下；要比哪幾位只放在記憶體，不寫進網址
const PAGES = { heroes: renderHeroes, compare: renderCompare, new: renderNew, me: renderMe, rank: renderRank, admin: renderAdmin };
const tabOf = (page) => (page === 'compare' ? 'heroes' : page);
// 離開武將分頁就清掉比較（避免下一個拿手機的人看到）
function leaveHeroesIfNeeded(page) {
  if (tabOf(page) !== 'heroes' && isCompareQuery()) clearCompare();
}

function parseHash() {
  const [t, arg] = location.hash.slice(1).split('/');
  const tab = PAGES[t] ? t : 'heroes';
  let heroId = null;
  if (tab === 'heroes' && arg) { try { heroId = decodeURIComponent(arg); } catch { heroId = null; } }
  return { tab, heroId };
}
function go(tab) {
  if (!PAGES[tab]) tab = 'heroes';
  if (location.hash !== '#' + tab) history.replaceState(null, '', '#' + tab);
  if (tab !== 'new') state.justSaved = null;
  leaveHeroesIfNeeded(tab);
  state.tab = tab;
  state.heroId = null;
  state.cameFromList = false;
  render();
}
async function onHashChange() {
  const { tab, heroId } = parseHash();
  if (tab === state.tab && heroId === state.heroId) return;
  const wasList = state.tab === 'heroes' && !state.heroId;
  const backToList = tab === 'heroes' && !heroId && (!!state.heroId || state.tab === 'compare');
  state.cameFromList = (!!heroId || tab === 'compare') && wasList;
  leaveHeroesIfNeeded(tab);
  if (tab !== 'new') state.justSaved = null;
  state.tab = tab;
  state.heroId = heroId;
  await render();
  window.scrollTo(0, backToList ? state.heroScroll : 0);
}
async function render() {
  $$('.tabbar button').forEach((b) => {
    const on = b.dataset.tab === tabOf(state.tab);
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  try {
    await PAGES[state.tab]();
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="card"><p><b>載入失敗</b>：${esc(errText(e))}</p><p class="muted">已經記下的資料不會不見。</p><button class="btn" id="retry">重新載入</button></div>`;
    $('#retry').onclick = () => { state.games = null; render(); };
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
  Object.assign(state, parseHash());
  // 捲動位置自己管（武將列表 ↔ 詳情頁），不讓瀏覽器自動還原
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  window.addEventListener('hashchange', onHashChange);

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
