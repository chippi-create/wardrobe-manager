# wardrobe-manager

手持ちの服とコーデを管理する、スマホ向けのWebアプリです。

## できること

- **服の登録**：写真（自動で縮小）・名前・カテゴリ・色・シーズン・メモ
- **一覧と絞り込み**：カテゴリ・色・シーズン・キーワードで絞り込み、よく着る順／着ていない順に並べ替え
- **コーデ**：登録した服を組み合わせて保存
- **着用記録**：「今日着た」で記録。コーデで記録すると、含まれる服にも記録されます
- **バックアップ**：データ（写真込み）をJSONファイルに書き出し・読み込み
- **ホーム画面に追加**：PWA対応。オフラインでも開けます

## データの保存場所

データは使う人それぞれの端末のブラウザ（IndexedDB）にだけ保存され、サーバーには送られません。
機種変更やブラウザのデータ削除で消えるため、設定画面からときどきバックアップを書き出してください。

## 構成

ビルド不要の HTML / CSS / JavaScript（ES Modules）です。

```
index.html            画面
styles.css            見た目（ライト／ダーク対応）
js/app.js             画面の動き
js/db.js              IndexedDB への保存
js/image.js           写真の縮小・変換
sw.js                 オフライン用のキャッシュ
manifest.webmanifest  ホーム画面に追加するための設定
icons/                アプリアイコン
```

## 手元で動かす

```sh
python3 -m http.server 8000
# http://localhost:8000 を開く
```

## 公開（Cloudflare Pages）

1. Cloudflare にログインし、Workers & Pages → Create → Pages → Connect to Git
2. このリポジトリを選ぶ
3. Framework preset は `None`、Build command は空欄、Build output directory は `/`
4. Save and Deploy

以降は `main` にプッシュするたびに自動で更新されます。

アプリを更新したときは、`sw.js` の `CACHE` のバージョン（`wardrobe-v1` など）を上げると、使っている人の端末に新しい版が確実に届きます。
