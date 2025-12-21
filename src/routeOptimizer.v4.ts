/**
 * ルート生成エンジン v4.1 - 往復ルート専用版
 * 
 * 【新仕様】
 * - 現在地 → 中間地点（往路）のみをOSRMで計算
 * - 復路は往路と同じ道を逆順で走行
 * - OSRMは2点（start, mid）のみの片道ルートを要求
 * - 往復時間 = 片道時間 × 2 で厳密に制御
 */

import {
  Location,
  RouteSegment,
  OptimizedRoute,
  calculateStraightLineDistance,
  generateMidpointCandidates,
  getOutboundRouteGeometry,
  buildRoundTripPath,
  evaluateRoute,
} from './routeOptimizer.v2'

// ===== 定数 =====
const RUNNING_PACE_KM_PER_MIN = 1 / 6 // 6分/km標準ペース
const NUM_ROUTE_CANDIDATES = 3 // 候補数：常に3個
const TIME_TOLERANCE_MIN = 2 // 分（最小許容値）

/**
 * 往復ルート候補の内部評価用
 */
interface RoundTripCandidate {
  midLocation: Location // 中間地点
  bearing: number // 中間地点への方位
  // 片道情報
  outboundDistance: number // km
  outboundDuration: number // 秒
  // 往復情報
  roundTripDistance: number // km（往復）
  roundTripDuration: number // 秒（往復）
  // ルートパス
  routePath: Location[] // スタート → 中間 → スタート（フル）
  segments: RouteSegment[]
  // スコア
  score: number // 低いほど良い
}

/**
 * ルート経路を逆順にして返す
 */
function reverseRoutePath(path: Location[]): Location[] {
  return [...path].reverse()
}

