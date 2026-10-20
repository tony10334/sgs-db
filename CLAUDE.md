# CLAUDE.md — 三國殺小抄

給 Claude Code 讀的專案說明。使用者是 Tony，用繁體中文溝通；他有寫過程式，但對 Firebase / GitHub Pages 的設定流程不熟，**每一步要做什麼、為什麼，請用白話跟他說**，需要他手動操作時要講清楚在哪裡點什麼。

## 專案是什麼

手機優先的三國殺網頁工具，放在 GitHub Pages，資料存 Firebase（免費 Spark 方案）。

1. **武將查詢**：輸入名字或別名（關羽、界關羽、謀關羽、摩關羽…）→ 白話技能翻譯，讓新手快速上手
2. **對局紀錄（身份局）**：設定人數、每個座位的玩家／武將／身份、哪一方贏 → 自動算每人勝負
3. **個人戰績**：Google 登入，每人有自己的勝率、各身份勝率、常用武將
4. **排行榜**：玩家勝率、熱門武將、各陣營勝率

## 技術選擇（不要隨意更動）

- **沒有 build step**：純 HTML + CSS + 原生 ES modules。不要引入 React / Vite / npm 打包，除非 Tony 明確要求。
- Firebase SDK 從 CDN 動態 import（`https://www.gstatic.com/firebasejs/10.12.2/...`），版本固定寫死。
- 部署：GitHub Pages，branch `main`、根目錄 `/`。
- DB：Cloud Firestore；登入：Firebase Auth（Google provider）。
- 所有費用必須維持 $0：不要升級 Blaze、不要用 Cloud Functions、不要用 Cloud Storage。

## 檔案結構

```
index.html              外殼 + 底部分頁列
css/style.css           深色主題、手機版面（CSS 變數在 :root）
js/app.js               全部邏輯：資料層、各頁面 render、統計
js/firebase-config.js   Firebase web config（apiKey 為 "PASTE_ME" 時走本機模式）
data/heroes.json        武將資料（目前是假資料）
firestore.rules         Firestore 安全規則
firebase.json           讓 firebase CLI 知道規則檔位置（只部署 rules，不用 Firebase Hosting）
.firebaserc             Firebase 專案 id（setup 時填）
```

## app.js 架構

- **資料層 `store`** 有兩種實作，介面相同：
  - `createLocalStore()`：localStorage，暱稱模擬登入（Firebase 還沒設定時用來測試）
  - `createFirebaseStore()`：Firestore + Google 登入（popup，被擋時 fallback 到 redirect）
  - 介面：`init(cb) / signIn() / signOut() / rename(name) / listUsers() / listGames() / addGame(g) / deleteGame(id)`
  - 新增功能時兩邊都要實作，本機模式要能繼續跑
- **頁面**：`PAGES = { heroes, new, me, rank }`，用 `location.hash` 切換，每頁一個 `renderXxx()`，用 innerHTML 重繪後再綁事件
- **統計**都在前端從 `state.games` 即時計算（`aggregate()`），不在 DB 存衍生資料
- 使用者輸入一律經過 `esc()` 再塞進 innerHTML

## 身份局規則

人數 → [主公, 忠臣, 反賊, 內奸]：
4:[1,1,1,1] 5:[1,1,2,1] 6:[1,1,3,1] 7:[1,2,3,1] 8:[1,2,4,1] 9:[1,3,4,1] 10:[1,3,4,2]

勝負：`winner` 為 `主公方` → 主公＋忠臣勝；`反賊` → 反賊勝；`內奸` → 內奸勝。

## Firestore 資料模型

```
users/{uid}   { name, photo, lastLogin }
games/{id}    { createdAt(ms), createdBy(uid), mode:"身份局", playerCount, winner,
                note, playerUids:[uid...],
                seats:[{ seat, uid|null, name, hero, identity, win }] }
```

- `uid: null` 代表訪客（沒帳號，用 name 識別）
- 規則：登入才能讀；只能寫自己的 `users/{uid}`；`games` 建立者才能改/刪
- 改了資料結構要同步更新 `firestore.rules` 並部署

## heroes.json 格式

