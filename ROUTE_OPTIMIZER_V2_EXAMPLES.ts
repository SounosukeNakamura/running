/**
 * 改善版ルート生成エンジン v2.0 - 実装例・統合コード
 * 
 * App.tsx での統合方法を示します
 */

// ============================================================================
// 1. 改善版 App.tsx - ルート生成部分
// ============================================================================

import React, { useState, useEffect } from 'react'
import { generateOptimizedClosedRoute, OptimizedRoute } from './routeOptimizer.v2'
import { displayRouteOnMap, clearRouteDisplay, MapResource, createRouteInfoHTML } from './geoloniaUtils'

interface AppState {
  location: { lat: number; lng: number } | null
  runningMinutes: string
  route: OptimizedRoute | null
  loading: boolean
  error: string
  mapResources: MapResource | null
}

export default function App() {
  const [state, setState] = useState<AppState>({
    location: null,
    runningMinutes: '30',
    route: null,
    loading: false,
    error: '',
    mapResources: null,
  })

  // 位置情報取得
  useEffect(() => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setState((s) => ({
          ...s,
          location: {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          },
        }))
      },
      () => {
        // デフォルト位置
        setState((s) => ({
          ...s,
          location: { lat: 35.6762, lng: 139.7674 },
        }))
      }
    )
  }, [])

  // ルート生成ハンドラー
  const handleGenerateRoute = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!state.location) {
      setState((s) => ({ ...s, error: '位置情報がありません' }))
      return
    }

    const minutes = parseInt(state.runningMinutes, 10)
    if (isNaN(minutes) || minutes <= 0 || minutes > 300) {
      setState((s) => ({
        ...s,
        error: '走行時間は1～300分の範囲で入力してください',
      }))
      return
    }

    setState((s) => ({ ...s, loading: true, error: '' }))

    try {
      console.log(`🚀 ルート生成開始: ${minutes}分`)

      // ✨ v2.0: 改善されたルート生成
      const generatedRoute = await generateOptimizedClosedRoute(
        state.location,
        minutes,
        6 // 初期ウェイポイント数
      )

      setState((s) => ({
        ...s,
        route: generatedRoute,
      }))

      // 地図に表示
      displayRouteOnMap(generatedRoute)
    } catch (error) {
      console.error('ルート生成エラー:', error)
      setState((s) => ({
        ...s,
        error: 'ルート生成に失敗しました。別の条件でお試しください。',
      }))
    } finally {
      setState((s) => ({ ...s, loading: false }))
    }
  }

  // 地図表示
  const displayRouteOnMap = async (route: OptimizedRoute) => {
    try {
      const mapElement = document.getElementById('map')
      if (!mapElement || !window.geolonia) {
        console.warn('Geolonia map not ready')
        return
      }

      const map = (window as any).geolonia.maps.get(mapElement)

      // ✨ v2.0: ウェイポイントマーカーは非表示
      const resources = await (
        window as any
      ).displayRouteOnMapImproved(
        map,
        route.routePath,
        route.startLocation,
        {
          hideWaypointMarkers: true, // 重要：ウェイポイントは表示しない
          routeColor: '#2196F3',
          routeWeight: 4,
          routeOpacity: 0.8,
        }
      )

      setState((s) => ({
        ...s,
        mapResources: resources,
      }))

      console.log('✅ ルート表示完了')
    } catch (error) {
      console.error('地図表示エラー:', error)
    }
  }

  // クリーンアップ
  useEffect(() => {
    return () => {
      if (state.mapResources && window.geolonia) {
        const mapElement = document.getElementById('map')
        const map = (window as any).geolonia.maps.get(mapElement)
        clearRouteDisplay(map, state.mapResources)
      }
    }
  }, [state.mapResources])

  return (
    <div className="app">
      <header>
        <h1>🏃 改善版ランニングコース提案アプリ v2.0</h1>
      </header>

      <main>
        {/* エラー表示 */}
        {state.error && (
          <div className="alert alert-error">
            <span>⚠️ {state.error}</span>
          </div>
        )}

        {/* 入力フォーム */}
        <section className="card">
          <h2>走行時間を入力</h2>
          <form onSubmit={handleGenerateRoute}>
            <div className="form-group">
              <label>
                走りたい時間（分）
                <input
                  type="number"
                  min="1"
                  max="300"
                  value={state.runningMinutes}
                  onChange={(e) =>
                    setState((s) => ({
                      ...s,
                      runningMinutes: e.target.value,
                    }))
                  }
                />
              </label>
            </div>
            <button type="submit" disabled={state.loading}>
              {state.loading ? 'ルート生成中...' : 'ルートを生成'}
            </button>
          </form>
        </section>

        {/* 地図 */}
        <section className="card">
          <h2>🗺️ ランニングコース</h2>
          <div
            id="map"
            className="geolonia-map"
            data-lat={state.location?.lat || 35.6762}
            data-lng={state.location?.lng || 139.7674}
            data-zoom="14"
            style={{ width: '100%', height: '500px' }}
          />
        </section>

        {/* ルート情報 */}
        {state.route && (
          <section className="card">
            <h2>📊 ルート詳細</h2>
            <div className="route-info">
              <dl>
                <dt>走行距離</dt>
                <dd>{state.route.totalDistance.toFixed(2)} km</dd>

                <dt>推定走行時間</dt>
                <dd>{Math.round(state.route.estimatedTime)} 分</dd>

                <dt>ペース</dt>
                <dd>
                  {(state.route.estimatedTime / state.route.totalDistance).toFixed(1)} 分/km
                </dd>

                <dt>経由点数</dt>
                <dd>{state.route.waypoints.length} 地点</dd>
              </dl>

              <div className="route-notes">
                <h3>✓ このルートの特徴</h3>
                <ul>
                  <li>✅ スタート = ゴール地点（現在地）</li>
                  <li>✅ 全区間が道路に沿ったルート</li>
                  <li>✅ 入力時間内に調整済み</li>
                  <li>✅ 指定時間内で最大距離を実現</li>
                </ul>
              </div>

              {/* ルートセグメント情報 */}
              <details>
                <summary>ルートセグメント詳細（{state.route.segments.length}区間）</summary>
                <div className="segments-list">
                  {state.route.segments.map((seg, idx) => (
                    <div key={idx} className="segment-item">
                      <span className="segment-index">{idx + 1}</span>
                      <span className="segment-distance">{seg.distance.toFixed(2)}km</span>
                      <span className="segment-duration">{seg.duration.toFixed(1)}分</span>
                    </div>
                  ))}
                </div>
              </details>
            </div>
          </section>
        )}
      </main>
    </div>
  )
}