/**
 * 指定時間内で往復ルートを生成
 * 
 * 【仕様】
 * - スタート地点 = ゴール地点（現在地）
 * - 複数の方位で中間地点の候補を生成
 * - 各候補に対してOSRM片道ルートを取得
 * - 往復時間が許容範囲内のルートを選択
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
  const targetDuration = desiredRunningMinutes * 60 // 秒

  console.log(`\n🏃 ランニングコース生成開始（往復ルート専用）`)
  console.log(`   リクエスト時間: ${desiredRunningMinutes}分`)
  console.log(`   許容時間範囲: ${minAllowedTime / 60}分 ～ ${maxAllowedTime / 60}分`)
  console.log(`   スタート地点: (${startLocation.lat.toFixed(5)}, ${startLocation.lng.toFixed(5)})`)

  // ===== 往路目標距離を計算 =====
  // 往復時間を往復距離に変換
  // 往復距離 = 走りたい時間 × ペース = 30分 × (1/6 km/分) = 5km
  const targetRoundTripDistance = desiredRunningMinutes * RUNNING_PACE_KM_PER_MIN
  // 往路目標距離 = 往復距離 / 2 = 2.5km
  const targetOutboundDistance = targetRoundTripDistance / 2

  console.log(`   往復目標距離: ${targetRoundTripDistance.toFixed(2)}km`)
  console.log(`   往路目標距離: ${targetOutboundDistance.toFixed(2)}km`)

  // ===== 複数の中間地点候補で試行 =====
  const candidates: RoundTripCandidate[] = []
  const attemptLog: { bearing: number; distance: string; reason: string }[] = []

  // 複数の方位（北、東、南、西など）で中間地点を生成
  const numBearings = 4 // 4方位（北、東、南、西）
  for (let bearingIdx = 0; bearingIdx < numBearings; bearingIdx++) {
    const bearing = (bearingIdx / numBearings) * 360
    
    // スケール係数で往路目標距離を調整（0.8, 1.0, 1.2の3段階）
    for (const scaleFactor of [0.8, 1.0, 1.2]) {
      try {
        const scaledOutboundDistance = targetOutboundDistance * scaleFactor
        
        console.log(
          `\n   📍 試行: bearing=${bearing.toFixed(0)}°, ` +
          `scale=${scaleFactor.toFixed(2)}, ` +
          `往路目標=${scaledOutboundDistance.toFixed(2)}km`
        )

        // 指定方位・距離で中間地点を生成
        const midLocation = generateMidpointInDirection(
          startLocation,
          scaledOutboundDistance,
          bearing
        )

        // OSRMで片道ルートを取得（2点のみ）
        const outboundRoute = await getOutboundRouteGeometry(startLocation, midLocation)
        
        // 往復に拡張
        const roundTripDistance = outboundRoute.distance * 2
        const roundTripDuration = outboundRoute.duration * 2

        console.log(
          `      往復合計: ${roundTripDistance.toFixed(2)}km / ` +
          `${(roundTripDuration / 60).toFixed(1)}分`
        )

        // 異常値チェック：往路が異常に長い場合は棄却
        if (outboundRoute.distance > scaledOutboundDistance * 3) {
          const reason = `往路が異常に長い: ${outboundRoute.distance.toFixed(2)}km (目標${scaledOutboundDistance.toFixed(2)}kmの3倍超)`
          console.log(`      ⏭️  ${reason}`)
          attemptLog.push({ bearing, distance: `${scaledOutboundDistance.toFixed(2)}km`, reason })
          continue
        }

        // 時間制約チェック
        if (roundTripDuration > maxAllowedTime) {
          const reason = `時間超過: ${(roundTripDuration / 60).toFixed(1)}分 > ${maxAllowedTime / 60}分`
          console.log(`      ⏭️  ${reason}`)
          attemptLog.push({ bearing, distance: `${scaledOutboundDistance.toFixed(2)}km`, reason })
          continue
        }

        if (roundTripDuration < minAllowedTime) {
          const reason = `時間不足: ${(roundTripDuration / 60).toFixed(1)}分 < ${minAllowedTime / 60}分`
          console.log(`      ⏭️  ${reason}`)
          attemptLog.push({ bearing, distance: `${scaledOutboundDistance.toFixed(2)}km`, reason })
          continue
        }

        // 往復ルートパスを構築（往路を取得して、復路は逆順）
        const routePath = buildRoundTripPath(outboundRoute.path, startLocation)

        // スコア計算
        const timeDiff = Math.abs(targetDuration - roundTripDuration)
        const bearingPenalty = Math.abs(bearing - 180) % 180 // 南向き優先（180度基準）
        const score = timeDiff + bearingPenalty

        const candidate: RoundTripCandidate = {
          midLocation,
          bearing,
          outboundDistance: outboundRoute.distance,
          outboundDuration: outboundRoute.duration,
          roundTripDistance,
          roundTripDuration,
          routePath,
          segments: [], // 詳細セグメント情報は後で埋める
          score,
        }

        candidates.push(candidate)

        console.log(
          `      ✓ 成功: 往復${roundTripDistance.toFixed(2)}km / ` +
          `${(roundTripDuration / 60).toFixed(1)}分 ` +
          `(差: ${((roundTripDuration / 60) - desiredRunningMinutes).toFixed(1)}分)`
        )

        // 3個候補に達したら終了
        if (candidates.length >= NUM_ROUTE_CANDIDATES) break

      } catch (error) {
        const reason = `API/処理エラー: ${error instanceof Error ? error.message.substring(0, 30) : '不明'}`
        console.log(`      ✗ ${reason}`)
        attemptLog.push({
          bearing,
          distance: `${(targetOutboundDistance * scaleFactor).toFixed(2)}km`,
          reason,
        })
      }
    }

    if (candidates.length >= NUM_ROUTE_CANDIDATES) break
  }

  // ===== 候補評価 =====
  if (candidates.length === 0) {
    console.log(`\n❌ ルート生成失敗。試行ログ:`)
    attemptLog.forEach((attempt) => {
      console.log(
        `   - bearing=${attempt.bearing.toFixed(0)}°, ` +
        `往路目標=${attempt.distance}: ${attempt.reason}`
      )
    })

    let errorMessage = `指定条件（${desiredRunningMinutes}分）でランニングコースを生成できませんでした。`

    const hasTimeIssues = attemptLog.some((a) => a.reason.includes('時間'))
    if (hasTimeIssues) {
      errorMessage += `\n\n【原因】指定時間に合うルートが見つかりませんでした。`
      errorMessage += `\n\n【対策】`
      if (attemptLog.some((a) => a.reason.includes('時間超過'))) {
        errorMessage += `\n・走りたい時間を長くするか、`
      }
      if (attemptLog.some((a) => a.reason.includes('時間不足'))) {
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
    const timeDiff = (cand.roundTripDuration / 60) - desiredRunningMinutes
    console.log(
      `   候補${idx + 1}: bearing=${cand.bearing.toFixed(0)}°, ` +
      `往復${cand.roundTripDistance.toFixed(2)}km / ` +
      `${(cand.roundTripDuration / 60).toFixed(1)}分 (差: ${timeDiff.toFixed(1)}分)`
    )
  })

  // スコア順でソート（低いほど良い）
  candidates.sort((a, b) => a.score - b.score)

  const bestCandidate = candidates[0]
  const timeDiffMinutes = (bestCandidate.roundTripDuration / 60) - desiredRunningMinutes

  console.log(`\n✅ 最適ルートが決定されました`)
  console.log(`   選択: bearing=${bestCandidate.bearing.toFixed(0)}°`)
  console.log(`   OSRM片道: ${bestCandidate.outboundDistance.toFixed(2)}km / ${(bestCandidate.outboundDuration / 60).toFixed(1)}分`)
  console.log(`   往復合計: ${bestCandidate.roundTripDistance.toFixed(2)}km / ${(bestCandidate.roundTripDuration / 60).toFixed(1)}分`)
  console.log(`   目標時間: ${desiredRunningMinutes}分`)
  console.log(`   時間差: ${timeDiffMinutes.toFixed(1)}分`)
  console.log(`   ✓ 時間制約充足: ${minAllowedTime / 60}分 ≤ ${(bestCandidate.roundTripDuration / 60).toFixed(1)}分 ≤ ${maxAllowedTime / 60}分`)

  return {
    startLocation,
    waypoints: [bestCandidate.midLocation], // 中間地点のみ
    segments: bestCandidate.segments,
    totalDistance: bestCandidate.roundTripDistance,
    estimatedTime: bestCandidate.roundTripDuration / 60, // 分単位
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
 * 指定方位・距離で中間地点を生成（ローカルヘルパー）
 */
function generateMidpointInDirection(
  startLocation: Location,
  distance: number,
  bearing: number
): Location {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const toDeg = (rad: number) => (rad * 180) / Math.PI
  const EARTH_RADIUS_KM = 6371

  const lat1 = toRad(startLocation.lat)
  const lng1 = toRad(startLocation.lng)
  const bearingRad = toRad(bearing)
  const angular = distance / EARTH_RADIUS_KM

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearingRad)
  )

  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearingRad) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2)
    )

  return {
    lat: toDeg(lat2),
    lng: toDeg(lng2),
  }
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
