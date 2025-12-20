// ============================================================================
// ランニングコース提案アプリ - React + TypeScript + Vite
// ============================================================================
// 
// 【概要】
// 現在地から出発して、指定した時間以内に出発地点へ戻ってくるランニングコースを提案するアプリ
// 
// 【実装済み機能】
// 1. ✅ 現在地取得と出発地点の設定（Geolocation API）
// 2. ✅ 走行時間入力 UI（入力値検証）
// 3. ✅ 指定時間から走行距離を計算（環境変数の RUNNING_PACE_MIN_PER_KM を使用）
// 4. ✅ 道路ネットワークベースのルート生成（OSRM - Open Source Routing Machine）
// 5. ✅ スタート＝ゴール地点の周回ルート生成（最適化アルゴリズム）
// 6. ✅ 指定距離への自動調整（ウェイポイント数の動的調整）
// 7. ✅ Geolonia 上へのルート描画（ポリライン + マーカー）
// 8. ✅ OpenWeather API による天気情報表示
// 9. ✅ 環境変数管理（.env.local + Vercel）
// 10. ✅ レスポンシブ UI デザイン
//
// 【改善点】
// - 旧: 円形ルート（直線で距離計算）→ 新: 道路ネットワークベース（実際の走行距離）
// - 旧: ウェイポイント固定数 → 新: 目標距離に応じた動的調整
// - 旧: 往復概念 → 新: スタート＝ゴール地点の周回ルート
//
// 【本番環境】
// https://running-kappa-kohl.vercel.app
//
// ============================================================================

import { useState, useEffect } from 'react'
import './App.css'
import {
  Location,
  WeatherData,
  CoursePoint,
  calculateRunningDistance,
  generateCircularCourse,
  fetchWeatherData,
  validateRunningMinutes,
  validateLocation,
  geocodeAddress,
  reverseGeocodeLocation,
} from './utils'
import { generateOptimizedClosedRoute, OptimizedRoute } from './routeOptimizer.v2'

/**
 * メインアプリケーションコンポーネント
 * ランニングコース提案アプリ
 */
