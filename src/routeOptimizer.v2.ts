/**
 * 安定したコース生成ロジック v2.2
 * 
 * 仕様：
 * - 必ず「道なり」で作成（直線・ランダムは禁止）
 * - OSRM の duration ではなく、距離 + 一定ペース（5分/km）で時間推定
 * - 往路と復路は同じルートを通る（完全な折り返し）
 * - 時間制約：T - 2分 ≤ time_estimate ≤ T（絶対条件）
 */

export interface Location {
  lat: number
  lng: number
}

export interface OptimizedRoute {
  startLocation: Location // スタート＝ゴール地点（現在地）
  midLocation: Location // 中間地点（折り返し地点）
  totalDistance: number // 往復距離（km）
  estimatedTime: number // 推定走行時間（分）
  routePath: Location[] // 完全なルートパス（マップ表示用）
  outwardPath: Location[] // 往路のパス
}

// ===== 定数 =====

const OSRM_SERVER = 'https://router.project-osrm.org'
const EARTH_RADIUS_KM = 6371
const RUNNING_PACE_MIN_PER_KM = 5 // 5分/km で時間推定
const MIN_CANDIDATES = 15 // 最低15回は候補生成
const MAX_CANDIDATES = 30 // 最大30回
const TIME_BUFFER_MIN = 2 // 時間バッファ（分）

// ===== 公開関数 =====

/**
 * メイン関数：入力時間から最適なコースを生成
 * 
 * @param startLocation スタート地点（現在地）
 * @param targetMinutes 走りたい時間（分）
 * @returns 最適なコース情報、または null（失敗時）
 */
export async function generateOptimizedClosedRoute(
  startLocation: Location,
  targetMinutes: number
): Promise<OptimizedRoute> {
  console.log(
    `🚀 [Course Generation] Starting: target=${targetMinutes}min from lat=${startLocation.lat}, lng=${startLocation.lng}`
  )

  try {
    // 往路の距離を計算
    const targetDistance = calculateDistanceFromTime(targetMinutes)
    const halfDistance = targetDistance / 2 // 往路の距離
    console.log(`📏 Target distance: ${targetDistance.toFixed(2)}km (half=${halfDistance.toFixed(2)}km)`)

    // 複数の bearing と scale で中間地点を探索
    const candidates = await exploreMiddlePoints(startLocation, halfDistance, targetMinutes)

    if (!candidates || candidates.length === 0) {
      throw new Error('No valid route candidates found')
    }

    // 時間差が最小のコースを選択
    const bestCandidate = candidates.reduce((best, current) => {
      const bestTimeDiff = Math.abs(best.estimatedTime - targetMinutes)
      const currentTimeDiff = Math.abs(current.estimatedTime - targetMinutes)
      return currentTimeDiff < bestTimeDiff ? current : best
    })

    console.log(
      `✅ [Course Generation] Success: distance=${bestCandidate.totalDistance.toFixed(2)}km, time=${bestCandidate.estimatedTime.toFixed(1)}min`
    )

    return bestCandidate
  } catch (error) {
    console.error('❌ [Course Generation] Error:', error)
    throw error
  }
}

// ===== プライベート関数 =====

/**
 * 時間から走行距離を計算
 */
function calculateDistanceFromTime(minutes: number): number {
  return (minutes / RUNNING_PACE_MIN_PER_KM) // 往復距離
}

/**
 * 直線距離を計算（Haversine公式）
 */
function calculateStraightDistance(loc1: Location, loc2: Location): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180

  const lat1 = toRad(loc1.lat)
  const lat2 = toRad(loc2.lat)
  const deltaLat = toRad(loc2.lat - loc1.lat)
  const deltaLng = toRad(loc2.lng - loc1.lng)

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return EARTH_RADIUS_KM * c
}

/**
 * 指定 bearing と距離から新しい地点を計算
 */
function getLocationByBearingAndDistance(
  start: Location,
  bearingDeg: number,
  distanceKm: number
): Location {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const toDeg = (rad: number) => (rad * 180) / Math.PI

  const lat1 = toRad(start.lat)
  const lng1 = toRad(start.lng)
  const bearing = toRad(bearingDeg)
  const dist = distanceKm / EARTH_RADIUS_KM

  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(dist) + Math.cos(lat1) * Math.sin(dist) * Math.cos(bearing))
  const lng2 =
    lng1 +
    Math.atan2(Math.sin(bearing) * Math.sin(dist) * Math.cos(lat1), Math.cos(dist) - Math.sin(lat1) * Math.sin(lat2))

  return {
    lat: toDeg(lat2),
    lng: toDeg(lng2),
  }
}

