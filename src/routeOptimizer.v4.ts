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
const RUNNING_PACE_MIN_PER_KM = 5.0 // ランニングペース：5分/km（固定）
const NUM_ROUTE_CANDIDATES = 3 // 候補数：採用候補は常に3個まで
const TIME_TOLERANCE_MIN = 2 // 分（最小許容値）

/**
 * 往復ルート候補の内部評価用
 */
interface RoundTripCandidate {
  midLocation: Location // 中間地点
  bearing: number // 中間地点への方位
  // 片道情報
  outboundDistance: number // km
  outboundDuration: number // 秒（不使用）
  // 往復情報
  roundTripDistance: number // km（往復）
  roundTripDuration: number // 秒（不使用）
  estimatedMinutes: number // 【新規】距離ベース推定時間（分）
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
  const minAllowedTime = desiredRunningMinutes - TIME_TOLERANCE_MIN // 分
  const maxAllowedTime = desiredRunningMinutes // 分
  const targetTime = desiredRunningMinutes // 分

  // ===== 目標距離の正しい計算（距離ベース） =====
  // ペース: 5分/km → 1km走るのに5分かかる
  // 往復時間 T → 往復距離 = T / 5 km
  const targetRoundTripKm = desiredRunningMinutes / RUNNING_PACE_MIN_PER_KM
  const targetOutboundKm = targetRoundTripKm / 2

  console.log(`\n🏃 ランニングコース生成開始（距離ベース推定）`)
  console.log(`   リクエスト時間: ${desiredRunningMinutes}分`)
  console.log(`   目標往復距離: ${targetRoundTripKm.toFixed(2)}km`)
  console.log(`   目標往路距離: ${targetOutboundKm.toFixed(2)}km`)
  console.log(`   許容時間範囲: ${minAllowedTime}分 ～ ${maxAllowedTime}分`)
  console.log(`   スタート地点: (${startLocation.lat.toFixed(5)}, ${startLocation.lng.toFixed(5)})`)
  console.log(`   推定ペース: ${RUNNING_PACE_MIN_PER_KM}分/km （OSRM duration は使用しない）`)

  // ===== 複数の中間地点候補で試行 =====
  const allCandidates: RoundTripCandidate[] = [] // 全試行結果
  const validCandidates: RoundTripCandidate[] = [] // 時間範囲内の有効候補
  const attemptLog: { bearing: number; scale: number; distance: string; estimatedMin: string; reason: string }[] = []

