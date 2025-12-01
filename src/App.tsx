import { useState, useEffect } from 'react'
import './App.css'

/**
 * 型定義
 */

// Open-Meteo API からのレスポンス型
interface WeatherResponse {
  latitude: number
  longitude: number
  current: {
    temperature: number
    precipitation: number
    wind_speed: number
    time: string
  }
  hourly?: {
    time: string[]
    temperature_2m: number[]
    precipitation: number[]
    wind_speed_10m: number[]
  }
  timezone: string
}

// アプリケーションの状態管理用型
interface RunningCondition {
  distance: number | ''
  type: 'running' | 'walking'
  timeOfDay: 'now' | 'morning' | 'afternoon' | 'evening'
}

interface WeatherInfo {
  temperature: number
  precipitation: number
  windSpeed: number
  runability: string
  advice: string
}

// 走りやすさ判定結果の型
interface EvaluationResult {
  level: string
  advice: string
}

/**
 * 走りやすさを判定するロジック関数
 * 気温、降水量、風速から走りやすさレベルを計算する
 */
function evaluateCondition(
  temperature: number,
  precipitation: number,
  windSpeed: number
): EvaluationResult {
  // 基本的な判定ロジック
  const isComfortableTemp = temperature >= 10 && temperature <= 22
  const isNoPrecipitation = precipitation === 0
  const isLowWind = windSpeed < 5

  if (isComfortableTemp && isNoPrecipitation && isLowWind) {
    return {
      level: 'とても走りやすい',
      advice: '最高の条件です。通常ペースで楽しんでください！',
    }
  }

  if (temperature > 25) {
    return {
      level: 'まあまあ',
      advice: '気温が高めなので、ペースは少し落としてこまめに水分補給をしてください。',
    }
  }

  if (temperature < 5) {
    return {
      level: 'まあまあ',
      advice: '気温が低いので、ウォーミングアップをしっかり行い、防寒対策をしてください。',
    }
  }

  if (precipitation > 0) {
    return {
      level: '控えめ推奨',
      advice: '降水があります。雨具を準備し、滑りやすい路面に注意してください。',
    }
  }

  if (windSpeed >= 5 && windSpeed < 10) {
    return {
      level: '控えめ推奨',
      advice: '風が強めです。露出した場所では注意が必要です。',
    }
  }

  if (windSpeed >= 10) {
    return {
      level: '今日は見送り推奨',
      advice: '非常に強い風が予想されます。今日は見送り、別の日に変更をおすすめします。',
    }
  }

  return {
    level: 'まあまあ',
    advice: '平均的な条件です。無理のないペースで楽しんでください。',
  }
}

/**
 * Open-Meteo APIから天気情報を取得する関数
 */
async function fetchWeather(latitude: number, longitude: number, timezone: string = 'Asia/Tokyo'): Promise<WeatherInfo> {
  try {
    // Open-Meteo APIを呼び出す
    const params = new URLSearchParams({
      latitude: latitude.toString(),
      longitude: longitude.toString(),
      current: 'temperature_2m,precipitation,wind_speed_10m',
      hourly: 'temperature_2m,precipitation,wind_speed_10m',
      timezone: timezone,
      forecast_days: '1',
    })

    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`)
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`)
    }

    const data: WeatherResponse = await response.json()

    // 現在の天気情報を使用
    const temperature = data.current.temperature
    const precipitation = data.current.precipitation
    const windSpeed = data.current.wind_speed

    const { level, advice } = evaluateCondition(temperature, precipitation, windSpeed)

    return {
      temperature,
      precipitation,
      windSpeed,
      runability: level,
      advice,
    }
  } catch (error) {
    console.error('天気APIエラー:', error)
    throw error
  }
}

/**
 * コース提案テキストを生成する関数
 */
