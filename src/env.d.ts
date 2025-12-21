/// <reference types="vite/client" />

/**
 * Vite 環境変数の型定義
 * 
 * 使用方法：
 *   import.meta.env.VITE_OPENWEATHER_API_KEY
 * 
 * 設定場所：
 *   - ローカル開発: .env.local ファイル
 *   - 本番環境（Vercel）: https://vercel.com/settings/environment-variables
 * 
 * 例：
 *   .env.local の内容:
 *   VITE_OPENWEATHER_API_KEY=xxxxxxxxxxxxxxxxxxxx
 */
interface ImportMetaEnv {
  /** Geolonia Maps APIキー - 地図表示に必須 */
  readonly VITE_GEOLONIA_API_KEY: string
  
  /** OpenWeather APIキー - 天気情報表示に使用（未設定可） */
  readonly VITE_OPENWEATHER_API_KEY: string
  
  /** ランニング想定ペース（分/km）- オプション */
  readonly VITE_RUNNING_PACE_MIN_PER_KM?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare namespace React {
  export {}
}
/**
 * グローバル window オブジェクトの型定義
 * Geolonia maps と custom display functions
 */
declare global {
  interface Window {
    // Geolonia API
    geolonia?: {
      onReady(callback: () => void): void
      maps?: Array<{
        flyTo?(options: { center: [number, number]; zoom: number }): void
        setCenter?(lnglat: [number, number]): void
      }>
    }
    geoloniaMapInstance?: any
    
    // Map initialization and display functions
    initializeGeoloniaMaps?: () => void
    displayCourseOnMap?: (coursePoints: Array<{ lat: number; lng: number }>, options?: Record<string, any>) => void
  }
}