/**
 * ルート生成エンジンの統合実装ガイド
 * HTML/JavaScriptでの使用例
 */

// ============================================================================
// 1. 基本的な使用例（React + TypeScript）
// ============================================================================

// App.tsx での使用例
import React, { useState } from 'react'
import { generateOptimizedRunningRoute, Location, OptimizedRoute } from './routeOptimizer'

export default function RunningApp() {
  const [route, setRoute] = useState<OptimizedRoute | null>(null)
  const [loading, setLoading] = useState(false)

  const handleGenerateRoute = async () => {
    setLoading(true)

    try {
      // 現在地取得
      const position = await new Promise<GeolocationCoordinates>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve(pos.coords),
          reject
        )
      })

      const currentLocation: Location = {
        lat: position.latitude,
        lng: position.longitude,
      }

      // ルート生成（30分走行）
      const generatedRoute = await generateOptimizedRunningRoute(currentLocation, 30)

      setRoute(generatedRoute)

      // コンソール出力
      console.log(`✅ ルート生成完了`)
      console.log(`   総距離: ${generatedRoute.totalDistance.toFixed(2)}km`)
      console.log(`   ウェイポイント: ${generatedRoute.waypoints.length}個`)
      console.log(`   道路パスポイント: ${generatedRoute.routePath.length}個`)
    } catch (error) {
      console.error('ルート生成エラー:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <button onClick={handleGenerateRoute} disabled={loading}>
        {loading ? 'ルート生成中...' : 'ルートを生成'}
      </button>

      {route && (
        <div>
          <h2>生成されたルート情報</h2>
          <p>走行距離: {route.totalDistance.toFixed(2)} km</p>
          <p>ウェイポイント数: {route.waypoints.length}</p>
          <p>推定走行時間: {Math.round(route.totalDistance * 6)} 分</p>

          {/* Geoloniaで表示する場合 */}
          <RouteMapDisplay route={route} />
        </div>
      )}
    </div>
  )
}

// ============================================================================
// 2. Geolonia マップでのルート表示
// ============================================================================

interface RouteMapDisplayProps {
  route: OptimizedRoute
}

function RouteMapDisplay({ route }: RouteMapDisplayProps) {
  React.useEffect(() => {
    if (!window.geolonia || !route) return

    // Geolonia 地図の初期化
    const map = (window as any).geolonia?.maps?.get('map')
    if (!map) return

    // ルートパスをポリラインとして表示
    const polylineCoordinates = route.routePath.map((point) => [point.lat, point.lng])

    const polyline = new (window as any).geolonia.maps.Polyline({
      path: polylineCoordinates,
      map: map,
      strokeColor: '#2196F3',
      strokeWeight: 3,
      strokeOpacity: 0.7,
    })

    // ウェイポイントをマーカーで表示
    route.waypoints.forEach((waypoint, index) => {
      const isStart = index === 0
      const isGoal = index === route.waypoints.length - 1

      new (window as any).geolonia.maps.Marker({
        position: [waypoint.lat, waypoint.lng],
        map: map,
        title: isStart ? 'スタート/ゴール' : `ウェイポイント ${index}`,
        icon: isStart || isGoal ? '🚩' : '📍',
      })
    })

    // 地図の視野をルートに合わせる
    const bounds = new (window as any).geolonia.maps.LatLngBounds()
    route.routePath.forEach((point) => {
      bounds.extend([point.lat, point.lng])
    })
    map.fitBounds(bounds)

    return () => {
      polyline.setMap(null)
    }
  }, [route])

  return <div id="map" style={{ width: '100%', height: '500px' }} />
}

// ============================================================================
// 3. 複数ルートを生成して比較する
// ============================================================================

async function generateMultipleRoutes(
  currentLocation: Location,
  timeDurations: number[]
): Promise<OptimizedRoute[]> {
  const routes: OptimizedRoute[] = []

  for (const duration of timeDurations) {
    console.log(`⏱️ ${duration}分ルートを生成中...`)
    const route = await generateOptimizedRunningRoute(currentLocation, duration)
    routes.push(route)
  }

  return routes
}

// 使用例
const location: Location = { lat: 35.6762, lng: 139.7674 }
const multipleRoutes = await generateMultipleRoutes(location, [20, 30, 45, 60])

multipleRoutes.forEach((route, idx) => {
  console.log(`ルート${idx + 1}: ${route.totalDistance.toFixed(2)}km`)
})

// ============================================================================
// 4. ルート情報をJSON形式で保存/共有
// ============================================================================

function exportRouteAsJSON(route: OptimizedRoute): string {
  return JSON.stringify(
    {
      timestamp: new Date().toISOString(),
      totalDistance: route.totalDistance,
      estimatedTime: Math.round(route.totalDistance * 6),
      waypointCount: route.waypoints.length,
      waypoints: route.waypoints.map((wp) => ({
        lat: wp.lat.toFixed(6),
        lng: wp.lng.toFixed(6),
      })),
      routePath: route.routePath.map((pt) => ({
        lat: pt.lat.toFixed(6),
        lng: pt.lng.toFixed(6),
      })),
    },
    null,
    2
  )
}

