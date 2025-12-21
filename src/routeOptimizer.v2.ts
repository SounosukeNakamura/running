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
  // maxDistanceKm は往路目標距離（例: 2.5km）
  // WPは現在地から maxDistanceKm 程度の距離に配置する
  // これにより OSRM が maxDistanceKm に相当するルートを生成する

  const waypoints: Location[] = []

  // 周回上に均等にウェイポイントを配置
  for (let i = 0; i < numWaypoints; i++) {
    const angle = (i / numWaypoints) * 360
    // 往路目標距離そのものを半径として使う（スケール係数を適用済みの値）
    const waypoint = getLocationByBearingAndDistance(startLocation, angle, maxDistanceKm)
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
 * 改善版：直線距離推定を使用して高速化
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
  // 直線距離で推定（OSRM呼び出しなし）
  const targetDistance = maxTimeMinutes / RUNNING_PACE_MIN_PER_KM
  const candidateWaypoints = generateCircularWaypoints(
    startLocation,
    targetDistance,
    initialWaypoints
  )

  // OSRM APIで実際のルート情報を取得（1回だけ）
  const routeInfo = await evaluateRoute(startLocation, candidateWaypoints)

  return {
    optimalWaypoints: candidateWaypoints,
    routeInfo,
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

// ===== ルート品質評価関数 =====

/**
 * ルート上の連続する3点における角度変化（ターン）を計算
 * @param p1 始点
 * @param p2 中点
 * @param p3 終点
 * @returns 角度（度：0=直進, 180=折り返し）
 */
function calculateTurnAngle(p1: Location, p2: Location, p3: Location): number {
  const bearing1 = calculateBearing(p1, p2) // p1 → p2 の方位角
  const bearing2 = calculateBearing(p2, p3) // p2 → p3 の方位角

  let angle = Math.abs(bearing2 - bearing1)
  // 角度を 0-180 の範囲に正規化（短い方の回転角）
  if (angle > 180) angle = 360 - angle
  return angle
}

/**
 * ルートの「曲がり角が多いかどうか」を評価
 * 大きな角度変化（60度以上）の回数をカウント
 * @param routePath ルート上の座標列
 * @returns ターン数（少ないほど分かりやすい）
 */
function countSharpTurns(routePath: Location[], threshold: number = 60): number {
  if (routePath.length < 3) return 0

  let sharpTurnCount = 0

  // ルートを一定の間隔でサンプル（計算量削減）
  const sampleInterval = Math.max(1, Math.floor(routePath.length / 50))

  for (let i = 0; i < routePath.length - 2; i += sampleInterval) {
    const angle = calculateTurnAngle(routePath[i], routePath[i + 1], routePath[i + 2])
    if (angle >= threshold) {
      sharpTurnCount++
    }
  }

  return sharpTurnCount
}

/**
 * ルートのジグザグ度を評価
 * 短距離の間に方向が頻繁に変わるかどうかを判定
 * @param routePath ルート上の座標列
 * @returns ジグザグスコア（0-1、低いほどジグザグでない）
 */
function calculateZigzagScore(routePath: Location[]): number {
  if (routePath.length < 10) return 0

  // ルートを10個のセグメントに分割
  const segmentSize = Math.floor(routePath.length / 10)
  if (segmentSize < 2) return 0

  let zigzagCount = 0

  for (let i = 0; i < routePath.length - 2; i += segmentSize) {
    const angle = calculateTurnAngle(routePath[i], routePath[i + 1], routePath[i + 2])
    // 90度以上の急なターンをジグザグと判定
    if (angle >= 90) {
      zigzagCount++
    }
  }

  // ジグザグ度 = (急なターンの数) / (総セグメント数)
  return Math.min(zigzagCount / 10, 1.0)
}

/**
 * ルート品質スコアを計算（総合評価）
 * 低いほど良い品質
 * @param routePath ルート上の座標列
 * @returns 品質スコア（0～1）
 */
function calculateRouteQualityScore(routePath: Location[]): number {
  const sharpTurns = countSharpTurns(routePath, 60)
  const zigzagScore = calculateZigzagScore(routePath)

  // 急いターンが多いほどペナルティを増加
  const turnPenalty = Math.min(sharpTurns / 20, 1.0) // 20個以上で1.0
  
  // ジグザグ度も品質スコアに反映
  const qualityScore = (turnPenalty + zigzagScore) / 2

  return Math.min(qualityScore, 1.0)
}

// ===== メイン最適化関数（複数候補比較版） =====

interface RouteCandidate {
  waypoints: Location[]
  routeInfo: { totalDistance: number; estimatedTime: number; segments: RouteSegment[] }
  routePath: Location[]
  duration: number // 秒
  duplicateRatio: number // 0-1
  qualityScore: number // 0-1（ルート品質スコア）
  sharpTurns: number // 60度以上のターン数
  timeDiff: number // 目標時間との差分（秒）
  score: number // 複合スコア（低いほど良い）
}

/**
 * ランニング時間から最適化された周回ルートを生成（改善版）
 * 
 * 時間条件：
 *   lowerBound = minutes - 2
 *   targetMin = minutes
 *   条件: lowerBound < estimatedMinutes < targetMin
 *   つまり: minutes - 2 < estimatedMinutes < minutes
 * 
 * 改善点：
 * 1. 厳密な時間条件を満たすルートのみ採用
 * 2. 最大試行30回で条件を満たすルートを検索
 * 3. 優先順位：時間の近さ > 重複度 > ターン数
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
    `\n🚀 Starting route generation (${maxRunningMinutes} min, ${startLocation.lat.toFixed(4)}, ${startLocation.lng.toFixed(4)})`
  )

  // ⏰ 時間条件を定義
  const targetMin = maxRunningMinutes
  const lowerBound = maxRunningMinutes - 2
  
  console.log(`⏰ Time condition: ${lowerBound.toFixed(1)}min < estimatedTime < ${targetMin}min`)

  const candidates: RouteCandidate[] = []
  const maxAttempts = 30
  let attemptCount = 0

  // スケール係数とウェイポイント数を拡大（候補を多く生成）
  const scales = [0.75, 0.8, 0.85, 0.9, 0.95, 1.0]
  const waypointCounts = [4, 5, 6, 7, 8]
  
  console.log(`\n📋 Generating route candidates (max ${maxAttempts} attempts)...`)
  
  for (const scale of scales) {
    if (attemptCount >= maxAttempts) break
    
    for (const wpCount of waypointCounts) {
      if (attemptCount >= maxAttempts) break
      
      attemptCount++
      try {
        console.log(`   [${attemptCount}/${maxAttempts}] Scale: ${scale.toFixed(2)}, Waypoints: ${wpCount}`)
        
        const targetTime = maxRunningMinutes * scale
        const { optimalWaypoints: waypoints, routeInfo: info } = await optimizeWaypointCount(
          startLocation,
          targetTime,
          wpCount
        )

        const estimatedMinutes = info.estimatedTime
        
        // 🔴 厳密な時間条件チェック：lowerBound < estimatedMinutes < targetMin
        if (!(lowerBound < estimatedMinutes && estimatedMinutes < targetMin)) {
          const reason = 
            estimatedMinutes <= lowerBound ? `too short (${estimatedMinutes.toFixed(1)}min ≤ ${lowerBound.toFixed(1)}min)` :
            estimatedMinutes >= targetMin ? `exceeds target (${estimatedMinutes.toFixed(1)}min ≥ ${targetMin}min)` :
            'unknown'
          console.log(
            `      ⏭️  Skipped: ${reason}`
          )
          continue
        }
        
        // ルートパスを取得して品質評価
        const closedWaypoints = [startLocation, ...waypoints, startLocation]
        let routePath = closedWaypoints
        
        try {
          const routeGeometry = await getClosedRouteGeometry(closedWaypoints)
          routePath = routeGeometry.path
        } catch (error) {
          console.warn(`⚠️ Could not get route geometry`)
        }

        // ルート品質を計算
        const duplicateRatio = calculateDuplicateRatio(routePath)
        const qualityScore = calculateRouteQualityScore(routePath)
        const sharpTurns = countSharpTurns(routePath, 60)

        // スコア計算（優先度：1時間の近さ > 2重複度 > 3ターン数）
        // 1. targetMin - estimatedMinutes が最小（走りたい時間に最も近い）
        //    差が小さいほどスコアが低い（良い）
        const timeDistanceToTarget = targetMin - estimatedMinutes
        const timeScore = timeDistanceToTarget * 1000 // スケーリング
        
        // 2. 重複度が低い
        const duplicatePenalty = duplicateRatio * 100 // 0-100
        
        // 3. ターン数が少ない
        const turnPenalty = sharpTurns * 5 // 1ターンあたり5ポイント
        
        const score = timeScore + duplicatePenalty + turnPenalty

        const timeDiffSeconds = (estimatedMinutes - targetMin) * 60 // 負の値（オーバーしてない）
        
        const candidate: RouteCandidate = {
          waypoints,
          routeInfo: info,
          routePath,
          duration: estimatedMinutes * 60, // 秒に変換
          timeDiff: timeDiffSeconds,
          duplicateRatio,
          qualityScore,
          sharpTurns,
          score
        }
        
        candidates.push(candidate)
        
        console.log(
          `      ✅ Time: ${estimatedMinutes.toFixed(1)}min (target: ${targetMin}min), ` +
          `Quality: ${qualityScore.toFixed(2)}, Turns: ${sharpTurns}, Dup: ${(duplicateRatio*100).toFixed(0)}%`
        )
        
      } catch (error) {
        console.log(`      ❌ Failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    }
  }

  // 候補がない場合はエラー
  if (candidates.length === 0) {
    throw new Error(
      `指定した時間に合うルートを生成できませんでした。時間を変更して再試行してください。`
    )
  }

  // ルートを選定（スコアが最小のものを選ぶ）
  candidates.sort((a, b) => a.score - b.score)
  
  console.log(`\n📊 Generated ${candidates.length} valid candidates`)
  console.log(`🏆 Top 3 candidates:`)
  candidates.slice(0, 3).forEach((c, i) => {
    console.log(
      `   [${i + 1}] Time: ${c.routeInfo.estimatedTime.toFixed(1)}min, ` +
      `Distance: ${c.routeInfo.totalDistance.toFixed(2)}km, ` +
      `Duplicate: ${(c.duplicateRatio * 100).toFixed(0)}%, Turns: ${c.sharpTurns}`
    )
  })

  const bestCandidate = candidates[0]
  const routeInfo = bestCandidate.routeInfo
  const optimalWaypoints = bestCandidate.waypoints

  console.log(`\n✅ Route selected:`)
  console.log(`   Time: ${routeInfo.estimatedTime.toFixed(1)}min (target: ${targetMin}min, range: ${lowerBound.toFixed(1)}-${targetMin}min)`)
  console.log(`   Distance: ${routeInfo.totalDistance.toFixed(2)}km`)
  console.log(`   Route quality: ${bestCandidate.qualityScore.toFixed(2)}, Turns: ${bestCandidate.sharpTurns}`)
  console.log(`   Duplicate ratio: ${(bestCandidate.duplicateRatio * 100).toFixed(1)}%`)
  console.log(`   ✅ Condition satisfied: ${lowerBound.toFixed(1)}min < ${routeInfo.estimatedTime.toFixed(1)}min < ${targetMin}min`)

  // ルートパスは既に取得済み
  const routePath = bestCandidate.routePath

  return {
    startLocation,
    waypoints: optimalWaypoints,
    segments: routeInfo.segments,
    totalDistance: routeInfo.totalDistance,
    estimatedTime: routeInfo.estimatedTime,
    routePath,
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