  // 複数の方位でループ（北、東、南、西など）
  const numBearings = 8 // 8方位（より多くの方向を試す）
  for (let bearingIdx = 0; bearingIdx < numBearings; bearingIdx++) {
    const bearing = (bearingIdx / numBearings) * 360

    // スケール係数で往路目標距離を調整（複数段階）
    for (const scaleFactor of [0.85, 0.95, 1.0, 1.05, 1.15]) {
      try {
        const scaledOutboundKm = targetOutboundKm * scaleFactor

        // 指定方位・距離で中間地点を生成
        const midLocation = generateMidpointInDirection(
          startLocation,
          scaledOutboundKm,
          bearing
        )

        // OSRMで片道ルートを取得（2点のみ）
        const outboundRoute = await getOutboundRouteGeometry(startLocation, midLocation)

        // 【重要】往復距離と推定時間を計算（OSRM duration は使わない）
        const outboundDistanceKm = outboundRoute.distance
        const roundTripDistanceKm = outboundDistanceKm * 2

        // 推定時間 = 往復距離(km) × ペース(5分/km)
        const estimatedMinutes = roundTripDistanceKm * RUNNING_PACE_MIN_PER_KM

        // ログ出力（試行の詳細）
        console.log(
          `   試行: bearing=${bearing.toFixed(0)}°, scale=${scaleFactor.toFixed(2)}, ` +
          `往路目標=${scaledOutboundKm.toFixed(2)}km`
        )
        console.log(
          `      OSRM片道: ${outboundDistanceKm.toFixed(2)}km`
        )
        console.log(
          `      往復: ${roundTripDistanceKm.toFixed(2)}km / ` +
          `推定${estimatedMinutes.toFixed(1)}分`
        )

        // 異常値チェック（往路が目標の3倍以上は棄却）
        if (outboundDistanceKm > scaledOutboundKm * 3) {
          const reason = `往路が異常に長い: ${outboundDistanceKm.toFixed(2)}km (目標${scaledOutboundKm.toFixed(2)}kmの3倍超)`
          console.log(`      ⏭️  ${reason}`)
          attemptLog.push({ bearing, scale: scaleFactor, distance: `${roundTripDistanceKm.toFixed(2)}km`, estimatedMin: `${estimatedMinutes.toFixed(1)}分`, reason })
          continue
        }

        // 時間制約チェック
        if (estimatedMinutes > maxAllowedTime) {
          const reason = `時間超過: ${estimatedMinutes.toFixed(1)}分 > ${maxAllowedTime}分`
          console.log(`      ⏭️  ${reason}`)
          attemptLog.push({ bearing, scale: scaleFactor, distance: `${roundTripDistanceKm.toFixed(2)}km`, estimatedMin: `${estimatedMinutes.toFixed(1)}分`, reason })
          continue
        }

        if (estimatedMinutes < minAllowedTime) {
          const reason = `時間不足: ${estimatedMinutes.toFixed(1)}分 < ${minAllowedTime}分`
          console.log(`      ⏭️  ${reason}`)
          attemptLog.push({ bearing, scale: scaleFactor, distance: `${roundTripDistanceKm.toFixed(2)}km`, estimatedMin: `${estimatedMinutes.toFixed(1)}分`, reason })
          continue
        }

        // ✓ 時間範囲内に入った候補
        console.log(`      ✓ 成功: 往復${roundTripDistanceKm.toFixed(2)}km / 推定${estimatedMinutes.toFixed(1)}分 (差: ${(estimatedMinutes - targetTime).toFixed(1)}分)`)

        // 往復ルートパスを構築（往路を取得して、復路は逆順）
        const routePath = buildRoundTripPath(outboundRoute.path, startLocation)

        // スコア計算（目標時間との差が小さいほど良い）
        const timeDiff = Math.abs(targetTime - estimatedMinutes)
        const score = timeDiff

        const candidate: RoundTripCandidate = {
          midLocation,
          bearing,
          outboundDistance: outboundDistanceKm,
          outboundDuration: 0, // 不使用（距離ベース推定のため）
          roundTripDistance: roundTripDistanceKm,
          roundTripDuration: 0, // 不使用（距離ベース推定のため）
          estimatedMinutes, // 【新規】距離ベース推定時間
          routePath,
          segments: [],
          score,
        }

        allCandidates.push(candidate)
        validCandidates.push(candidate)

        // 有効候補が3個に達したら試行終了
        if (validCandidates.length >= NUM_ROUTE_CANDIDATES) {
          console.log(`\n   ℹ️  有効候補が${NUM_ROUTE_CANDIDATES}個に達したため、試行を終了します`)
          break
        }

      } catch (error) {
        const reason = `API/処理エラー: ${error instanceof Error ? error.message.substring(0, 30) : '不明'}`
        console.log(`      ✗ ${reason}`)
        attemptLog.push({
          bearing,
          scale: scaleFactor,
          distance: `${(targetOutboundKm * scaleFactor * 2).toFixed(2)}km`,
          estimatedMin: `推定値なし`,
          reason,
        })
      }
    }

    if (validCandidates.length >= NUM_ROUTE_CANDIDATES) break
  }

