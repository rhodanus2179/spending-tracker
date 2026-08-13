# spending-tracker

無駄遣いと、回避できた支出をすばやく記録するブラウザ/PWAアプリです。

## 特徴

- 150円、300円、1,000円、4,000円をワンタップで記録
- 無駄遣いをマイナス、回避できた支出をプラスとして集計
- 今日・今週（月曜始まり）・今月・今年・累計を表示
- データはブラウザの `localStorage` のみに保存
- Service Workerによるオフライン利用に対応
- ビルド工程や外部ライブラリなし

## 構成

- `index.html` — マークアップ
- `styles.css` — 表示とレスポンシブ対応
- `app.js` — 記録、保存、集計、画面更新
- `service-worker.js` — PWAキャッシュ
- `manifest.json` — PWAメタデータ
- `icons/` — PWA・favicon用画像

## ローカル実行

Service Workerを含めて確認する場合は、リポジトリのルートで簡易HTTPサーバーを起動してください。

```bash
python -m http.server 8000
```

その後、ブラウザで `http://localhost:8000/` を開きます。

## データについて

記録は `spending-tracker.records.v2` というキーで `localStorage` に保存されます。サーバー送信は行いません。

## ライセンス

MIT License
