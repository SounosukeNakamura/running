/**
 * ランニングコース生成エンジン v3.0
 * 
 * 仕様：
 * - スタート地点（現在地）→ 折り返し地点 → ゴール地点（現在地）の往復ルート
 * - 推定走行時間 = 総距離 ÷ ペース（5分/km）
 * - 時間制約：T - 2分 ≤ 推定時間 ≤ T（絶対条件）
 * - bearing（8方向）× scale（複数）で多数候補を生成
 * - 時間差が最小のルートを採用
 */

export interface Location {
  lat: number
  lng: number
}

export interface OptimizedRoute {
  startLocation: Location // スタート＝ゴール地点
  midLocation: Location // 折り返し地点
  totalDistance: number // 往復距離（km）
  estimatedTime: number // 推定走行時間（分）
  routePath: Location[] // 完全なルートパス
}

// ===== 定数 =====
const OSRM_SERVER = 'https://router.project-osrm.org'
const EARTH_RADIUS_KM = 6371
const RUNNING_PACE_MIN_PER_KM = 5 // 5分/km で推定時間を計算
const TIME_BUFFER_MIN = 2 // 時間バッファ（分）

// ===== メイン関数 =====

/**
 * 入力時間から最適なランニングコースを生成
 */
export async function generateOptimizedClosedRoute(
  startLocation: Location,
  targetMinutes: number
): Promise<OptimizedRoute> {
  console.log(
    `\n🏃 ランニングコース生成開始（距離ベース推定）\n   リクエスト時間: ${targetMinutes}分\n   目標往復距離: ${(targetMinutes / RUNNING_PACE_MIN_PER_KM).toFixed(2)}km\n   目標往路距離: ${(targetMinutes / RUNNING_PACE_MIN_PER_KM / 2).toFixed(2)}km\n   許容時間範囲: ${Math.max(1, targetMinutes - TIME_BUFFER_MIN)}分 ～ ${targetMinutes}分\n   スタート地点: (${startLocation.lat.toFixed(5)}, ${startLocation.lng.toFixed(5)})\n   推定ペース: ${RUNNING_PACE_MIN_PER_KM}分/km （OSRM duration は使用しない）`
  )

  try {
    const targetDistance = targetMinutes / RUNNING_PACE_MIN_PER_KM
    const targetHalfDistance = targetDistance / 2
    const minTime = Math.max(1, targetMinutes - TIME_BUFFER_MIN)
    const maxTime = targetMinutes

    // 複数の bearing × scale で候補を生成
    const candidates = await generateCandidates(startLocation, targetHalfDistance, minTime, maxTime)

    if (candidates.length === 0) {
      throw new Error('有効なルート候補が見つかりません')
    }

    // 時間差が最小のルートを選択
    const bestRoute = candidates.reduce((prev, curr) => {
      const prevDiff = Math.abs(prev.estimatedTime - targetMinutes)
      const currDiff = Math.abs(curr.estimatedTime - targetMinutes)
      return currDiff < prevDiff ? curr : prev
    })

    console.log(
      `\n✅ 最適ルートが決定されました\n   選択: ${bestRoute.totalDistance.toFixed(2)}km / 推定${bestRoute.estimatedTime.toFixed(1)}分 (差: ${(bestRoute.estimatedTime - targetMinutes).toFixed(1)}分)\n   ✓ 時間制約充足: ${minTime}分 ≤ ${bestRoute.estimatedTime.toFixed(1)}分 ≤ ${maxTime}分`
    )

    return bestRoute
  } catch (error) {
    console.error('❌ コース生成エラー:', error)
    throw error
  }
}

// ===== プライベート関数 =====

/**
 * 複数の bearing × scale で候補を生成
 */