  // ===== 候補評価 =====
  if (validCandidates.length === 0) {
    console.log(`\n❌ ルート生成失敗。${allCandidates.length}回の試行で条件を満たすルートが見つかりませんでした。`)
    console.log(`\n試行ログ（距離 / 推定時間 / 理由）:`)
    attemptLog.forEach((attempt) => {
      console.log(
        `   - bearing=${attempt.bearing.toFixed(0)}°, scale=${attempt.scale.toFixed(2)}: ` +
        `${attempt.distance} / ${attempt.estimatedMin} → ${attempt.reason}`
      )
    })

    let errorMessage = `指定条件（${desiredRunningMinutes}分）でランニングコースを生成できませんでした。`
    errorMessage += `\n\n【原因】距離ベース推定（${RUNNING_PACE_MIN_PER_KM}分/km）で、${minAllowedTime}〜${maxAllowedTime}分に入るルートが見つかりませんでした。`
    errorMessage += `\n\n【試行結果のサマリー】`

    // 全試行の最大時間を確認
    const maxEstimated = Math.max(...attemptLog.map((a) => {
      const timeStr = a.estimatedMin.match(/\d+\.?\d*/)?.[0]
      return timeStr ? parseFloat(timeStr) : 0
    }))

    if (maxEstimated < minAllowedTime) {
      errorMessage += `\n・最大推定時間: ${maxEstimated.toFixed(1)}分 （目標${minAllowedTime}分に届かず）`
      errorMessage += `\n・走りたい時間を短くするか、現在地を変更してみてください。`
    } else if (maxEstimated > maxAllowedTime) {
      errorMessage += `\n・最小推定時間: ${maxEstimated.toFixed(1)}分 （目標${maxAllowedTime}分を超過）`
      errorMessage += `\n・走りたい時間を長くするか、現在地を変更してみてください。`
    }

    throw new Error(errorMessage)
  }

  console.log(`\n📊 ${validCandidates.length}個の有効候補を生成しました`)
  validCandidates.forEach((cand, idx) => {
    const timeDiff = cand.estimatedMinutes - desiredRunningMinutes
    console.log(
      `   候補${idx + 1}: bearing=${cand.bearing.toFixed(0)}°, ` +
      `往復${cand.roundTripDistance.toFixed(2)}km / ` +
      `推定${cand.estimatedMinutes.toFixed(1)}分 (差: ${timeDiff.toFixed(1)}分)`
    )
  })

  // スコア順でソート（低いほど良い = 目標時間に最も近い）
  validCandidates.sort((a, b) => a.score - b.score)

  const bestCandidate = validCandidates[0]
  const timeDiffMinutes = bestCandidate.estimatedMinutes - desiredRunningMinutes

  console.log(`\n✅ 最適ルートが決定されました`)
  console.log(`   選択: bearing=${bestCandidate.bearing.toFixed(0)}°, スコア${bestCandidate.score.toFixed(1)}`)
  console.log(`   OSRM片道距離: ${bestCandidate.outboundDistance.toFixed(2)}km`)
  console.log(`   往復距離: ${bestCandidate.roundTripDistance.toFixed(2)}km`)
  console.log(`   推定走行時間: ${bestCandidate.estimatedMinutes.toFixed(1)}分`)
  console.log(`   目標時間: ${desiredRunningMinutes}分`)
  console.log(`   時間差: ${timeDiffMinutes.toFixed(1)}分`)
  console.log(`   ✓ 時間制約充足: ${minAllowedTime}分 ≤ ${bestCandidate.estimatedMinutes.toFixed(1)}分 ≤ ${maxAllowedTime}分`)

  return {
    startLocation,
    waypoints: [bestCandidate.midLocation], // 中間地点のみ
    segments: bestCandidate.segments,
    totalDistance: bestCandidate.roundTripDistance,
    estimatedTime: bestCandidate.estimatedMinutes, // 距離ベース推定（分）
    routePath: bestCandidate.routePath,
    displayMarkers: {
      startGoal: startLocation,
    },
  }
}

/**
 * ユーティリティ：ランニング時間から推定距離を計算（5分/km）
 */
export function estimateRunningDistance(timeMinutes: number): number {
  return timeMinutes / RUNNING_PACE_MIN_PER_KM
}

/**
 * ユーティリティ：走行距離からランニング時間を推定（5分/km）
 */
export function estimateRunningTime(distanceKm: number): number {
  return distanceKm * RUNNING_PACE_MIN_PER_KM
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
 * 【検証項目】
 * 1. ルートの開始と終了が同じ位置か
 * 2. 時間制約を守っているか（距離ベース推定）
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

  // チェック2: 時間制約（距離ベース推定）
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
  if (Math.abs(estimatedTimeMinutes - desiredRunningMinutes) < 1) {
    warnings.push(
      `走行時間が目標値に非常に近い値です （${estimatedTimeMinutes.toFixed(1)}分、目標: ${desiredRunningMinutes}分）`
    )
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  }
}
