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
  fetchWeatherData,
  validateRunningMinutes,
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
    console.log('🔴🔴🔴 [useEffect for address] location changed:', location)
    if (!location) {
      console.log('🔴 location is null/undefined, returning early')
      return
    }

    console.log('🔴 location exists, calling fetchAddress()')
    const fetchAddress = async () => {
      try {
        console.log('🔍 [DEBUG] Calling reverseGeocodeLocation with location:', location)
        const address = await reverseGeocodeLocation(location)
        console.log('🔍 [DEBUG] Returned from reverseGeocodeLocation:', address)
        console.log('🔍 [DEBUG] Setting locationAddress to:', address)
        setLocationAddress(address)
        console.log('🔍 [DEBUG] State updated. locationAddress should now be:', address)
      } catch (error) {
        console.error('❌ Failed to get address for location:', error)
        const fallback = `${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}`
        console.log('🔍 [DEBUG] Using fallback address:', fallback)
        setLocationAddress(fallback)
      }
    }

    fetchAddress()
  }, [location])

  /**
   * 地図表示の初期化（Geolonia）と初期天気取得
   */
  useEffect(() => {
    console.log('🔄 [useEffect] location dependency triggered. location:', location)
    if (!location) {
      console.log('🔴 [useEffect] location is null/undefined, returning early')
      return
    }

    console.log('✅ [useEffect] location exists, proceeding with map and weather initialization')

    // React がレンダリング完了してから Geolonia 地図を初期化
    const timer = setTimeout(() => {
      if ((window as any).geolonia && (window as any).initializeGeoloniaMaps) {
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

    // 初期位置情報取得時に自動的に天気を取得
    console.log('🌤️ [useEffect] About to call fetchWeatherForLocation with location:', location)
    fetchWeatherForLocation(location)

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
      if ((window as any).geolonia) {
        const maps = (window as any).geolonia.maps
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

      // 地図にコースを表示
      if ((window as any).displayCourseOnMap && route.routePath && route.routePath.length > 0) {
        console.log(`📍 Displaying route on map: ${route.routePath.length} points`)
        ;(window as any).displayCourseOnMap(route.routePath)
      } else {
        console.warn('⚠️ Cannot display route: displayCourseOnMap or routePath unavailable')
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

    console.log('🌤️ fetchWeatherForLocation called with location:', loc)
    console.log('🔑 API Key exists:', !!apiKey)
    console.log('🔑 API Key value (first 10 chars):', apiKey ? apiKey.substring(0, 10) : 'UNDEFINED')

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
      console.log('📡 Calling fetchWeatherData with location:', loc, 'API Key (first 10 chars):', apiKey.substring(0, 10))
      const data = await fetchWeatherData(loc, apiKey)
      console.log('✅ Weather data received:', data)
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
    const humidity = weather.main.humidity
    const description = weather.weather[0]?.description || ''

    return `${description} (気温: ${temp}°C, 体感: ${feelsLike}°C, 湿度: ${humidity}%, 風速: ${windSpeed}m/s)`
  }

  /**
   * 天気に基づく詳細なランニングアドバイスを生成
   */
  const getWeatherAdvice = () => {
    if (!weather) return ''

    const temp = weather.main.temp
    const feelsLike = weather.main.feels_like
    const humidity = weather.main.humidity
    const windSpeed = weather.wind.speed
    const rainVolume = weather.rain?.['1h'] || 0
    const snowVolume = weather.snow?.['1h'] || 0
    const isPrecipitation = rainVolume > 0 || snowVolume > 0

    const advices: string[] = []

    // 気温に基づくアドバイス
    if (temp >= 28 || feelsLike >= 30) {
      advices.push('🔥 熱中症注意！こまめな水分・塩分補給が必須')
      advices.push('帽子・サングラス着用、日中の時間帯は避ける')
      advices.push('ペースを控えめに、無理は禁物です')
    } else if (temp <= 5) {
      advices.push('❄️ 防寒対策が必要です。手袋・ネック巻き推奨')
      advices.push('ウォームアップを長めに、筋肉を十分ほぐす')
      advices.push('アイシング（冷たい風）対策で首周りを保護')
    } else {
      advices.push('✅ 気温は快適な範囲です')
    }

    // 湿度に基づくアドバイス
    if (humidity >= 80) {
      advices.push('💧 高湿度！心拍が上がりやすいため、無理をしない')
      advices.push('いつもより遅いペースで、頻繁に休憩を取ってください')
    } else if (humidity >= 70) {
      advices.push('湿度が高め。いつもより水分補給を意識的に')
    }

    // 風速に基づくアドバイス
    if (windSpeed >= 8) {
      advices.push('🌪️ 強風注意！向かい風で負荷が増します')
      advices.push('コース設計：折返し後に追い風を活用、体力配分を工夫')
      advices.push('バランスに注意、転倒リスク↑')
    } else if (windSpeed >= 6) {
      advices.push('風が強め。バランスに注意してください')
    }

    // 降水に基づくアドバイス
    if (isPrecipitation) {
      advices.push(`☔ 雨・雪あり（${rainVolume > 0 ? `雨量${rainVolume}mm` : ''}${snowVolume > 0 ? `${rainVolume > 0 ? '、' : ''}積雪${snowVolume}cm` : ''}）`)
      advices.push('路面が滑りやすい。速度落とし気味で、慎重に')
      advices.push('防水ウェア・帽子・防水シューズで対策')
      advices.push('コース選定：舗装が良好で滑りにくい区間を優先')
    }

    // アドバイスがない場合のデフォルト
    if (advices.length === 0) {
      advices.push('✅ ランニングに適した条件です。安全に楽しんでください！')
    }

    return advices.join('\n')
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

        {/* 天気情報セクション（最上部） */}
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
              <div className="weather-advice">
                {getWeatherAdvice().split('\n').map((advice, idx) => (
                  <p key={idx}>{advice}</p>
                ))}
              </div>
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
              {weather.rain && weather.rain['1h'] > 0 && (
                <div className="weather-item">
                  <span className="label">降雨量（1h）</span>
                  <span className="value">{weather.rain['1h']}mm</span>
                </div>
              )}
              {weather.snow && weather.snow['1h'] > 0 && (
                <div className="weather-item">
                  <span className="label">降雪量（1h）</span>
                  <span className="value">{weather.snow['1h']}cm</span>
                </div>
              )}
            </div>
          </section>
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
        {optimizedRoute && (
          <section className="card">
            <h2>🗺️ 提案コース</h2>

            <div className="course-info">
              <div className="info-item">
                <span className="label">走行距離:</span>
                <span className="value">{optimizedRoute.totalDistance.toFixed(2)} km</span>
              </div>
              <div className="info-item">
                <span className="label">推定走行時間:</span>
                <span className="value">{optimizedRoute.estimatedTime.toFixed(1)} 分</span>
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

// Window 型定義は env.d.ts で定義済み