function generateCourseProposal(
  distance: number,
  type: 'running' | 'walking',
  weather: WeatherInfo
): string {
  const typeLabel = type === 'running' ? 'ランニング' : 'ウォーキング'
  const halfDistance = distance / 2

  let proposal = `約 ${distance}km の${typeLabel}コースを想定して、自宅から${halfDistance}km地点で折り返す往復コースをおすすめします。\n\n`
  proposal += `走りやすさ: ${weather.runability}\n`
  proposal += `アドバイス: ${weather.advice}`

  return proposal
}

/**
 * メインコンポーネント
 */
export default function App() {
  // 位置情報の状態管理
  const [latitude, setLatitude] = useState<number | null>(null)
  const [longitude, setLongitude] = useState<number | null>(null)
  const [locationError, setLocationError] = useState<string>('')
  const [locationLoading, setLocationLoading] = useState(true)

  // ランニング条件の状態管理
  const [condition, setCondition] = useState<RunningCondition>({
    distance: '',
    type: 'running',
    timeOfDay: 'now',
  })

  // 天気情報と提案の状態管理
  const [weather, setWeather] = useState<WeatherInfo | null>(null)
  const [proposal, setProposal] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>('')

  // コンポーネントマウント時に位置情報を取得
  useEffect(() => {
    const getLocation = () => {
      if ('geolocation' in navigator) {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            setLatitude(position.coords.latitude)
            setLongitude(position.coords.longitude)
            setLocationLoading(false)
          },
          (error) => {
            console.error('位置情報取得エラー:', error)
            setLocationError(
              'ブラウザの位置情報を許可するか、以下のフォームで緯度・経度を手入力してください。'
            )
            setLocationLoading(false)
          }
        )
      } else {
        setLocationError('このブラウザはGeolocation APIに対応していません。')
        setLocationLoading(false)
      }
    }

    getLocation()
  }, [])

  /**
   * コース提案ボタンのハンドラー
   */
  const handleProposeCourse = async () => {
    // 入力値の検証
    if (condition.distance === '' || condition.distance <= 0) {
      setError('距離を入力してください。')
      return
    }

    if (latitude === null || longitude === null) {
      setError('位置情報が必要です。緯度・経度を入力してください。')
      return
    }

    setLoading(true)
    setError('')

    try {
      // 天気情報を取得
      const weatherInfo = await fetchWeather(latitude, longitude)
      setWeather(weatherInfo)

      // コース提案を生成
      const courseProposal = generateCourseProposal(
        condition.distance as number,
        condition.type,
        weatherInfo
      )
      setProposal(courseProposal)
    } catch (err) {
      setError('天気情報の取得に失敗しました。もう一度お試しください。')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  /**
   * 緯度・経度の手入力ハンドラー
   */
  const handleManualLocationInput = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    const lat = parseFloat(formData.get('latitude') as string)
    const lng = parseFloat(formData.get('longitude') as string)

    if (isNaN(lat) || isNaN(lng)) {
      setLocationError('有効な緯度・経度を入力してください。')
      return
    }

    setLatitude(lat)
    setLongitude(lng)
    setLocationError('')
  }

  return (
    <div className="app-container">
      {/* ヘッダー */}
      <header className="app-header">
        <h1>天気×ランニングコース提案アプリ</h1>
      </header>

      <main className="app-main">
        {/* 位置情報セクション */}
        <section className="location-section">
          <h2>現在地情報</h2>
          {locationLoading ? (
            <p>位置情報取得中…</p>
          ) : latitude !== null && longitude !== null ? (
            <div className="location-info">
              <p>
                現在地: <strong>緯度 {latitude.toFixed(6)}</strong>、{' '}
                <strong>経度 {longitude.toFixed(6)}</strong>
              </p>
            </div>
          ) : (
            <div className="location-error">
              <p>{locationError}</p>
              <form onSubmit={handleManualLocationInput} className="manual-location-form">
                <div className="form-group">
                  <label htmlFor="latitude">緯度:</label>
                  <input
                    type="number"
                    id="latitude"
                    name="latitude"
                    placeholder="例: 35.6762"
                    step="0.0001"
                    required
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="longitude">経度:</label>
                  <input
                    type="number"
                    id="longitude"
                    name="longitude"
                    placeholder="例: 139.7674"
                    step="0.0001"
                    required
                  />
                </div>
                <button type="submit" className="btn-secondary">
                  位置情報を設定
                </button>
              </form>
            </div>
          )}
        </section>

        {/* 入力フォームセクション */}
        <section className="input-section">
          <h2>ランニング条件を入力</h2>
          <form className="condition-form">
            <div className="form-group">
              <label htmlFor="distance">距離 (km):</label>
              <input
                type="number"
                id="distance"
                placeholder="例: 5"
                min="0.1"
                step="0.1"
                value={condition.distance}
                onChange={(e) =>
                  setCondition({
                    ...condition,
                    distance: e.target.value ? parseFloat(e.target.value) : '',
                  })
                }
              />
            </div>

            <div className="form-group">
              <label htmlFor="type">種別:</label>
              <select
                id="type"
                value={condition.type}
                onChange={(e) =>
                  setCondition({
                    ...condition,
                    type: e.target.value as 'running' | 'walking',
                  })
                }
              >
                <option value="running">ランニング</option>
                <option value="walking">ウォーキング</option>
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="timeOfDay">走りたい時間帯:</label>
              <select
                id="timeOfDay"
                value={condition.timeOfDay}
                onChange={(e) =>
                  setCondition({
                    ...condition,
                    timeOfDay: e.target.value as 'now' | 'morning' | 'afternoon' | 'evening',
                  })
                }
              >
                <option value="now">今すぐ</option>
                <option value="morning">朝</option>
                <option value="afternoon">昼</option>
                <option value="evening">夜</option>
              </select>
            </div>

            <button
              type="button"
              className="btn-primary"
              onClick={handleProposeCourse}
              disabled={loading}
            >
              {loading ? '取得中...' : 'コースを提案'}
            </button>
          </form>
        </section>

        {/* エラーメッセージ */}
        {error && <div className="error-message">{error}</div>}

        {/* 天気情報セクション */}
        {weather && (
          <section className="weather-section">
            <h2>天気情報</h2>
            <div className="weather-info">
              <div className="weather-item">
                <span className="label">気温:</span>
                <span className="value">{weather.temperature}°C</span>
              </div>
              <div className="weather-item">
                <span className="label">降水量:</span>
                <span className="value">{weather.precipitation}mm</span>
              </div>
              <div className="weather-item">
                <span className="label">風速:</span>
                <span className="value">{weather.windSpeed}m/s</span>
              </div>
              <div className="weather-item">
                <span className="label">走りやすさ:</span>
                <span className="value runability">{weather.runability}</span>
              </div>
            </div>
          </section>
        )}

        {/* コース提案セクション */}
        {proposal && (
          <section className="proposal-section">
            <h2>コース提案</h2>
            <div className="proposal-content">
              <p>{proposal}</p>
            </div>
          </section>
        )}

        {/* 地図セクション */}
        {latitude !== null && longitude !== null ? (
          <section className="map-section">
            <h2>現在地の地図</h2>
            {/* 
              TODO: 将来的にGeoJSONを読み込んで提案されたコースをポリラインで表示する
              例:
              {
                "type": "FeatureCollection",
                "features": [
                  {
                    "type": "Feature",
                    "geometry": {
                      "type": "LineString",
                      "coordinates": [
                        [139.7674, 35.6762],
                        [139.7700, 35.6800],
                        [139.7650, 35.6850]
                      ]
                    },
                    "properties": {
                      "name": "提案コース"
                    }
                  }
                ]
              }
            */}
            <div
              className="geolonia"
              data-lat={latitude}
              data-lng={longitude}
              data-zoom="14"
              style={{ height: '300px' }}
            />
          </section>
        ) : (
          <section className="map-section">
            <p>位置情報を取得してください。地図を表示します。</p>
          </section>
        )}
      </main>

      {/* フッター */}
      <footer className="app-footer">
        <p>&copy; 2025 天気×ランニングコース提案アプリ</p>
      </footer>
    </div>
  )
}
