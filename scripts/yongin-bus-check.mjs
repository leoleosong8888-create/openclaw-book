#!/usr/bin/env node

const API_BASE = 'https://apis.data.go.kr/6410000/busarrivalservice/v2';

const apiKey = process.env.BUS_API_KEY || '';
const stationId = process.env.BUS_STATION_ID || '29319';
const routeName = process.env.BUS_ROUTE_NAME || '39';
const routeId = process.env.BUS_ROUTE_ID || '';
const directionHint = process.env.BUS_DIRECTION || '';

function toArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function asNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pickFirst(...vals) {
  for (const v of vals) {
    if (v !== undefined && v !== null && `${v}`.trim() !== '') return v;
  }
  return null;
}

function normalizeText(v) {
  return (v ?? '').toString().trim();
}

function formatEta(sec, loc) {
  const s = asNum(sec);
  const l = asNum(loc);
  const min = s != null ? Math.max(0, Math.round(s / 60)) : null;
  const locText = l != null ? `${l}정거장 전` : null;
  const minText = min != null ? `${min}분` : null;
  if (minText && locText) return `${minText} (${locText})`;
  return minText || locText || '정보 없음';
}

async function fetchJson(path, params) {
  const url = new URL(`${API_BASE}/${path}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && `${v}` !== '') url.searchParams.set(k, `${v}`);
  });

  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const text = await res.text();

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`JSON 파싱 실패: ${text.slice(0, 200)}`);
  }

  const header = data?.response?.msgHeader || data?.msgHeader;
  const resultCode = `${header?.resultCode ?? ''}`;
  if (resultCode && resultCode !== '0') {
    const msg = header?.resultMessage || 'API 오류';
    throw new Error(`${msg} (code=${resultCode})`);
  }
  return data;
}

function chooseArrival(list) {
  const candidates = list
    .filter((x) => normalizeText(pickFirst(x.routeName, x.routeNm)) === routeName)
    .filter((x) => {
      if (!routeId) return true;
      return normalizeText(pickFirst(x.routeId, x.routeID)) === routeId;
    })
    .filter((x) => {
      if (!directionHint) return true;
      const stationNm1 = normalizeText(x.stationNm1);
      const stationNm2 = normalizeText(x.stationNm2);
      return stationNm1.includes(directionHint) || stationNm2.includes(directionHint);
    });

  if (!candidates.length) return null;

  return candidates.sort((a, b) => {
    const aSec = asNum(pickFirst(a.predictTime1)) ?? 9e9;
    const bSec = asNum(pickFirst(b.predictTime1)) ?? 9e9;
    return aSec - bSec;
  })[0];
}

async function main() {
  if (!apiKey) {
    console.log('버스 조회 실패: BUS_API_KEY가 비어있습니다.');
    process.exit(1);
  }

  try {
    const data = await fetchJson('getBusArrivalListv2', {
      serviceKey: apiKey,
      stationId,
      format: 'json',
    });

    const body = data?.response?.msgBody || data?.msgBody || {};
    const stationName = normalizeText(body.stationName || body.stationNm || '힐스테이트.현대1차');
    const arrivals = toArray(body.busArrivalList);

    const target = chooseArrival(arrivals);
    if (!target) {
      console.log(`오늘 06:10 버스 조회\n정류장: ${stationName}(${stationId})\n노선: ${routeName}\n결과: 해당 노선 도착정보를 찾지 못했어요.`);
      return;
    }

    const line = normalizeText(pickFirst(target.routeName, target.routeNm, routeName));
    const eta1 = formatEta(pickFirst(target.predictTime1), pickFirst(target.locationNo1));
    const eta2 = formatEta(pickFirst(target.predictTime2), pickFirst(target.locationNo2));
    const lowFloor = pickFirst(target.lowPlate1, target.lowPlate2);
    const lowFloorText = `${lowFloor}` === '1' ? ' (저상버스)' : '';
    const toward = normalizeText(target.stationNm1 || target.stationNm2 || directionHint);

    console.log(
      `오늘 06:10 버스 조회\n정류장: ${stationName}(${stationId})\n노선: ${line}${toward ? ` · ${toward} 방향` : ''}\n첫차: ${eta1}${lowFloorText}\n다음차: ${eta2}`
    );
  } catch (err) {
    console.log(`버스 조회 실패: ${err.message}`);
    process.exit(1);
  }
}

main();