function importRouteFromJSON(jsonString: string): Partial<OptimizedRoute> {
  const data = JSON.parse(jsonString)

  return {
    totalDistance: data.totalDistance,
    waypoints: data.waypoints.map((wp: any) => ({
      lat: parseFloat(wp.lat),
      lng: parseFloat(wp.lng),
    })),
    routePath: data.routePath.map((pt: any) => ({
      lat: parseFloat(pt.lat),
      lng: parseFloat(pt.lng),
    })),
  }
}

// 使用例
const routeJSON = exportRouteAsJSON(route)
console.log(routeJSON)

// ファイルにダウンロード
const blob = new Blob([routeJSON], { type: 'application/json' })
const url = URL.createObjectURL(blob)
const a = document.createElement('a')
a.href = url
a.download = `running_route_${Date.now()}.json`
a.click()

// ============================================================================
// 5. ルート統計情報を計算
// ============================================================================

interface RouteStatistics {
  totalDistance: number
  estimatedTime: number
  averagePace: number
  waypointCount: number
  totalPathPoints: number
  boundingBox: {
    north: number
    south: number
    east: number
    west: number
  }
}

function calculateRouteStatistics(route: OptimizedRoute): RouteStatistics {
  // ルートの座標範囲を計算
  let north = -90,
    south = 90,
    east = -180,
    west = 180

  route.routePath.forEach((point) => {
    north = Math.max(north, point.lat)
    south = Math.min(south, point.lat)
    east = Math.max(east, point.lng)
    west = Math.min(west, point.lng)
  })

  return {
    totalDistance: route.totalDistance,
    estimatedTime: Math.round(route.totalDistance * 6),
    averagePace: 6,
    waypointCount: route.waypoints.length,
    totalPathPoints: route.routePath.length,
    boundingBox: { north, south, east, west },
  }
}

// ============================================================================
// 6. エラーハンドリング + リトライ機構
// ============================================================================

async function generateRouteWithRetry(
  location: Location,
  minutes: number,
  maxRetries: number = 3
): Promise<OptimizedRoute | null> {
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🔄 ルート生成試行 ${attempt}/${maxRetries}...`)
      const route = await generateOptimizedRunningRoute(location, minutes)
      console.log(`✅ ルート生成成功`)
      return route
    } catch (error) {
      lastError = error as Error
      console.warn(`❌ 試行${attempt}失敗: ${lastError.message}`)

      if (attempt < maxRetries) {
        // 指数バックオフ：1s, 2s, 4s...
        const delay = Math.pow(2, attempt - 1) * 1000
        console.log(`⏳ ${delay}ms 後に再試行します...`)
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }

  console.error(`❌ ${maxRetries}回の試行後も失敗しました`)
  return null
}

// ============================================================================
// 7. バリデーション関数
// ============================================================================

function validateRoute(route: OptimizedRoute, expectedDistance: number): {
  valid: boolean
  issues: string[]
} {
  const issues: string[] = []
  const tolerance = 0.1 // 10%の許容範囲

  // 距離チェック
  const distanceDiff = Math.abs(route.totalDistance - expectedDistance)
  const distanceRatio = distanceDiff / expectedDistance

  if (distanceRatio > tolerance) {
    issues.push(`距離が目標値から${(distanceRatio * 100).toFixed(1)}%ズレています`)
  }

  // ウェイポイントチェック
  if (route.waypoints.length < 3) {
    issues.push('ウェイポイント数が不足しています（最小3個必要）')
  }

  // 最初と最後が同じかチェック（周回ルート確認）
  const first = route.waypoints[0]
  const last = route.waypoints[route.waypoints.length - 1]

  // 緯度経度の差が1m未満なら同一地点と判定
  const distance = Math.sqrt(Math.pow(first.lat - last.lat, 2) + Math.pow(first.lng - last.lng, 2))
  if (distance > 0.00001) {
    issues.push('スタートとゴール地点が同じではありません')
  }

  // ルートパスチェック
  if (route.routePath.length < route.waypoints.length) {
    issues.push('ルートパスポイントが不足しています')
  }

  return {
    valid: issues.length === 0,
    issues,
  }
}

// 使用例
const validation = validateRoute(route, 3.0) // 3km が目標
if (!validation.valid) {
  console.warn('ルート検証エラー:', validation.issues)
}

// ============================================================================
// 8. TypeScript型定義（型安全性の確保）
// ============================================================================

// routeOptimizer.ts で定義されている型
interface Location {
  lat: number
  lng: number
}

interface RouteStep {
  location: Location
  stepIndex: number
  distanceFromStart: number
}

interface OptimizedRoute {
  waypoints: Location[]
  totalDistance: number
  routePath: Location[]
  steps: RouteStep[]
}

// カスタム型を拡張する場合
interface ExtendedRoute extends OptimizedRoute {
  name: string
  difficulty: 'easy' | 'moderate' | 'hard'
  terrain: 'road' | 'trail' | 'mixed'
  scenery: number // 1-5
  safety: number // 1-5
}

function createExtendedRoute(
  baseRoute: OptimizedRoute,
  metadata: Partial<ExtendedRoute>
): ExtendedRoute {
  return {
    ...baseRoute,
    name: metadata.name || 'Unnamed Route',
    difficulty: metadata.difficulty || 'moderate',
    terrain: metadata.terrain || 'mixed',
    scenery: metadata.scenery || 3,
    safety: metadata.safety || 3,
  }
}

