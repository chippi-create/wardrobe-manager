// 現在地の天気を Open-Meteo（無料・登録不要）から取得する。
// 送るのは緯度経度（小数2桁 ≒ 1km程度に丸めたもの）だけ。

export function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('この端末では位置情報が使えません'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        lat: Math.round(pos.coords.latitude * 100) / 100,
        lon: Math.round(pos.coords.longitude * 100) / 100,
      }),
      (err) => reject(new Error(err.code === 1
        ? '位置情報の利用が許可されていません。気温は手動で設定できます'
        : '現在地を取得できませんでした')),
      { timeout: 10000, maximumAge: 30 * 60 * 1000 },
    );
  });
}

export async function fetchWeather({ lat, lon }) {
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    current: 'temperature_2m,weather_code',
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    timezone: 'auto',
    forecast_days: '1',
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!res.ok) throw new Error('天気を取得できませんでした');
  const data = await res.json();
  return {
    current: data.current?.temperature_2m,
    code: data.current?.weather_code,
    max: data.daily?.temperature_2m_max?.[0],
    min: data.daily?.temperature_2m_min?.[0],
    rain: data.daily?.precipitation_probability_max?.[0],
  };
}

// WMO天気コード → ことば
export function weatherLabel(code) {
  if (code == null) return '';
  if (code === 0) return '晴れ';
  if (code <= 3) return 'くもり';
  if (code <= 48) return '霧';
  if (code <= 67 || (code >= 80 && code <= 82)) return '雨';
  if (code <= 77 || code === 85 || code === 86) return '雪';
  return '雷雨';
}
