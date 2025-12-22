/**
 * ランニングコース提案アプリ - React コンポーネント実装
 * 実際のUIコンポーネント統合例
 */

import React, { useState, useRef, useEffect } from 'react'
import {
  generateOptimizedRoundTripRoute,
  validateRoundTripRoute,
  estimateRunningDistance,
} from './routeOptimizer.v4'
import { OptimizedRoute } from './routeOptimizer.v2'

interface RouteGeneratorState {
  desiredMinutes: number
  currentLocation: { lat: number; lng: number } | null
  currentAddress: string | null // 住所
  addressLoading: boolean // 住所取得中
  route: OptimizedRoute | null
  loading: boolean
  error: string | null
  validation: any | null
}

/**
 * メインコンポーネント: ランニングコース提案アプリ
 */
export function RunningCourseApp() {
  const [state, setState] = useState<RouteGeneratorState>({
    desiredMinutes: 30,
    currentLocation: null,
    currentAddress: null,
    addressLoading: false,
    route: null,
    loading: false,
    error: null,
    validation: null,
  })

  const mapRef = useRef<any>(null)
  const mapResourcesRef = useRef<any>(null)

  // コンポーネントマウント時にGPS位置情報を取得
  useEffect(() => {
    initializeLocation()
  }, [])

  /**
   * 現在地が確定したら地図を初期化
   */
  useEffect(() => {
    if (!state.currentLocation || !mapRef.current) {
      return
    }

    console.log('📍 Current location confirmed:', state.currentLocation)
    
    // 地図コンテナに data-lat/data-lng 属性を設定
    mapRef.current.setAttribute('data-lat', state.currentLocation.lat.toString())
    mapRef.current.setAttribute('data-lng', state.currentLocation.lng.toString())
    mapRef.current.setAttribute('data-zoom', '14')
    
    console.log('✓ Map container attributes set:', {
      'data-lat': state.currentLocation.lat,
      'data-lng': state.currentLocation.lng,
      'data-zoom': 14,
    })
    
    // Geolonia初期化
    if (window.initializeGeoloniaMaps && typeof window.initializeGeoloniaMaps === 'function') {
      console.log('🗺️ Calling initializeGeoloniaMaps()...')
      window.initializeGeoloniaMaps()
    }
  }, [state.currentLocation])

  /**
   * GPS位置情報を初期化
   */
  const initializeLocation = async () => {
    return new Promise<void>((resolve) => {
      if ('geolocation' in navigator) {
        navigator.geolocation.getCurrentPosition(
          async (position) => {
            const loc = {
              lat: position.coords.latitude,
              lng: position.coords.longitude,
            }
            setState((prev) => ({
              ...prev,
              currentLocation: loc,
              addressLoading: true,
            }))
            
            // 逆ジオコーディングで住所を取得
            try {
              const response = await fetch(
                `https://nominatim.openstreetmap.org/reverse?format=json&lat=${loc.lat}&lon=${loc.lng}&accept-language=ja`
              )
              const data = await response.json()
              const address = data.address?.['ja:address'] || data.display_name || '住所を取得できませんでした'
              setState((prev) => ({
                ...prev,
                currentAddress: address,
                addressLoading: false,
              }))
            } catch (error) {
              console.error('住所取得エラー:', error)
              setState((prev) => ({
                ...prev,
                currentAddress: '住所を取得できませんでした',
                addressLoading: false,
              }))
            }
            resolve()
          },
          (error) => {
            console.error('GPS取得エラー:', error)
            // デフォルト位置（東京駅）を使用
            setState((prev) => ({
              ...prev,
              currentLocation: { lat: 35.6762, lng: 139.7674 },
              currentAddress: '東京駅周辺',
              error: 'GPS位置情報の取得に失敗しました。デフォルト位置を使用します。',
            }))
            resolve()
          }
        )
      } else {
        // デフォルト位置
        setState((prev) => ({
          ...prev,
          currentLocation: { lat: 35.6762, lng: 139.7674 },
          currentAddress: '東京駅周辺',
          error: 'ブラウザがGPSに対応していません。',
        }))
        resolve()
      }
    })
  }

  /**
   * ルート生成ハンドラー
   */
  const handleGenerateRoute = async () => {
    if (!state.currentLocation) return

    setState((prev) => ({ ...prev, loading: true, error: null }))

    try {
      // ルート生成
      const generatedRoute = await generateOptimizedRoundTripRoute(
        state.currentLocation,
        state.desiredMinutes
      )

      // ルート検証
      const validationResult = validateRoundTripRoute(generatedRoute, state.desiredMinutes)

      setState((prev) => ({
        ...prev,
        route: generatedRoute,
        validation: validationResult,
        loading: false,
      }))

      // ルート生成後、地図にルートを表示
      console.log('🎯 Route generation completed. Preparing to display on map...')
      
      if (window.displayCourseOnMap && typeof window.displayCourseOnMap === 'function') {
        console.log('📍 Calling displayCourseOnMap with', generatedRoute.routePath.length, 'points')
        // displayCourseOnMapは内部でmapインスタンスをチェックし、なければリトライする
        window.displayCourseOnMap(generatedRoute.routePath, { hideWaypointMarkers: true })
      } else {
        console.warn('⚠️ displayCourseOnMap function not available')
      }
    } catch (error) {
      setState((prev) => ({
        ...prev,
        error: error instanceof Error ? error.message : '不明なエラーが発生しました',
        loading: false,
      }))
    }
  }

  /**
   * 走行時間をリセット
   */
  const handleReset = () => {
    setState((prev) => ({
      ...prev,
      desiredMinutes: 30,
      route: null,
      error: null,
      validation: null,
    }))
  }

  /**
   * ルートを共有（共有API使用）
   */
  const handleShareRoute = async () => {
    if (!state.route) return

    const shareText = `
🏃 ランニングコース情報
・往復距離: ${state.route.totalDistance.toFixed(2)}km
・推定時間: ${state.route.estimatedTime.toFixed(1)}分
・スタート地点: (${state.currentLocation?.lat.toFixed(5)}, ${state.currentLocation?.lng.toFixed(5)})

詳細はアプリで確認してください。
    `.trim()

    if (navigator.share) {
      try {
        await navigator.share({
          title: 'ランニングコース',
          text: shareText,
        })
      } catch (error) {
        console.error('共有エラー:', error)
      }
    } else {
      // フォールバック: クリップボードにコピー
      await navigator.clipboard.writeText(shareText)
      alert('ルート情報をコピーしました')
    }
  }

  /**
   * ルートを保存（LocalStorage）
   */
  const handleSaveRoute = () => {
    if (!state.route) return

    const routes = JSON.parse(localStorage.getItem('savedRoutes') || '[]')
    const newRoute = {
      id: Date.now(),
      timestamp: new Date().toISOString(),
      desiredMinutes: state.desiredMinutes,
      route: state.route,
    }

    routes.push(newRoute)
    localStorage.setItem('savedRoutes', JSON.stringify(routes))
    alert('ルートを保存しました')
  }

  return (
    <div style={styles.container}>
      {/* ヘッダー */}
      <header style={styles.header}>
        <h1 style={styles.title}>🏃 ランニングコース提案アプリ</h1>
        <p style={styles.subtitle}>AIがあなたにぴったりなランニングコースを提案します</p>
      </header>

      {/* メインコンテンツ */}
      <div style={styles.content}>
        {/* 入力パネル */}
        <section style={styles.inputPanel}>
          <h2 style={styles.sectionTitle}>コース設定</h2>

          <div style={styles.inputGroup}>
            <label style={styles.label}>⏱️ 走りたい時間</label>
            <div style={{ marginTop: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', marginBottom: '12px' }}>
                <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#5C6BC0' }}>
                  {state.desiredMinutes}分
                </div>
                <div style={{ fontSize: '13px', color: '#666' }}>
                  許容範囲: {Math.max(5, state.desiredMinutes - 2)}～{state.desiredMinutes}分
                </div>
              </div>
              <input
                type="range"
                min="5"
                max="120"
                step="5"
                value={state.desiredMinutes}
                onChange={(e) =>
                  setState((prev) => ({ ...prev, desiredMinutes: parseInt(e.target.value) }))
                }
                disabled={state.loading}
                style={styles.slider}
              />
              <p style={{ margin: '8px 0 0 0', fontSize: '12px', color: '#999' }}>
                推定走行距離: {estimateRunningDistance(state.desiredMinutes / 2).toFixed(2)}km × 2 = 
                {(estimateRunningDistance(state.desiredMinutes / 2) * 2).toFixed(2)}km
              </p>
            </div>
          </div>

          {state.currentLocation && (
            <div style={styles.inputGroup}>
              <label style={styles.label}>📍 現在地</label>
              <div style={{ marginTop: '8px' }}>
                <p style={{ margin: '4px 0', fontSize: '14px', fontWeight: 'bold', color: '#333' }}>
                  {state.addressLoading ? '住所を取得中...' : state.currentAddress || '住所を取得できませんでした'}
                </p>
                <p style={{ margin: '4px 0', fontSize: '12px', color: '#666' }}>
                  {state.currentLocation.lat.toFixed(5)}, {state.currentLocation.lng.toFixed(5)}
                </p>
              </div>
            </div>
          )}

          <div style={styles.buttonGroup}>
            <button
              onClick={handleGenerateRoute}
              disabled={state.loading || !state.currentLocation}
              style={{
                ...styles.button,
                ...styles.buttonPrimary,
                opacity: state.loading || !state.currentLocation ? 0.6 : 1,
                cursor: state.loading || !state.currentLocation ? 'not-allowed' : 'pointer',
              }}
            >
              {state.loading ? '📍 生成中...' : '✨ コース生成'}
            </button>

            {state.route && (
              <>
                <button
                  onClick={handleSaveRoute}
                  style={{ ...styles.button, ...styles.buttonSecondary }}
                >
                  💾 保存
                </button>
                <button
                  onClick={handleShareRoute}
                  style={{ ...styles.button, ...styles.buttonSecondary }}
                >
                  📤 共有
                </button>
                <button
                  onClick={handleReset}
                  style={{ ...styles.button, ...styles.buttonSecondary }}
                >
                  🔄 リセット
                </button>
              </>
            )}
          </div>
        </section>

        {/* エラーメッセージ */}
        {state.error && (
          <section style={{ ...styles.alert, ...styles.alertError }}>
            <h3>❌ コース生成に失敗しました</h3>
            <div style={{ whiteSpace: 'pre-wrap', fontSize: '14px', lineHeight: '1.6', color: '#333' }}>
              {state.error}
            </div>
          </section>
        )}

        {/* ルート情報 */}
        {state.route && (
          <>
            {/* 結果サマリー */}
            <section style={styles.resultPanel}>
              <h2 style={styles.sectionTitle}>✅ 生成されたコース</h2>

              <div style={{ marginBottom: '20px', padding: '16px', backgroundColor: '#F5F5F5', borderRadius: '8px', border: '2px solid #5C6BC0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '8px' }}>
                  <div>
                    <div style={{ fontSize: '14px', color: '#666', marginBottom: '4px' }}>推定走行時間</div>
                    <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#5C6BC0' }}>
                      {state.route.estimatedTime.toFixed(1)}分
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>目標時間</div>
                    <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#333' }}>
                      {state.desiredMinutes}分
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>差</div>
                    <div
                      style={{
                        fontSize: '18px',
                        fontWeight: 'bold',
                        color:
                          Math.abs(state.route.estimatedTime - state.desiredMinutes) < 2
                            ? '#4CAF50'
                            : '#FF9800',
                      }}
                    >
                      {(state.route.estimatedTime - state.desiredMinutes).toFixed(1)}分
                    </div>
                  </div>
                </div>
                <div style={{ fontSize: '12px', color: '#999' }}>
                  ✓ 許容範囲内: {Math.max(5, state.desiredMinutes - 2)}～{state.desiredMinutes}分
                </div>
              </div>

              <div style={styles.routeStats}>
                <div style={styles.statCard}>
                  <div style={styles.statLabel}>往復距離</div>
                  <div style={styles.statValue}>{state.route.totalDistance.toFixed(2)}km</div>
                </div>
              </div>

              {/* 検証結果 */}
              {state.validation && state.validation.isValid && (
                <div style={styles.validationSection}>
                  <div style={{ ...styles.alertSuccess, padding: '12px', borderRadius: '6px', backgroundColor: '#E8F5E9', border: '1px solid #4CAF50' }}>
                    <p style={{ margin: 0, color: '#2E7D32', fontSize: '14px' }}>✅ このルートは要件をすべて満たしています</p>
                  </div>
                </div>
              )}
            </section>

            {/* 詳細情報 */}
            <section style={styles.detailPanel}>
              <h2 style={styles.sectionTitle}>📍 ルート詳細</h2>

              <div style={styles.detailGrid}>
                <div style={styles.detailItem}>
                  <h4>往路情報</h4>
                  <p>
                    片道距離: {(state.route.totalDistance / 2).toFixed(2)}km
                    <br />
                    片道時間: {(state.route.estimatedTime / 2).toFixed(1)}分
                  </p>
                </div>

                <div style={styles.detailItem}>
                  <h4>走行条件</h4>
                  <p>
                    標準ペース: 5分/km
                    <br />
                    路面: 混在（推定）
                  </p>
                </div>
              </div>
            </section>
          </>
        )}

        {/* 地図 */}
        <section style={styles.mapPanel}>
          <h2 style={styles.sectionTitle}>🗺️ ルートマップ</h2>
          <div
            ref={mapRef}
            style={styles.map}
            data-zoom="14"
          />
          {!state.route && (
            <div style={styles.mapPlaceholder}>
              <p>コース生成後、ここにルートマップが表示されます</p>
            </div>
          )}
        </section>
      </div>

      {/* フッター */}
      <footer style={styles.footer}>
        <p>© 2025 ランニングコース提案アプリ | GPSと地図データを使用しています</p>
      </footer>
    </div>
  )
}

/**
 * スタイルオブジェクト
 */
const styles = {
  container: {
    minHeight: '100vh',
    backgroundColor: '#f5f5f5',
    fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
  } as React.CSSProperties,

  header: {
    backgroundColor: '#2C3E50',
    color: 'white',
    padding: '40px 20px',
    textAlign: 'center' as const,
  } as React.CSSProperties,

  title: {
    margin: 0,
    fontSize: '32px',
    fontWeight: 'bold' as const,
  } as React.CSSProperties,

  subtitle: {
    margin: '10px 0 0 0',
    fontSize: '16px',
    opacity: 0.9,
  } as React.CSSProperties,

  content: {
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '20px',
  } as React.CSSProperties,

  inputPanel: {
    backgroundColor: 'white',
    borderRadius: '8px',
    padding: '20px',
    marginBottom: '20px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
  } as React.CSSProperties,

  sectionTitle: {
    fontSize: '20px',
    fontWeight: 'bold' as const,
    marginTop: 0,
    marginBottom: '20px',
    color: '#2C3E50',
  } as React.CSSProperties,

  inputGroup: {
    marginBottom: '20px',
  } as React.CSSProperties,

  label: {
    display: 'block',
    fontSize: '14px',
    fontWeight: '600' as const,
    marginBottom: '8px',
    color: '#555',
  } as React.CSSProperties,

  timeInput: {
    display: 'flex',
    gap: '15px',
    alignItems: 'center',
  } as React.CSSProperties,

  slider: {
    flex: 1,
    height: '6px',
    borderRadius: '3px',
    outline: 'none',
    WebkitAppearance: 'none',
    appearance: 'none' as any,
    backgroundColor: '#ddd',
  } as React.CSSProperties,

  timeDisplay: {
    fontSize: '20px',
    fontWeight: 'bold' as const,
    color: '#2C3E50',
    minWidth: '60px',
  } as React.CSSProperties,

  hint: {
    fontSize: '12px',
    color: '#999',
    margin: '8px 0 0 0',
  } as React.CSSProperties,

  locationText: {
    fontSize: '14px',
    color: '#666',
    margin: '8px 0',
    padding: '10px',
    backgroundColor: '#f9f9f9',
    borderRadius: '4px',
    fontFamily: 'monospace',
  } as React.CSSProperties,

  buttonGroup: {
    display: 'flex',
    gap: '10px',
    marginTop: '20px',
    flexWrap: 'wrap' as const,
  } as React.CSSProperties,

  button: {
    padding: '12px 20px',
    border: 'none',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: '600' as const,
    cursor: 'pointer',
    transition: 'all 0.3s ease',
  } as React.CSSProperties,

  buttonPrimary: {
    backgroundColor: '#4CAF50',
    color: 'white',
  } as React.CSSProperties,

  buttonSecondary: {
    backgroundColor: '#2196F3',
    color: 'white',
  } as React.CSSProperties,

  alert: {
    borderRadius: '8px',
    padding: '15px 20px',
    marginBottom: '20px',
  } as React.CSSProperties,

  alertError: {
    backgroundColor: '#ffebee',
    borderLeft: '4px solid #f44336',
    color: '#c62828',
  } as React.CSSProperties,

  alertSuccess: {
    backgroundColor: '#e8f5e9',
    borderLeft: '4px solid #4CAF50',
    color: '#2e7d32',
  } as React.CSSProperties,

  alertWarning: {
    backgroundColor: '#fff3e0',
    borderLeft: '4px solid #ff9800',
    color: '#e65100',
  } as React.CSSProperties,

  resultPanel: {
    backgroundColor: 'white',
    borderRadius: '8px',
    padding: '20px',
    marginBottom: '20px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
  } as React.CSSProperties,

  routeStats: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: '15px',
    marginBottom: '20px',
  } as React.CSSProperties,

  statCard: {
    backgroundColor: '#f9f9f9',
    border: '1px solid #eee',
    borderRadius: '6px',
    padding: '15px',
    textAlign: 'center' as const,
  } as React.CSSProperties,

  statLabel: {
    fontSize: '12px',
    color: '#999',
    marginBottom: '8px',
    textTransform: 'uppercase' as const,
  } as React.CSSProperties,

  statValue: {
    fontSize: '24px',
    fontWeight: 'bold' as const,
    color: '#2C3E50',
  } as React.CSSProperties,

  validationSection: {
    marginTop: '20px',
    paddingTop: '20px',
    borderTop: '1px solid #eee',
  } as React.CSSProperties,

  errorList: {
    margin: '10px 0',
    paddingLeft: '20px',
  } as React.CSSProperties,

  detailPanel: {
    backgroundColor: 'white',
    borderRadius: '8px',
    padding: '20px',
    marginBottom: '20px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
  } as React.CSSProperties,

  detailGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '20px',
  } as React.CSSProperties,

  detailItem: {
    padding: '15px',
    backgroundColor: '#f9f9f9',
    borderRadius: '6px',
    borderLeft: '4px solid #2196F3',
  } as React.CSSProperties,

  mapPanel: {
    backgroundColor: 'white',
    borderRadius: '8px',
    padding: '20px',
    marginBottom: '20px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
  } as React.CSSProperties,

  map: {
    width: '100%',
    height: '600px',
    backgroundColor: '#e0e0e0',
    borderRadius: '6px',
    overflow: 'hidden',
  } as React.CSSProperties,

  mapPlaceholder: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '600px',
    backgroundColor: '#e0e0e0',
    borderRadius: '6px',
    color: '#999',
  } as React.CSSProperties,

  footer: {
    backgroundColor: '#2C3E50',
    color: 'white',
    textAlign: 'center' as const,
    padding: '20px',
    marginTop: '40px',
  } as React.CSSProperties,
}

export default RunningCourseApp
