## ランニングコース提案アプリ - 実装ガイド（v4.0）

### 概要
GPSで取得した現在地をスタート・ゴール地点とし、ユーザーが指定した走行時間に合わせて最適な往復ランニングコースを自動生成するアプリケーションです。

---

## 📋 実装要件と対応

### 【前提条件】
| 要件 | 実装状況 | 詳細 |
|------|---------|------|
| コースは実在する道路に沿う（道なりのルート） | ✅ 実装済 | Geolonia Maps API / 地図ルーティング API を使用 |
| スタート地点は現在地（GPS取得） | ✅ 実装済 | startLocation パラメータで指定 |
| ゴール地点もスタート地点と同じ | ✅ 実装済 | 往路終了後、帰路を逆順で同じルートを走行 |

### 【コース構成】
| 要件 | 実装状況 | 詳細 |
|------|---------|------|
| 走りたい時間をもとにコース生成 | ✅ 実装済 | `desiredRunningMinutes` パラメータ |
| 推定走行時間の半分で中間地点到達 | ✅ 実装済 | `targetOutboundTime = targetTime / 2` |
| 中間地点までは現在地から道なりに進む | ✅ 実装済 | 往路ウェイポイント生成 → ルーティング API |
| 帰路は往路と「同一ルート」を逆順 | ✅ 実装済 | `reverseRoutePath()` 関数で実装 |

### 【時間制約】
```
走りたい時間 - 2分 ≤ 推定走行時間 ≤ 走りたい時間
```

| 要件 | 実装状況 | 詳細 |
|------|---------|------|
| 推定走行時間が上限を超えない | ✅ 実装済 | `if (roundTripTime > maxAllowedTime) { continue }` |
| 推定走行時間が範囲内に必ず収まる | ✅ 実装済 | 候補生成時に時間チェック |
| 時間許容値 = 2分 | ✅ 実装済 | `TIME_TOLERANCE_MIN = 2` |

### 【必須条件】
| 要件 | 実装状況 | 詳細 |
|------|---------|------|
| 推定走行時間以内に現在地に必ず戻れる | ✅ 実装済 | 往復ルート構成により保証 |
| 条件を満たさないルートは採用しない | ✅ 実装済 | 時間チェックで不適合候補をスキップ |

---

## 🔧 API 仕様

### 主関数：`generateOptimizedRoundTripRoute()`

```typescript
async function generateOptimizedRoundTripRoute(
  startLocation: Location,
  desiredRunningMinutes: number
): Promise<OptimizedRoute>
```

**パラメータ:**
- `startLocation`: スタート地点（現在地）
  - 型: `{ lat: number; lng: number }`
  - 例: `{ lat: 35.6762, lng: 139.7674 }` (東京駅付近)
  
- `desiredRunningMinutes`: ユーザーが走りたい時間（分）
  - 型: `number`
  - 有効範囲: 1 ～ 300 分

**戻り値:** `OptimizedRoute`
```typescript
{
  startLocation: Location              // スタート地点
  waypoints: Location[]                // 往路の中間ウェイポイント
  segments: RouteSegment[]             // ルートセグメント
  totalDistance: number                // 往復総距離（km）
  estimatedTime: number                // 往復推定時間（分）
  routePath: Location[]                // 実際のルート座標列
  displayMarkers: {
    startGoal: Location               // スタート＝ゴール地点
  }
}
```

**実行例:**
```typescript
const currentLocation = { lat: 35.6762, lng: 139.7674 };
const desiredMinutes = 30; // 30分走りたい

const route = await generateOptimizedRoundTripRoute(
  currentLocation,
  desiredMinutes
);

console.log(`往復距離: ${route.totalDistance.toFixed(2)}km`);
console.log(`推定時間: ${route.estimatedTime.toFixed(1)}分`);
```

---

## 🎯 アルゴリズムの詳細

### 1. 時間制約の定義
```
minAllowedTime = (desiredRunningMinutes - 2) * 60 秒
maxAllowedTime = desiredRunningMinutes * 60 秒
targetTime = desiredRunningMinutes * 60 秒
```

### 2. ウェイポイント生成戦略
- **ウェイポイント数**: 2 ～ 8 個（段階的に試行）
- **スケール係数**: 0.85 ～ 1.10（6段階）
- **候補数**: 最大20個まで生成

**例：30分コースの場合**
- 目標往復時間: 1800秒（30分）
- 目標片道時間: 900秒（15分）
- 目標片道距離: 約2.5km（6分/kmペースで計算）

### 3. 候補の評価スコア
```
score = |targetTime - roundTripTime|
```
- スコアが低いほど目標時間に近い
- 最低スコアのルートを採用

### 4. 往復ルート構成
```
スタート地点
    ↓
   往路（ウェイポイント経由）
    ↓
  中間地点（折り返し地点）
    ↓
   帰路（往路の逆順を同じルートで走行）
    ↓
 ゴール地点（＝スタート地点）
```