/**
 * 複数の bearing・scale で中間地点を探索
 * 条件を満たす候補を返す
 */
async function exploreMiddlePoints(
  startLocation: Location,
  targetHalfDistance: number,
  targetMinutes: number
): Promise<OptimizedRoute[]> {
  const candidates: OptimizedRoute[] = []
  let attemptCount = 0

  // bearing を 8 方向（45度ずつ）で試行
  const bearings = [0, 45, 90, 135, 180, 225, 270, 315]

  // 各 bearing ごとに複数の scale を試行
  const scales = [0.85, 0.9, 0.95, 1.0, 1.05, 1.1, 1.15]

  for (const bearing of bearings) {
    for (const scale of scales) {
      if (attemptCount >= MAX_CANDIDATES) break

      const adjustedDistance = targetHalfDistance * scale
      const midLocation = getLocationByBearingAndDistance(startLocation, bearing, adjustedDistance)

      const route = await tryGenerateRoute(startLocation, midLocation, targetMinutes)

      if (route) {
        // 時間制約を確認：T - 2分 ≤ time ≤ T
        const minTime = Math.max(1, targetMinutes - TIME_BUFFER_MIN)
        const maxTime = targetMinutes

        if (route.estimatedTime >= minTime && route.estimatedTime <= maxTime) {
          candidates.push(route)
          console.log(
            `✓ [Candidate ${candidates.length}] bearing=${bearing}°, scale=${scale.toFixed(2)}, time=${route.estimatedTime.toFixed(1)}min`
          )
        } else {
          console.log(
            `✗ [Rejected] bearing=${bearing}°, scale=${scale.toFixed(2)}, time=${route.estimatedTime.toFixed(1)}min (out of bounds)`
          )
        }
      }

      attemptCount++
    }

    if (attemptCount >= MAX_CANDIDATES) break
  }

  console.log(`📊 Explored ${attemptCount} candidates, ${candidates.length} met time constraints`)

  return candidates
}

/**
 * 1つの中間地点でルートを生成してみる
 */
async function tryGenerateRoute(
  startLocation: Location,
  midLocation: Location,
  targetMinutes: number
): Promise<OptimizedRoute | null> {
  try {
    // 往路：start → mid
    const outwardSegment = await getRouteSegment(startLocation, midLocation)
    if (!outwardSegment) return null

    // 復路：mid → start（同じパスを逆順）
    const returnPath = outwardSegment.path.slice().reverse()

    // 完全なルートパス
    const routePath = [...outwardSegment.path, ...returnPath.slice(1)] // 中間地点を重複しないように

    // 往復距離
    const totalDistance = outwardSegment.distance * 2

    // 推定時間
    const estimatedTime = (totalDistance / RUNNING_PACE_MIN_PER_KM) * 60 // 秒を分に変換

    const route: OptimizedRoute = {
      startLocation,
      midLocation,
      totalDistance,
      estimatedTime: Math.round(estimatedTime * 10) / 10, // 小数第1位まで
      routePath,
      outwardPath: outwardSegment.path,
    }

    return route
  } catch (error) {
    console.error('Error generating route:', error)
    return null
  }
}

/**
 * OSRM で2点間のルートを取得（道なり）
 */
async function getRouteSegment(
  from: Location,
  to: Location
): Promise<{ path: Location[]; distance: number } | null> {
  try {
    const url = `${OSRM_SERVER}/route/v1/foot/${from.lng},${from.lat};${to.lng},${to.lat}?steps=true&geometries=geojson&overview=full`

    const response = await fetch(url)
    if (!response.ok) throw new Error(`OSRM API error: ${response.status}`)

    const data = await response.json()

    if (!data.routes || data.routes.length === 0) {
      console.warn('No route found between points')
      return null
    }

    const route = data.routes[0]
    const distance = route.distance / 1000 // メートルをkmに変換
    const coordinates = route.geometry.coordinates

    const path: Location[] = coordinates.map((coord: [number, number]) => ({
      lat: coord[1],
      lng: coord[0],
    }))

    return { path, distance }
  } catch (error) {
    console.error('Error fetching OSRM route:', error)
    return null
  }
}
