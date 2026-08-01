// §10 gates: "Agent idle memory < 150 MB" and "Library window cold open < 1.5 s".
//
//   npm run bench:memory -- [--budget-mb 150] [--gate] [--json]
//
// Runs under Electron, not node — it measures Electron's own process tree via
// app.getAppMetrics(). What it reports is the *floor*: a single window loading a
// trivial document. The real Noteato renderer (React + BlockNote) is strictly
// heavier, so a failure here can never be explained away by app code.
//
// This is the number that justifies the native agent. Phase 1 adds the agent's
// own RSS alongside it; until then, the value of this benchmark is that it
// keeps the Electron floor visible as a moving target rather than a one-off
// figure in an audit.
const { app, BrowserWindow } = require('electron')

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? fallback : argv[i + 1]
}
const has = (name) => argv.includes(`--${name}`)

const budgetMB = Number(flag('budget-mb', 150))
const launchedAt = Date.now()

app.whenReady().then(async () => {
  const readyMs = Date.now() - launchedAt

  const win = new BrowserWindow({
    width: 1100,
    height: 700,
    show: false,
    webPreferences: { sandbox: false }
  })

  const shownAt = new Promise((resolve) => win.once('ready-to-show', () => resolve(Date.now())))
  win.loadURL('data:text/html,' + encodeURIComponent('<body style="background:#1a1a1a"></body>'))
  const coldOpenMs = (await shownAt) - launchedAt
  win.showInactive()

  // Let the process tree settle before sampling; a reading taken mid-startup
  // flatters the number.
  await new Promise((resolve) => setTimeout(resolve, 3000))

  const metrics = app.getAppMetrics()
  const perProcess = metrics.map((m) => ({
    type: m.type,
    mb: Number(((m.memory?.workingSetSize || 0) / 1024).toFixed(1))
  }))
  const totalMB = Number(perProcess.reduce((sum, p) => sum + p.mb, 0).toFixed(1))

  const result = {
    metric: 'electron-idle-floor',
    budgetMB,
    totalMB,
    processCount: metrics.length,
    perProcess,
    appReadyMs: readyMs,
    coldOpenMs,
    withinBudget: totalMB <= budgetMB
  }

  if (has('json')) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    console.log(`electron idle floor · ${metrics.length} processes · trivial document`)
    for (const p of perProcess) console.log(`  ${p.type.padEnd(10)} ${String(p.mb).padStart(8)} MB`)
    console.log(`  ${'TOTAL'.padEnd(10)} ${String(totalMB).padStart(8)} MB   budget ${budgetMB} MB — ${result.withinBudget ? 'PASS' : 'FAIL'}`)
    console.log(`  app ready ${readyMs} ms · window ready-to-show ${coldOpenMs} ms`)
  }

  if (has('gate') && !result.withinBudget) {
    console.error(`\nFAIL: ${totalMB} MB exceeds the ${budgetMB} MB budget (§10).`)
    app.exit(1)
  }
  app.exit(0)
})
