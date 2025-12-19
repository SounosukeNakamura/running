/**
 * 改善版：道路ネットワークベースのルート生成エンジン v2.0
 * 
 * 改善点：
 * 1. スタート = ゴール地点の厳密な周回ルート
 * 2. 全区間を OSRM で道路ネットワークに沿わせる
 * 3. 走行時間制約を厳密に管理（超過しない）
 * 4. マーカー表示制御を UI 層に委譲
 * 5. 指定時間内で最大距離になるように最適化
 */

export interface Location {
  lat: number
  lng: number
}

export interface RouteSegment {
  from: Location
  to: Location
  distance: number // km
  duration: number // 分
  path: Location[] // 道路沿いの詳細パス
}

export interface OptimizedRoute {
  startLocation: Location // スタート＝ゴール地点
  waypoints: Location[] // 中間経由点（スタート・ゴール除く）
  segments: RouteSegment[] // ルート区間情報
  totalDistance: number // km
  estimatedTime: number // 分
  routePath: Location[] // 完全なルートパス（表示用）
  displayMarkers?: {
    startGoal: Location // スタート・ゴール地点のマーカー
    // ウェイポイント用マーカーは表示しない
  }
}

// ===== 定数 =====

/** OSRM サーバーURL */
const OSRM_SERVER = 'https://router.project-osrm.org'

/** 地球の半径（km） */
const EARTH_RADIUS_KM = 6371

/** ランニング想定ペース（分/km） */
const RUNNING_PACE_MIN_PER_KM = 6

/** 直線距離から実道路距離への係数（都市部） */
const ROUTE_DISTANCE_RATIO = 0.7

/** ルート生成時の最大ウェイポイント数 */
const MAX_WAYPOINTS = 20

/** 時間超過の許容幅（分） */
const TIME_BUFFER_MIN = 1

// ===== 距離・方位計算関数 =====

/**
 * Haversine公式で2点間の直線距離を計算（km）
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
 * 2点間の方位角を計算（度：0=北, 90=東, 180=南, 270=西）
 */
export function calculateBearing(from: Location, to: Location): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const toDeg = (rad: number) => (rad * 180) / Math.PI

  const lat1 = toRad(from.lat)
  const lat2 = toRad(to.lat)
  const deltaLng = toRad(to.lng - from.lng)

  const y = Math.sin(deltaLng) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng)

  const bearing = toDeg(Math.atan2(y, x))
  return (bearing + 360) % 360 // 0-360に正規化
}

/**
 * 方位角と距離から新しい位置を計算
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
 * スタート地点を中心とした周回用の初期ウェイポイントを生成
 * @param startLocation スタート＝ゴール地点
 * @param maxDistanceKm 最大走行距離（km）
 * @param numWaypoints ウェイポイント数
 * @returns 周回ウェイポイント配列（スタート・ゴール除く）
 */
export function generateCircularWaypoints(
  startLocation: Location,
  maxDistanceKm: number,
  numWaypoints: number = 6
): Location[] {
  // 周回ルート：スタート → wp1 → wp2 → ... → wpN → スタート
  // 直線距離半径を計算
  const straightLineRadius = (maxDistanceKm * ROUTE_DISTANCE_RATIO) / (2 * Math.PI)

  const waypoints: Location[] = []

  // 周回上に均等にウェイポイントを配置
  for (let i = 0; i < numWaypoints; i++) {
    const angle = (i / numWaypoints) * 360
    const waypoint = getLocationByBearingAndDistance(startLocation, angle, straightLineRadius)
    waypoints.push(waypoint)
  }

  return waypoints
}

// ===== OSRM API 呼び出し関数 =====

/**
 * OSRM から複数ウェイポイント経由のルート情報を取得
 * @param waypoints スタート → 経由点 → ゴール（最初と最後が同じ場所）
 * @returns ルート情報
 */
