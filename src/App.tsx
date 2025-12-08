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
    if (location && window.geolonia) {
      try {
        // Geoloniaの再描画をトリガー
        window.geolonia.onReady(() => {
          console.log('Geolonia is ready', location)
        })
      } catch (err) {
        console.error('Geolonia error:', err)
        setLocationError('地図の読み込みに失敗しました')
      }
    }
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
  const handleSetManualLocation = (e: React.FormEvent<HTMLFormElement>) => {
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
  const handleGenerateCourse = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setWeatherError('')
    setCourse([])

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

      // 走行距離を計算
      const minutes = parseFloat(runningMinutes)
      const distance = calculateRunningDistance(minutes)
      setCourseDistance(distance)

      // コースを生成
      const generatedCourse = generateCircularCourse(location, distance, 12)
      setCourse(generatedCourse)

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
              {window.geolonia ? (
                <div
                  className="geolonia-map"
                  data-lat={location.lat}
                  data-lng={location.lng}
                  data-zoom="14"
                />
              ) : (
                <div className="geolonia-map" style={{ backgroundColor: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <p>地図読み込み中...</p>
                </div>
              )}
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
                <span className="label">ポイント数:</span>
                <span className="value">{course.length} 地点</span>
              </div>
            </div>

            {/* コースの詳細情報 */}
            <details>
              <summary>コースの詳細座標</summary>
              <div className="course-details">
                {course.map((point, idx) => (
                  <div key={idx} className="point-info">
                    <strong>ポイント {idx}:</strong> {point.lat.toFixed(6)}, {point.lng.toFixed(6)}
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
