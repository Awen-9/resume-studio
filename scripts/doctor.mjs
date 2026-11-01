/* global console */

import { existsSync } from 'node:fs'
import process from 'node:process'
import { chromium } from 'playwright'
import 'dotenv/config'

const failures = []
const nodeMajor = Number(process.versions.node.split('.')[0])

if (nodeMajor < 20) {
  failures.push(`Node.js 20 or newer is required; found ${process.version}.`)
} else {
  console.log(`OK Node.js ${process.version}`)
}

const configuredChrome = process.env.CHROME_PATH?.trim()
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
let bundledChrome = ''
try {
  bundledChrome = chromium.executablePath()
} catch {
  bundledChrome = ''
}
const browserPath = [configuredChrome, bundledChrome, ...systemCandidates].find(
  (candidate) => candidate && existsSync(candidate),
)

if (browserPath && existsSync(browserPath)) {
  console.log(`OK Chromium browser: ${browserPath}`)
} else {
  failures.push(
    'No usable Chromium browser was found. Run `npm run setup` or set CHROME_PATH to a local Chrome executable.',
  )
}

if (process.env.HOST && process.env.HOST !== '127.0.0.1' && process.env.HOST !== 'localhost') {
  console.warn(`WARN HOST=${process.env.HOST}; resume data may be exposed beyond this computer.`)
} else {
  console.log(`OK local host: ${process.env.HOST ?? '127.0.0.1'}`)
}

if (failures.length > 0) {
  console.error('\nEnvironment check failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exitCode = 1
} else {
  console.log('Environment check passed.')
}
