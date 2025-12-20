/**
 * ランニングコース生成アプリの共通ユーティリティ関数群
 */

// ===== 型定義 =====

export interface Location {
  lat: number
  lng: number
}

export interface WeatherData {
  main: {
    temp: number
    feels_like: number
    humidity: number
  }
  weather: Array<{
    main: string
    description: string
  }>
  wind: {
    speed: number
  }
  clouds: {
    all: number
  }
}

export interface CoursePoint {
  lat: number
  lng: number
}

// ===== 定数 =====

/** ランニング想定ペース（分/km）*/
const RUNNING_PACE_MIN_PER_KM = 6

/** 地球の半径（km）*/
const EARTH_RADIUS_KM = 6371

// ===== 距離計算関数 =====

/**
 * 2つの位置間の距離をHaversine公式で計算（km）
 */
export function calculateDistance(loc1: Location, loc2: Location): number {
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
 * 方位角と距離から新しい位置を計算
 * @param location 出発地点
 * @param bearing 方位角（度：0=北, 90=東）
 * @param distanceKm 距離（km）
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

// ===== コース生成関数 =====

/**
 * ランニング時間から走行距離を計算
 * @param minutes ランニング時間（分）
 * @returns 走行距離（km）
 */
export function calculateRunningDistance(minutes: number): number {
  return minutes / RUNNING_PACE_MIN_PER_KM
}

/**
 * 円周上のコース（ポイント群）を生成
 * @param center 出発地点
 * @param totalDistanceKm 総走行距離
 * @param points 生成するポイント数（デフォルト：8）
 * @returns コース上の座標配列
 */
export function generateCircularCourse(
  center: Location,
  totalDistanceKm: number,
  points: number = 8
): CoursePoint[] {
  // 円周 = 2πr より、半径を計算
  // 走行距離は往復なので、実際の円周はその半分
  const radius = totalDistanceKm / (2 * Math.PI)

  const course: CoursePoint[] = []

  for (let i = 0; i < points; i++) {
    const angle = (i / points) * 360 // 度
    const location = getLocationByBearingAndDistance(center, angle, radius)
    course.push(location)
  }

  // 最初の点に戻る
  course.push(course[0])

  return course
}

// ===== API呼び出し関数 =====

/**
 * OpenWeather APIから天気情報を取得
 */
export async function fetchWeatherData(
  location: Location,
  apiKey: string
): Promise<WeatherData> {
  const url = new URL('https://api.openweathermap.org/data/2.5/weather')
  url.searchParams.set('lat', location.lat.toString())
  url.searchParams.set('lon', location.lng.toString())
  url.searchParams.set('appid', apiKey)
  url.searchParams.set('units', 'metric')
  url.searchParams.set('lang', 'ja')

  const response = await fetch(url.toString())
  if (!response.ok) {
    throw new Error(`Weather API error: ${response.status} ${response.statusText}`)
  }

  return response.json()
}

/**
 * Geolonia Reverse Geocoding APIで緯度経度から住所を取得
 * @param location 緯度・経度
 * @returns 住所文字列
 */
export async function reverseGeocodeLocation(location: Location): Promise<string> {
  const url = new URL('https://api.geolonia.com/v1/reverse')
  url.searchParams.set('lat', location.lat.toString())
  url.searchParams.set('lng', location.lng.toString())

  try {
    const response = await fetch(url.toString())
    if (!response.ok) {
      throw new Error(`Reverse Geocoding API error: ${response.status}`)
    }

    const data = await response.json()

    // Geolonia APIの応答形式: { properties: { name } }
    if (data.properties && data.properties.name) {
      return data.properties.name
    }

    // フォールバック：座標表示
    return `${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}`
  } catch (error) {
    console.error('Reverse geocoding error:', error)
    // エラー時は座標を返す
    return `${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}`
  }
}

/**
 * Geolonia Geocoding APIで住所から位置情報を取得
 * @param address 住所文字列（日本語対応）
 * @returns 緯度・経度
 */
export async function geocodeAddress(address: string): Promise<Location> {
  if (!address.trim()) {
    throw new Error('住所を入力してください')
  }

  const url = new URL('https://api.geolonia.com/v1/geocode')
  url.searchParams.set('address', address)

  try {
    const response = await fetch(url.toString())
    if (!response.ok) {
      throw new Error(`Geocoding API error: ${response.status}`)
    }

    const data = await response.json()

    // Geolonia APIの応答形式: { geometry: { coordinates: [lng, lat] } }
    if (data.geometry && data.geometry.coordinates) {
      const [lng, lat] = data.geometry.coordinates
      return { lat, lng }
    }

    throw new Error('住所が見つかりませんでした')
  } catch (error) {
    console.error('Geocoding error:', error)
    throw new Error('住所の検索に失敗しました。別の住所を試してください。')
  }
}

// ===== バリデーション関数 =====

/**
 * ランニング時間の入力値をバリデーション
 */
export function validateRunningMinutes(value: unknown): { valid: boolean; error?: string } {
  const num = Number(value)

  if (isNaN(num)) {
    return { valid: false, error: '時間は数値で入力してください' }
  }

  if (num <= 0) {
    return { valid: false, error: '時間は0より大きい値を入力してください' }
  }

  if (num > 300) {
    return { valid: false, error: '時間は300分以下で入力してください' }
  }

  return { valid: true }
}

/**
 * 緯度経度の入力値をバリデーション
 */
export function validateLocation(lat: unknown, lng: unknown): { valid: boolean; error?: string } {
  const latitude = Number(lat)
  const longitude = Number(lng)

  if (isNaN(latitude) || isNaN(longitude)) {
    return { valid: false, error: '緯度と経度は数値で入力してください' }
  }

  if (latitude < -90 || latitude > 90) {
    return { valid: false, error: '緯度は-90～90の範囲で入力してください' }
  }

  if (longitude < -180 || longitude > 180) {
    return { valid: false, error: '経度は-180～180の範囲で入力してください' }
  }

  return { valid: true }
}
