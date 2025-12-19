/**
 * 道路ネットワークベースのルート生成最適化エンジン
 * OSRM（Open Source Routing Machine）とGeoloniaを活用した現実的なルート生成
 */

export interface Location {
  lat: number
  lng: number
}

export interface RouteStep {
  location: Location
  stepIndex: number
  distanceFromStart: number // km
}

export interface OptimizedRoute {
  waypoints: Location[] // スタート → 経由点 → ゴール
  totalDistance: number // km
  routePath: Location[] // 実際の道路に沿ったパス
  steps: RouteStep[]
}

// ===== 定数 =====

/** OSRM サーバーURL（公開インスタンス） */
const OSRM_SERVER = 'https://router.project-osrm.org'

/** 地球の半径（km） */
const EARTH_RADIUS_KM = 6371

/** ランニング想定ペース（分/km） */
const RUNNING_PACE_MIN_PER_KM = 6

/** ウェイポイント間の目標距離（km）- ルート最適化用 */
const TARGET_WAYPOINT_INTERVAL = 1.5

/** ルート生成時の最大ウェイポイント数 */
const MAX_WAYPOINTS = 25

// ===== 距離計算関数 =====

/**
 * 2つの位置間の直線距離をHaversine公式で計算（km）
 * ルート最適化で使用する距離推定値
 */
export function calculateStraightLineDistance(loc1: Location, loc2: Location): number {
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
 * 方位角と距離から新しい位置を計算（直線距離ベース）
 */
export function getLocationByBearingAndDistance(
  location: Location,
  bearing: number,
  distanceKm: number
): Location {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const toDeg = (rad: number) => (rad * 180) / Math.PI

  const lat1 = toRad(location.lat)
  const lng1 = toRad(location.lng)
  const bearingRad = toRad(bearing)
  const angular = distanceKm / EARTH_RADIUS_KM

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

// ===== ウェイポイント生成関数 =====

/**
 * 指定距離に基づいて、スタート地点を中心とした周回用の初期ウェイポイントを生成
 * @param startLocation スタート地点（現在地）
 * @param targetDistanceKm 目標走行距離（km）
 * @param numWaypoints ウェイポイント数（デフォルト：6）
 * @returns 初期ウェイポイント配列（スタート地点を含む）
 */
export function generateInitialWaypoints(
  startLocation: Location,
  targetDistanceKm: number,
  numWaypoints: number = 6
): Location[] {
  // 周回ルート：スタート → 経由点群 → スタートに戻る
  // 直線距離の半径を計算（道路での実距離はこれより長いため、係数0.7を適用）
  const straightLineRadius = (targetDistanceKm * 0.7) / (2 * Math.PI)

  const waypoints: Location[] = [startLocation]

  // 周回上に均等にウェイポイントを配置
  for (let i = 1; i < numWaypoints; i++) {
    const angle = ((i - 1) / (numWaypoints - 1)) * 360
    const waypoint = getLocationByBearingAndDistance(startLocation, angle, straightLineRadius)
    waypoints.push(waypoint)
  }

  return waypoints
}

// ===== OSRM API呼び出し関数 =====

/**
 * OSRMから2点間のルート距離を取得（km）
 * @param from 出発地点
 * @param to 到着地点
 * @returns ルート距離（km）
 */
export async function getRouteDistance(from: Location, to: Location): Promise<number> {
  const coordinates = `${from.lng},${from.lat};${to.lng},${to.lat}`
  const url = `${OSRM_SERVER}/route/v1/foot/${coordinates}?overview=false`

  try {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`OSRM API error: ${response.status}`)
    }

    const data = await response.json()

    if (data.routes && data.routes.length > 0) {
      // メートルをkmに変換
      return data.routes[0].distance / 1000
    }

    throw new Error('No route found')
  } catch (error) {
    console.error('OSRM distance error:', error)
    // フォールバック：直線距離を使用
    return calculateStraightLineDistance(from, to)
  }
}

/**
 * OSRMから複数ウェイポイントを経由するルート情報を取得
 * @param waypoints ウェイポイント配列（スタート → 経由点 → ゴール）
 * @returns ルート情報（総距離、詳細パス）
 */
