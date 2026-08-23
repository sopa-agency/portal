# Scheduler tick — who fires the autopilot, and from where

The autopilot actions (auto-boost, revenue snapshot, stream refill) must run
**once per hour**. `GET /api/scheduler/cron` is the entry point; its per-hour
claim (an atomic compare-and-set on `SchedulerLease.lastActionsTickAt`) makes it
safe for several callers to hit it, **as long as they share a database**.

## Who calls it

| Caller | Cadence | Role |
|---|---|---|
| `scripts/scheduler-tick.js` on minivlad (LaunchAgent) | hourly, at :05 | **primary** |
| Vercel cron in `vercel.json` (crew project) | daily, 06:00 UTC | safety net |

Why the split: the crew's Vercel team is on the **Hobby** plan, and Hobby only
accepts a **daily** cron — an hourly expression makes Vercel *refuse to create
the deployment at all* (no failed build appears; only the GitHub check fails,
linking to the cron pricing doc). So the hourly cadence lives on the Mac, for
free, and Vercel keeps a daily run for the case where the Mac is down.

If the crew ever moves to Pro, the hourly schedule can go back into
`vercel.json` and this LaunchAgent becomes redundant.

## Install the LaunchAgent (minivlad)

Write `~/Library/LaunchAgents/com.sopa.scheduler-tick.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.sopa.scheduler-tick</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/vladnikolaev/.nvm/versions/node/v22.22.3/bin/node</string>
    <string>/Users/vladnikolaev/Code/sopa/portal/scripts/scheduler-tick.js</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Minute</key>
    <integer>5</integer>
  </dict>
  <key>RunAtLoad</key>
  <false/>
  <key>StandardOutPath</key>
  <string>/tmp/sopa-scheduler-tick.out.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/sopa-scheduler-tick.err.log</string>
</dict>
</plist>
```

`StartCalendarInterval` with only `Minute` set fires **every hour** at that
minute. Then:

```sh
launchctl load -w ~/Library/LaunchAgents/com.sopa.scheduler-tick.plist
node scripts/scheduler-tick.js          # smoke test, prints the response body
tail -f /tmp/sopa-scheduler-tick.out.log
```

The response body is the only place the ran/skipped detail shows up (the route
returns it in JSON, it is not written to stdout server-side), which is why the
script logs the body verbatim.

## Env

| Var | Default | Notes |
|---|---|---|
| `SCHEDULER_TICK_URL` | `https://portal.sopa.team` | which deployment to tick |
| `CRON_SECRET` | — | sent as `Authorization: Bearer …`; the route allows unauthenticated calls only while it is unset |

## Before pausing the old marketing-portal project

Its Vercel cron is, today, the **only** registered hourly caller. Pausing that
project without this LaunchAgent running stops the autopilot completely. Order:
install here → confirm a tick in the log → then pause.