async function generateCandidates(
  startLoc: Location,
  targetHalfDist: number,
  minTime: number,
  maxTime: number
): Promise<OptimizedRoute[]> {
  const candidates: OptimizedRoute[] = []
  const MAX_CANDIDATES = 3 // 最大3個で早期終了
  const bearings = [0, 45, 90, 135, 180, 225, 270, 315]
  const scales = [0.8, 0.85, 0.9, 0.95, 1.0, 1.05, 1.1, 1.15, 1.2]

  for (const bearing of bearings) {
    if (candidates.length >= MAX_CANDIDATES) break // 3個見つかったら終了

    for (const scale of scales) {
      if (candidates.length >= MAX_CANDIDATES) break // 3個見つかったら終了

      const adjustedDist = targetHalfDist * scale
      const midLoc = getLocationByBearingAndDistance(startLoc, bearing, adjustedDist)

      // OSRM で往路ルートを取得
      const outwardPath = await getRouteViaOSRM(startLoc, midLoc)
      if (!outwardPath) continue

      // 往路距離を計算
      const outwardDist = calculatePathDistance(outwardPath)

      // 往復距離・推定時間を算出
      const totalDist = outwardDist * 2
      const estimatedTime = (totalDist / RUNNING_PACE_MIN_PER_KM) * 60 // 秒を分に

      // 時間制約をチェック
      if (estimatedTime > maxTime) {
        console.log(
          `   試行: bearing=${bearing}°, scale=${scale.toFixed(2)}, 往路目標=${adjustedDist.toFixed(2)}km\n       OSRM片道: ${outwardDist.toFixed(2)}km\n       往復: ${totalDist.toFixed(2)}km / 推定${estimatedTime.toFixed(1)}分\n       ⏭️  時間超過: ${estimatedTime.toFixed(1)}分 > ${maxTime}分`
        )
        continue
      }

      if (estimatedTime < minTime) {
        continue
      }

      // 有効候補
      const returnPath = outwardPath.slice().reverse()
      const routePath = [...outwardPath, ...returnPath.slice(1)]

      candidates.push({
        startLocation: startLoc,
        midLocation: midLoc,
        totalDistance: totalDist,
        estimatedTime: Math.round(estimatedTime * 10) / 10,
        routePath,
      })

      console.log(
        `   試行: bearing=${bearing}°, scale=${scale.toFixed(2)}, 往路目標=${adjustedDist.toFixed(2)}km\n       OSRM片道: ${outwardDist.toFixed(2)}km\n       往復: ${totalDist.toFixed(2)}km / 推定${estimatedTime.toFixed(1)}分\n       ✓ 成功: 往復${totalDist.toFixed(2)}km / 推定${estimatedTime.toFixed(1)}分 (差: ${(estimatedTime - 30).toFixed(1)}分)`
      )
    }
  }

  console.log(
    `\n📊 ${candidates.length}個の有効候補を生成しました\n   ${candidates.map((c, i) => `候補${i + 1}: bearing=${Math.round(Math.atan2(c.midLocation.lng - c.startLocation.lng, c.midLocation.lat - c.startLocation.lat) * 180 / Math.PI)}°, 往復${c.totalDistance.toFixed(2)}km / 推定${c.estimatedTime.toFixed(1)}分 (差: ${(c.estimatedTime - 30).toFixed(1)}分)`).join('\n   ')}`
  )

  return candidates
}

/**
 * Bearing と距離から新しい位置を計算
 */
function getLocationByBearingAndDistance(start: Location, bearingDeg: number, distKm: number): Location {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const toDeg = (rad: number) => (rad * 180) / Math.PI

  const lat1 = toRad(start.lat)
  const lng1 = toRad(start.lng)
  const bearing = toRad(bearingDeg)
  const dist = distKm / EARTH_RADIUS_KM

  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(dist) + Math.cos(lat1) * Math.sin(dist) * Math.cos(bearing))
  const lng2 =
    lng1 + Math.atan2(Math.sin(bearing) * Math.sin(dist) * Math.cos(lat1), Math.cos(dist) - Math.sin(lat1) * Math.sin(lat2))

  return { lat: toDeg(lat2), lng: toDeg(lng2) }
}

/**
 * OSRM API でルートを取得
 */
async function getRouteViaOSRM(from: Location, to: Location): Promise<Location[] | null> {
  try {
    const url = `${OSRM_SERVER}/route/v1/foot/${from.lng},${from.lat};${to.lng},${to.lat}?geometries=geojson&overview=full`
    const response = await fetch(url)

    if (!response.ok) return null

    const data = await response.json()
    if (!data.routes || data.routes.length === 0) return null

    const coordinates = data.routes[0].geometry.coordinates
    return coordinates.map((coord: [number, number]) => ({
      lat: coord[1],
      lng: coord[0],
    }))
  } catch {
    return null
  }
}

/**
 * ルートパスの総距離を計算（km）
 */
function calculatePathDistance(path: Location[]): number {
  let distance = 0

  for (let i = 0; i < path.length - 1; i++) {
    const loc1 = path[i]
    const loc2 = path[i + 1]

    const toRad = (deg: number) => (deg * Math.PI) / 180
    const lat1 = toRad(loc1.lat)
    const lat2 = toRad(loc2.lat)
    const deltaLat = toRad(loc2.lat - loc1.lat)
    const deltaLng = toRad(loc2.lng - loc1.lng)

    const a =
      Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2)

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    distance += EARTH_RADIUS_KM * c
  }

  return distance
}
