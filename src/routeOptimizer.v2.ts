/**
 * 改善版：道路ネットワークベースのルート生成エンジン v2.1
 * 
 * 改善点：
 * 1. スタート = ゴール地点の厳密な周回ルート
 * 2. 全区間を OSRM で道路ネットワークに沿わせる
 * 3. 走行時間制約を厳密に管理（超過しない）
 * 4. マーカー表示制御を UI 層に委譲
 * 5. 指定時間内で最大距離になるように最適化
 * 6. 複数の周回ルート候補を生成し、重複度が低いルートを優先
 * 7. 時間が目標値に最も近いルートを選択
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
  }
}

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

// ===== 定数 =====

/** OSRM サーバーURL */
const OSRM_SERVER = 'https://router.project-osrm.org'

/** 地球の半径（km） */
const EARTH_RADIUS_KM = 6371

/** ランニング想定ペース（分/km） */
const RUNNING_PACE_MIN_PER_KM = 6

/** 直線距離から実道路距離への係数（都市部） */
const ROUTE_DISTANCE_RATIO = 0.7

/** ルート候補生成の最小数 */
const MIN_ROUTE_CANDIDATES = 10

/** ルート候補生成の最大数 */
const MAX_ROUTE_CANDIDATES = 30

/** 重複判定の距離閾値（メートル） */
const DUPLICATE_THRESHOLD_METERS = 20

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

    console.log(`✓ OSRM returned route: ${distance.toFixed(2)}km, ${path.length} path points`)

    return {
      distance,
      duration,
      path,
    }
  } catch (error) {
    console.error('⚠️ OSRM getClosedRouteGeometry error:', error)
    // フォールバック：ウェイポイント間を直線で結ぶ
    console.log('  Using fallback: waypoints as path')
    let totalDistance = 0
    for (let i = 0; i < limitedWaypoints.length - 1; i++) {
      totalDistance += calculateStraightLineDistance(limitedWaypoints[i], limitedWaypoints[i + 1])
    }
    return {
      distance: totalDistance,
      duration: totalDistance * RUNNING_PACE_MIN_PER_KM * 60, // km * 分/km * 60秒/分 = 秒
      path: limitedWaypoints,
    }
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
export async function evaluateRoute(
  startLocation: Location,
  waypoints: Location[]
): Promise<{
  totalDistance: number
  estimatedTime: number
  segments: RouteSegment[]
}> {
  // ウェイポイント配列を閉じたルートに変換（スタートを先頭に追加して最後に戻す）
  // これにより start -> wp0 -> wp1 -> ... -> wpN -> start の全区間を評価します
  const closedWaypoints = [startLocation, ...waypoints, startLocation]

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

  console.log(`⏱️ Optimizing waypoints for ${maxTimeMinutes}min, trying ${minWaypoints}-${maxWaypoints} waypoints...`)

  // 複数のウェイポイント数でルートを試す
  for (let numWaypoints = minWaypoints; numWaypoints <= maxWaypoints; numWaypoints++) {
    console.log(`🔄 Trying ${numWaypoints} waypoints...`)

    try {
      // 目標距離を計算：走行時間（分） ÷ ペース（分/km） = 走行距離（km）
      const targetDistance = maxTimeMinutes / RUNNING_PACE_MIN_PER_KM
      const candidateWaypoints = generateCircularWaypoints(
        startLocation,
        targetDistance, // 目標走行距離（km）
        numWaypoints
      )

      const routeInfo = await evaluateRoute(startLocation, candidateWaypoints)

      console.log(
        `  ✓ Distance: ${routeInfo.totalDistance.toFixed(2)}km, Time: ${routeInfo.estimatedTime.toFixed(1)}min`
      )

      // 走行時間が制約以内で、かつ距離が最大のものを選択
      if (routeInfo.estimatedTime <= maxTimeMinutes + TIME_BUFFER_MIN) {
        if (routeInfo.totalDistance > bestDistance) {
          bestWaypoints = candidateWaypoints
          bestDistance = routeInfo.totalDistance
          bestRouteInfo = routeInfo
          console.log(`  ✅ New best: ${routeInfo.totalDistance.toFixed(2)}km in ${routeInfo.estimatedTime.toFixed(1)}min`)
        }
      } else {
        // 時間超過の場合、この先のウェイポイント数は試さない
        console.log(`  ⏱️ Exceeds time limit (${routeInfo.estimatedTime.toFixed(1)} > ${maxTimeMinutes})`)
        break
      }
    } catch (error) {
      console.error(`  ❌ Error with ${numWaypoints} waypoints:`, error)
      continue
    }
  }

  if (bestWaypoints.length === 0) {
    console.error(`❌ Failed to generate route within ${maxTimeMinutes}min`)
    throw new Error(`Failed to generate route within ${maxTimeMinutes} minutes`)
  }

  return {
    optimalWaypoints: bestWaypoints,
    routeInfo: bestRouteInfo,
  }
}

// ===== 重複度計算関数 =====

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
        // 20m以内の近い点が見つかった
        duplicateCount++
        break // この point1 についてはカウント完了
      }
    }
  }

  // 重複度 = (重複した点の数) / (前半の点数)
  const ratio = duplicateCount / firstHalf.length
  return Math.min(ratio, 1.0)
}

// ===== 重複度計算関数 =====

/**
 * ルートパス内での重複度を計算
 * @param routePath ルート上の座標列
 * @returns 重複度（0-1、低いほど重複が少ない）
 */
export function calculateDuplicateRatio(routePath: Location[]): number {
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
      if (distance * 1000 <= 20) { // 20m以内
        duplicateCount++
        break
      }
    }
  }

  const ratio = duplicateCount / firstHalf.length
  return Math.min(ratio, 1.0)
}

