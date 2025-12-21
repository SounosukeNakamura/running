/**
 * ランニングコース提案アプリ - 実装例とテストコード
 * routeOptimizer.v4.ts の使用例とテストケース
 */

import {
  generateOptimizedRoundTripRoute,
  validateRoundTripRoute,
  estimateRunningDistance,
  estimateRunningTime,
} from './src/routeOptimizer.v4'
import { OptimizedRoute } from './src/routeOptimizer.v2'

/**
 * ============================================
 * 1. 基本的な使用例
 * ============================================
 */

/**
 * 例1: 東京駅から30分のランニングコース生成
 */
async function example1_TokyoStation30Min() {
  console.log('\n【例1】東京駅から30分のランニングコース')
  console.log('=========================================')

  try {
    const currentLocation = { lat: 35.6762, lng: 139.7674 } // 東京駅
    const desiredMinutes = 30

    const route = await generateOptimizedRoundTripRoute(currentLocation, desiredMinutes)

    console.log(`\n✅ ルート生成成功`)
    console.log(`   往復距離: ${route.totalDistance.toFixed(2)}km`)
    console.log(`   推定時間: ${route.estimatedTime.toFixed(1)}分`)
    console.log(`   ウェイポイント数: ${route.waypoints.length}個`)
    console.log(`   ルート座標数: ${route.routePath.length}個`)

    // ルート検証
    const validation = validateRoundTripRoute(route, desiredMinutes)
    if (validation.isValid) {
      console.log(`\n✅ ルート検証: 合格`)
    } else {
      console.log(`\n❌ ルート検証: 失敗`)
      validation.errors.forEach((e) => console.error(`   エラー: ${e}`))
    }

    if (validation.warnings.length > 0) {
      console.log(`\n⚠️ 警告:`)
      validation.warnings.forEach((w) => console.warn(`   ${w}`))
    }
  } catch (error) {
    console.error(`❌ エラー: ${error.message}`)
  }
}

/**
 * 例2: 複数の走行時間でコース生成（パラメータバリエーション）
 */
async function example2_MultipleTimeVariations() {
  console.log('\n【例2】複数の走行時間パターン')
  console.log('=========================================')

  const currentLocation = { lat: 35.6762, lng: 139.7674 }
  const timeVariations = [10, 20, 30, 45, 60]

  for (const minutes of timeVariations) {
    try {
      console.log(`\n[${minutes}分コース生成中...]`)
      const route = await generateOptimizedRoundTripRoute(currentLocation, minutes)

      console.log(
        `✓ ${minutes}分: 往復${route.totalDistance.toFixed(2)}km / ` +
          `推定${route.estimatedTime.toFixed(1)}分 / ` +
          `差分${(route.estimatedTime - minutes).toFixed(1)}分`
      )
    } catch (error) {
      console.error(`✗ ${minutes}分: ${error.message}`)
    }
  }
}

/**
 * 例3: 複数地点からのコース生成（地域による比較）
 */
async function example3_MultipleLocations() {
  console.log('\n【例3】複数地点からの30分コース生成')
  console.log('=========================================')

  const locations = {
    '東京駅': { lat: 35.6762, lng: 139.7674 },
    '渋谷駅': { lat: 35.6595, lng: 139.7004 },
    '新宿駅': { lat: 35.6895, lng: 139.7006 },
    '品川駅': { lat: 34.6329, lng: 139.7396 },
  }

  const desiredMinutes = 30

  for (const [name, location] of Object.entries(locations)) {
    try {
      console.log(`\n[${name}から生成中...]`)
      const route = await generateOptimizedRoundTripRoute(location, desiredMinutes)

      console.log(`✓ ${name}: ${route.totalDistance.toFixed(2)}km / ${route.estimatedTime.toFixed(1)}分`)
    } catch (error) {
      console.error(`✗ ${name}: ${error.message}`)
    }
  }
}

/**
 * ============================================
 * 2. 詳細な分析例
 * ============================================
 */

/**
 * 例4: ルート情報の詳細分析
 */
