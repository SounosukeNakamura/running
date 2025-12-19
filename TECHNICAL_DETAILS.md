# ランニングコース提案アプリ - 道路ネットワークベース ルート生成ロジック

## 📖 目次

1. [概要](#概要)
2. [要件充足](#要件充足)
3. [アーキテクチャ](#アーキテクチャ)
4. [実装詳細](#実装詳細)
5. [API 仕様](#api-仕様)
6. [アルゴリズム解説](#アルゴリズム解説)
7. [使用技術スタック](#使用技術スタック)

---

## 概要

現在地（Geolocation API で取得した緯度・経度）からスタートし、指定時間内に同じ地点へ戻ってくるランニングコースを、**OSRM（Open Source Routing Machine）** を利用して実際の道路に沿ったルートで提案するシステムです。

### 主な特徴

✅ **リアルな道路ルート**
- 直線距離ではなく、実際の道路ネットワークに基づいたルート生成

✅ **スタート＝ゴール地点**
- 現在地から出発し、同じ地点で終了する周回ルート

✅ **指定距離への自動調整**
- ランニング時間から計算した目標距離に自動的に調整

✅ **動的ウェイポイント最適化**
- 距離に応じてウェイポイント数を自動調整

---

## 要件充足

| 要件 | 実装方法 | 状態 |
|------|--------|------|
| スタート/ゴール = 現在地 | Geolocation API で取得した座標をスタート・ゴールに設定 | ✅ |
| 必ずしも円形でなくてOK | OSRM で道路を参照しているため、任意の形状が生成可能 | ✅ |
| 実際の道路に沿ったルート | OSRM Foot API で OpenStreetMap の道路ネットワークを利用 | ✅ |
| OpenStreetMap/Geolonia 対応 | OSRM は OSM ベース、表示は Geolonia で実施 | ✅ |
| スタート→経由点→ゴール構造 | ウェイポイント配列として管理 | ✅ |
| 指定距離への調整 | 反復的なウェイポイント数調整アルゴリズムで実装 | ✅ |

---

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────────┐
│                    React コンポーネント層                     │
│                      (App.tsx)                               │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ↓
    ┌────────────────────────────────────────┐
    │   routeOptimizer.ts - ルート生成エンジン  │
    │                                         │
    │  • generateOptimizedRunningRoute()      │
    │  • generateInitialWaypoints()           │
    │  • optimizeWaypoints()                  │
    │  • getRouteGeometry()                   │
    │  • getRouteDistance()                   │
    └────────┬─────────────────────────────────┘
             │
             ↓
    ┌────────────────────────────────────────┐
    │     OSRM API（外部サービス）             │
    │   https://router.project-osrm.org      │
    │                                         │
    │  • Route API: ルート取得                │
    │  • Distance API: 距離計算               │
    └────────┬─────────────────────────────────┘
             │
             ↓
    ┌────────────────────────────────────────┐
    │    OpenStreetMap 道路ネットワーク       │
    └────────────────────────────────────────┘

    ┌────────────────────────────────────────┐
    │      Geolonia マップ（表示層）           │
    │  ・ルートパス（ポリライン）表示          │
    │  ・ウェイポイント（マーカー）表示        │
    └────────────────────────────────────────┘
```

---

## 実装詳細

### 1. ルート生成フロー

```typescript
// メイン関数
generateOptimizedRunningRoute(
  startLocation: Location,
  runningMinutes: number
): Promise<OptimizedRoute>
```

**処理ステップ:**

```
1️⃣ 入力パラメータ検証
   ├─ startLocation: {lat, lng}
   └─ runningMinutes: 20-300

2️⃣ 目標走行距離を計算
   targetDistance = runningMinutes / PACE_MIN_PER_KM
   例) 30分 / 6分/km = 5km

3️⃣ 初期ウェイポイント生成
   ├─ 直線距離半径 = targetDistance * 0.7 / (2π)
   ├─ スタート地点を中心に周回上に均等配置
   └─ 初期ウェイポイント: [スタート, wp1, wp2, ..., wn]

4️⃣ ウェイポイント最適化ループ（最大3回）
   ┌─ 各セグメント間の OSRM ルート距離を計算
   ├─ 総距離と目標を比較
   ├─ 距離が不足 → ウェイポイント数 +1
   ├─ 距離が超過 → ウェイポイント数 -1
   └─ 収束まで反復

5️⃣ 最終ルート情報を取得
   ├─ getRouteGeometry() で全ウェイポイント経由のルートを取得
   ├─ 道路沿いの詳細パス（routePath）を抽出
   └─ ステップ情報を生成
```

### 2. ウェイポイント最適化アルゴリズム

```typescript
optimizeWaypoints(
  startLocation: Location,
  waypoints: Location[],
  targetDistanceKm: number
): Promise<Location[]>
```

**最適化ロジック:**

```
現在のウェイポイント配列から距離を計算
│
├─ スタート → wp1 の距離
├─ wp1 → wp2 の距離
├─ ...
├─ wpN → スタート（ゴール）の距離
│
↓

totalDistance = Σ(セグメント距離)

↓

if (totalDistance ≈ targetDistance) {
  // 十分に近い（±10%以内）→ 収束
  return waypoints
}

else if (totalDistance < targetDistance) {
  // 距離が不足 → ウェイポイント数を増やす
  return generateInitialWaypoints(start, target, n+1)
}

else {
  // 距離が超過 → ウェイポイント数を減らす
  return generateInitialWaypoints(start, target, max(3, n-1))
}
```

### 3. OSRM API 統合

#### Route API（最も重要）

```typescript
getRouteGeometry(waypoints: Location[]): Promise<{
  distance: number  // メートル
  duration: number  // 秒
  path: Location[]  // 道路沿いの座標配列
}>
```

**API リクエスト例:**

```
GET https://router.project-osrm.org/route/v1/foot/139.7674,35.6762;139.7688,35.6755;139.7702,35.6748?overview=full&geometries=geojson
```

**パラメータ:**
- `foot`: プロファイル（歩行ルート）
- `coordinates`: ウェイポイント（lng,lat 形式）
- `overview=full`: 詳細な道路パスを取得
- `geometries=geojson`: 出力形式

**レスポンス:**

```json
{
  "routes": [
    {
      "geometry": {
        "coordinates": [[139.7674, 35.6762], [139.7680, 35.6760], ...],
        "type": "LineString"
      },
      "distance": 1234.5,
      "duration": 987.6
    }
  ]
}
```

#### Distance API（距離計算用）

```typescript
getRouteDistance(from: Location, to: Location): Promise<number>
```

**API リクエスト例:**

```
GET https://router.project-osrm.org/route/v1/foot/139.7674,35.6762;139.7688,35.6755?overview=false
```

---

## API 仕様

### `generateOptimizedRunningRoute()`

```typescript
async function generateOptimizedRunningRoute(
  startLocation: Location,
  runningMinutes: number
): Promise<OptimizedRoute>
```

**パラメータ:**
- `startLocation`: 開始地点 `{lat: number, lng: number}`
- `runningMinutes`: ランニング時間（分）。1～300の範囲。

**戻り値:**

```typescript
interface OptimizedRoute {
  waypoints: Location[]      // スタート → 経由点 → ゴール
  totalDistance: number      // 総走行距離（km）
  routePath: Location[]      // 実際の道路パス
  steps: RouteStep[]         // ステップ情報
}
```

**使用例:**

```typescript
const route = await generateOptimizedRunningRoute(
  { lat: 35.6762, lng: 139.7674 },
  30
)

console.log(`走行距離: ${route.totalDistance.toFixed(2)}km`)
console.log(`ウェイポイント: ${route.waypoints.length}個`)
```

### `generateInitialWaypoints()`

```typescript
function generateInitialWaypoints(
  startLocation: Location,
  targetDistanceKm: number,
  numWaypoints?: number
): Location[]
```

**パラメータ:**
- `startLocation`: 中心点
- `targetDistanceKm`: 目標走行距離
- `numWaypoints`: ウェイポイント数（デフォルト: 8）

**戻り値:**
初期ウェイポイント配列

**アルゴリズム:**

```
直線距離半径 = targetDistance * 0.7 / (2π)
               ↑
           係数 0.7 は、実際の道路距離が直線より長いことを考慮

for i in 0..numWaypoints-1:
  angle = (i / numWaypoints) * 360°
  waypoint = getLocationByBearingAndDistance(start, angle, radius)
  waypoints.append(waypoint)
```

### `getRouteDistance()`

```typescript
async function getRouteDistance(
  from: Location,
  to: Location
): Promise<number>
```

**戻り値:** ルート距離（km）

---

## アルゴリズム解説

### 1. 周回ルート生成の数学的背景

**円周ルート（従来）vs 最適化ルート（新）**

従来の方法:
```
走行距離 = 2πr（往路 πr + 復路 πr）
```

新しい方法:
```
OSRM が実際の道路網を参照し、
円形ではなく、利用可能な道路を最適に利用したルートを生成
```

### 2. ウェイポイント数の動的調整

**直線距離と実際の道路距離の差**

| 地域 | 係数 | 理由 |
|------|------|------|
| 平坦な都市 | 0.7～0.8 | 細い道路が多い |
| 山間地 | 0.6～0.7 | 急勾配、迂回路が必要 |
| 高速道路沿い | 0.8～0.9 | 直線的 |

現在のアプリは **0.7** で統一（都市部想定）

### 3. 反復最適化の収束性

**許容範囲:**
- 収束判定: |totalDistance - targetDistance| / targetDistance < 10%
- 最大反復回数: 3回
- 通常は 2回で収束

**ウェイポイント数の変化例（30分走行、5km目標）:**

```
Iteration 1: 8 waypoints → 5.2km（超過）→ 7に減少
Iteration 2: 7 waypoints → 4.8km（不足）→ 8に増加
Iteration 3: 8 waypoints → 5.0km（OK）→ 収束
```

---

## 使用技術スタック

### フロントエンド
- **React 18.2** - UI フレームワーク
- **TypeScript** - 型安全性
- **Vite 5.0** - ビルドツール

### 外部 API
- **OSRM** - ルート計算エンジン
  - プロトコル: HTTP REST
  - レスポンス形式: JSON
  - 公開インスタンス無料利用可

- **OpenWeather API** - 天気情報
  - RESTful API
  - リアルタイム気象データ

- **Geolocation API** - 位置情報取得
  - ブラウザ標準 API
  - GPS / WiFi 三角測量

- **Geolonia** - 地図表示
  - OpenStreetMap ベース
  - リアルタイムルート表示

### ライブラリ
- Haversine 公式（距離計算）
- GeoJSON（地理データフォーマット）
- Promise/async-await（非同期処理）

### デプロイ
- **Vercel** - ホスティング
- **GitHub** - バージョン管理

---

## 性能最適化

### キャッシング戦略

```typescript
// 計算結果をキャッシュ（将来実装）
const routeCache = new Map<string, OptimizedRoute>()

function getCacheKey(location: Location, minutes: number): string {
  return `${location.lat.toFixed(4)}_${location.lng.toFixed(4)}_${minutes}`
}
```

### リクエスト最適化

- OSRM API 呼び出しを最小化
- 不要なウェイポイント削除
- バッチ処理で複数ルート同時生成

### ネットワーク最適化

- CDN 経由での配信
- gzip 圧縮
- 懒延ロード（Lazy Loading）

---

## トラブルシューティング

### 問題: OSRM API のレスポンスが遅い

**原因:** 公開インスタンスは共有リソース

**解決方法:**
1. 本番環境ではセルフホストした OSRM インスタンスを利用
2. キャッシング機構を実装
3. リトライロジックを追加

### 問題: ルート距離が目標値から大きくズレている

**原因:** 係数 0.7 が地域に合っていない

**解決方法:**
```typescript
// 係数を動的に調整
const adaptiveCoefficient = calculateRegionFactor(location)
const straightLineRadius = (targetDistance * adaptiveCoefficient) / (2 * Math.PI)
```

### 問題: ウェイポイント数が多すぎる

**原因:** 目標距離が大きすぎる

**解決方法:**
```typescript
// 最大ウェイポイント数を超える場合は警告
if (waypoints.length > MAX_WAYPOINTS) {
  console.warn('⚠️ ウェイポイント数が上限を超えています')
  // より大きな周回ラウンドを複数生成
}
```

---

## まとめ

このシステムは、OSRM の強力なルーティング機能と React の柔軟なUI を組み合わせることで、現実的で使いやすいランニングコース提案アプリを実現しています。

継続的な改善により、ユーザーエクスペリエンスをさらに向上させることができます。