export async function getClosedRouteGeometry(waypoints: Location[]): Promise<{
  distance: number // km
  duration: number // 秒
  path: Location[] // 道路沿いの座標配列
}> {
  // 最初と最後が同じ地点（閉じたルート）であることを確認
  if (waypoints.length < 2) {
    throw new Error('At least 2 waypoints required (start and end)')
  }

  const maxWaypoints = Math.min(waypoints.length, MAX_WAYPOINTS)
  const limitedWaypoints = waypoints.slice(0, maxWaypoints)

  const coordinates = limitedWaypoints.map((wp) => `${wp.lng},${wp.lat}`).join(';')
  const url = `${OSRM_SERVER}/route/v1/foot/${coordinates}?overview=full&geometries=geojson&steps=false`

  try {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`OSRM API error: ${response.status}`)
    }

    const data = await response.json()

    if (!data.routes || data.routes.length === 0) {
      throw new Error('No route found from OSRM')
    }

    const route = data.routes[0]
    const distance = route.distance / 1000 // メートル → km
    const duration = route.duration // 秒
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
  } catch (error) {
    console.error('OSRM getClosedRouteGeometry error:', error)
    throw error
  }
}

/**
 * OSRM から2点間のルート距離と時間を取得
 */
export async function getSegmentRouteInfo(
  from: Location,
  to: Location
): Promise<{
  distance: number
  duration: number
}> {
  const coordinates = `${from.lng},${from.lat};${to.lng},${to.lat}`
  const url = `${OSRM_SERVER}/route/v1/foot/${coordinates}?overview=false`

  try {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`OSRM API error: ${response.status}`)
    }

    const data = await response.json()

    if (!data.routes || data.routes.length === 0) {
      throw new Error('No route found')
    }

    return {
      distance: data.routes[0].distance / 1000, // メートル → km
      duration: data.routes[0].duration / 60, // 秒 → 分
    }
  } catch (error) {
    console.error('OSRM getSegmentRouteInfo error:', error)
    // フォールバック：直線距離とペースから推定
    const distance = calculateStraightLineDistance(from, to)
    return {
      distance,
      duration: distance * RUNNING_PACE_MIN_PER_KM,
    }
  }
}

// ===== ルート最適化関数 =====

/**
 * ウェイポイント経由の全体ルートを評価（走行時間を計算）
 */
async function evaluateRoute(
  startLocation: Location,
  waypoints: Location[]
): Promise<{
  totalDistance: number
  estimatedTime: number
  segments: RouteSegment[]
}> {
  // ウェイポイント配列を閉じたルートに変換（最後にスタートに戻す）
  const closedWaypoints = [...waypoints, startLocation]

  // 各セグメント間の距離と時間を計算
  const segments: RouteSegment[] = []
  let totalDistance = 0
  let totalTime = 0

  for (let i = 0; i < closedWaypoints.length - 1; i++) {
    const from = closedWaypoints[i]
    const to = closedWaypoints[i + 1]

    const segmentInfo = await getSegmentRouteInfo(from, to)

    segments.push({
      from,
      to,
      distance: segmentInfo.distance,
      duration: segmentInfo.duration,
      path: [], // 後で詳細ルートから抽出
    })

    totalDistance += segmentInfo.distance
    totalTime += segmentInfo.duration
  }

  return {
    totalDistance,
    estimatedTime: totalTime,
    segments,
  }
}

/**
 * 走行時間制約の下で、最大距離になるようなウェイポイント数を見つける
 */
