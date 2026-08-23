#!/usr/bin/env node
// Hourly tick for the scheduler autopilot — the Mac-side replacement for the
// Vercel hourly cron.
//
// Why this exists: the autopilot actions (auto-boost, revenue snapshot, stream
// refill) must run ONCE PER HOUR. They used to ride the Vercel cron, but the
// crew's Vercel team is on Hobby, which only allows a DAILY cron — so
// vercel.json keeps a daily run as the safety net and this script carries the
// hourly cadence from minivlad, for free.
//
// It just calls the same endpoint Vercel would (`GET /api/scheduler/cron` with
// `Authorization: Bearer <CRON_SECRET>`). The endpoint's per-hour claim makes it
// safe to run alongside any other cron pointing at the SAME database.
//
// Install as an hourly LaunchAgent (runs at :05 every hour):
//   see docs/scheduler-tick.md
//
// Run once by hand:
//   node scripts/scheduler-tick.js

"use strict";

const path = require("node:path");

for (const f of [".env.local", ".env.development", ".env"]) {
  try {
    require("dotenv").config({ path: path.join(__dirname, "..", f), override: false });
  } catch {}
}

const BASE_URL = (process.env.SCHEDULER_TICK_URL ?? "https://portal.sopa.team").replace(/\/+$/, "");
const CRON_SECRET = process.env.CRON_SECRET;
const TIMEOUT_MS = Number(process.env.SCHEDULER_TICK_TIMEOUT_MS ?? 120_000);

function stamp() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

async function main() {
  const url = `${BASE_URL}/api/scheduler/cron`;
  const headers = CRON_SECRET ? { authorization: `Bearer ${CRON_SECRET}` } : {};
  if (!CRON_SECRET) {
    console.warn(`[${stamp()}] scheduler-tick: no CRON_SECRET in env — calling unauthenticated`);
  }

  const started = Date.now();
  let res;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    // Network/timeout: log and exit non-zero so launchd surfaces it in the log.
    console.error(`[${stamp()}] scheduler-tick: ${url} failed — ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
    return;
  }

  const body = await res.text();
  const ms = Date.now() - started;
  // The response body carries the ran/skipped detail (claimed the hour or not),
  // so log it verbatim — that's the only place it shows up.
  console.log(`[${stamp()}] scheduler-tick: ${res.status} in ${ms}ms — ${body.slice(0, 800)}`);
  if (!res.ok) process.exitCode = 1;
}

main();
