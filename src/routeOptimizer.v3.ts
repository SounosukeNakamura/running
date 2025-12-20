/**
 * ルート生成エンジン v3.0 - 複数候補比較による最適化版
 * 
 * 改善点：
 * 1. 複数のルート候補（10〜30個）を生成
 * 2. 各候補について重複度を計算（往復で同じ道を通わないか）
 * 3. 時間と重複度の複合スコアで最適なルートを選択
 * 4. 推定走行時間は入力時間を絶対に超えない
 * 5. 目標時間に最も近いルートを優先
 */

import {
  Location,
  RouteSegment,
  OptimizedRoute,
  calculateStraightLineDistance,
  calculateBearing,
  getLocationByBearingAndDistance,
  generateCircularWaypoints,
  getClosedRouteGeometry,
  getSegmentRouteInfo,
  evaluateRoute,
} from './routeOptimizer.v2'

// ===== 定数 =====
const RUNNING_PACE_MIN_PER_KM = 6
const MIN_ROUTE_CANDIDATES = 10
const MAX_ROUTE_CANDIDATES = 30
const DUPLICATE_THRESHOLD_METERS = 20

// ルート候補の内部評価用
interface RouteCandidate {
  waypoints: Location[]
  routeInfo: {
    totalDistance: number
    estimatedTime: number
    segments: RouteSegment[]
  }
  routePath: Location[]
  duration: number // 秒
  duplicateRatio: number // 0-1 の重複度（低いほど良い）
  score: number // 複合スコア（低いほど良い）
}

/**
 * ルートパス内での重複度を計算
 * @param routePath ルート上の座標列
 * @returns 重複度（0-1、低いほど重複が少ない）
 */
function calculateDuplicateRatio(routePath: Location[]): number {
  if (routePath.length < 4) return 0

  // ルートを前半と後半に分割
  const midPoint = Math.floor(routePath.length / 2)
  const firstHalf = routePath.slice(0, midPoint)
  const secondHalf = routePath.slice(midPoint)

  if (firstHalf.length === 0 || secondHalf.length === 0) return 0

  let duplicateCount = 0

  // 前半の各点について、後半で近い点があるかチェック
  for (const point1 of firstHalf) {
    for (const point2 of secondHalf) {
      const distance = calculateStraightLineDistance(point1, point2)
      if (distance * 1000 <= DUPLICATE_THRESHOLD_METERS) {
        // DUPLICATE_THRESHOLD_METERS以内の近い点が見つかった
        duplicateCount++
        break // この point1 についてはカウント完了
      }
    }
  }

  // 重複度 = (重複した点の数) / (前半の点数)
  const ratio = duplicateCount / firstHalf.length
  return Math.min(ratio, 1.0)
}

/**
 * ランニング時間から最適化された周回ルートを生成（複数候補比較版）
 * 
 * 特徴：
 * - スタート = ゴール地点
 * - 複数の周回ルート候補（10〜30個）を生成し比較
 * - 重複度が低い（同じ道を通わない）ルートを優先
 * - 推定時間が目標値に最も近いルートを選択
 * - 走行時間が入力値を超えない
 */
