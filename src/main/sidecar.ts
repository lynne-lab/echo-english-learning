import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, type WriteStream } from 'node:fs'
import { join } from 'node:path'

const SIDECAR_PORT = 8765
const SIDECAR_URL = `http://127.0.0.1:${SIDECAR_PORT}`

let sidecar: ChildProcess | null = null
let sidecarLog: WriteStream | null = null

export function getSidecarUrl(): string {
  return SIDECAR_URL
}

export function getDataDir(): string {
  const dir = app.isPackaged
    ? join(app.getPath('userData'), 'data')
    : join(app.getAppPath(), 'data')
  mkdirSync(dir, { recursive: true })
  return dir
}

function getPythonExe(): string {
  const venvPython = join(app.getAppPath(), '.venv', 'Scripts', 'python.exe')
  if (existsSync(venvPython)) return venvPython
  return process.platform === 'win32' ? 'python.exe' : 'python3'
}

function getSidecarLaunch(dataDir: string): {
  command: string
  args: string[]
  cwd: string
} {
  const commonArgs = ['--port', String(SIDECAR_PORT), '--data-dir', dataDir]
  if (app.isPackaged) {
    const sidecarDir = join(process.resourcesPath, 'sidecar')
    return {
      command: join(sidecarDir, 'echo-sidecar.exe'),
      args: commonArgs,
      cwd: sidecarDir
    }
  }
  return {
    command: getPythonExe(),
    args: ['-m', 'sidecar.app.main', ...commonArgs],
    cwd: app.getAppPath()
  }
}

async function isSidecarUp(timeoutMs = 1200): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const res = await fetch(`${SIDECAR_URL}/api/health`, { signal: controller.signal })
    clearTimeout(timer)
    return res.ok
  } catch {
    return false
  }
}

export async function startSidecar(): Promise<void> {
  if (await isSidecarUp()) {
    console.log('[sidecar] an existing engine is already running')
    return
  }

  const dataDir = getDataDir()
  const logDir = join(dataDir, 'logs')
  mkdirSync(logDir, { recursive: true })
  sidecarLog = createWriteStream(join(logDir, 'sidecar.log'), { flags: 'a' })

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PYTHONUNBUFFERED: '1',
    PYTHONIOENCODING: 'utf-8',
    APP_DATA_DIR: dataDir
  }
  // Hugging Face 在国内直连较慢；用户可通过环境变量覆盖。
  if (!env.HF_ENDPOINT) env.HF_ENDPOINT = 'https://hf-mirror.com'

  if (app.isPackaged) {
    const bundledBin = join(process.resourcesPath, 'bin')
    if (existsSync(bundledBin)) {
      env.PATH = `${bundledBin};${env.PATH ?? ''}`
    }
  }

  const launch = getSidecarLaunch(dataDir)
  console.log(`[sidecar] starting: ${launch.command}`)
  sidecar = spawn(launch.command, launch.args, {
    cwd: launch.cwd,
    env,
    windowsHide: true
  })

  sidecar.stdout?.on('data', (chunk: Buffer) => {
    process.stdout.write(`[sidecar] ${chunk.toString()}`)
    sidecarLog?.write(chunk)
  })
  sidecar.stderr?.on('data', (chunk: Buffer) => {
    process.stderr.write(`[sidecar] ${chunk.toString()}`)
    sidecarLog?.write(chunk)
  })
  sidecar.on('error', (error) => {
    console.error('[sidecar] spawn error:', error)
  })
  sidecar.on('exit', (code) => {
    console.log(`[sidecar] exited with code ${code}`)
    sidecar = null
  })

  for (let i = 0; i < 120; i++) {
    if (await isSidecarUp()) {
      console.log('[sidecar] ready')
      return
    }
    if (!sidecar) {
      console.error('[sidecar] process exited before becoming healthy')
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  console.error('[sidecar] did not become healthy within 60s')
}

export function stopSidecar(): void {
  if (!sidecar) return
  const pid = sidecar.pid
  sidecar = null
  if (!pid) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/t', '/f'], { windowsHide: true })
  } else {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      /* ignore */
    }
  }
  sidecarLog?.end()
  sidecarLog = null
}

export function getAppInfo(): {
  version: string
  dataDir: string
  sidecarUrl: string
  platform: string
} {
  return {
    version: app.getVersion(),
    dataDir: getDataDir(),
    sidecarUrl: SIDECAR_URL,
    platform: process.platform
  }
}
