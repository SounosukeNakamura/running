/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GEOLONIA_API_KEY: string
  readonly VITE_OPENWEATHER_API_KEY: string
  readonly VITE_RUNNING_PACE_MIN_PER_KM?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