async function example4_DetailedRouteAnalysis() {
  console.log('\n【例4】ルート詳細分析')
  console.log('=========================================')

  try {
    const currentLocation = { lat: 35.6762, lng: 139.7674 }
    const desiredMinutes = 30

    const route = await generateOptimizedRoundTripRoute(currentLocation, desiredMinutes)

    console.log('\n【ルート基本情報】')
    console.log(`  スタート地点: (${route.startLocation.lat.toFixed(5)}, ${route.startLocation.lng.toFixed(5)})`)
    console.log(`  ゴール地点: (${route.displayMarkers.startGoal.lat.toFixed(5)}, ${route.displayMarkers.startGoal.lng.toFixed(5)})`)
    console.log(`  往復距離: ${route.totalDistance.toFixed(2)}km`)
    console.log(`  推定時間: ${route.estimatedTime.toFixed(1)}分`)
    console.log(`  平均ペース: ${(route.estimatedTime / (route.totalDistance / 2)).toFixed(2)}分/km`)

    console.log('\n【ウェイポイント情報】')
    console.log(`  ウェイポイント数: ${route.waypoints.length}`)
    route.waypoints.forEach((wp, index) => {
      console.log(`    WP${index + 1}: (${wp.lat.toFixed(5)}, ${wp.lng.toFixed(5)})`)
    })

    console.log('\n【ルートパス情報】')
    console.log(`  ルートパス座標数: ${route.routePath.length}`)
    console.log(`  開始地点: (${route.routePath[0].lat.toFixed(5)}, ${route.routePath[0].lng.toFixed(5)})`)
    console.log(`  終了地点: (${route.routePath[route.routePath.length - 1].lat.toFixed(5)}, ${route.routePath[route.routePath.length - 1].lng.toFixed(5)})`)

    // 距離計算テスト
    const halfPathLength = Math.floor(route.routePath.length / 2)
    const midpoint = route.routePath[halfPathLength]
    console.log(`  中間地点: (${midpoint.lat.toFixed(5)}, ${midpoint.lng.toFixed(5)})`)

    console.log('\n【セグメント情報】')
    if (route.segments && route.segments.length > 0) {
      console.log(`  セグメント数: ${route.segments.length}`)
      route.segments.slice(0, 5).forEach((seg, index) => {
        console.log(
          `    Seg${index + 1}: ${seg.distance.toFixed(3)}km / ${seg.estimatedTime.toFixed(1)}分`
        )
      })
      if (route.segments.length > 5) {
        console.log(`    ... (残り ${route.segments.length - 5} セグメント)`)
      }
    }
  } catch (error) {
    console.error(`❌ エラー: ${error.message}`)
  }
}

/**
 * 例5: 時間推定ユーティリティの確認
 */
function example5_TimeEstimationUtilities() {
  console.log('\n【例5】時間推定ユーティリティ')
  console.log('=========================================')

  // ランニング時間から推定距離を計算
  const testTimes = [10, 20, 30, 45, 60]
  console.log('\n【時間 → 距離推定】')
  console.log('(標準ペース: 6分/km)')
  for (const minutes of testTimes) {
    const distance = estimateRunningDistance(minutes)
    console.log(`  ${minutes}分 → ${distance.toFixed(2)}km`)
  }

  // 距離からランニング時間を推定
  const testDistances = [1, 2, 3, 5, 10]
  console.log('\n【距離 → 時間推定】')
  for (const km of testDistances) {
    const time = estimateRunningTime(km)
    console.log(`  ${km}km → ${time.toFixed(1)}分`)
  }

  // 往復距離から推定時間
  console.log('\n【往復ルート推定】')
  for (const desiredMinutes of [20, 30, 60]) {
    const oneWayDistance = estimateRunningDistance(desiredMinutes / 2)
    const roundTripDistance = oneWayDistance * 2
    console.log(
      `  ${desiredMinutes}分: 片道${oneWayDistance.toFixed(2)}km → ` +
        `往復${roundTripDistance.toFixed(2)}km`
    )
  }
}

/**
 * ============================================
 * 3. エラーハンドリング例
 * ============================================
 */

/**
 * 例6: エラーハンドリングと例外処理
 */
async function example6_ErrorHandling() {
  console.log('\n【例6】エラーハンドリング')
  console.log('=========================================')

  const testCases = [
    { location: { lat: 35.6762, lng: 139.7674 }, minutes: 0, description: '無効な時間（0分）' },
    { location: { lat: 35.6762, lng: 139.7674 }, minutes: -10, description: '負の時間' },
    { location: { lat: 35.6762, lng: 139.7674 }, minutes: 500, description: '過度に長い時間（500分）' },
  ]

  for (const testCase of testCases) {
    console.log(`\n[テスト] ${testCase.description}`)
    try {
      const route = await generateOptimizedRoundTripRoute(testCase.location, testCase.minutes)
      console.log(`  ✓ 予期しない成功: ${route.totalDistance.toFixed(2)}km`)
    } catch (error) {
      console.log(`  ✓ 予期されたエラーをキャッチ: ${error.message}`)
    }
  }
}

/**
 * ============================================
 * 4. React コンポーネント統合例
 * ============================================
 */

/**
 * React ランニングコース生成コンポーネント
 */
