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
} from './utils'
import { generateOptimizedRunningRoute, OptimizedRoute } from './routeOptimizer'

/**
 * メインアプリケーションコンポーネント
 * ランニングコース提案アプリ
 */
export default function App() {
  // ===== 状態管理 =====

  // 位置情報
  const [location, setLocation] = useState<Location | null>(null)
  const [locationLoading, setLocationLoading] = useState(true)
  const [locationError, setLocationError] = useState('')

  // フォーム入力
  const [runningMinutes, setRunningMinutes] = useState('')
  const [manualLat, setManualLat] = useState('')
  const [manualLng, setManualLng] = useState('')

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
   * 手動で位置情報を設定
   */
  const handleSetManualLocation = (e: any) => {
    e.preventDefault()
    setError('')

    const validation = validateLocation(manualLat, manualLng)
    if (!validation.valid) {
      setError(validation.error || '位置情報が無効です')
      return
    }

    setLocation({
      lat: parseFloat(manualLat),
      lng: parseFloat(manualLng),
    })

    setManualLat('')
    setManualLng('')
    setLocationError('')
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

      // 新しい最適化エンジンを使用
      const route = await generateOptimizedRunningRoute(location, minutes)
      
      setOptimizedRoute(route)
      setCourseDistance(route.totalDistance)

      // ウェイポイント情報をCoursePointに変換（後方互換性）
      const coursePoints: CoursePoint[] = route.waypoints
      setCourse(coursePoints)

      // 地図にコースを表示（ルートパスを使用）
      if ((window as any).displayCourseOnMap) {
        console.log('📍 Displaying optimized route on map...')
        ;(window as any).displayCourseOnMap(route.routePath || route.waypoints)
      }

      // 天気情報を取得
      fetchWeatherForLocation(location)
    } catch (err) {
      setError('コース生成中にエラーが発生しました。')
      console.error(err)
    } finally {
      setIsGenerating(false)
    }
  }

  /**
   * 位置情報に基づいて天気情報を取得
   */
  const fetchWeatherForLocation = async (loc: Location) => {
    const apiKey = import.meta.env.VITE_OPENWEATHER_API_KEY

    if (!apiKey) {
      setWeatherError('OpenWeather API キーが設定されていません。')
      return
    }

    try {
      setWeatherLoading(true)
      const data = await fetchWeatherData(loc, apiKey)
      setWeather(data)
      setWeatherError('')
    } catch (err) {
      setWeatherError('天気情報の取得に失敗しました。')
      console.error('Weather API Error:', err)
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
                  緯度 {location.lat.toFixed(4)}, 経度 {location.lng.toFixed(4)}
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

          {/* 手動位置情報入力 */}
          <div className="manual-location">
            <h3>位置情報を手動で設定</h3>
            <form onSubmit={handleSetManualLocation} className="form-inline">
              <div className="form-group">
                <label htmlFor="manual-lat">緯度:</label>
                <input
                  id="manual-lat"
                  type="number"
                  step="0.0001"
                  placeholder="35.6762"
                  value={manualLat}
                  onChange={(e) => setManualLat(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label htmlFor="manual-lng">経度:</label>
                <input
                  id="manual-lng"
                  type="number"
                  step="0.0001"
                  placeholder="139.7674"
                  value={manualLng}
                  onChange={(e) => setManualLng(e.target.value)}
                />
              </div>
              <button type="submit" className="btn btn-secondary">
                設定
              </button>
            </form>
          </div>
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
              <div className="info-item">
                <span className="label">ウェイポイント数:</span>
                <span className="value">{course.length} 地点</span>
              </div>
              {optimizedRoute && (
                <div className="info-item">
                  <span className="label">推定走行時間:</span>
                  <span className="value">{Math.round(optimizedRoute.totalDistance * 6)} 分</span>
                </div>
              )}
            </div>

            {/* ルート最適化情報 */}
            {optimizedRoute && (
              <div className="optimization-info">
                <h3>📊 ルート最適化情報</h3>
                <ul>
                  <li>✅ OSRMによる道路ネットワークベースのルート生成</li>
                  <li>✅ スタート地点 = ゴール地点（現在地）の周回ルート</li>
                  <li>✅ 指定距離への自動調整（{optimizedRoute.totalDistance.toFixed(2)}km）</li>
                  <li>✅ {optimizedRoute.steps.length}個のウェイポイントを経由</li>
                  <li>✅ 実際の道路に沿ったナビゲーション対応</li>
                </ul>
              </div>
            )}

            {/* コースの詳細情報 */}
            <details>
              <summary>コースの詳細座標（{course.length}個のウェイポイント）</summary>
              <div className="course-details">
                {course.map((point, idx) => (
                  <div key={idx} className="point-info">
                    <strong>ウェイポイント {idx}:</strong> {point.lat.toFixed(6)}, {point.lng.toFixed(6)}
                  </div>
                ))}
              </div>
            </details>
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
    }
  }
}