export async function getRouteGeometry(waypoints: Location[]): Promise<{
  distance: number
  duration: number
  path: Location[]
}> {
  // 最大25個のウェイポイントに制限
  const limitedWaypoints = waypoints.slice(0, MAX_WAYPOINTS)

  const coordinates = limitedWaypoints.map((wp) => `${wp.lng},${wp.lat}`).join(';')
  const url = `${OSRM_SERVER}/route/v1/foot/${coordinates}?overview=full&geometries=geojson`

  try {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`OSRM API error: ${response.status}`)
    }

    const data = await response.json()

    if (data.routes && data.routes.length > 0) {
      const route = data.routes[0]
      const distance = route.distance / 1000 // メートル→km
      const duration = route.duration / 60 // 秒→分
      const coordinates = route.geometry.coordinates

      // [lng, lat] を {lat, lng} に変換
      const path: Location[] = coordinates.map(([lng, lat]: [number, number]) => ({
        lat,
        lng,
      }))

      return {
        distance,
        duration,
        path,
      }
    }

    throw new Error('No route found')
  } catch (error) {
    console.error('OSRM geometry error:', error)
    // フォールバック：ウェイポイントを直接返す
    return {
      distance: 0,
      duration: 0,
      path: limitedWaypoints,
    }
  }
}

// ===== ルート最適化関数 =====

/**
 * ウェイポイントを距離に基づいて最適化
 * @param startLocation スタート地点（現在地）
 * @param waypoints 初期ウェイポイント
 * @param targetDistanceKm 目標走行距離
 * @returns 最適化されたウェイポイント配列
 */
export async function optimizeWaypoints(
  startLocation: Location,
  waypoints: Location[],
  targetDistanceKm: number
): Promise<Location[]> {
  // 各ウェイポイント間のOSRMルート距離を計算
  const segments: { from: Location; to: Location; distance: number }[] = []

  // スタート → 最初のウェイポイント
  segments.push({
    from: startLocation,
    to: waypoints[1],
    distance: await getRouteDistance(startLocation, waypoints[1]),
  })

  // ウェイポイント間
  for (let i = 1; i < waypoints.length - 1; i++) {
    segments.push({
      from: waypoints[i],
      to: waypoints[i + 1],
      distance: await getRouteDistance(waypoints[i], waypoints[i + 1]),
    })
  }

  // 最後のウェイポイント → スタート（ゴール）
  segments.push({
    from: waypoints[waypoints.length - 1],
    to: startLocation,
    distance: await getRouteDistance(waypoints[waypoints.length - 1], startLocation),
  })

  const totalDistance = segments.reduce((sum, seg) => sum + seg.distance, 0)

  console.log(`📏 Current route distance: ${totalDistance.toFixed(1)}km (Target: ${targetDistanceKm.toFixed(1)}km)`)

  // 距離が目標に近い場合はそのまま返す（±10%の許容範囲）
  if (Math.abs(totalDistance - targetDistanceKm) / targetDistanceKm < 0.1) {
    return waypoints
  }

  // 距離が足りない場合：ウェイポイント数を増やす
  if (totalDistance < targetDistanceKm) {
    console.log('🔄 Increasing waypoints...')
    return generateInitialWaypoints(startLocation, targetDistanceKm, waypoints.length + 1)
  }

  // 距離が多い場合：ウェイポイント数を減らす
  console.log('🔄 Decreasing waypoints...')
  return generateInitialWaypoints(startLocation, targetDistanceKm, Math.max(3, waypoints.length - 1))
}

// ===== メイン最適化関数 =====

/**
 * 走行時間から指定距離に最適化されたランニングコースを生成
 * @param startLocation スタート地点（現在地）
 * @param runningMinutes ランニング時間（分）
 * @returns 最適化されたルート情報
 */
export async function generateOptimizedRunningRoute(
  startLocation: Location,
  runningMinutes: number
): Promise<OptimizedRoute> {
  // 走行距離を計算
  const targetDistance = (runningMinutes / RUNNING_PACE_MIN_PER_KM)

  console.log(`⏱️  Running time: ${runningMinutes}min → Target distance: ${targetDistance.toFixed(1)}km`)

  // 初期ウェイポイントを生成
  let waypoints = generateInitialWaypoints(startLocation, targetDistance, 8)

  // ウェイポイントを最適化（最大3回の反復）
  for (let iteration = 0; iteration < 3; iteration++) {
    const optimized = await optimizeWaypoints(startLocation, waypoints, targetDistance)
    waypoints = optimized

    // 収束判定
    if (iteration === 2) break
  }

  // 最終ルートを取得（実際の道路に沿ったパス）
  const { distance, duration, path } = await getRouteGeometry(waypoints)

  // ルート上のステップを生成
  const steps: RouteStep[] = []
  let accumulatedDistance = 0

  waypoints.forEach((waypoint, index) => {
    steps.push({
      location: waypoint,
      stepIndex: index,
      distanceFromStart: accumulatedDistance,
    })
  })

  return {
    waypoints,
    totalDistance: distance || targetDistance,
    routePath: path,
    steps,
  }
}

/**
 * ランニング時間から走行距離を計算
 */
export function calculateRunningDistance(minutes: number): number {
  return minutes / RUNNING_PACE_MIN_PER_KM
}