```json
{ "id": "guanyu", "name": "關羽", "version": "標準", "title": "美髯公",
  "faction": "蜀", "hp": 4, "difficulty": 1,
  "aliases": ["关羽", "關公"], "tagline": "一句話定位",
  "roles": ["輸出", "新手推薦"],
  "skills": [{ "name": "武聖", "plain": "白話說明", "tip": "小技巧" }] }
```

- `difficulty`：1 新手友善 / 2 中等 / 3 進階
- `aliases` 要包含簡體字、常見俗稱、常見錯字（例如「摩關羽」→ 謀關羽）
- 技能說明**用自己的話白話改寫**，不要整段照抄官方技能原文
- 目前是假資料；`謀關羽`、`界關羽・義絕` 是佔位內容，待校對

## 本機開發

```bash
python3 -m http.server 8000   # 開 http://localhost:8000
```

直接雙擊 index.html 不行（module 與 fetch JSON 會被擋）。
localhost 也可以測 Google 登入（Firebase 預設已授權 localhost）。

## 第一次設定流程（Setup）

照順序做，每完成一步跟 Tony 回報。標 👤 的步驟 CLI 做不到，要請 Tony 到網頁上手動操作，並給他確切的路徑。

### A. GitHub
1. `git init`，建 `.gitignore`，第一次 commit
2. `gh repo create sgs-db --public --source=. --push`（免費帳號的 GitHub Pages 需要 public repo）
3. 開 Pages：`gh api -X POST repos/{owner}/sgs-db/pages -f "source[branch]=main" -f "source[path]=/"`
4. 網址：`https://{owner}.github.io/sgs-db/`

### B. Firebase
1. 確認 CLI：`firebase --version`，沒有就 `npm i -g firebase-tools`；`firebase login`（若已登入會顯示帳號）
2. 建專案：`firebase projects:create sgs-db-<隨機後綴> --display-name "三國殺小抄"`（專案 id 全球唯一）
3. 填 `.firebaserc` 的 default 專案 id
4. 👤 Firestore：Firebase Console → Build → Firestore Database → 建立資料庫 → 位置 `asia-east1`（台灣）→ 正式版模式
   （或 CLI：`firebase firestore:databases:create "(default)" --location=asia-east1`，失敗再請 Tony 手動）
5. 部署規則：`firebase deploy --only firestore:rules`
6. 建 web app：`firebase apps:create web "sgs-web"`，再 `firebase apps:sdkconfig web <appId>` 拿 config，寫進 `js/firebase-config.js`
7. 👤 開 Google 登入：Console → Build → Authentication → 開始使用 → Sign-in method → Google → 啟用（要選支援信箱）
8. 👤 授權網域：Authentication → 設定 → 授權網域 → 新增 `{owner}.github.io`
9. commit + push，等 1–2 分鐘後在手機打開 Pages 網址測試登入與記一局

> Firebase web 的 apiKey 本來就是公開的，可以 commit；資料安全靠 firestore.rules。

## 部署流程（之後每次改版）

- 前端：commit → `git push`，GitHub Pages 自動更新（約 1 分鐘，手機可能要強制重新整理）
- 規則：改 `firestore.rules` 後 `firebase deploy --only firestore:rules`

## 寫程式的規範

- UI 文字一律繁體中文（台灣用語）
- 手機優先：寬度 390px 要好用，按鈕夠大，不要出現水平捲動
- 改完至少在本機模式跑一遍：查武將 → 登入 → 記一局 → 看「我的」與「排行」
- 小步 commit，commit message 用中文簡述
- 不確定的設計決定先問 Tony，不要自己大改架構

## Backlog（還沒做）

- [ ] 武將資料換成真實資料（標準包 → 界限突破 → 謀攻篇 → SP / 神將），神將要加「神」勢力顏色
- [ ] 群組邀請碼：只有輸入正確碼的人才能讀寫紀錄（規則也要改）
- [ ] 認領訪客紀錄：把某個訪客名字的歷史紀錄併到自己的帳號
- [ ] 編輯已存的對局（目前只能刪掉重記）
- [ ] PWA：manifest + service worker，可加到主畫面、離線查武將
- [ ] 開局 QR code：玩家掃碼自己加入座位
- [ ] 選填「誰殺了誰」→ 仇人榜 / 擊殺數
- [ ] 國戰模式
