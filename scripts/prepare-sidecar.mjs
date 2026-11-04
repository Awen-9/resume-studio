/**
 * 准备桌面端 sidecar：Node 运行时 + 后端 + 生产依赖。
 *
 * 不把后端编译成单文件（SEA/bun 都会在 Playwright 上翻车），而是：
 * 1. 下载固定版本的 Node 官方可执行文件，校验 SHA256；
 * 2. 把编译后的 dist-server、package.json、package-lock.json 放进 server-bundle，
 *    在目录里 npm ci --omit=dev，只装生产依赖；
 * 3. Tauri 把 Node 作为 externalBin、server-bundle 作为 resource 打进安装包。
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const NODE_VERSION = '24.22.2'
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BINARIES_DIR = path.join(ROOT, 'src-tauri', 'binaries')
const BUNDLE_DIR = path.join(ROOT, 'src-tauri', 'server-bundle')
const DOWNLOAD_DIR = path.join(tmpdir(), `resume-studio-node-${NODE_VERSION}`)
const DIST_URL = `https://nodejs.org/dist/v${NODE_VERSION}`

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')

const download = async (url, destination) => {
  console.log(`[sidecar] download ${url}`)
  const response = await fetch(url)
  if (!response.ok) throw new Error(`下载失败 ${response.status}: ${url}`)
  writeFileSync(destination, Buffer.from(await response.arrayBuffer()))
}

const loadShasums = async () => {
  const response = await fetch(`${DIST_URL}/SHASUMS256.txt`)
  if (!response.ok) throw new Error(`读取 SHASUMS256.txt 失败: ${response.status}`)
  const text = await response.text()
  const map = new Map()
  for (const line of text.split('\n')) {
    const match = line.trim().match(/^([0-9a-f]{64})\s+(.+)$/i)
    if (match) map.set(match[2], match[1].toLowerCase())
  }
  return map
}

const verify = (file, expected, label) => {
  if (!expected) throw new Error(`SHASUMS256.txt 里没有 ${label}`)
  const actual = sha256(file)
  if (actual !== expected) {
    throw new Error(`${label} 校验失败：期望 ${expected}，实际 ${actual}`)
  }
}

const ensureVerifiedDownload = async (entry, destination, shasums) => {
  if (existsSync(destination)) {
    verify(destination, shasums.get(entry), destination)
    console.log(`[sidecar] reuse ${path.basename(destination)}`)
    return destination
  }
  const temporary = path.join(DOWNLOAD_DIR, path.basename(entry))
  await download(`${DIST_URL}/${entry}`, temporary)
  verify(temporary, shasums.get(entry), entry)
  copyFileSync(temporary, destination)
  return destination
}

const prepareWindows = async (shasums) => {
  mkdirSync(BINARIES_DIR, { recursive: true })
  const target = path.join(BINARIES_DIR, 'node-x86_64-pc-windows-msvc.exe')
  await ensureVerifiedDownload('win-x64/node.exe', target, shasums)
}

const extractNode = (tarball, platformName) => {
  const extractDir = path.join(DOWNLOAD_DIR, platformName)
  rmSync(extractDir, { recursive: true, force: true })
  mkdirSync(extractDir, { recursive: true })
  execFileSync('tar', ['-xzf', tarball, '-C', extractDir], { stdio: 'inherit' })
  return path.join(extractDir, `node-v${NODE_VERSION}-${platformName}`, 'bin', 'node')
}

const prepareMacos = async (shasums) => {
  mkdirSync(BINARIES_DIR, { recursive: true })
  const targets = {
    'darwin-arm64': path.join(BINARIES_DIR, 'node-aarch64-apple-darwin'),
    'darwin-x64': path.join(BINARIES_DIR, 'node-x86_64-apple-darwin'),
  }

  for (const [platformName, target] of Object.entries(targets)) {
    const archiveName = `node-v${NODE_VERSION}-${platformName}.tar.gz`
    const archive = path.join(DOWNLOAD_DIR, archiveName)
    if (!existsSync(archive)) await download(`${DIST_URL}/${archiveName}`, archive)
    verify(archive, shasums.get(archiveName), archiveName)
    const node = extractNode(archive, platformName)
    copyFileSync(node, target)
    chmodSync(target, 0o755)
    console.log(`[sidecar] wrote ${target}`)
  }

  const universal = path.join(BINARIES_DIR, 'node-universal-apple-darwin')
  execFileSync(
    'lipo',
    ['-create', targets['darwin-arm64'], targets['darwin-x64'], '-output', universal],
    { stdio: 'inherit' },
  )
  // lipo 之后原签名失效，Apple Silicon 会拒绝运行未签名/签名无效的 arm64 程序。
  execFileSync('codesign', ['--force', '--sign', '-', universal], { stdio: 'inherit' })
  chmodSync(universal, 0o755)
  console.log(`[sidecar] wrote ${universal}`)
}

const prepareServerBundle = () => {
  console.log('[sidecar] build dist-server')
  execFileSync('npm', ['run', 'server:build'], { cwd: ROOT, stdio: 'inherit', shell: true })

  rmSync(BUNDLE_DIR, { recursive: true, force: true })
  mkdirSync(BUNDLE_DIR, { recursive: true })
  const distDir = path.join(ROOT, 'dist-server')
  for (const entry of readdirSync(distDir)) {
    cpSync(path.join(distDir, entry), path.join(BUNDLE_DIR, entry), { recursive: true })
  }
  for (const file of ['package.json', 'package-lock.json']) {
    copyFileSync(path.join(ROOT, file), path.join(BUNDLE_DIR, file))
  }

  console.log('[sidecar] npm ci --omit=dev')
  execFileSync('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: BUNDLE_DIR,
    stdio: 'inherit',
    shell: true,
  })

  const nativeModules = []
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.node')) nativeModules.push(full)
    }
  }
  walk(path.join(BUNDLE_DIR, 'node_modules'))
  if (nativeModules.length > 0) {
    console.error('[sidecar] 发现原生扩展（macOS universal 包里可能只有一种架构）：')
    for (const file of nativeModules) console.error(`  ${path.relative(BUNDLE_DIR, file)}`)
  } else {
    console.log('[sidecar] 没有 .node 原生扩展')
  }
}

const main = async () => {
  mkdirSync(DOWNLOAD_DIR, { recursive: true })
  const shasums = await loadShasums()
  if (process.platform === 'win32') await prepareWindows(shasums)
  else if (process.platform === 'darwin') await prepareMacos(shasums)
  else throw new Error('sidecar 目前只准备 Windows 和 macOS 的 Node')
  prepareServerBundle()
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
