/* global console */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import process from 'node:process'
import 'dotenv/config'

const systemCandidates =
  process.platform === 'darwin'
    ? [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
      ]
    : process.platform === 'win32'
      ? [
          `${process.env.PROGRAMFILES ?? 'C:/Program Files'}/Google/Chrome/Application/chrome.exe`,
          `${process.env.LOCALAPPDATA ?? 'C:/Users/Default/AppData/Local'}/Google/Chrome/Application/chrome.exe`,
        ]
      : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']

const configuredChrome = process.env.CHROME_PATH?.trim()
const systemChrome = [configuredChrome, ...systemCandidates].find(
  (candidate) => candidate && existsSync(candidate),
)

if (systemChrome) {
  console.log(`Found a system Chromium browser at ${systemChrome}; skipping browser download.`)
  console.log('Setup complete. Run `npm run doctor` and then `npm run dev`.')
  process.exit(0)
}

const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx'

console.log('Installing the Playwright-managed Chromium browser...')
const result = spawnSync(npxCommand, ['playwright', 'install', 'chromium'], {
  stdio: 'inherit',
  shell: false,
})

if (result.error) {
  console.error(`Unable to run ${npxCommand}: ${result.error.message}`)
  process.exit(1)
}

if (result.status !== 0) {
  process.exit(result.status ?? 1)
}

console.log('Setup complete. Run `npm run doctor` and then `npm run dev`.')
