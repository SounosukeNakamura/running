# 天気×ランニングコース提案アプリ

天気情報と現在地を使って、ランニング/ウォーキングコースを提案するシングルページWebアプリケーションです。

## 技術スタック

- **フロントエンド**: React 18 + TypeScript
- **ビルドツール**: Vite 5
- **スタイル**: 独自 CSS（シンプルなレイアウト）
- **地図表示**: Geolonia Maps Embed API
- **天気API**: Open-Meteo（無料、キー不要）

## セットアップ方法

### 1. 前提条件

- Node.js v16 以上
- npm v8 以上

### 2. インストール

```bash
# 依存パッケージのインストール
npm install
```

### 3. 開発サーバーの起動

```bash
# Vite開発サーバーを起動（デフォルト: http://localhost:5173）
npm run dev
```

### 4. プロダクション用ビルド

```bash
# TypeScript型チェックとViteでビルド
npm run build

# ビルド結果のプレビュー
npm run preview
```

## アプリの主な機能

### 1. 位置情報取得
- ブラウザの Geolocation API で現在地を自動取得
- 位置情報が拒否された場合は、手動で緯度・経度を入力可能

### 2. ランニング条件の入力
- 走りたい距離（km）
- 種別（ランニング / ウォーキング）
- 走りたい時間帯（今すぐ / 朝 / 昼 / 夜）

### 3. 天気情報の取得と分析
- Open-Meteo API を利用して気温、降水量、風速を取得
- 走りやすさを「とても走りやすい」「まあまあ」「控えめ推奨」「今日は見送り推奨」の4段階で評価

### 4. コース提案
- 入力された距離と種別に基づいてコース提案を生成
- 天気条件に応じたアドバイス文を表示

### 5. 地図表示
- Geolonia Maps で現在地を中心に地図を表示
- 将来的に GeoJSON を読み込んでルートを描画可能

## プロジェクト構成

```
.
├── index.html                # HTMLエントリーポイント
├── package.json              # 依存パッケージ定義
├── vite.config.ts            # Vite設定
├── tsconfig.json             # TypeScript設定
├── tsconfig.node.json        # Node用TypeScript設定
└── src/
    ├── main.tsx              # React アプリケーションエントリーポイント
    ├── App.tsx               # メインコンポーネント
    └── App.css               # スタイルシート
```

## コードの主要部分

### App.tsx の構成

#### 1. 型定義
- `WeatherResponse`: Open-Meteo API のレスポンス型
- `RunningCondition`: ユーザー入力条件の型
- `WeatherInfo`: 加工された天気情報の型
- `EvaluationResult`: 走りやすさ評価結果の型

#### 2. 主要な関数

**`evaluateCondition()`**
気温、降水量、風速から走りやすさを判定します。
```
- とても走りやすい: 気温10-22℃ AND 降水0mm AND 風速<5m/s
- まあまあ: その他の平均的な条件
- 控えめ推奨: 降水あり または 風速5-10m/s
- 今日は見送り推奨: 風速≥10m/s
```

**`fetchWeather()`**
Open-Meteo API から天気データを取得し、走りやすさを評価します。

**`generateCourseProposal()`**
入力された条件と天気情報をもとにコース提案テキストを生成します。

### React State の管理

```typescript
// 位置情報
const [latitude, setLatitude] = useState<number | null>(null)
const [longitude, setLongitude] = useState<number | null>(null)

// ユーザー入力
const [condition, setCondition] = useState<RunningCondition>({
  distance: '',
  type: 'running',
  timeOfDay: 'now',
})

// 結果表示
const [weather, setWeather] = useState<WeatherInfo | null>(null)
const [proposal, setProposal] = useState<string>('')
```

## 地図表示について

### Geolonia Maps の設定

index.html に以下が含まれています：

```html
<script src="https://cdn.geolonia.com/v1/embed?geolonia-api-key=YOUR-API-KEY"></script>
```

APIキーは本番環境では適切に設定してください。

### 地図へのコース描画（将来の拡張）

GeoJSON を使ってルートを描画する場合の例：

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": {
        "type": "LineString",
        "coordinates": [
          [139.7674, 35.6762],
          [139.7700, 35.6800],
          [139.7650, 35.6850]
        ]
      },
      "properties": {
        "name": "提案コース"
      }
    }
  ]
}
```

App.tsx の地図セクションにコメントで記載されています。

## 天気判定ロジック

走りやすさの判定は以下のルールで行われます：

| 気温 | 降水量 | 風速 | 判定 | アドバイス |
|------|--------|------|------|----------|
| 10-22℃ | 0mm | <5m/s | とても走りやすい | 最高の条件です |
| >25℃ | 任意 | 任意 | まあまあ | ペースを落としてこまめに水分補給 |
| <5℃ | 任意 | 任意 | まあまあ | ウォーミングアップと防寒対策 |
| 任意 | >0mm | 任意 | 控えめ推奨 | 雨具を準備し滑りやすい路面に注意 |
| 任意 | 任意 | 5-10m/s | 控えめ推奨 | 露出した場所では注意 |
| 任意 | 任意 | ≥10m/s | 今日は見送り推奨 | 非常に強い風が予想される |
| その他 | 任意 | 任意 | まあまあ | 平均的な条件 |

## エラーハンドリング

- **位置情報取得失敗**: ユーザーに手入力フォームを提示
- **天気API失敗**: エラーメッセージを画面に表示
- **入力値エラー**: 距離が入力されていない場合は警告

## 拡張予定事項

以下の機能拡張が想定されています（App.tsx に TODO コメント記載）：

1. **地図上のコース描画**: GeoJSON で提案コースを可視化
2. **走行ログの保存**: localStorage で過去の提案を記録
3. **多地域対応**: 緯度・経度入力で世界中のコース提案
4. **詳細な天気情報**: 時間帯別の天気予報表示
5. **コース距離の自動計算**: 地図から実際のルートを描画

## ブラウザ互換性

- Chrome / Chromium ≥ 60
- Firefox ≥ 55
- Safari ≥ 11
- Edge ≥ 15

Geolocation API と Fetch API のサポートが必要です。

## ライセンス

MIT

## 参考資料

- [React ドキュメント](https://react.dev/)
- [Vite ドキュメント](https://vitejs.dev/)
- [Open-Meteo API ドキュメント](https://open-meteo.com/en/docs)
- [Geolonia Maps ドキュメント](https://geolonia.com/docs/)
- [Geolocation API](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation_API)
