#!/usr/bin/env node

const API_BASE = 'https://apis.data.go.kr/6410000/busarrivalservice/v2/getBusArrivalListv2';

const serviceKey = process.env.BUS_API_KEY || 'd05c817068c14fa7278d282cbf0bbe9ad62a2563f182cf13d720dc634bd5f7db';
const stationId = process.env.BUS_STATION_ID || '228000997';
const routeFilter = (process.env.BUS_ROUTE_FILTER || '39,39-1,102,1303')
  .split(',')
  .map((v) => v.trim())
  .filter(Boolean);
const routeOrder = new Map(routeFilter.map((name, idx) => [name, idx]));

const asArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);
const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function formatArrival(item, nth) {
  const eta = toNum(item[`predictTime${nth}`]);
  const loc = toNum(item[`locationNo${nth}`]);
  if (eta == null && loc == null) return null;

  // 경기 버스 API의 predictTime 값은 보통 '분' 단위
  const minText = eta != null ? `${Math.max(0, Math.round(eta))}분` : null;
  const locText = loc != null ? `${loc}정거장 전` : null;
  if (minText && locText) return `${minText} (${locText})`;
  return minText || locText;
}

async function main() {
  const url = new URL(API_BASE);
  url.searchParams.set('serviceKey', serviceKey);
  url.searchParams.set('stationId', stationId);
  url.searchParams.set('format', 'json');

  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 180)}`);
  }

  const json = JSON.parse(text);
  const header = json?.response?.msgHeader || json?.msgHeader || {};
  const code = `${header.resultCode ?? ''}`;
  if (code && code !== '0') {
    throw new Error(`${header.resultMessage || 'API 오류'} (code=${code})`);
  }

  const body = json?.response?.msgBody || json?.msgBody || {};
  const stationName = body.stationName || body.stationNm || `정류장 ${stationId}`;
  const list = asArray(body.busArrivalList);

  const filtered = list
    .filter((item) => routeFilter.includes(String(item.routeName || item.routeNm || '').trim()))
    .sort((a, b) => {
      const aRoute = String(a.routeName || a.routeNm || '').trim();
      const bRoute = String(b.routeName || b.routeNm || '').trim();
      const aIdx = routeOrder.has(aRoute) ? routeOrder.get(aRoute) : Number.MAX_SAFE_INTEGER;
      const bIdx = routeOrder.has(bRoute) ? routeOrder.get(bRoute) : Number.MAX_SAFE_INTEGER;
      if (aIdx !== bIdx) return aIdx - bIdx;

      const aSec = toNum(a.predictTime1) ?? Number.MAX_SAFE_INTEGER;
      const bSec = toNum(b.predictTime1) ?? Number.MAX_SAFE_INTEGER;
      return aSec - bSec;
    });

  if (!filtered.length) {
    console.log(`출근 버스 조회\n정류장: ${stationName} (${stationId})\n대상 노선: ${routeFilter.join(', ')}\n결과: 해당 노선 도착정보 없음`);
    return;
  }

  const lines = filtered.map((item) => {
    const route = item.routeName || item.routeNm;
    const toward = item.stationNm1 || item.stationNm2 || '-';
    const a1 = formatArrival(item, 1) || '정보 없음';
    return `- ${route}: ${a1} / ${toward}`;
  });

  console.log(
    [
      '출근 버스 조회',
      `정류장: ${stationName} (${stationId})`,
      `대상 노선: ${routeFilter.join(', ')}`,
      ...lines,
    ].join('\n')
  );
}

main().catch((err) => {
  console.log(`출근 버스 조회 실패: ${err.message}`);
  process.exit(1);
});
