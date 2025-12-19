## 道路ネットワークベースのルート生成 - 実装ガイド

### 📋 概要

ランニングコース提案アプリに、**OSRM（Open Source Routing Machine）** を活用した、実際の道路に沿ったルート生成ロジックを実装しました。

### 🎯 要件充足状況

| 要件 | 状態 | 実装内容 |
|------|------|--------|
| スタート＝ゴール地点（現在地） | ✅ | Geolocation API で取得した座標をスタート・ゴールに設定 |
| 円形でなくてもOK | ✅ | 周回ルートは任意形状に最適化 |
| 実際の道路に沿ったルート | ✅ | OSRM Foot API で道路ネットワーク参照 |
| OpenStreetMap / Geolonia 対応 | ✅ | OSRM は OSM ベース、表示は Geolonia で実施 |
| 周回ルート（スタート → 経由点 → ゴール） | ✅ | ウェイポイント配列の最初と最後が同一地点 |
| 指定距離への調整 | ✅ | 反復的なウェイポイント数調整で達成 |

---

### 🔧 主要なコンポーネント

#### 1. **routeOptimizer.ts**

新規作成ファイル。道路ネットワークベースのルート生成エンジンを提供します。

**主要関数:**

```typescript
// ウェイポイント生成（初期配置）
generateInitialWaypoints(
  startLocation: Location,
  targetDistanceKm: number,
  numWaypoints?: number
): Location[]

// OSRM から2点間のルート距離を取得
getRouteDistance(from: Location, to: Location): Promise<number>

// 複数ウェイポイント経由のルート情報を取得
getRouteGeometry(waypoints: Location[]): Promise<{
  distance: number
  duration: number
  path: Location[]
}>

// ウェイポイントを距離に基づいて最適化
optimizeWaypoints(
  startLocation: Location,
  waypoints: Location[],
  targetDistanceKm: number
): Promise<Location[]>

// 【メイン関数】ランニング時間から最適化ルートを生成
generateOptimizedRunningRoute(
  startLocation: Location,
  runningMinutes: number
): Promise<OptimizedRoute>
```

#### 2. **App.tsx** の変更点

```typescript
// 新しいインポート
import { generateOptimizedRunningRoute, OptimizedRoute } from './routeOptimizer'

// 新しい状態管理
const [optimizedRoute, setOptimizedRoute] = useState<OptimizedRoute | null>(null)

// handleGenerateCourse 更新
const handleGenerateCourse = async (e: any) => {
  // ...
  const route = await generateOptimizedRunningRoute(location, minutes)
  setOptimizedRoute(route)
  setCourseDistance(route.totalDistance)
  // 実際の道路パスを地図に表示
  if ((window as any).displayCourseOnMap) {
    ;(window as any).displayCourseOnMap(route.routePath || route.waypoints)
  }
}
```

---

### 🚀 ルート生成のアルゴリズム

```
1. 目標走行距離を計算
   targetDistance = runningMinutes / PACE_MIN_PER_KM (約6分/km)

2. 初期ウェイポイント生成
   - スタート地点を中心に、周回上に均等配置
   - 直線距離の半径 = targetDistance * 0.7 / (2π)
   - 係数 0.7 を適用（実際の道路距離は直線より長いため）

3. ウェイポイント最適化（最大3回の反復）
   a) 各セグメント間の OSRM ルート距離を計算
   b) 総距離と目標の差を確認
   c) 差が大きい場合：
      - 距離不足 → ウェイポイント数を増加
      - 距離超過 → ウェイポイント数を減少
   d) 収束まで反復

4. 最終ルートを取得
   - getRouteGeometry で全ウェイポイント経由のルートを取得
   - 道路に沿った詳細パス（ルートパス）を生成
```

---

### 📊 データフロー図

```
┌─────────────────────────┐
│ 現在地（Geolocation API） │
└────────────┬────────────┘
             │
             ↓
    ┌─────────────────────┐
    │ ランニング時間入力       │
    │ (例: 30分)           │
    └────────┬─────────────┘
             │
             ↓
    ┌──────────────────────────────────────┐
    │ generateOptimizedRunningRoute()       │
    │ ・目標距離を計算                       │
    │ ・初期ウェイポイント生成                │
    │ ・OSRM API で反復最適化               │
    └────────────┬─────────────────────────┘
                 │
     ┌───────────┼───────────┐
     │           │           │
     ↓           ↓           ↓
  ウェイポイント OSRM距離 ルートパス
  (経由点配列)   計算    (道路沿い)
     │           │           │
     └───────────┼───────────┘
                 │
                 ↓
      ┌──────────────────────────┐
      │ OptimizedRoute オブジェクト │
      │ {waypoints, totalDistance,│
      │  routePath, steps}        │
      └────────┬──────────────────┘
               │
               ↓
      ┌──────────────────────────┐
      │ Geolonia 地図上に表示      │
      │ ・ルートパスをポリラインで  │
      │ ・ウェイポイントをマーカーで│
      └──────────────────────────┘
```