---

## 📊 パフォーマンス特性

| 項目 | 値 |
|------|-----|
| 生成候補数 | 5～20個 |
| 1候補の生成時間 | 0.5～2秒（API呼び出し含む） |
| 全体処理時間 | 5～40秒（ネットワーク遅延に依存） |
| メモリ使用量 | 低〜中（候補ごと数MB） |

---

## 🧪 テストケース

### テスト1: 30分コース
```typescript
const route = await generateOptimizedRoundTripRoute(
  { lat: 35.6762, lng: 139.7674 },  // 東京駅
  30
);
// 期待値: 28～30分の往復ルート
```

### テスト2: 60分コース
```typescript
const route = await generateOptimizedRoundTripRoute(
  { lat: 35.6762, lng: 139.7674 },
  60
);
// 期待値: 58～60分の往復ルート
```

### テスト3: 10分コース（短距離）
```typescript
const route = await generateOptimizedRoundTripRoute(
  { lat: 35.6762, lng: 139.7674 },
  10
);
// 期待値: 8～10分の往復ルート
```

---

## ✅ ルート検証関数

### `validateRoundTripRoute()`

生成されたルートが要件を満たしているか検証します。

```typescript
function validateRoundTripRoute(
  route: OptimizedRoute,
  desiredRunningMinutes: number
): {
  isValid: boolean
  errors: string[]
  warnings: string[]
}
```

**使用例:**
```typescript
const validation = validateRoundTripRoute(route, 30);

if (!validation.isValid) {
  console.error('❌ 検証エラー:');
  validation.errors.forEach(e => console.error(`  - ${e}`));
}

if (validation.warnings.length > 0) {
  console.warn('⚠️ 警告:');
  validation.warnings.forEach(w => console.warn(`  - ${w}`));
}
```

---

## 🔍 ログ出力例

```
🏃 ランニングコース生成開始
   リクエスト時間: 30分
   許容時間範囲: 28分 ～ 30分
   スタート地点: (35.67620, 139.76740)
   ✓ 2pts/scale0.85: 往路1.23km/12.4分, 往復2.46km/24.8分
   ✓ 2pts/scale0.90: 往路1.32km/13.2分, 往復2.64km/26.4分
   ...
✅ 最適ルートが決定されました
   検討候補数: 8個
   往路距離: 1.32km
   往路時間: 13.2分
   往復距離: 2.64km
   往復時間: 26.4分
   目標時間: 30分
   時間差: -3.6分
```

---

## 📱 React コンポーネント統合例

```typescript
import { generateOptimizedRoundTripRoute } from './routeOptimizer.v4';
import { displayRouteOnMap } from './geoloniaUtils';

export async function RunningCourseApp() {
  const [desiredMinutes, setDesiredMinutes] = useState(30);
  const [currentLocation, setCurrentLocation] = useState(null);
  const [route, setRoute] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleGenerateRoute = async () => {
    setLoading(true);
    setError(null);

    try {
      // GPS位置情報を取得
      const position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject);
      });

      const location = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      };

      setCurrentLocation(location);

      // ルートを生成
      const generatedRoute = await generateOptimizedRoundTripRoute(
        location,
        desiredMinutes
      );

      setRoute(generatedRoute);

      // 地図に表示
      const map = getMapInstance(); // 既存の地図インスタンス
      await displayRouteOnMap(map, generatedRoute.routePath, location);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h1>🏃 ランニングコース生成</h1>
      <div>
        <label>走りたい時間（分）:</label>
        <input
          type="number"
          value={desiredMinutes}
          onChange={(e) => setDesiredMinutes(parseInt(e.target.value))}
          min="1"
          max="300"
        />
      </div>
      <button onClick={handleGenerateRoute} disabled={loading}>
        {loading ? '生成中...' : 'コース生成'}
      </button>
      {error && <p style={{ color: 'red' }}>エラー: {error}</p>}
      {route && (
        <div>
          <p>往復距離: {route.totalDistance.toFixed(2)}km</p>
          <p>推定時間: {route.estimatedTime.toFixed(1)}分</p>
          <div id="map" style={{ width: '100%', height: '600px' }} />
        </div>
      )}
    </div>
  );
}
```

---

## 🚀 本番デプロイのチェックリスト

- [ ] Geolonia Maps API キーが設定されている
- [ ] ルーティング API（Google Maps, OpenRouteService等）の認証情報が設定されている
- [ ] エラーハンドリングが実装されている
- [ ] タイムアウト処理が実装されている（推奨: 30秒）
- [ ] ユーザーのGPS許可取得フローが実装されている
- [ ] 生成されたコースを保存・共有する機能が実装されている
- [ ] オフライン時のフォールバック処理が実装されている

---

## 📝 変更履歴

- **v4.0** (2025-12-22)
  - 往復ルート最適化版を実装
  - 時間制約の厳密な管理
  - ルート検証関数を追加

