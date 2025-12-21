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
const NUM_ROUTE_CANDIDATES = 3 // 候補数：常に3個（成功率優先）
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

  // ===== 複数の探索パターンで候補ルート生成 =====
  const candidates: RoundTripCandidate[] = []
  const attemptLog: { scaleFactor: number; waypointCount: number; reason: string }[] = []

  // 探索パターン: より広いスケール係数と複数のウェイポイント組み合わせ
  const searchPatterns = [
    { scaleBases: [0.8, 0.9, 1.0, 1.1, 1.2], waypoints: [2, 3, 4] },
    { scaleBases: [0.7, 1.3], waypoints: [2, 3, 4, 5] },
    { scaleBases: [0.85, 0.95, 1.05, 1.15], waypoints: [3] },
  ]

  for (const pattern of searchPatterns) {
    console.log(`\n📍 探索パターン: スケール ${pattern.scaleBases.map(s => s.toFixed(2)).join(',')} / ウェイポイント ${pattern.waypoints.join(',')}`)

    for (const waypointCount of pattern.waypoints) {
      for (const scaleFactor of pattern.scaleBases) {
        try {
          console.log(`   📊 候補生成中: scale=${scaleFactor.toFixed(2)}, waypoints=${waypointCount}`)

          // 正しい距離計算：30分なら 30/6=5km、片道2.5km
          const estimatedTotalDistance = desiredRunningMinutes / RUNNING_PACE_KM_PER_MIN
          const estimatedOutboundDistance = (estimatedTotalDistance / 2) * scaleFactor

          console.log(`      目標距離: ${estimatedTotalDistance.toFixed(2)}km (往復), 往路目標: ${estimatedOutboundDistance.toFixed(2)}km`)

          const outboundWaypoints = generateCircularWaypoints(
            startLocation,
            estimatedOutboundDistance,
            waypointCount
          )

          // ウェイポイント検証：現在地から5km以上離れていないか確認
          for (let i = 0; i < outboundWaypoints.length; i++) {
            const wp = outboundWaypoints[i]
            const dist = calculateStraightLineDistance(startLocation, wp)
            console.log(`      WP${i + 1}: (${wp.lat.toFixed(5)}, ${wp.lng.toFixed(5)}) - 直線距離: ${(dist * 1000).toFixed(0)}m`)
            if (dist > 10) {
              console.log(`      ⚠️  警告: ウェイポイント${i + 1}が10km以上離れています。スキップします。`)
              throw new Error(`Waypoint ${i + 1} is too far (${dist.toFixed(1)}km)`)
            }
          }

          const closedOutboundWaypoints = [startLocation, ...outboundWaypoints, startLocation]
          
          // API呼び出しを並列実行
          const [outboundRouteInfo, routeGeometry] = await Promise.all([
            evaluateRoute(startLocation, outboundWaypoints),
            getClosedRouteGeometry(closedOutboundWaypoints)
          ])

          const roundTripTime = outboundRouteInfo.estimatedTime * 2 * 60
          const roundTripDistance = outboundRouteInfo.totalDistance * 2

          console.log(`      → 候補時間: ${(roundTripTime / 60).toFixed(1)}分 / 距離: ${roundTripDistance.toFixed(2)}km`)

          // 異常値チェック：目標距離の3倍以上は棄却（例: 30分指定で15km超のルートは異常）
          if (roundTripDistance > estimatedTotalDistance * 3) {
            const reason = `異常な距離: ${roundTripDistance.toFixed(2)}km (目標${estimatedTotalDistance.toFixed(2)}kmの3倍超)`
            console.log(`      ⏭️  ${reason}`)
            attemptLog.push({ scaleFactor, waypointCount, reason })
            continue
          }

          // 時間制約チェック
          if (roundTripTime > maxAllowedTime) {
            const reason = `時間超過: ${(roundTripTime / 60).toFixed(1)}分 > ${maxAllowedTime / 60}分`
            console.log(`      ⏭️  ${reason}`)
            attemptLog.push({ scaleFactor, waypointCount, reason })
            continue
          }

          if (roundTripTime < minAllowedTime) {
            const reason = `時間不足: ${(roundTripTime / 60).toFixed(1)}分 < ${minAllowedTime / 60}分`
            console.log(`      ⏭️  ${reason}`)
            attemptLog.push({ scaleFactor, waypointCount, reason })
            continue
          }

          // ルートパス取得
          let routePath: Location[] = []
          try {
            const pathLength = routeGeometry.path.length
            const midIndex = Math.ceil(pathLength / 2)
            const outboundPath = routeGeometry.path.slice(0, midIndex)
            const returnPath = reverseRoutePath(outboundPath.slice(1))
            routePath = [...outboundPath, ...returnPath]
          } catch (error) {
            routePath = closedOutboundWaypoints
          }

          const timeDiff = Math.abs(targetTime - roundTripTime)
          const simplicity = waypointCount * 10
          const score = timeDiff + simplicity

          const candidate: RoundTripCandidate = {
            outboundWaypoints,
            routeInfo: {
              totalDistance: roundTripDistance,
              estimatedTime: roundTripTime / 60,
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
            `      ✓ 成功: ${roundTripDistance.toFixed(2)}km / ${(roundTripTime / 60).toFixed(1)}分 ` +
            `(差: ${((roundTripTime / 60) - desiredRunningMinutes).toFixed(1)}分)`
          )

          // 3個候補に達したら終了
          if (candidates.length >= 3) break
        } catch (error) {
          const reason = `API/処理エラー: ${error instanceof Error ? error.message.substring(0, 30) : 'エラー'}`
          console.log(`      ✗ ${reason}`)
          attemptLog.push({ scaleFactor, waypointCount, reason })
        }
      }
      if (candidates.length >= 3) break
    }
    if (candidates.length >= 3) break
  }

  // ===== 候補評価 =====
  if (candidates.length === 0) {
    console.log(`\n❌ ルート生成失敗。試行ログ:`)
    attemptLog.forEach((attempt) => {
      console.log(`   - scale=${attempt.scaleFactor.toFixed(2)}, waypoints=${attempt.waypointCount}: ${attempt.reason}`)
    })

    let errorMessage = `指定条件（${desiredRunningMinutes}分）でランニングコースを生成できませんでした。`
    
    const hasTimeIssues = attemptLog.some(a => a.reason.includes('時間'))
    if (hasTimeIssues) {
      errorMessage += `\n\n【原因】指定時間に合うルートが見つかりませんでした。`
      errorMessage += `\n\n【対策】`
      if (attemptLog.some(a => a.reason.includes('時間超過'))) {
        errorMessage += `\n・走りたい時間を長くするか、`
      }
      if (attemptLog.some(a => a.reason.includes('時間不足'))) {
        errorMessage += `\n・走りたい時間を短くしてみてください。`
      }
      errorMessage += `\n・現在地を変更してみてください。`
    } else {
      errorMessage += `\n\n【原因】ルーティングAPI呼び出し失敗またはネットワークエラーの可能性があります。`
      errorMessage += `\n\n【対策】インターネット接続を確認してください。`
    }

    throw new Error(errorMessage)
  }

  console.log(`\n📊 ${candidates.length}個の候補を生成しました`)
  candidates.forEach((cand, idx) => {
    const timeDiff = (cand.roundTripTimeSeconds / 60) - desiredRunningMinutes
    console.log(
      `   候補${idx + 1}: ${cand.roundTripDistance.toFixed(2)}km / ` +
      `${(cand.roundTripTimeSeconds / 60).toFixed(1)}分 (差: ${timeDiff.toFixed(1)}分)`
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
