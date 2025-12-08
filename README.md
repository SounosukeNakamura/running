# 🏃 ランニングコース提案アプリ

天気情報と位置情報から、あなたにぴったりなランニングコースを自動生成するシングルページWebアプリケーションです。走りたい時間を入力するだけで、最適なコースが提案されます。

## 主な特徴

✨ **自動コース生成**
- 走りたい時間から走行距離を計算
- 出発地点を中心とした円周コースを自動生成
- 詳細な座標データを表示

🌤️ **天気情報連携**
- OpenWeather API で現在の天気を取得
- 気温、体感温度、湿度、風速、雲量を表示
- 天気に応じた走行アドバイスを自動生成

📍 **位置情報管理**
- Geolocation API で自動取得
- 手動での緯度経度入力対応
- Geolonia Maps で地図表示

⚡ **モダンUI**
- レスポンシブデザイン対応
- スムーズなアニメーション
- スマートフォン最適化

## 技術スタック

| 項目 | 技術 |
|------|------|
| フロントエンド | React 18 + TypeScript |
| ビルドツール | Vite 5 |
| スタイル | モダンレスポンシブ CSS |
| 地図表示 | Geolonia Maps Embed API |
| 天気API | OpenWeather API |
| 地理計算 | Haversine公式 |

## セットアップ方法

### 1. 前提条件

- Node.js v16 以上
- npm v8 以上
- [Geolonia](https://geolonia.com/) API キー
- [OpenWeather](https://openweathermap.org/api) API キー

### 2. APIキーの取得

**Geolonia:**
1. https://geolonia.com/ でアカウント作成
2. ダッシュボードから API キーを取得

**OpenWeather:**
1. https://openweathermap.org/api でアカウント作成
2. API キーを取得（無料版で十分）

### 3. 環境変数の設定

```bash
# .env.localファイルを作成
cp .env.example .env.local
```

`.env.local` に以下を記入：

```env
VITE_GEOLONIA_API_KEY=your-geolonia-api-key
VITE_OPENWEATHER_API_KEY=your-openweather-api-key
VITE_RUNNING_PACE_MIN_PER_KM=6
```

### 4. インストールと実行

```bash
# 依存パッケージのインストール
npm install

# 開発サーバー起動（http://localhost:5173）
npm run dev

# プロダクションビルド
npm run build

# ビルド結果のプレビュー
npm run preview
```

## 使用方法

### 基本的な流れ

1. **位置情報を取得**
   - ブラウザの位置情報許可ダイアログで「許可」をクリック
   - または手動で緯度・経度を入力

2. **走行時間を入力**
   - 「走りたい時間（分）」欄に数値を入力（1～300分）

3. **コースを生成**
   - 「コースを生成」ボタンをクリック
   - 走行距離が計算されコースが自動生成される

4. **結果を確認**
   - 提案コース（走行距離、ポイント数）
   - 現在地の天気情報
   - ランニングアドバイス

### スクリーンショット

各セクションの説明：

| セクション | 説明 |
|-----------|------|
| 📍 位置情報 | 現在地の表示と地図 |
| ⏱️ ランニングコース生成 | 時間入力とコース生成 |
| 🗺️ 提案コース | 走行距離とコース詳細 |
| 🌤️ 天気情報 | 気象データと走行アドバイス |

## プロジェクト構成

```
running/
├── index.html                 # HTMLエントリーポイント
├── package.json               # 依存パッケージ定義
├── vite.config.ts             # Vite設定
├── tsconfig.json              # TypeScript設定
├── .env.example               # 環境変数テンプレート
├── README.md                  # このファイル
├── QUICKSTART.md              # クイックスタートガイド
└── src/
    ├── main.tsx               # React初期化
    ├── App.tsx                # メインコンポーネント
    ├── App.css                # スタイルシート
    └── utils.ts               # ユーティリティ関数群
```

## コアな実装

### utils.ts - 地理計算とコース生成

```typescript
// Haversine公式で距離計算
calculateDistance(loc1: Location, loc2: Location): number

// 方位角と距離から新しい位置を計算
getLocationByBearingAndDistance(
  location: Location,
  bearing: number,
  distanceKm: number
): Location

// 円周コース生成
generateCircularCourse(
  center: Location,
  totalDistanceKm: number,
  points: number = 12
): CoursePoint[]

// 時間から走行距離を計算
calculateRunningDistance(minutes: number): number

// OpenWeather APIから天気取得
fetchWeatherData(location: Location, apiKey: string): Promise<WeatherData>

// バリデーション関数
validateRunningMinutes(value: unknown): ValidationResult
validateLocation(lat: unknown, lng: unknown): ValidationResult
```

### App.tsx - Reactコンポーネント

主要な機能：
- 位置情報管理（自動取得、手動入力）
- コース自動生成ロジック
- 天気情報取得と表示
- エラーハンドリング
- ローディング状態管理

## 走行アドバイスロジック

天気条件に基づいて自動的にアドバイスが生成されます：

| 気温 | 風速 | アドバイス |
|------|------|----------|
| > 28°C | 任意 | 水分補給、日射対策 |
| < 5°C | 任意 | ウォーミングアップ、防寒対策 |
| 5-28°C | > 6 m/s | バランス注意 |
| 5-28°C | ≤ 6 m/s | 最適な条件 |

## 入力値バリデーション

アプリケーションは以下の入力値検証を行います：

```typescript
// 走行時間：1～300分の整数
validateRunningMinutes(value)
// → { valid: boolean, error?: string }

// 緯度・経度：有効な座標値
validateLocation(lat, lng)
// → { valid: boolean, error?: string }
```

## エラーハンドリング

- **位置情報取得失敗** → デフォルト位置（東京）を設定
- **API呼び出し失敗** → エラーメッセージを表示
- **入力値エラー** → バリデーションエラーを表示

## ブラウザ互換性

- Chrome / Chromium ≥ 60
- Firefox ≥ 55
- Safari ≥ 11
- Edge ≥ 15

必須機能：
- Geolocation API
- Fetch API
- ES2020 以降のJavaScript

## 将来の拡張予定

- [ ] GeoJSONを使ったコースの地図描画
- [ ] 走行ログの保存（localStorage）
- [ ] 複数コース提案機能
- [ ] 高度やルート最適化
- [ ] ソーシャル機能（コース共有）
- [ ] PWA対応

## トラブルシューティング

### 地図が表示されない

```
原因：Geolonia APIキーが未設定
解決：.env.localでVITE_GEOLONIA_API_KEYを確認
```

### 天気情報が取得できない

```
原因：OpenWeather APIキーが無効
解決：https://openweathermap.org/api でキーを確認
```

### 位置情報が取得できない

```
原因：ブラウザの位置情報許可設定
解決：ブラウザの設定で位置情報アクセスを許可
     または手動で緯度・経度を入力
```

## パフォーマンス

- バンドルサイズ: ~150KB (gzipped)
- ビルド時間: ~5秒
- 初期ロード: ~2秒
- API呼び出し: ~1秒

## ライセンス

MIT

## 参考資料

- [React Documentation](https://react.dev/)
- [Vite Documentation](https://vitejs.dev/)
- [OpenWeather API Docs](https://openweathermap.org/api)
- [Geolonia Maps Docs](https://geolonia.com/docs/)
- [Geolocation API - MDN](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation_API)
- [Haversine Formula](https://en.wikipedia.org/wiki/Haversine_formula)

## サポート・フィードバック

問題が発生した場合は、GitHub Issues で報告してください。

---

**最終更新**: 2025年12月8日  
**バージョン**: 2.0.0  
**Author**: SounosukeNakamura