export async function generateOptimizedClosedRoute(
  startLocation: Location,
  maxRunningMinutes: number,
  initialWaypointCount: number = 6
): Promise<OptimizedRoute> {
  if (maxRunningMinutes <= 0 || maxRunningMinutes > 300) {
    throw new Error('Running time must be between 1 and 300 minutes')
  }

  const targetSeconds = maxRunningMinutes * 60
  const maxDurationSeconds = targetSeconds - 5 // 5秒のマージン

  console.log(
    `\n🚀 Starting optimized route generation (${maxRunningMinutes}min, ${startLocation.lat.toFixed(4)}, ${startLocation.lng.toFixed(4)})`
  )
  console.log(`   Target duration: ${targetSeconds}s, Max allowed: ${maxDurationSeconds}s`)

  // 複数スケールで候補を生成
  const candidates: RouteCandidate[] = []
  const scaleFactors = [0.8, 0.85, 0.9, 0.95, 1.0]

  for (const scale of scaleFactors) {
    const targetTime = maxRunningMinutes * scale
    console.log(`\n📍 Generating candidates with scale ${scale.toFixed(2)} (target: ${targetTime.toFixed(1)}min)`)

    try {
      // ウェイポイント数を段階的に試す
      for (let numWaypoints = 4; numWaypoints <= 8; numWaypoints++) {
        try {
          const randomWaypoints = generateCircularWaypoints(
            startLocation,
            targetTime / RUNNING_PACE_MIN_PER_KM,
            numWaypoints
          )

          const routeInfo = await evaluateRoute(startLocation, randomWaypoints)
          const duration = routeInfo.estimatedTime * 60

          if (duration > maxDurationSeconds) {
            console.log(`   ⏱️ ${numWaypoints}pts: Time exceeded ${duration.toFixed(0)}s > ${maxDurationSeconds}s`)
            break // この scale はこれ以上試さない
          }

          // ルートパスを取得
          const closedWaypoints = [startLocation, ...randomWaypoints, startLocation]
          let routePath: Location[] = []

          try {
            const routeGeometry = await getClosedRouteGeometry(closedWaypoints)
            routePath = routeGeometry.path
          } catch (error) {
            routePath = closedWaypoints
          }

          // 重複度を計算
          const duplicateRatio = calculateDuplicateRatio(routePath)

          // スコア計算：時間が目標に近く、重複度が低いほど低スコア
          const timeDiff = Math.abs(targetSeconds - duration)
          const score = timeDiff * 0.7 + duplicateRatio * 100 * 0.3

          const candidate: RouteCandidate = {
            waypoints: randomWaypoints,
            routeInfo,
            routePath,
            duration,
            duplicateRatio,
            score,
          }

          candidates.push(candidate)
          console.log(
            `   ✓ ${numWaypoints}pts: time=${duration.toFixed(0)}s, dup=${(duplicateRatio * 100).toFixed(1)}%, score=${score.toFixed(1)}`
          )
        } catch (error) {
          console.log(`   ✗ ${numWaypoints}pts: Error`)
          continue
        }
      }
    } catch (error) {
      console.log(`   ✗ Scale ${scale.toFixed(2)}: Error`)
      continue
    }
  }

  // 追加ランダム候補を生成
  if (candidates.length < MIN_ROUTE_CANDIDATES) {
    console.log(`\n🎲 Generating ${MIN_ROUTE_CANDIDATES - candidates.length} more random candidates...`)

    for (let i = candidates.length; i < MAX_ROUTE_CANDIDATES; i++) {
      try {
        // ランダムなウェイポイント数（4〜8）で候補を生成
        const randomNumWaypoints = 4 + Math.floor(Math.random() * 5)
        const randomScale = 0.8 + Math.random() * 0.2
        const randomWaypoints = generateCircularWaypoints(
          startLocation,
          (maxRunningMinutes / RUNNING_PACE_MIN_PER_KM) * randomScale,
          randomNumWaypoints
        )

        const routeInfo = await evaluateRoute(startLocation, randomWaypoints)
        const duration = routeInfo.estimatedTime * 60

        if (duration > maxDurationSeconds) continue

        const closedWaypoints = [startLocation, ...randomWaypoints, startLocation]
        let routePath: Location[] = []

        try {
          const routeGeometry = await getClosedRouteGeometry(closedWaypoints)
          routePath = routeGeometry.path
        } catch {
          routePath = closedWaypoints
        }

        const duplicateRatio = calculateDuplicateRatio(routePath)
        const timeDiff = Math.abs(targetSeconds - duration)
        const score = timeDiff * 0.7 + duplicateRatio * 100 * 0.3

        candidates.push({
          waypoints: randomWaypoints,
          routeInfo,
          routePath,
          duration,
          duplicateRatio,
          score,
        })

        if (candidates.length >= MAX_ROUTE_CANDIDATES) break
      } catch (error) {
        continue
      }
    }
  }

  // 候補がない場合はエラー
  if (candidates.length === 0) {
    throw new Error(
      `指定条件でルートを生成できませんでした。時間を増やすか再試行してください。`
    )
  }

  // スコア順でソート（低いほど良い）
  candidates.sort((a, b) => a.score - b.score)

  const bestCandidate = candidates[0]

  console.log(`\n✅ Best route selected:`)
  console.log(`   Candidates evaluated: ${candidates.length}`)
  console.log(`   Distance: ${bestCandidate.routeInfo.totalDistance.toFixed(2)}km`)
  console.log(`   Time: ${bestCandidate.duration.toFixed(0)}s (${(bestCandidate.duration / 60).toFixed(1)}min)`)
  console.log(`   Target: ${targetSeconds}s (${maxRunningMinutes}min)`)
  console.log(`   Duplicate ratio: ${(bestCandidate.duplicateRatio * 100).toFixed(1)}%`)
  console.log(`   Score: ${bestCandidate.score.toFixed(1)}`)

  return {
    startLocation,
    waypoints: bestCandidate.waypoints,
    segments: bestCandidate.routeInfo.segments,
    totalDistance: bestCandidate.routeInfo.totalDistance,
    estimatedTime: bestCandidate.routeInfo.estimatedTime,
    routePath: bestCandidate.routePath,
    displayMarkers: {
      startGoal: startLocation,
    },
  }
}

/**
 * ユーティリティ：走行距離からランニング時間を推定
 */
export function estimateRunningTime(distanceKm: number): number {
  return distanceKm * RUNNING_PACE_MIN_PER_KM
}

/**
 * ユーティリティ：ランニング時間から推定距離を計算
 */
export function estimateRunningDistance(timeMinutes: number): number {
  return timeMinutes / RUNNING_PACE_MIN_PER_KM
}
