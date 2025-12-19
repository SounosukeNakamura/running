/**
 * Geolonia 地図表示制御ユーティリティ
 * 
 * ルート表示時のマーカー・ポリラインの制御を管理します
 */

export interface MapDisplayConfig {
  routeColor?: string
  routeWeight?: number
  routeOpacity?: number
  startGoalMarkerIcon?: string
  hideWaypointMarkers?: boolean
}

const defaultConfig: MapDisplayConfig = {
  routeColor: '#2196F3',
  routeWeight: 4,
  routeOpacity: 0.8,
  startGoalMarkerIcon: '🚩',
  hideWaypointMarkers: true, // ウェイポイント用マーカーは表示しない
}

export interface MapResource {
  polyline?: any
  markers: {
    startGoal?: any
    waypoints: any[]
  }
}

/**
 * ルートを Geolonia 地図上に表示
 */
export async function displayRouteOnMap(
  map: any,
  routePath: Array<{ lat: number; lng: number }>,
  startGoalLocation: { lat: number; lng: number },
  config: MapDisplayConfig = {}
): Promise<MapResource> {
  const finalConfig = { ...defaultConfig, ...config }
  const resources: MapResource = {
    markers: {
      waypoints: [],
    },
  }

  // ポリライン（ルート）を描画
  if (routePath && routePath.length > 1) {
    const polylineCoordinates = routePath.map((point) => [point.lat, point.lng])

    try {
      const polyline = new (window as any).geolonia.maps.Polyline({
        path: polylineCoordinates,
        map: map,
        strokeColor: finalConfig.routeColor || '#2196F3',
        strokeWeight: finalConfig.routeWeight || 4,
        strokeOpacity: finalConfig.routeOpacity || 0.8,
      })

      resources.polyline = polyline
      console.log('✅ Route polyline displayed')
    } catch (error) {
      console.error('Error displaying polyline:', error)
    }
  }

  // スタート・ゴール地点のマーカーを表示
  if (startGoalLocation) {
    try {
      const marker = new (window as any).geolonia.maps.Marker({
        position: [startGoalLocation.lat, startGoalLocation.lng],
        map: map,
        title: 'スタート＝ゴール',
        icon: finalConfig.startGoalMarkerIcon || '🚩',
      })

      resources.markers.startGoal = marker
      console.log('✅ Start/Goal marker displayed')
    } catch (error) {
      console.error('Error displaying start/goal marker:', error)
    }
  }

  // ウェイポイント用マーカーは表示しない（hideWaypointMarkers = true がデフォルト）
  console.log(`ℹ️ Waypoint markers: ${finalConfig.hideWaypointMarkers ? 'hidden' : 'shown'}`)

  // 地図の視野をルートに合わせる
  if (routePath && routePath.length > 0) {
    try {
      const bounds = new (window as any).geolonia.maps.LatLngBounds()
      routePath.forEach((point) => {
        bounds.extend([point.lat, point.lng])
      })
      map.fitBounds(bounds, {
        padding: 50,
      })
      console.log('✅ Map view adjusted to route')
    } catch (error) {
      console.error('Error adjusting map bounds:', error)
    }
  }

  return resources
}

/**
 * 地図上のルート表示をクリア
 */
export function clearRouteDisplay(map: any, resources: MapResource): void {
  if (!resources) return

  try {
    // ポリラインを削除
    if (resources.polyline) {
      resources.polyline.setMap(null)
      console.log('✅ Polyline cleared')
    }

    // スタート・ゴール地点マーカーを削除
    if (resources.markers.startGoal) {
      resources.markers.startGoal.setMap(null)
      console.log('✅ Start/Goal marker cleared')
    }

    // ウェイポイント用マーカーを削除
    resources.markers.waypoints.forEach((marker) => {
      marker.setMap(null)
    })
    console.log('✅ All markers cleared')
  } catch (error) {
    console.error('Error clearing display:', error)
  }
}

/**
 * ルート情報を UI で表示用のテキストに変換
 */
export function formatRouteInfo(
  distance: number,
  estimatedTimeMinutes: number
): {
  distanceText: string
  timeText: string
  paceText: string
} {
  return {
    distanceText: `${distance.toFixed(2)} km`,
    timeText: `${Math.round(estimatedTimeMinutes)} 分`,
    paceText: `${(estimatedTimeMinutes / distance).toFixed(1)} 分/km`,
  }
}

/**
 * HTML で route 情報を表示
 */
export function createRouteInfoHTML(
  distance: number,
  estimatedTimeMinutes: number,
  waypointCount: number
): string {
  const info = formatRouteInfo(distance, estimatedTimeMinutes)

  return `
    <div class="route-info-summary">
      <h3>🗺️ ルート情報</h3>
      <dl>
        <dt>走行距離</dt>
        <dd>${info.distanceText}</dd>
        <dt>推定時間</dt>
        <dd>${info.timeText}</dd>
        <dt>ペース</dt>
        <dd>${info.paceText}</dd>
        <dt>経由点数</dt>
        <dd>${waypointCount} 点</dd>
      </dl>
      <p class="route-note">
        ✓ スタート = ゴール地点（現在地）<br>
        ✓ 全区間が道路に沿ったルート<br>
        ✓ 入力時間内に調整済み
      </p>
    </div>
  `
}
