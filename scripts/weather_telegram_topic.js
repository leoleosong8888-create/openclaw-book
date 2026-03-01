#!/usr/bin/env node

/**
 * Daily weather report for Seoul -> Telegram forum topic
 *
 * Required env:
 * - TELEGRAM_BOT_TOKEN
 * - TELEGRAM_CHAT_ID (e.g. -1003747245401)
 * - TELEGRAM_THREAD_ID (e.g. 34)
 *
 * Optional env:
 * - WEATHER_LAT (default: 37.5665)
 * - WEATHER_LON (default: 126.9780)
 * - WEATHER_TZ  (default: Asia/Seoul)
 */

const LAT = Number(process.env.WEATHER_LAT || 37.5665);
const LON = Number(process.env.WEATHER_LON || 126.9780);
const TZ = process.env.WEATHER_TZ || "Asia/Seoul";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const THREAD_ID = process.env.TELEGRAM_THREAD_ID;

function requireEnv(name, value) {
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
}

function dateInTz(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function hourOf(ts) {
  return ts.slice(11, 16); // HH:MM
}

async function fetchJson(url, timeoutMs = 20000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function getWeather() {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}` +
    `&hourly=temperature_2m,apparent_temperature,precipitation,wind_speed_10m` +
    `&timezone=${encodeURIComponent(TZ)}&past_days=1&forecast_days=1`;

  const data = await fetchJson(url);

  const times = data?.hourly?.time || [];
  const temp = data?.hourly?.temperature_2m || [];
  const feels = data?.hourly?.apparent_temperature || [];
  const rain = data?.hourly?.precipitation || [];
  const wind = data?.hourly?.wind_speed_10m || [];

  if (!times.length) throw new Error("No hourly weather data returned");

  const today = dateInTz(new Date(), TZ);
  const dates = [...new Set(times.map((t) => t.slice(0, 10)))].sort();
  const yesterday = dates.filter((d) => d < today).at(-1) || dates[0];

  const todayRows = {};
  const yesterdayTempByHour = {};

  for (let i = 0; i < times.length; i++) {
    const d = times[i].slice(0, 10);
    const h = hourOf(times[i]);

    if (d === today) {
      todayRows[h] = {
        t: temp[i],
        f: feels[i],
        p: rain[i],
        w: wind[i],
      };
    } else if (d === yesterday) {
      yesterdayTempByHour[h] = temp[i];
    }
  }

  return { today, yesterday, todayRows, yesterdayTempByHour };
}

function buildMessage({ today, yesterday, todayRows, yesterdayTempByHour }) {
  const hours = Object.keys(todayRows).sort();

  let msg = `🇰🇷 한국(서울) 시간별 날씨\n`;
  msg += `오늘: ${today} | 비교(어제): ${yesterday}\n\n`;
  msg += `시간 | 온도 | 체감 | 강수(mm) | 바람(km/h) | 어제온도\n`;

  for (const h of hours) {
    const r = todayRows[h];
    const y = yesterdayTempByHour[h];
    const yTxt = Number.isFinite(y) ? `${y.toFixed(1)}°C` : "-";

    msg += `${h} | ${r.t.toFixed(1)}°C | ${r.f.toFixed(1)}°C | ${r.p.toFixed(1)} | ${r.w.toFixed(1)} | ${yTxt}\n`;
  }

  return msg;
}

async function sendTelegram(text) {
  const api = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;

  const payload = {
    chat_id: CHAT_ID,
    message_thread_id: Number(THREAD_ID),
    text,
    disable_web_page_preview: true,
  };

  const res = await fetch(api, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const out = await res.json();
  if (!out.ok) {
    throw new Error(`Telegram send failed: ${JSON.stringify(out)}`);
  }
}

async function main() {
  requireEnv("TELEGRAM_BOT_TOKEN", BOT_TOKEN);
  requireEnv("TELEGRAM_CHAT_ID", CHAT_ID);
  requireEnv("TELEGRAM_THREAD_ID", THREAD_ID);

  const weather = await getWeather();
  const text = buildMessage(weather);
  await sendTelegram(text);
  console.log("Weather report sent successfully");
}

main().catch((err) => {
  console.error(err?.stack || err);
  process.exit(1);
});
