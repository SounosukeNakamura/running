import ReactDOM from 'react-dom/client'
import App from './App.tsx'

// Geolonia Maps スクリプトの動的読み込み
const loadGeolonia = () => {
  const apiKey = import.meta.env.VITE_GEOLONIA_API_KEY || '57e50c6fcf3240359f4cf08862c029d6'
  if (!apiKey) {
    console.warn('Geolonia API キーが設定されていません')
    return
  }

  const script = document.createElement('script')
  script.src = `https://cdn.geolonia.com/v1/embed?geolonia-api-key=${apiKey}`
  script.async = true
  script.defer = true
  document.head.appendChild(script)
}

// Geolonia を読み込み
loadGeolonia()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <App />
)