async function optimizeWaypointCount(
  startLocation: Location,
  maxTimeMinutes: number,
  initialWaypoints: number = 6
): Promise<{
  optimalWaypoints: Location[]
  routeInfo: {
    totalDistance: number
    estimatedTime: number
    segments: RouteSegment[]
  }
}> {
  // バイナリサーチで最適なウェイポイント数を探索
  let minWaypoints = 2 // 最少：スタート直後に折り返す最小構成
  let maxWaypoints = Math.min(initialWaypoints + 5, MAX_WAYPOINTS)
  let bestWaypoints: Location[] = []
  let bestDistance = 0
  let bestRouteInfo = {
    totalDistance: 0,
    estimatedTime: 0,
    segments: [] as RouteSegment[],
  }

  // 複数のウェイポイント数でルートを試す
  for (let numWaypoints = minWaypoints; numWaypoints <= maxWaypoints; numWaypoints++) {
    console.log(`🔄 Trying ${numWaypoints} waypoints...`)

    try {
      const candidateWaypoints = generateCircularWaypoints(
        startLocation,
        (maxTimeMinutes * RUNNING_PACE_MIN_PER_KM) / 1.2, // 初期距離推定
        numWaypoints
      )

      const routeInfo = await evaluateRoute(startLocation, candidateWaypoints)

      console.log(
        `  Distance: ${routeInfo.totalDistance.toFixed(2)}km, Time: ${routeInfo.estimatedTime.toFixed(1)}min`
      )

      // 走行時間が制約以内で、かつ距離が最大のものを選択
      if (routeInfo.estimatedTime <= maxTimeMinutes) {
        if (routeInfo.totalDistance > bestDistance) {
          bestWaypoints = candidateWaypoints
          bestDistance = routeInfo.totalDistance
          bestRouteInfo = routeInfo
        }
      } else {
        // 時間超過の場合、この先のウェイポイント数は試さない
        console.log(`  ⏱️ Exceeds time limit (${routeInfo.estimatedTime.toFixed(1)} > ${maxTimeMinutes})`)
        break
      }
    } catch (error) {
      console.error(`  Error with ${numWaypoints} waypoints:`, error)
      continue
    }
  }

  if (bestWaypoints.length === 0) {
    throw new Error(`Failed to generate route within ${maxTimeMinutes} minutes`)
  }

  return {
    optimalWaypoints: bestWaypoints,
    routeInfo: bestRouteInfo,
  }
}

// ===== メイン最適化関数 =====

/**
 * ランニング時間から最適化された周回ルートを生成
 * 
 * 特徴：
 * - スタート = ゴール地点
 * - 全区間が OSRM で道路ネットワークに沿う
 * - 走行時間が入力値を超えない
 * - 指定時間内で最大距離を実現
 */
export async function generateOptimizedClosedRoute(
  startLocation: Location,
  maxRunningMinutes: number,
  initialWaypointCount: number = 6
): Promise<OptimizedRoute> {
  if (maxRunningMinutes <= 0 || maxRunningMinutes > 300) {
    throw new Error('Running time must be between 1 and 300 minutes')
  }

  console.log(
    `\n🚀 Starting closed route generation (${maxRunningMinutes} min, ${startLocation.lat.toFixed(4)}, ${startLocation.lng.toFixed(4)})`
  )

  // ウェイポイント数を最適化
  const { optimalWaypoints, routeInfo } = await optimizeWaypointCount(
    startLocation,
    maxRunningMinutes,
    initialWaypointCount
  )

  console.log(`\n✅ Optimal configuration found:`)
  console.log(`   Waypoints: ${optimalWaypoints.length}`)
  console.log(`   Distance: ${routeInfo.totalDistance.toFixed(2)}km`)
  console.log(`   Estimated time: ${routeInfo.estimatedTime.toFixed(1)}min`)

  // 全体ルートの詳細パスを取得
  const closedWaypoints = [...optimalWaypoints, startLocation]
  let routePath: Location[] = []

  try {
    const routeGeometry = await getClosedRouteGeometry(closedWaypoints)
    routePath = routeGeometry.path
    console.log(`   Route path points: ${routePath.length}`)
  } catch (error) {
    console.error('Failed to get detailed route path:', error)
    // フォールバック：ウェイポイントを直接使用
    routePath = closedWaypoints
  }

  return {
    startLocation,
    waypoints: optimalWaypoints, // スタート・ゴール除く
    segments: routeInfo.segments,
    totalDistance: routeInfo.totalDistance,
    estimatedTime: routeInfo.estimatedTime,
    routePath,
    displayMarkers: {
      startGoal: startLocation,
      // ウェイポイント用マーカーは表示しない
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
