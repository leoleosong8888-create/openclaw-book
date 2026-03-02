#!/usr/bin/env node

const API_BASE = 'https://apis.data.go.kr/6410000/busarrivalservice/v2/getBusArrivalListv2';

const serviceKey = process.env.BUS_API_KEY || 'd05c817068c14fa7278d282cbf0bbe9ad62a2563f182cf13d720dc634bd5f7db';

const stationConfigs = [
  { stationId: '206000095', routes: ['102', '1303'] },
  { stationId: '206000087', routes: ['39-1', '39', '22'] },
];

const routeOrder = ['39-1', '39', '22', '102', '1303'];
const routeOrderMap = new Map(routeOrder.map((r, i) => [r, i]));

const asArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);
const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function formatArrival(item, nth) {
  const eta = toNum(item[`predictTime${nth}`]);
  const loc = toNum(item[`locationNo${nth}`]);
  if (eta == null && loc == null) return null;

  const minText = eta != null ? `${Math.max(0, Math.round(eta))}분` : null;
  const locText = loc != null ? `${loc}정거장 전` : null;
  if (minText && locText) return `${minText} (${locText})`;
  return minText || locText;
}

async function fetchStation(stationId) {
  const url = new URL(API_BASE);
  url.searchParams.set('serviceKey', serviceKey);
  url.searchParams.set('stationId', stationId);
  url.searchParams.set('format', 'json');

  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const text = await res.text();
  if (!res.ok) throw new Error(`[${stationId}] HTTP ${res.status}: ${text.slice(0, 120)}`);

  const json = JSON.parse(text);
  const header = json?.response?.msgHeader || json?.msgHeader || {};
  const code = `${header.resultCode ?? ''}`;
  if (code && code !== '0') {
    throw new Error(`[${stationId}] ${header.resultMessage || 'API 오류'} (code=${code})`);
  }

  const body = json?.response?.msgBody || json?.msgBody || {};
  return {
    stationId,
    stationName: body.stationName || body.stationNm || `정류장 ${stationId}`,
    items: asArray(body.busArrivalList),
  };
}

async function main() {
  const results = await Promise.all(stationConfigs.map((cfg) => fetchStation(cfg.stationId)));

  const merged = [];
  for (const station of results) {
    const cfg = stationConfigs.find((x) => x.stationId === station.stationId);
    const allow = new Set(cfg.routes);
    for (const item of station.items) {
      const route = String(item.routeName || item.routeNm || '').trim();
      if (!allow.has(route)) continue;
      merged.push({ ...item, _stationName: station.stationName, _stationId: station.stationId, _route: route });
    }
  }

  merged.sort((a, b) => {
    const ai = routeOrderMap.has(a._route) ? routeOrderMap.get(a._route) : Number.MAX_SAFE_INTEGER;
    const bi = routeOrderMap.has(b._route) ? routeOrderMap.get(b._route) : Number.MAX_SAFE_INTEGER;
    if (ai !== bi) return ai - bi;

    const as = toNum(a.predictTime1) ?? Number.MAX_SAFE_INTEGER;
    const bs = toNum(b.predictTime1) ?? Number.MAX_SAFE_INTEGER;
    return as - bs;
  });

  if (!merged.length) {
    console.log('퇴근 버스 조회\n결과: 대상 노선 도착정보 없음');
    return;
  }

  const lines = merged.map((item) => {
    const toward = item.stationNm1 || item.stationNm2 || '-';
    const a1 = formatArrival(item, 1) || '정보 없음';
    return `- ${item._route}: ${a1} / ${toward}`;
  });

  console.log([
    '퇴근 버스 조회',
    '대상 정류장: 206000095, 206000087',
    '대상 노선: 39-1, 39, 22, 102, 1303',
    ...lines,
  ].join('\n'));
}

main().catch((err) => {
  console.log(`퇴근 버스 조회 실패: ${err.message}`);
  process.exit(1);
});
