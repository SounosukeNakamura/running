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
// calculateRunningDistance は未使用のため削除

/**
 * 円周上のコース（ポイント群）を生成
 * @param center 出発地点
 * @param totalDistanceKm 総走行距離
 * @param points 生成するポイント数（デフォルト：8）
 * @returns コース上の座標配列
 */
// generateCircularCourse は未使用のため削除

// ===== API呼び出し関数 =====

/**
 * OpenWeather API から天気情報を取得
 * 
 * 使用方法：
 *   const apiKey = import.meta.env.VITE_OPENWEATHER_API_KEY
 *   const weatherData = await fetchWeatherData(location, apiKey)
 * 
 * APIキー取得：
 *   https://openweathermap.org/api
 * 
 * 環境変数設定：
 *   .env.local (ローカル開発):
 *     VITE_OPENWEATHER_API_KEY=xxxxxxxxxxxxxxxxxxxx
 *   
 *   Vercel (本番環境):
 *     https://vercel.com/settings/environment-variables
 * 
 * @param location 位置情報（緯度経度）
 * @param apiKey OpenWeather API キー
 * @returns 天気データ
 * @throws APIエラーの場合、Error をスロー
 */
export async function fetchWeatherData(
  location: Location,
  apiKey: string
): Promise<WeatherData> {
  if (!apiKey || apiKey.trim() === '') {
    throw new Error('OpenWeather API キーが設定されていません。.env ファイルを確認してください。')
  }

  const url = new URL('https://api.openweathermap.org/data/2.5/weather')
  url.searchParams.set('lat', location.lat.toString())
  url.searchParams.set('lon', location.lng.toString())
  url.searchParams.set('appid', apiKey)
  url.searchParams.set('units', 'metric')
  url.searchParams.set('lang', 'ja')

  try {
    const response = await fetch(url.toString())
    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('OpenWeather APIキーが無効です。Vercelの環境変数を確認してください。')
      }
      throw new Error(`Weather API error: ${response.status} ${response.statusText}`)
    }
    return response.json()
  } catch (error) {
    console.error('❌ OpenWeather API エラー:', error)
    throw error
  }
}

/**
 * 住所の町名と丁目を分離する
 * 例：「白鳥二丁目」→ 「白鳥 2丁目」
 */
function separateTownAndChome(fullName: string): string {
  if (!fullName) return fullName
  
  // 「〇丁目」パターンを数字に変換（一→1、二→2 等）
  const kanjiToNum: Record<string, string> = {
    '一': '1', '二': '2', '三': '3', '四': '4', '五': '5',
    '六': '6', '七': '7', '八': '8', '九': '9', '十': '10'
  }
  
  // 漢数字の丁目パターンを検出
  const chomePattern = /([一二三四五六七八九十]+)丁目/
  const match = fullName.match(chomePattern)
  
  if (match) {
    const kanjiNum = match[1]
    const arabicNum = kanjiToNum[kanjiNum] || kanjiNum
    const townName = fullName.replace(chomePattern, '').trim()
    return `${townName} ${arabicNum}丁目`
  }
  
  return fullName
}

/**
 * OpenStreetMap Nominatim APIで緯度経度から住所を取得
 * @param location 緯度・経度
 * @returns 住所文字列（都道府県 市区町村 町名 丁目の形式）
 */
export async function reverseGeocodeLocation(location: Location): Promise<string> {
  const url = new URL('https://nominatim.openstreetmap.org/reverse')
  url.searchParams.set('lat', location.lat.toString())
  url.searchParams.set('lon', location.lng.toString())
  url.searchParams.set('format', 'json')
  url.searchParams.set('accept-language', 'ja')
  url.searchParams.set('addressdetails', '1')

  try {
    console.log(`🔄 Reverse geocoding: ${location.lat}, ${location.lng}`)
    const response = await fetch(url.toString())
    if (!response.ok) {
      throw new Error(`Nominatim API error: ${response.status}`)
    }

    const data = await response.json()
    console.log('Nominatim response address:', JSON.stringify(data.address, null, 2))

    // address コンポーネントから必要な要素を抽出
    if (data.address) {
      const addr = data.address
      const parts: string[] = []
      
      // 1. 都道府県（state）
      let prefecture = ''
      if (addr.state) {
        prefecture = addr.state
        console.log(`  ✓ State (都道府県): ${addr.state}`)
      }
      if (prefecture) parts.push(prefecture)
      
      // 2. 市区町村（city など）
      let municipality = ''
      if (addr.city) {
        municipality = addr.city
        console.log(`  ✓ City (市区町村): ${addr.city}`)
      } else if (addr.city_district) {
        municipality = addr.city_district
        console.log(`  ✓ City District (市区町村): ${addr.city_district}`)
      } else if (addr.town) {
        municipality = addr.town
        console.log(`  ✓ Town (市区町村): ${addr.town}`)
      } else if (addr.county) {
        municipality = addr.county
        console.log(`  ✓ County (市区町村): ${addr.county}`)
      }
      if (municipality) parts.push(municipality)
      
      // 3. 町名と丁目の組み合わせ処理
      // (suburb または neighbourhood から町名を取得)
      let townName = ''
      if (addr.suburb) {
        townName = addr.suburb
        console.log(`  ✓ Suburb (町名/丁目): ${addr.suburb}`)
      } else if (addr.neighbourhood) {
        townName = addr.neighbourhood
        console.log(`  ✓ Neighbourhood (町名/丁目): ${addr.neighbourhood}`)
      } else if (addr.village) {
        townName = addr.village
        console.log(`  ✓ Village (町名/丁目): ${addr.village}`)
      }
      
      // 町名と丁目を分離（例：「白鳥二丁目」→ 「白鳥 2丁目」）
      if (townName) {
        townName = separateTownAndChome(townName)
        parts.push(townName)
      }

      const address = parts.join(' ')
      if (address) {
        console.log(`✓ Final address: ${address}`)

        return address
      }
    }

    console.warn('No address components found in Nominatim response')
    return '住所を取得できませんでした'
  } catch (error) {
    console.error('⚠️ Reverse geocoding error:', error)
    return '住所を取得できませんでした'
  }
}

/**
 * OpenStreetMap Nominatim APIで住所から位置情報を取得
 * @param address 住所文字列（日本語対応）
 * @returns 緯度・経度
 */
export async function geocodeAddress(address: string): Promise<Location> {
  if (!address.trim()) {
    throw new Error('住所を入力してください')
  }

  const url = new URL('https://nominatim.openstreetmap.org/search')
  url.searchParams.set('q', address)
  url.searchParams.set('format', 'json')
  url.searchParams.set('accept-language', 'ja')
  url.searchParams.set('countrycodes', 'jp') // 日本のみに限定

  try {
    console.log(`🔄 Geocoding address: "${address}"`)
    const response = await fetch(url.toString())
    if (!response.ok) {
      throw new Error(`Nominatim API error: ${response.status}`)
    }

    const data = await response.json()
    console.log('Nominatim geocoding response:', data)

    // Nominatim APIの応答形式: { lat, lon } の配列
    if (data && data.length > 0) {
      const result = data[0]
      const location = {
        lat: parseFloat(result.lat),
        lng: parseFloat(result.lon)
      }
      console.log(`✓ Address found: ${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}`)
      return location
    }

    throw new Error('住所が見つかりませんでした')
  } catch (error) {
    console.error('⚠️ Geocoding error:', error)
    const errorMsg = error instanceof Error ? error.message : '住所の検索に失敗しました'
    throw new Error(`${errorMsg}。別の住所を試してください。`)
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