// ============================================================================
// 2. Geolonia の初期化スクリプト（HTML の <head> に追加）
// ============================================================================

/*
<script>
  window.addEventListener('load', function() {
    // Geolonia の初期化
    if (window.geolonia) {
      // 改善版表示関数をグローバルにアタッチ
      window.displayRouteOnMapImproved = async function(map, routePath, startLocation, config) {
        // geoloniaUtils.ts の displayRouteOnMap を呼び出し
        // または、以下のようにインラインで実装
        
        const polyline = new window.geolonia.maps.Polyline({
          path: routePath.map(p => [p.lat, p.lng]),
          map: map,
          strokeColor: config?.routeColor || '#2196F3',
          strokeWeight: config?.routeWeight || 4,
          strokeOpacity: config?.routeOpacity || 0.8
        })
        
        const marker = new window.geolonia.maps.Marker({
          position: [startLocation.lat, startLocation.lng],
          map: map,
          title: 'スタート＝ゴール',
          icon: '🚩'
        })
        
        // マップビューを調整
        const bounds = new window.geolonia.maps.LatLngBounds()
        routePath.forEach(p => bounds.extend([p.lat, p.lng]))
        map.fitBounds(bounds, { padding: 50 })
        
        return {
          polyline: polyline,
          markers: { startGoal: marker, waypoints: [] }
        }
      }
    }
  })
</script>
*/

// ============================================================================
// 3. CSS スタイル（App.css に追加）
// ============================================================================

