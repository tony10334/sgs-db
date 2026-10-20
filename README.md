# 三國殺小抄（v0.1）

手機用的三國殺小工具：

- **武將**：搜尋名字或別名（關羽／界關羽／謀關羽／摩關羽…），看白話技能翻譯
- **開局**：身份局（4–10 人），設定每個座位的玩家、武將、身份，選誰贏，自動算勝負
- **我的**：個人勝率、各身份勝率、最常用武將、連勝、最近對局
- **排行**：玩家勝率榜、熱門武將、各陣營勝率

純前端，放 GitHub Pages 就能用；資料庫用 Firebase（免費 Spark 方案）。

## 檔案結構

```
index.html
css/style.css
js/app.js               主程式
js/firebase-config.js   ← 貼 Firebase 設定的地方
data/heroes.json        武將資料（目前是假資料）
firestore.rules         Firestore 安全規則（貼到 Firebase Console）
```

## 1. 先在電腦上試跑（本機模式）

`firebase-config.js` 的 apiKey 還是 `PASTE_ME` 時，網頁會自動進「本機模式」：
用暱稱模擬登入，資料存在瀏覽器 localStorage，方便先測流程。

> 直接雙擊 index.html 不行（瀏覽器會擋 module 和讀 JSON），要開個小 server：

```bash
cd sgs-db
python3 -m http.server 8000
# 打開 http://localhost:8000
```

## 2. 放上 GitHub Pages

1. 建一個 repo（例如 `sgs-db`），把整個資料夾內容推上去
2. Repo → Settings → Pages → Source 選 `Deploy from a branch`，branch 選 `main` / `(root)`
3. 幾分鐘後網址會是 `https://<你的帳號>.github.io/sgs-db/`

## 3. 接上 Firebase（Google 登入 + 雲端紀錄）

1. 到 [Firebase Console](https://console.firebase.google.com/) → 新增專案（Google Analytics 可以關掉）
2. **Build → Authentication** → 開始使用 → Sign-in method → 啟用 **Google**
3. Authentication → **Settings → Authorized domains** → 新增 `<你的帳號>.github.io`
4. **Build → Firestore Database** → 建立資料庫 → 位置選 `asia-east1`（台灣）→ 用正式版模式
5. Firestore → **規則** 分頁 → 把 `firestore.rules` 的內容整段貼上 → 發布
6. 專案設定（齒輪）→ 一般 → 您的應用程式 → 新增「網頁」應用程式 → 把產生的 `firebaseConfig` 貼進 `js/firebase-config.js`
7. 推上 GitHub，打開網頁右上角就會變成 Google 登入

> Firebase 網頁版的 apiKey 本來就是公開的，可以放進 repo；真正保護資料的是 Firestore 規則。
> 免費方案每天 5 萬次讀取、2 萬次寫入，朋友圈用不完；超過也只是當天停用，不會扣錢。

## 資料格式

### data/heroes.json

```json
{
  "id": "guanyu",              // 唯一 id
  "name": "關羽",               // 顯示名稱
  "version": "標準",            // 標準 / 界限突破 / 謀攻篇 / SP / 神…
  "title": "美髯公",
  "faction": "蜀",              // 魏 / 蜀 / 吳 / 群（神將之後可加「神」+ CSS 顏色）
  "hp": 4,
  "difficulty": 1,             // 1 新手友善 / 2 中等 / 3 進階
  "aliases": ["關公", "二爺"],   // 搜尋會比對這些
  "tagline": "一句話定位",
  "roles": ["輸出", "新手推薦"],
  "skills": [{ "name": "武聖", "plain": "白話說明", "tip": "小技巧" }]
}
```

### Firestore

```
users/{uid}   { name, photo, lastLogin }
games/{id}    { createdAt, createdBy, mode:"身份局", playerCount, winner:"主公方|反賊|內奸",
                note, playerUids:[...],
                seats:[{ seat, uid|null, name, hero, identity, win }] }
```

統計（勝率、各身份、熱門武將）都是前端從 `games` 即時算，不另外存。

## 已知限制 / 下一步

- 武將資料是假資料，`謀關羽`、`界關羽` 的技能尤其要校對
- 任何有 Google 帳號的人都能登入並看到紀錄 → 之後可加「群組邀請碼」限制
- 訪客（沒帳號）的紀錄用名字記；之後可做「認領訪客紀錄」把它併到帳號
- 開局後如果要修改紀錄，目前只能刪掉重記