---

### 🔌 OSRM API について

**OSRMとは:**
- Open Source Routing Machine
- OpenStreetMap の道路ネットワークを利用
- 複数のプロトコル（car, foot, bike など）に対応
- 公開インスタンス: `https://router.project-osrm.org`

**使用エンドポイント:**

```bash
# 2点間のルート取得
GET /route/v1/foot/{lng1},{lat1};{lng2},{lat2}?overview=false

# 複数ウェイポイント経由のルート取得
GET /route/v1/foot/{coordinates}?overview=full&geometries=geojson
```

**レスポンス例:**

```json
{
  "routes": [
    {
      "geometry": {
        "coordinates": [[139.7674, 35.6762], [139.7688, 35.6755], ...],
        "type": "LineString"
      },
      "distance": 1234.5,    // メートル
      "duration": 987.6      // 秒
    }
  ],
  "waypoints": [...]
}
```

---

### 🎨 HTML/CSS 更新

UI に最適化情報を表示するため、CSS に以下を追加してください：

```css
/* optimization-info スタイル */
.optimization-info {
  margin-top: 1rem;
  padding: 1rem;
  background-color: #e8f5e9;
  border-left: 4px solid #4caf50;
  border-radius: 4px;
}

.optimization-info h3 {
  margin-top: 0;
  color: #2e7d32;
}

.optimization-info ul {
  margin: 0.5rem 0;
  padding-left: 1.5rem;
  font-size: 0.95rem;
}

.optimization-info li {
  margin: 0.25rem 0;
  color: #1b5e20;
}
```

---

### ⚙️ 環境変数 (.env.local)

OSRM は公開APIなため新たな環境変数は不要ですが、以下は既存で必要です：

```bash
VITE_OPENWEATHER_API_KEY=your_api_key_here
```

---

### 🧪 使用例

```typescript
import { generateOptimizedRunningRoute, Location } from './routeOptimizer'

// 現在地
const currentLocation: Location = {
  lat: 35.6762,
  lng: 139.7674
}

// 30分ランニングコースを生成
const route = await generateOptimizedRunningRoute(currentLocation, 30)

console.log(`走行距離: ${route.totalDistance.toFixed(2)}km`)
console.log(`ウェイポイント数: ${route.waypoints.length}`)
console.log(`推定走行時間: ${Math.round(route.totalDistance * 6)}分`)

// ルートパス（道路沿い）を地図に表示
route.routePath.forEach((point) => {
  // 地図にポイントをプロット
})
```

---

### 📈 パフォーマンス考慮事項

| 項目 | 値 | 説明 |
|------|---|----|
| OSRM API レスポンス時間 | 1～3秒 | ネットワーク遅延に依存 |
| ウェイポイント最適化反復回数 | 3回 | 通常は2回で収束 |
| 最大ウェイポイント数 | 25個 | OSRM の制限 |
| 距離精度 | ±10% | 最適化の許容範囲 |

**最適化のポイント:**
- キャッシング：同じ経路は API 呼び出しをキャッシュ
- バッチ処理：複数ユーザーのリクエストをまとめる（将来）
- 非同期処理：OSRM 呼び出しは Promise ベース

---

### 🐛 トラブルシューティング

**Q: OSRM API が遅い**
- A: 公開インスタンスは共有リソース。本番環境ではセルフホストした OSRM インスタンスの利用を検討

**Q: ウェイポイント数が多すぎる/少なすぎる**
- A: `routeOptimizer.ts` の `MAX_WAYPOINTS` や最適化アルゴリズムを調整

**Q: 距離が目標値から大きくズレている**
- A: 係数 0.7 を調整（山間地など地形が複雑な場合は 0.6 など）

**Q: ルートが渋滞に考慮していない**
- A: OSRM は静的なルート計算。リアルタイム渋滞を考慮する場合は Google Maps API などの利用を検討

---

### 🔄 今後の拡張案

1. **複数ルートオプション**
   - 同じ距離でも異なるルートを複数提案

2. **景観スコア**
   - 公園や景勝地を優先的に組み込む

3. **安全性指標**
   - 交通量の少ない道路を優先

4. **勾配情報**
   - elevation API を組み合わせ、平坦/坂道を表示

5. **リアルタイムキャッシング**
   - IndexedDB でルート情報をキャッシュ

6. **複言語対応**
   - 複数地域への対応

---

### 📚 参考リンク

- [OSRM - Open Source Routing Machine](http://project-osrm.org)
- [OSRM API Documentation](http://project-osrm.org/docs/v5.5.1/api/overview)
- [OpenStreetMap](https://www.openstreetmap.org)
- [Geolonia](https://geolonia.com)