export default function App() {
  // ===== 状態管理 =====

  // 位置情報
  const [location, setLocation] = useState<Location | null>(null)
  const [locationAddress, setLocationAddress] = useState('取得中...')
  const [locationLoading, setLocationLoading] = useState(true)
  const [locationError, setLocationError] = useState('')

  // フォーム入力
  const [runningMinutes, setRunningMinutes] = useState('')
  const [manualAddress, setManualAddress] = useState('')
  const [isGeocodingLoading, setIsGeocodingLoading] = useState(false)

  // 天気情報
  const [weather, setWeather] = useState<WeatherData | null>(null)
  const [weatherLoading, setWeatherLoading] = useState(false)
  const [weatherError, setWeatherError] = useState('')

  // コース情報
  const [course, setCourse] = useState<CoursePoint[]>([])
  const [courseDistance, setCourseDistance] = useState(0)
  const [optimizedRoute, setOptimizedRoute] = useState<OptimizedRoute | null>(null)

  // Geolonia 状態
  const [geoloniaReady, setGeoloniaReady] = useState(false)

  // UI状態
  const [error, setError] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)

  // ===== エフェクト =====

  /**
   * 初期化：位置情報取得
   */
  useEffect(() => {
    initializeLocation()
  }, [])

  /**
   * 現在地から住所を取得（location 変更時）
   */
  useEffect(() => {
    if (!location) return

    const fetchAddress = async () => {
      try {
        const address = await reverseGeocodeLocation(location)
        setLocationAddress(address)
      } catch (error) {
        console.error('Failed to get address for location:', error)
        setLocationAddress(`${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}`)
      }
    }

    fetchAddress()
  }, [location])

  /**
   * 地図表示の初期化（Geolonia）
   */
  useEffect(() => {
    if (!location) return

    // React がレンダリング完了してから Geolonia 地図を初期化
    const timer = setTimeout(() => {
      if (window.geolonia && (window as any).initializeGeoloniaMaps) {
        console.log('✓ Calling initializeGeoloniaMaps from React...')
        try {
          (window as any).initializeGeoloniaMaps()
          setGeoloniaReady(true)
        } catch (err) {
          console.error('Error initializing Geolonia maps:', err)
          setGeoloniaReady(true)
        }
      } else {
        console.warn('Geolonia or initializeGeoloniaMaps not available')
        setGeoloniaReady(true)
      }
    }, 100)

    return () => clearTimeout(timer)
  }, [location])

  // ===== 位置情報関連の関数 =====

  /**
   * 初期位置情報の取得またはデフォルト設定
   */
  const initializeLocation = () => {
    if (!navigator.geolocation) {
      setLocationError('お使いのブラウザはGeolocation APIに対応していません。')
      setLocationLoading(false)
      return
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        })
        setLocationLoading(false)
      },
      () => {
        // 位置情報取得失敗時は東京をデフォルト設定
        setLocation({
          lat: 35.6762,
          lng: 139.7674,
        })
        setLocationError('位置情報の取得に失敗しました。東京をデフォルト位置に設定しています。')
        setLocationLoading(false)
      }
    )
  }

  /**
   * 住所から位置情報を検索して設定・地図を移動
   */
  const handleSetLocationFromAddress = async (e: any) => {
    e.preventDefault()
    setError('')

    if (!manualAddress.trim()) {
      setError('住所を入力してください')
      return
    }

    try {
      setIsGeocodingLoading(true)
      const newLocation = await geocodeAddress(manualAddress)
      
      // 位置情報を更新
      setLocation(newLocation)
      console.log(`✓ Location set from address: ${newLocation.lat.toFixed(4)}, ${newLocation.lng.toFixed(4)}`)
      
      // Geolonia 地図を移動
      if (window.geolonia) {
        const maps = window.geolonia.maps
        if (maps && maps.length > 0) {
          const map = maps[0]
          // Geolonia の地図を移動（flyTo でアニメーション付き移動）
          if (map.flyTo) {
            map.flyTo({
              center: [newLocation.lng, newLocation.lat],
              zoom: 14
            })
          } else if (map.setCenter) {
            // フォールバック
            map.setCenter([newLocation.lng, newLocation.lat])
          }
          console.log(`📍 Map moved to: ${newLocation.lat.toFixed(4)}, ${newLocation.lng.toFixed(4)}`)
        }
      }
      
      // フォーム入力をクリア
      setManualAddress('')
      setLocationError('')
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : '住所の検索に失敗しました。別の住所を試してください。'
      setError(errorMsg)
      console.error('Geocoding error:', err)
    } finally {
      setIsGeocodingLoading(false)
    }
  }

  // ===== コース生成関連の関数 =====

  /**
   * コース生成ボタンのハンドラー
   */
  const handleGenerateCourse = async (e: any) => {
    e.preventDefault()
    setError('')
    setWeatherError('')
    setCourse([])
    setOptimizedRoute(null)

    // バリデーション
    const validation = validateRunningMinutes(runningMinutes)
    if (!validation.valid) {
      setError(validation.error || '入力値が無効です')
      return
    }

    if (!location) {
      setError('位置情報が必要です。')
      return
    }

    try {
      setIsGenerating(true)

      // 走行時間から最適化されたルートを生成
      const minutes = parseFloat(runningMinutes)
      console.log(`🚀 Starting optimized route generation for ${minutes} minutes...`)

      // 新しい最適化エンジン（v2）を使用
      const route = await generateOptimizedClosedRoute(location, minutes)

      setOptimizedRoute(route)
      setCourseDistance(route.totalDistance)

      // ウェイポイント情報をCoursePointに変換（後方互換性）
      const coursePoints: CoursePoint[] = (route.waypoints || []) as CoursePoint[]
      setCourse(coursePoints)

      // 地図にコースを表示（ルートパスを使用）
      if ((window as any).displayCourseOnMap) {
        console.log('📍 Displaying optimized closed route on map (hide waypoint markers)...')
        ;(window as any).displayCourseOnMap(route.routePath || route.waypoints, { hideWaypointMarkers: true })
      }

      // 天気情報を取得
      fetchWeatherForLocation(location)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'コース生成中にエラーが発生しました。'
      setError(errorMessage)
      console.error('Course generation error:', err)
    } finally {
      setIsGenerating(false)
    }
  }

  /**
   * 位置情報に基づいて天気情報を取得
   * 環境変数 VITE_OPENWEATHER_API_KEY が未設定の場合は警告を表示し処理を中断
   */
  const fetchWeatherForLocation = async (loc: Location) => {
    const apiKey = import.meta.env.VITE_OPENWEATHER_API_KEY

    // APIキーが未設定の場合
    if (!apiKey || apiKey.trim() === '') {
      console.warn('⚠️ OpenWeather API キーが未設定です。.env に VITE_OPENWEATHER_API_KEY を設定してください。')
      setWeatherError('天気情報を表示するにはOpenWeather APIキーを設定してください。詳細は.envファイルを参照してください。')
      setWeather(null)
      return
    }

    try {
      setWeatherLoading(true)
      setWeatherError('')
      const data = await fetchWeatherData(loc, apiKey)
      setWeather(data)
    } catch (err) {
      console.error('❌ 天気情報取得エラー:', err)
      setWeatherError('天気情報の取得に失敗しました。APIキーが正しいか確認してください。')
      setWeather(null)
    } finally {
      setWeatherLoading(false)
    }
  }

  // ===== ヘルパー関数 =====

  /**
   * 天気の説明文を生成
   */
  const getWeatherDescription = () => {
    if (!weather) return ''

    const temp = Math.round(weather.main.temp)
    const feelsLike = Math.round(weather.main.feels_like)
    const windSpeed = Math.round(weather.wind.speed * 10) / 10
    const description = weather.weather[0]?.description || ''

    return `${description} (気温: ${temp}°C, 体感: ${feelsLike}°C, 風速: ${windSpeed}m/s)`
  }

  /**
   * 天気に基づくアドバイスを生成
   */
  const getWeatherAdvice = () => {
    if (!weather) return ''

    const temp = weather.main.temp
    const windSpeed = weather.wind.speed

    if (temp > 28) {
      return '気温が高いです。水分補給をこまめに行い、帽子を被るなど日射対策をしましょう。'
    }

    if (temp < 5) {
      return '気温が低いです。ウォーミングアップをしっかり行い、防寒対策をしてください。'
    }

    if (windSpeed > 6) {
      return '風が強いです。バランスに注意して走ってください。'
    }

    return 'ランニングに適した条件です。安全に楽しんでください。'
  }

  // ===== レンダリング =====

  return (
    <div className="app-container">
      {/* ヘッダー */}
      <header className="app-header">
        <h1>🏃 ランニングコース提案アプリ</h1>
        <p>天気情報と位置情報からあなたにぴったりなコースを提案します</p>
      </header>

      <main className="app-main">
        {/* エラーメッセージ */}
        {error && (
          <div className="alert alert-error">
            <span>⚠️ {error}</span>
          </div>
        )}

        {/* 位置情報セクション */}
        <section className="card">
          <h2>📍 位置情報</h2>

          {locationLoading ? (
            <div className="loading">位置情報を取得中...</div>
          ) : location ? (
            <>
              <div className="location-display">
                <p>
                  <strong>現在地：</strong>
                  {locationAddress}
                </p>
              </div>

              {locationError && (
                <div className="alert alert-info">
                  <span>ℹ️ {locationError}</span>
                </div>
              )}

              {/* 地図表示 */}
              <div
                className="geolonia-map"
                data-lat={location.lat}
                data-lng={location.lng}
                data-zoom="14"
              />
            </>
          ) : null}
        </section>

        {/* コース生成セクション */}
        <section className="card">
          <h2>⏱️ ランニングコース生成</h2>

          <form onSubmit={handleGenerateCourse} className="form-main">
            <div className="form-group">
              <label htmlFor="running-minutes">走りたい時間（分）:</label>
              <input
                id="running-minutes"
                type="number"
                min="1"
                max="300"
                placeholder="30"
                value={runningMinutes}
                onChange={(e) => setRunningMinutes(e.target.value)}
              />
              <small>1～300分の範囲で入力してください</small>
            </div>

            <button type="submit" disabled={isGenerating || !location} className="btn btn-primary">
              {isGenerating ? 'コース生成中...' : 'コースを生成'}
            </button>
          </form>
        </section>

        {/* コース情報セクション */}
        {course.length > 0 && (
          <section className="card">
            <h2>🗺️ 提案コース</h2>

            <div className="course-info">
              <div className="info-item">
                <span className="label">走行距離:</span>
                <span className="value">{courseDistance.toFixed(2)} km</span>
              </div>
              {optimizedRoute && (
                <div className="info-item">
                  <span className="label">推定走行時間:</span>
                  <span className="value">{Math.round(optimizedRoute.estimatedTime)} 分</span>
                </div>
              )}
            </div>
          </section>
        )}

        {/* 天気情報セクション */}
        {weatherLoading && (
          <section className="card">
            <div className="loading">天気情報を取得中...</div>
          </section>
        )}

        {weatherError && (
          <div className="alert alert-warning">
            <span>⚠️ {weatherError}</span>
          </div>
        )}

        {weather && (
          <section className="card weather-card">
            <h2>🌤️ 天気情報</h2>

            <div className="weather-summary">
              <p className="weather-main">{getWeatherDescription()}</p>
              <p className="weather-advice">{getWeatherAdvice()}</p>
            </div>

            <div className="weather-grid">
              <div className="weather-item">
                <span className="label">気温</span>
                <span className="value">{Math.round(weather.main.temp)}°C</span>
              </div>
              <div className="weather-item">
                <span className="label">体感温度</span>
                <span className="value">{Math.round(weather.main.feels_like)}°C</span>
              </div>
              <div className="weather-item">
                <span className="label">湿度</span>
                <span className="value">{weather.main.humidity}%</span>
              </div>
              <div className="weather-item">
                <span className="label">風速</span>
                <span className="value">{(Math.round(weather.wind.speed * 10) / 10).toFixed(1)} m/s</span>
              </div>
              <div className="weather-item">
                <span className="label">雲量</span>
                <span className="value">{weather.clouds.all}%</span>
              </div>
            </div>
          </section>
        )}
      </main>

      {/* フッター */}
      <footer className="app-footer">
        <p>
          &copy; 2025 ランニングコース提案アプリ | Built with React + TypeScript + Vite
        </p>
      </footer>
    </div>
  )
}

// グローバル型の拡張（Geolonia）
declare global {
  interface Window {
    geolonia?: {
      onReady(callback: () => void): void
      maps?: Array<{
        flyTo?(options: { center: [number, number]; zoom: number }): void
        setCenter?(lnglat: [number, number]): void
      }>
    }
  }
}
