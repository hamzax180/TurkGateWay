const { app, BrowserWindow, shell, ipcMain, dialog, Menu, Tray, nativeImage } = require('electron')
const { spawn, execFile } = require('child_process')
const path = require('path')
const http = require('http')
const fs = require('fs')

// ── Paths ─────────────────────────────────────────────────────────────────────
const IS_PACKAGED = app.isPackaged
const RESOURCES   = IS_PACKAGED ? process.resourcesPath : path.join(__dirname, '..')
const NEXT_ROOT   = IS_PACKAGED ? path.join(RESOURCES) : path.join(__dirname, '..')
const BACKEND_DIR = IS_PACKAGED ? path.join(RESOURCES, 'backend') : path.join(__dirname, '..', 'backend')
const NODE_BIN    = IS_PACKAGED ? path.join(RESOURCES, 'node_modules', '.bin', 'next') : 'next'

const NEXT_PORT    = 3000
const BACKEND_PORT = 8003

let mainWindow   = null
let splashWindow = null
let tray         = null
let nextProc     = null
let pythonProc   = null
let readyCount   = 0  // increments when each server is confirmed up

// ── Logging ───────────────────────────────────────────────────────────────────
const logFile = path.join(app.getPath('userData'), 'turkgateway.log')
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  try { fs.appendFileSync(logFile, line + '\n') } catch {}
}

// ── Splash Window ─────────────────────────────────────────────────────────────
function createSplash() {
  splashWindow = new BrowserWindow({
    width: 480,
    height: 320,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    center: true,
    webPreferences: { contextIsolation: true }
  })
  splashWindow.loadFile(path.join(__dirname, 'splash.html'))
  splashWindow.setSkipTaskbar(true)
}

// ── Main Window ───────────────────────────────────────────────────────────────
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    title: 'TurkGateway',
    backgroundColor: '#09090b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    }
  })

  // Custom menu — minimal
  const menu = Menu.buildFromTemplate([
    {
      label: 'TurkGateway',
      submenu: [
        { label: 'About TurkGateway', click: () => showAbout() },
        { type: 'separator' },
        { label: 'Open Log File', click: () => shell.openPath(logFile) },
        { type: 'separator' },
        { role: 'quit', label: 'Quit TurkGateway' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Open DevTools', accelerator: 'F12', click: () => mainWindow?.webContents.toggleDevTools() },
        { label: 'TurkGateway Website', click: () => shell.openExternal('https://turkgateway.ai') }
      ]
    }
  ])
  Menu.setApplicationMenu(menu)

  mainWindow.loadURL(`http://localhost:${NEXT_PORT}`)

  mainWindow.once('ready-to-show', () => {
    try { splashWindow?.close(); splashWindow = null } catch {}
    mainWindow.show()
    mainWindow.focus()
    log('Main window ready.')
  })

  // Open external links in the default browser, not in Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(`http://localhost`)) shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => { mainWindow = null })
}

function showAbout() {
  dialog.showMessageBox({
    type: 'info',
    title: 'TurkGateway',
    message: 'TurkGateway Desktop',
    detail: `Version: ${app.getVersion()}\nAI-powered Turkish administrative assistant.\n\n© 2026 TurkGateway`,
    buttons: ['OK']
  })
}

// ── Server Health Checks ──────────────────────────────────────────────────────
function waitForServer(port, timeout = 90000) {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const check = () => {
      http.get(`http://localhost:${port}`, (res) => {
        if (res.statusCode < 500) { resolve(); return }
        retry()
      }).on('error', retry)
    }
    const retry = () => {
      if (Date.now() - start > timeout) {
        reject(new Error(`Server on port ${port} didn't start in ${timeout}ms`))
        return
      }
      setTimeout(check, 800)
    }
    check()
  })
}

// ── Start Next.js ─────────────────────────────────────────────────────────────
function startNext() {
  log('Starting Next.js server...')
  const cwd = NEXT_ROOT

  // Use 'next start' (production) if packaged, otherwise spawn via npm
  const args = IS_PACKAGED
    ? [path.join(RESOURCES, 'node_modules', 'next', 'dist', 'bin', 'next'), 'start', '--port', String(NEXT_PORT)]
    : ['run', 'start', '--', '--port', String(NEXT_PORT)]

  const cmd = IS_PACKAGED ? process.execPath : 'npm'

  nextProc = spawn(IS_PACKAGED ? 'node' : cmd, IS_PACKAGED ? args : args, {
    cwd,
    env: { ...process.env, PORT: String(NEXT_PORT), NODE_ENV: 'production' },
    shell: !IS_PACKAGED,
    windowsHide: true
  })

  nextProc.stdout?.on('data', (d) => log(`[Next] ${d.toString().trim()}`))
  nextProc.stderr?.on('data', (d) => log(`[Next ERR] ${d.toString().trim()}`))
  nextProc.on('exit', (code) => log(`[Next] exited with code ${code}`))
}

// ── Start Python Backend ──────────────────────────────────────────────────────
function startPython() {
  log('Starting Python backend...')
  const python = process.platform === 'win32' ? 'python' : 'python3'

  pythonProc = spawn(python, ['-m', 'uvicorn', 'main:app', '--port', String(BACKEND_PORT), '--host', '127.0.0.1'], {
    cwd: BACKEND_DIR,
    env: { ...process.env, PYTHONPATH: BACKEND_DIR },
    windowsHide: true
  })

  pythonProc.stdout?.on('data', (d) => log(`[Python] ${d.toString().trim()}`))
  pythonProc.stderr?.on('data', (d) => log(`[Python ERR] ${d.toString().trim()}`))
  pythonProc.on('exit', (code) => log(`[Python] exited with code ${code}`))
}

// ── Cleanup ───────────────────────────────────────────────────────────────────
function killAll() {
  log('Shutting down child processes...')
  try { nextProc?.kill('SIGTERM') }   catch {}
  try { pythonProc?.kill('SIGTERM') } catch {}
}

// ── App Lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  log('App ready. Creating splash...')
  createSplash()

  // Start both servers in parallel
  startNext()
  startPython()

  try {
    // Wait for frontend then open window
    log('Waiting for Next.js to be ready...')
    await waitForServer(NEXT_PORT, 120000)
    log('Next.js is up! Opening main window...')
    createMainWindow()

    // Backend is optional — don't block UI for it
    waitForServer(BACKEND_PORT, 60000)
      .then(() => log('Python backend is up!'))
      .catch((e) => log(`[WARN] Backend not ready: ${e.message}`))

  } catch (err) {
    log(`FATAL: ${err.message}`)
    splashWindow?.close()
    dialog.showErrorBox(
      'TurkGateway — Startup Error',
      `The app servers failed to start.\n\n${err.message}\n\nCheck the log at:\n${logFile}`
    )
    app.quit()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    killAll()
    app.quit()
  }
})

app.on('before-quit', killAll)
app.on('activate', () => { if (!mainWindow) createMainWindow() })

// IPC: renderer can ask for app version, log path
ipcMain.handle('get-version', () => app.getVersion())
ipcMain.handle('get-log-path', () => logFile)
ipcMain.handle('open-log', () => shell.openPath(logFile))