// ===== メイン最適化関数（複数候補比較版） =====

interface RouteCandidate {
  waypoints: Location[]
  routeInfo: { totalDistance: number; estimatedTime: number; segments: RouteSegment[] }
  duplicateRatio: number
  score: number
}

/**
 * ランニング時間から最適化された周回ルートを生成
 * 
 * 特徴：
 * - 複数候補生成：スケール係数（0.8～1.0）とウェイポイント数（4～8）を組み合わせ
 * - 重複評価：同じ道を走る度合い（duplicateRatio）を計算
 * - スマート選択：時間ペナルティ（70%）と重複ペナルティ（30%）で最良ルート選定
 * - スタート = ゴール地点
 * - 全区間が OSRM で道路ネットワークに沿う
 * - 走行時間が入力値を超えない（最大許容値以下に調整）
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
    `\n🚀 Starting closed route generation - Multi-candidate (${maxRunningMinutes} min, ${startLocation.lat.toFixed(4)}, ${startLocation.lng.toFixed(4)})`
  )

  // 最大許容時間（秒）：丸め誤差を避けるため5秒のマージンを持つ
  const maxDurationSeconds = maxRunningMinutes * 60 - 5
  console.log(`⏱️ Max duration: ${maxDurationSeconds}s (${maxRunningMinutes}min - 5s buffer)`)

  const candidates: RouteCandidate[] = []

  // ✨ v2.2: 複数候補比較版が有効です
  // スケール係数とウェイポイント数の組み合わせで複数候補を生成
  const scales = [0.8, 0.85, 0.9, 0.95, 1.0]
  const waypointCounts = [4, 5, 6, 7, 8]
  
  let candidateIndex = 0
  
  console.log(`\n📋 Generating ${scales.length * waypointCounts.length} route candidates...`)
  
  for (const scale of scales) {
    for (const wpCount of waypointCounts) {
      candidateIndex++
      try {
        console.log(`   [${candidateIndex}] Scale: ${scale.toFixed(2)}, Waypoints: ${wpCount}...`)
        
        const targetTime = maxRunningMinutes * scale
        const { optimalWaypoints: waypoints, routeInfo: info } = await optimizeWaypointCount(
          startLocation,
          targetTime,
          wpCount
        )

        const estimatedDurationSeconds = info.estimatedTime * 60
        
        // 時間制約チェック
        if (estimatedDurationSeconds > maxDurationSeconds) {
          console.log(`      ⏭️  Skipped: Time exceeded (${estimatedDurationSeconds.toFixed(0)}s > ${maxDurationSeconds}s)`)
          continue
        }

        // 重複率を計算
        const closedWaypoints = [startLocation, ...waypoints, startLocation]
        let duplicateRatio = 0
        try {
          duplicateRatio = calculateDuplicateRatio(closedWaypoints)
        } catch (error) {
          console.warn(`      ⚠️  Could not calculate duplicate ratio:`, error)
          duplicateRatio = 0.5 // デフォルト値
        }

        // スコア計算：時間差（70%）＋重複率（30%）
        // 目標時間との差分（秒）を時間差スコアに変換
        const timeDiffSeconds = Math.abs(maxDurationSeconds - estimatedDurationSeconds)
        const timeScore = (timeDiffSeconds / maxDurationSeconds) * 0.7 // 0～0.7
        const duplicateScore = duplicateRatio * 100 * 0.3 // 0～30
        const score = timeScore + duplicateScore
        
        const candidate: RouteCandidate = {
          waypoints,
          routeInfo: info,
          duplicateRatio,
          score
        }
        
        candidates.push(candidate)
        
        console.log(
          `      ✅ Time: ${info.estimatedTime.toFixed(1)}min, Distance: ${info.totalDistance.toFixed(2)}km, ` +
          `Duplicate: ${(duplicateRatio * 100).toFixed(1)}%, Score: ${score.toFixed(2)}`
        )
        
      } catch (error) {
        console.log(`      ❌ Failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  // 候補がない場合はエラー
  if (candidates.length === 0) {
    throw new Error(
      `指定時間内に収まるルートを生成できませんでした。時間を増やすか再試行してください。`
    )
  }

  // スコアでソート（低いほど良い）し、最良候補を選択
  candidates.sort((a, b) => a.score - b.score)
  
  console.log(`\n📊 Generated ${candidates.length} valid candidates`)
  console.log(`🏆 Top 3 candidates:`)
  candidates.slice(0, 3).forEach((c, i) => {
    console.log(
      `   [${i + 1}] Score: ${c.score.toFixed(2)}, Time: ${c.routeInfo.estimatedTime.toFixed(1)}min, ` +
      `Distance: ${c.routeInfo.totalDistance.toFixed(2)}km, Duplicate: ${(c.duplicateRatio * 100).toFixed(1)}%`
    )
  })

  const bestCandidate = candidates[0]
  const routeInfo = bestCandidate.routeInfo
  const optimalWaypoints = bestCandidate.waypoints

  console.log(`\n✅ Route generation succeeded:`)
  console.log(`   Waypoints: ${optimalWaypoints.length}`)
  console.log(`   Distance: ${routeInfo.totalDistance.toFixed(2)}km`)
  console.log(`   Estimated time: ${routeInfo.estimatedTime.toFixed(1)}min`)
  console.log(`   Duplicate ratio: ${(bestCandidate.duplicateRatio * 100).toFixed(1)}%`)
  console.log(`   Score: ${bestCandidate.score.toFixed(2)}`)

  // 全体ルートの詳細パスを取得（スタートを先頭に入れて閉じた配列を作る）
  const closedWaypoints = [startLocation, ...optimalWaypoints, startLocation]
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
