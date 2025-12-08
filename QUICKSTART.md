# 🚀 クイックスタートガイド

このガイドに従えば、5分でアプリを起動できます。

## 1️⃣ 前提条件をインストール

### Node.js と npm のインストール

**Windows:**
- https://nodejs.org から LTS 版をダウンロード
- インストーラーに従ってインストール

**Mac:**
```bash
brew install node
```

**Linux:**
```bash
sudo apt-get install nodejs npm
```

## 2️⃣ APIキーを取得

### Geolonia APIキー
1. https://geolonia.com にアクセス
2. アカウントを作成
3. ダッシュボードから APIキーをコピー

### OpenWeather APIキー
1. https://openweathermap.org/api にアクセス
2. 無料アカウントを作成
3. API キーを取得

## 3️⃣ 環境変数を設定

```bash
# プロジェクトディレクトリに移動
cd running

# .env.local ファイルを作成
cp .env.example .env.local
```

`.env.local` を編集して APIキーを設定：

```env
VITE_GEOLONIA_API_KEY=your-key-here
VITE_OPENWEATHER_API_KEY=your-key-here
VITE_RUNNING_PACE_MIN_PER_KM=6
```

## 4️⃣ アプリを起動

```bash
# 依存パッケージをインストール
npm install

# 開発サーバーを起動
npm run dev
```

ブラウザで http://localhost:5173 にアクセス。

## 5️⃣ 使ってみる

### ステップ1: 位置情報を確認
- ブラウザから位置情報へのアクセスを許可
- または手動で緯度・経度を入力

### ステップ2: 走行時間を入力
- 「走りたい時間（分）」に数値を入力（例：30）
- 30分 ÷ 6分/km = 5km のコースが提案されます

### ステップ3: コースを生成
- 「コースを生成」ボタンをクリック
- コース情報と天気が表示されます

### ステップ4: 結果を確認
- 走行距離とポイント数
- 気温、湿度、風速などの天気情報
- ランニングアドバイス

## 📍 位置情報を手動で設定する場合

位置情報が取得できない場合：

1. 「位置情報を手動で設定」セクションを展開
2. 緯度と経度を入力
3. 「設定」ボタンをクリック

### よく使う座標

```
東京駅：35.6762, 139.7674
渋谷スクランブル交差点：35.6595, 139.7004
京都駅：34.9756, 135.7581
大阪城公園：34.6873, 135.5262
```

## 🌤️ 天気アドバイスについて

アプリは気象条件に応じたアドバイスを自動生成します：

| 気温 | アドバイス |
|------|----------|
| > 28°C | 気温が高いです。水分補給を心がけ、日射対策をしましょう。 |
| < 5°C | 気温が低いです。ウォーミングアップと防寒対策をしてください。 |
| 5-28°C | ランニングに適した気温です。 |

| 風速 | アドバイス |
|------|----------|
| > 6 m/s | 風が強いです。バランスに注意してください。 |
| ≤ 6 m/s | 走行に支障はありません。 |

## 🛠️ トラブルシューティング

### エラー：「OpenWeather API キーが設定されていません」

**原因**: `.env.local` に `VITE_OPENWEATHER_API_KEY` が設定されていない

**解決**:
```bash
# .env.local を確認
cat .env.local

# キーが含まれていることを確認
# その後、開発サーバーを再起動
npm run dev
```

### エラー：「天気情報の取得に失敗しました」

**原因**: OpenWeather API キーが無効

**解決**:
1. https://openweathermap.org でキーを確認
2. `.env.local` を更新
3. 開発サーバーを再起動

### 地図が表示されない

**原因**: Geolonia APIキーが無効

**解決**:
1. https://geolonia.com でキーを確認
2. `.env.local` を更新
3. ブラウザキャッシュをクリア（Ctrl+Shift+Delete）
4. ページをリロード

### 位置情報が取得できない

**原因**: ブラウザの位置情報許可設定

**解決**:
1. ブラウザの設定を確認
2. サイトの位置情報アクセスを「許可」に設定
3. ページをリロード
4. または手動で緯度・経度を入力

## 📋 コマンド一覧

```bash
# 開発サーバー起動
npm run dev

# プロダクション用にビルド
npm run build

# ビルド結果をプレビュー
npm run preview
```

## 📚 ファイル構成

```
running/
├── .env.example           # 環境変数テンプレート
├── .env.local             # 実際の環境変数（.gitignore推奨）
├── index.html             # HTMLメイン
├── package.json           # 依存パッケージ
├── vite.config.ts         # Vite設定
├── tsconfig.json          # TypeScript設定
├── README.md              # 詳細ドキュメント
├── QUICKSTART.md          # このファイル
└── src/
    ├── main.tsx           # React初期化
    ├── App.tsx            # メインコンポーネント（約270行）
    ├── App.css            # スタイルシート（約380行）
    └── utils.ts           # ユーティリティ関数（約250行）
```

## 🎯 実装のポイント

### ランニング距離の計算

```
走行時間（分） ÷ ペース（分/km） = 走行距離（km）

例）
30分 ÷ 6分/km = 5km
```

### コース生成アルゴリズム

1. 出発地点を中心とした円を描く
2. 円周を12分割
3. 各分割点の座標を Haversine 公式で計算
4. 最初の点に戻す（往復）

### 天気データ

OpenWeather API から取得：
- 気温（℃）
- 体感温度（℃）
- 湿度（%）
- 風速（m/s）
- 雲量（%）

## 🚀 本番環境へのデプロイ

### Vercel でのデプロイ

```bash
# 1. GitHub にプッシュ
git push origin main

# 2. Vercel に接続（https://vercel.com）
# 3. リポジトリを選択
# 4. 環境変数を設定
#    - VITE_GEOLONIA_API_KEY
#    - VITE_OPENWEATHER_API_KEY
# 5. デプロイ開始
```

### その他のホスティングサービス

**Netlify:**
```bash
npm run build
# dist フォルダを Netlify にドラッグ&ドロップ
```

**Docker:**
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY . .
RUN npm install && npm run build
FROM node:18-alpine
COPY --from=0 /app/dist /app/dist
EXPOSE 3000
CMD ["npx", "serve", "-s", "/app/dist"]
```

## 💡 Tips

- 複数のコースを試してみたい場合は、異なる時間を入力
- 天気アドバイスはリアルタイムで更新される
- 座標は小数第4位まで精密（約11m）
- ポイント数を増やすと、より詳細なコースになる

## 🤝 貢献

バグ報告や機能提案は GitHub Issues で！

---

楽しいランニングライフを！🏃‍♂️🏃‍♀️
