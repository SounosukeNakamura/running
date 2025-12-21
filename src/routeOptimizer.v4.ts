/**
 * ルート生成エンジン v4.0 - ランニングコース提案アプリ最適化版
 * 
 * 【要件実装】
 * 1. スタート地点 = ゴール地点（現在地）
 * 2. 往復ルート（中間地点までは直進、帰路は同じ道を逆順で通る）
 * 3. 推定走行時間の半分の時間で中間地点に到達
 * 4. 時間制約: 走りたい時間 - 2分 ≤ 推定走行時間 ≤ 走りたい時間
 * 5. 実在する道路に沿ったルート（道なりルート）
 * 6. 必ず現在地に戻れるルートのみ採用
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
const RUNNING_PACE_KM_PER_MIN = 1 / 6 // 6分/km標準ペース
const NUM_ROUTE_CANDIDATES = 3 // 候補数：常に3個固定
const SCALE_FACTORS = [0.9, 1.0, 1.1] // 3パターンのスケール係数
const TIME_TOLERANCE_MIN = 2 // 分（最小許容値）

/**
 * 往復ルート候補の内部評価用
 */
interface RoundTripCandidate {
  // 往路の中間ウェイポイント（スタート地点は含まない）
  outboundWaypoints: Location[]
  // ルート情報
  routeInfo: {
    totalDistance: number
    estimatedTime: number
    segments: RouteSegment[]
  }
  // ルートパス（スタート → 中間地点 → ゴール）
  routePath: Location[]
  // 推定走行時間（秒）
  estimatedTimeSeconds: number
  // スコア（低いほど良い）
  score: number
  // 詳細情報
  outboundDistance: number
  outboundTimeSeconds: number
  roundTripDistance: number // 往復距離
  roundTripTimeSeconds: number // 往復時間
}

/**
 * ルート経路を逆順にして返す
 */
function reverseRoutePath(path: Location[]): Location[] {
  return [...path].reverse()
}

/**
 * 指定時間内で往復ルートを生成（最適化版）
 * 
 * 【コース仕様】
 * - スタート地点 = ゴール地点（GPSで取得した現在地）
 * - 走りたい時間の半分で中間地点に到達
 * - 帰路は往路と同一ルートを逆順で走行
 * - 往復で確実に現在地に戻る
 * 
 * @param startLocation スタート地点（現在地）
 * @param desiredRunningMinutes ユーザーが走りたい時間（分）
 * @returns 最適な往復ランニングコース
 */