/*
.route-info {
  margin-top: 2rem;
  padding: 1.5rem;
  background-color: #f5f5f5;
  border-radius: 8px;
}

.route-info dl {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.route-info dt {
  font-weight: 600;
  color: #667eea;
}

.route-info dd {
  font-size: 1.25rem;
  font-weight: 700;
  color: #2c3e50;
}

.route-notes {
  background-color: #e8f5e9;
  padding: 1rem;
  border-left: 4px solid #4caf50;
  border-radius: 4px;
  margin-bottom: 1rem;
}

.route-notes h3 {
  margin-top: 0;
  color: #2e7d32;
  font-size: 1rem;
}

.route-notes ul {
  margin: 0.5rem 0;
  padding-left: 1.5rem;
}

.route-notes li {
  color: #1b5e20;
  margin: 0.25rem 0;
}

.segments-list {
  max-height: 400px;
  overflow-y: auto;
  padding: 1rem;
  background-color: #f9f9f9;
  border-radius: 4px;
}

.segment-item {
  display: flex;
  align-items: center;
  padding: 0.75rem;
  margin: 0.5rem 0;
  background-color: white;
  border-left: 3px solid #2196f3;
  border-radius: 4px;
  gap: 1rem;
  font-family: 'Monaco', 'Courier New', monospace;
  font-size: 0.9rem;
}

.segment-index {
  font-weight: 600;
  color: #2196f3;
  min-width: 30px;
}

.segment-distance {
  flex: 1;
  color: #666;
}

.segment-duration {
  color: #4caf50;
  font-weight: 500;
}
*/

// ============================================================================
// 4. TypeScript 型定義の拡張
// ============================================================================

declare global {
  interface Window {
    geolonia?: {
      maps?: {
        get(element: string | HTMLElement): any
        Polyline: any
        Marker: any
        LatLngBounds: any
      }
      onReady?(callback: () => void): void
    }
    displayRouteOnMapImproved?(
      map: any,
      routePath: Array<{ lat: number; lng: number }>,
      startLocation: { lat: number; lng: number },
      config?: {
        hideWaypointMarkers?: boolean
        routeColor?: string
        routeWeight?: number
        routeOpacity?: number
      }
    ): Promise<any>
  }
}

// ============================================================================
// 5. テスト・デバッグ用ユーティリティ
// ============================================================================

/**
 * ルート生成のログ出力を設定
 */
export function enableRouteDebugLogging(): void {
  const originalLog = console.log
  const originalError = console.error

  console.log = function (...args: any[]) {
    if (args[0]?.includes?.('🚀') || args[0]?.includes?.('✅')) {
      originalLog.apply(console, ['[ROUTE DEBUG]', ...args])
    } else {
      originalLog.apply(console, args)
    }
  }

  console.error = function (...args: any[]) {
    originalError.apply(console, ['[ROUTE ERROR]', ...args])
  }
}

/**
 * ルート生成のパフォーマンス測定
 */
export async function measureRouteGeneration(
  location: { lat: number; lng: number },
  minutes: number
): Promise<{
  duration: number
  route: any
}> {
  const startTime = performance.now()

  const route = await (window as any).generateOptimizedClosedRoute(location, minutes)

  const endTime = performance.now()

  return {
    duration: endTime - startTime,
    route,
  }
}

/**
 * 複数のルート条件でテスト実行
 */
export async function testMultipleRoutes(location: { lat: number; lng: number }): Promise<void> {
  const testCases = [
    { minutes: 20, name: '20分ルート' },
    { minutes: 30, name: '30分ルート' },
    { minutes: 45, name: '45分ルート' },
    { minutes: 60, name: '60分ルート' },
  ]

  console.log('🧪 ルート生成テスト開始\n')

  for (const testCase of testCases) {
    try {
      const result = await measureRouteGeneration(location, testCase.minutes)

      console.log(`✅ ${testCase.name}:`)
      console.log(`   生成時間: ${result.duration.toFixed(1)}ms`)
      console.log(`   距離: ${result.route.totalDistance.toFixed(2)}km`)
      console.log(`   時間: ${result.route.estimatedTime.toFixed(1)}分\n`)
    } catch (error) {
      console.error(`❌ ${testCase.name}: ${error}\n`)
    }
  }
}

// ============================================================================
// 6. 使用例：スタンドアロン実行
// ============================================================================

/*
// Node.js または ブラウザコンソールで実行可能

import { generateOptimizedClosedRoute } from './routeOptimizer.v2'

// 東京での30分ランニングコース
const location = { lat: 35.6762, lng: 139.7674 }
const minutes = 30

generateOptimizedClosedRoute(location, minutes).then(route => {
  console.log('✅ ルート生成成功')
  console.log(`距離: ${route.totalDistance.toFixed(2)}km`)
  console.log(`時間: ${route.estimatedTime.toFixed(1)}分`)
  console.log(`経由点: ${route.waypoints.length}個`)
  console.log(`ルートパス: ${route.routePath.length}点`)
}).catch(error => {
  console.error('❌ ルート生成失敗:', error)
})
*/
