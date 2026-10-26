/* global console */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import 'dotenv/config'

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: false, ...options })
  if (result.error) {
    console.error(`Unable to run ${command}: ${result.error.message}`)
    process.exit(1)
  }
  return result.status ?? 0
}

/**
 * 修复 npm 在 macOS ARM64 上安装可选依赖（rollup 原生包）遗漏的已知 bug。
 * 表现为 `vite` / `rollup` 启动时报 `Cannot find module @rollup/rollup-darwin-arm64`。
 */
const ensureRollupNative = () => {
  const suffix =
    process.platform === 'darwin'
      ? process.arch === 'arm64'
        ? 'darwin-arm64'
        : 'darwin-x64'
      : null
  if (!suffix) return
  const moduleName = `@rollup/rollup-${suffix}`
  const modulePath = join('node_modules', '@rollup', `rollup-${suffix}`)
  if (existsSync(modulePath)) return

  console.log(`rollup 原生包缺失（npm 可选依赖 bug），正在补装 ${moduleName}...`)
  const status = run(npmCommand, ['install', moduleName, '--no-save'])
  if (status !== 0) {
    console.error(`补装 ${moduleName} 失败。可手动执行：npm install ${moduleName} --no-save`)
  }
}

/**
 * macOS Gatekeeper 会拦截未签名的原生模块（如 node_modules/fsevents/fsevents.node），
 * 弹窗提示"无法验证开发者"。这里自动清除隔离标记，避免首次运行被拦截。
 */
const clearQuarantine = () => {
  if (process.platform !== 'darwin') return
  const target = join('node_modules', 'fsevents', 'fsevents.node')
  if (!existsSync(target)) return

  // xattr 输出为空说明没有隔离标记，无需处理。
  const check = spawnSync('xattr', ['-p', 'com.apple.quarantine', target], { encoding: 'utf8' })
  if (check.status !== 0) return

  console.log('检测到 fsevents.node 携带隔离标记，正在清除以绕过 Gatekeeper 拦截...')
  const result = spawnSync('xattr', ['-d', 'com.apple.quarantine', target])
  if (result.status !== 0) {
    console.warn('清除隔离标记失败，首次运行可能弹出系统安全提示，请点击"取消"而非"移到废纸篓"。')
  }
}

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

ensureRollupNative()
clearQuarantine()

if (systemChrome) {
  console.log(`Found a system Chromium browser at ${systemChrome}; skipping browser download.`)
  console.log('Setup complete. Run `npm run doctor` and then `npm run dev`.')
  process.exit(0)
}

const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx'

console.log('Installing the Playwright-managed Chromium browser...')
const status = run(npxCommand, ['playwright', 'install', 'chromium'])
if (status !== 0) {
  process.exit(status)
}

console.log('Setup complete. Run `npm run doctor` and then `npm run dev`.')