async function example7_ReactIntegration() {
  console.log('\n【例7】React統合サンプルコード')
  console.log('=========================================')

  const sampleCode = `
import React, { useState } from 'react'
import { generateOptimizedRoundTripRoute, validateRoundTripRoute } from './src/routeOptimizer.v4'

export function RunningCourseGenerator() {
  const [desiredMinutes, setDesiredMinutes] = useState(30)
  const [route, setRoute] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [validation, setValidation] = useState(null)

  const handleGenerateRoute = async () => {
    setLoading(true)
    setError(null)

    try {
      // GPS位置情報取得
      const position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject)
      })

      const currentLocation = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      }

      // ルート生成
      const generatedRoute = await generateOptimizedRoundTripRoute(
        currentLocation,
        desiredMinutes
      )

      setRoute(generatedRoute)

      // ルート検証
      const validationResult = validateRoundTripRoute(generatedRoute, desiredMinutes)
      setValidation(validationResult)

      // 地図に表示
      if (window.geolonia && window.geolonia.maps) {
        const map = getMapInstance() // 既存の地図インスタンスを取得
        await displayRouteOnMap(map, generatedRoute.routePath, currentLocation)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ padding: '20px' }}>
      <h1>🏃 ランニングコース生成</h1>

      <div style={{ marginBottom: '20px' }}>
        <label>
          走りたい時間（分）:
          <input
            type="number"
            value={desiredMinutes}
            onChange={(e) => setDesiredMinutes(parseInt(e.target.value) || 30)}
            min="1"
            max="300"
            style={{ marginLeft: '10px', padding: '5px' }}
          />
        </label>
      </div>

      <button
        onClick={handleGenerateRoute}
        disabled={loading}
        style={{
          padding: '10px 20px',
          backgroundColor: loading ? '#ccc' : '#007bff',
          color: 'white',
          border: 'none',
          borderRadius: '5px',
          cursor: loading ? 'default' : 'pointer',
        }}
      >
        {loading ? '生成中...' : 'コース生成'}
      </button>

      {error && (
        <div style={{ marginTop: '20px', color: 'red' }}>
          <h3>❌ エラー</h3>
          <p>{error}</p>
        </div>
      )}

      {route && (
        <div style={{ marginTop: '20px' }}>
          <h2>✅ 生成されたコース</h2>
          <div style={{ backgroundColor: '#f0f0f0', padding: '15px', borderRadius: '5px' }}>
            <p><strong>往復距離:</strong> {route.totalDistance.toFixed(2)}km</p>
            <p><strong>推定時間:</strong> {route.estimatedTime.toFixed(1)}分</p>
            <p><strong>目標時間:</strong> {desiredMinutes}分</p>
            <p><strong>時間差:</strong> {(route.estimatedTime - desiredMinutes).toFixed(1)}分</p>
            <p><strong>ウェイポイント数:</strong> {route.waypoints.length}個</p>
          </div>

          {validation && (
            <div style={{ marginTop: '20px' }}>
              {validation.isValid ? (
                <p style={{ color: 'green' }}>✅ ルート検証: 合格</p>
              ) : (
                <div>
                  <p style={{ color: 'red' }}>❌ ルート検証: 失敗</p>
                  <ul style={{ color: 'red' }}>
                    {validation.errors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}
              {validation.warnings.length > 0 && (
                <ul style={{ color: 'orange' }}>
                  {validation.warnings.map((warn, i) => (
                    <li key={i}>{warn}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div id="map" style={{ width: '100%', height: '600px', marginTop: '20px' }} />
        </div>
      )}
    </div>
  )
}
  `

  console.log(sampleCode)
}

/**
 * ============================================
 * 5. テスト実行
 * ============================================
 */

/**
 * すべてのテストを実行
 */
export async function runAllExamples() {
  console.log('\n' + '='.repeat(50))
  console.log('ランニングコース提案アプリ - 実装例実行')
  console.log('='.repeat(50))

  try {
    // 基本例
    await example1_TokyoStation30Min()
    await example2_MultipleTimeVariations()
    await example3_MultipleLocations()

    // 詳細分析
    await example4_DetailedRouteAnalysis()

    // ユーティリティ
    example5_TimeEstimationUtilities()

    // エラーハンドリング
    await example6_ErrorHandling()

    // React統合例
    await example7_ReactIntegration()

    console.log('\n' + '='.repeat(50))
    console.log('✅ すべての例が完了しました')
    console.log('='.repeat(50))
  } catch (error) {
    console.error('\n❌ テスト実行エラー:', error)
  }
}

// 実行例：Node.js環境で実行する場合
// runAllExamples().catch(console.error)