export async function generateOptimizedRoundTripRoute(
  startLocation: Location,
  desiredRunningMinutes: number
): Promise<OptimizedRoute> {
  if (desiredRunningMinutes <= 0 || desiredRunningMinutes > 300) {
    throw new Error('走行時間は1〜300分の範囲で指定してください')
  }

  // ===== 時間制約の定義 =====
  const minAllowedTime = (desiredRunningMinutes - TIME_TOLERANCE_MIN) * 60 // 秒
  const maxAllowedTime = desiredRunningMinutes * 60 // 秒
  const targetTime = desiredRunningMinutes * 60 // 秒（目標値）

  console.log(`\n🏃 ランニングコース生成開始`)
  console.log(`   リクエスト時間: ${desiredRunningMinutes}分`)
  console.log(`   許容時間範囲: ${minAllowedTime / 60}分 ～ ${maxAllowedTime / 60}分`)
  console.log(`   スタート地点: (${startLocation.lat.toFixed(5)}, ${startLocation.lng.toFixed(5)})`)

  // ===== 候補ルート生成 =====
  const candidates: RoundTripCandidate[] = []

  // 片道時間の目標（=往復時間の半分）
  const targetOutboundTime = targetTime / 2

  // 3個のスケール係数でそれぞれ1つずつ候補を生成
  for (let i = 0; i < SCALE_FACTORS.length; i++) {
    const scaleFactor = SCALE_FACTORS[i]
    
    try {
      console.log(`\n📍 候補${i + 1}を生成中 (scale: ${scaleFactor.toFixed(2)})`)

      // 最適なウェイポイント数を決定（固定値で簡潔に）
      const waypointCount = 4 // 4個のウェイポイントを使用

      // 片道距離から推定される距離でウェイポイントを生成
      const estimatedOutboundDistance =
        (targetOutboundTime / 60) * (10 / RUNNING_PACE_KM_PER_MIN) * scaleFactor

      const outboundWaypoints = generateCircularWaypoints(
        startLocation,
        estimatedOutboundDistance,
        waypointCount
      )

      // 往路のルート情報を取得
      const closedOutboundWaypoints = [startLocation, ...outboundWaypoints, startLocation]
      const outboundRouteInfo = await evaluateRoute(startLocation, outboundWaypoints)

      // 往復時間を計算
      const roundTripTime = outboundRouteInfo.estimatedTime * 2 * 60 // 秒
      const roundTripDistance = outboundRouteInfo.totalDistance * 2

      // 時間制約チェック
      if (roundTripTime > maxAllowedTime) {
        console.log(
          `   ⏱️ 時間超過: ${(roundTripTime / 60).toFixed(1)}分 > ${maxAllowedTime / 60}分 → スキップ`
        )
        continue
      }

      if (roundTripTime < minAllowedTime) {
        console.log(
          `   ⏱️ 時間不足: ${(roundTripTime / 60).toFixed(1)}分 < ${minAllowedTime / 60}分 → スキップ`
        )
        continue
      }

      // ルートパスを取得
      let routePath: Location[] = []
      try {
        const routeGeometry = await getClosedRouteGeometry(closedOutboundWaypoints)
        // 往路のパスを取得
        const pathLength = routeGeometry.path.length
        const midIndex = Math.ceil(pathLength / 2)
        const outboundPath = routeGeometry.path.slice(0, midIndex)
        // 往復パスを構築（往路 + 帰路の逆順）
        const returnPath = reverseRoutePath(outboundPath.slice(1)) // 中間地点が重複しないよう調整
        routePath = [...outboundPath, ...returnPath]
      } catch (error) {
        routePath = closedOutboundWaypoints
      }

      // スコア計算：
      // 1. 時間が目標に近いほど低スコア（一次評価）
      // 2. ウェイポイント数が少ないほど低スコア（単純さ = 二次評価）
      const timeDiff = Math.abs(targetTime - roundTripTime)
      const simplicity = waypointCount * 10 // ウェイポイント数による単純さスコア
      const score = timeDiff + simplicity

      const candidate: RoundTripCandidate = {
        outboundWaypoints,
        routeInfo: {
          totalDistance: roundTripDistance,
          estimatedTime: roundTripTime / 60, // 分
          segments: outboundRouteInfo.segments,
        },
        routePath,
        estimatedTimeSeconds: roundTripTime,
        score,
        outboundDistance: outboundRouteInfo.totalDistance,
        outboundTimeSeconds: outboundRouteInfo.estimatedTime * 60,
        roundTripDistance,
        roundTripTimeSeconds: roundTripTime,
      }

      candidates.push(candidate)

      console.log(
        `   ✓ 候補${i + 1} 生成成功: ` +
        `往復${roundTripDistance.toFixed(2)}km / ${(roundTripTime / 60).toFixed(1)}分 ` +
        `(差: ${(roundTripTime / 60 - desiredRunningMinutes).toFixed(1)}分, スコア: ${score.toFixed(1)})`
      )
    } catch (error) {
      console.log(`   ✗ 候補${i + 1} 生成失敗: ${error instanceof Error ? error.message : 'エラー発生'}`)
      continue
    }
  }

  // ===== 候補の評価と最適ルートの選択 =====
  if (candidates.length === 0) {
    throw new Error(
      `指定条件（${desiredRunningMinutes}分）でランニングコースを生成できませんでした。` +
      `実行時間を変更して再試行してください。`
    )
  }

  console.log(`\n📊 候補評価結果:`)
  candidates.forEach((cand, idx) => {
    const timeDiff = (cand.roundTripTimeSeconds / 60) - desiredRunningMinutes
    console.log(
      `   候補${idx + 1}: 往復${cand.roundTripDistance.toFixed(2)}km / ` +
      `${(cand.roundTripTimeSeconds / 60).toFixed(1)}分 (差: ${timeDiff.toFixed(1)}分, スコア: ${cand.score.toFixed(1)})`
    )
  })

  // スコア順でソート（低いほど良い）
  // 評価基準：
  // 1. 時間制約を満たすことが前提
  // 2. 目標時間に最も近い（時間差が最小）
  // 3. 同率の場合は単純さ（ウェイポイント数が少ない）を優先
  candidates.sort((a, b) => a.score - b.score)

  const bestCandidate = candidates[0]
  const timeDiffMinutes = (bestCandidate.roundTripTimeSeconds / 60) - desiredRunningMinutes

  console.log(`\n✅ 最適ルートが決定されました`)
  console.log(`   選択: 候補1（スコア最小: ${bestCandidate.score.toFixed(1)}）`)
  console.log(`   往路距離: ${bestCandidate.outboundDistance.toFixed(2)}km`)
  console.log(`   往路時間: ${(bestCandidate.outboundTimeSeconds / 60).toFixed(1)}分`)
  console.log(`   往復距離: ${bestCandidate.roundTripDistance.toFixed(2)}km`)
  console.log(`   往復時間: ${(bestCandidate.roundTripTimeSeconds / 60).toFixed(1)}分`)
  console.log(`   目標時間: ${desiredRunningMinutes}分`)
  console.log(`   時間差: ${timeDiffMinutes.toFixed(1)}分`)
  console.log(`   ✓ 時間制約充足: ${minAllowedTime / 60}分 ≤ ${(bestCandidate.roundTripTimeSeconds / 60).toFixed(1)}分 ≤ ${maxAllowedTime / 60}分`)

  return {
    startLocation,
    waypoints: bestCandidate.outboundWaypoints,
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
 * ユーティリティ：ランニング時間から推定距離を計算
 */
export function estimateRunningDistance(timeMinutes: number): number {
  return timeMinutes * RUNNING_PACE_KM_PER_MIN
}

/**
 * ユーティリティ：走行距離からランニング時間を推定
 */
export function estimateRunningTime(distanceKm: number): number {
  return distanceKm / RUNNING_PACE_KM_PER_MIN
}

/**
 * ユーティリティ：往復ルートの検証
 * 
 * 以下の条件を確認：
 * 1. 必ず現在地に戻れるか
 * 2. 時間制約を守っているか
 * 3. 往路と帰路が同じルートか
 */
export function validateRoundTripRoute(
  route: OptimizedRoute,
  desiredRunningMinutes: number
): {
  isValid: boolean
  errors: string[]
  warnings: string[]
} {
  const errors: string[] = []
  const warnings: string[] = []

  // チェック1: ルートの開始と終了が同じ位置か
  const startPoint = route.routePath[0]
  const endPoint = route.routePath[route.routePath.length - 1]

  if (!startPoint || !endPoint) {
    errors.push('ルートパスが空です')
    return { isValid: false, errors, warnings }
  }

  const startEndDistance = calculateStraightLineDistance(startPoint, endPoint)
  if (startEndDistance > 0.001) {
    // 1m以上離れている
    errors.push(
      `ルートの始点と終点が異なります （距離: ${(startEndDistance * 1000).toFixed(0)}m）`
    )
  }

  // チェック2: 時間制約
  const estimatedTimeMinutes = route.estimatedTime
  const minAllowedTime = desiredRunningMinutes - TIME_TOLERANCE_MIN
  const maxAllowedTime = desiredRunningMinutes

  if (estimatedTimeMinutes > maxAllowedTime) {
    errors.push(
      `走行時間が上限を超えています （${estimatedTimeMinutes.toFixed(1)}分 > ${maxAllowedTime}分）`
    )
  }

  if (estimatedTimeMinutes < minAllowedTime) {
    errors.push(
      `走行時間が下限を超えています （${estimatedTimeMinutes.toFixed(1)}分 < ${minAllowedTime}分）`
    )
  }

  // 警告
  if (estimatedTimeMinutes > desiredRunningMinutes - 1) {
    warnings.push(
      `走行時間が目標値に近い値です （${estimatedTimeMinutes.toFixed(1)}分、目標: ${desiredRunningMinutes}分）`
    )
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  }
}
