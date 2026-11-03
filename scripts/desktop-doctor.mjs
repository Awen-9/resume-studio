/* global console */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

/**
 * 桌面端（Tauri）打包前置检查。
 *
 * `npm run tauri:build` 的报错通常只有一句 "program not found"（缺 cargo）或链接阶段的
 * 一堆 LNK 错误（缺 MSVC），很难看出到底要装什么。这个脚本把每个前置条件单独检查、
 * 给出对应的安装命令，并在缺东西时返回非 0，方便直接判断「这台机器现在能不能出安装包」。
 */

const failures = []
const notes = []

const hasCommand = (command, args = ['--version']) => {
  try {
    const output = execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return output.trim().split('\n')[0]
  } catch {
    return ''
  }
}

const projectRoot = process.cwd()
const tauriDir = path.join(projectRoot, 'src-tauri')
const platform = process.platform

console.log(`Platform: ${platform} (${process.arch})`)

if (!existsSync(tauriDir)) {
  failures.push('找不到 src-tauri 目录，这个仓库可能不是 Tauri 项目。')
} else {
  const configPath = path.join(tauriDir, 'tauri.conf.json')
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf8'))
    const targets = config.bundle?.targets ?? 'all'
    console.log(`OK 桌面端配置：bundle.targets=${JSON.stringify(targets)}`)
  } catch (error) {
    failures.push(`src-tauri/tauri.conf.json 读取失败：${error.message}`)
  }
}

// 1. Rust 工具链（所有平台都需要）
const cargo = hasCommand('cargo')
const rustc = hasCommand('rustc')
if (cargo && rustc) {
  console.log(`OK ${rustc}`)
  console.log(`OK cargo ${cargo.replace(/^cargo\s+/, '')}`)
} else {
  failures.push(
    platform === 'win32'
      ? '缺少 Rust 工具链（cargo）。安装：winget install Rustlang.Rustup（装完重开终端）'
      : '缺少 Rust 工具链（cargo）。安装：curl https://sh.rustup.rs -sSf | sh',
  )
}

if (platform === 'win32') {
  // 2. MSVC 链接器：Rust 的 windows-msvc 目标必须有 link.exe
  const vswhere = `${process.env['ProgramFiles(x86)'] ?? 'C:/Program Files (x86)'}/Microsoft Visual Studio/Installer/vswhere.exe`
  const linkExe = hasCommand('where', ['link.exe'])
  let msvcInfo = ''
  if (existsSync(vswhere)) {
    try {
      msvcInfo = execFileSync(
        vswhere,
        [
          '-latest',
          '-products',
          '*',
          '-requires',
          'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
          '-property',
          'installationPath',
        ],
        { encoding: 'utf8' },
      ).trim()
    } catch {
      msvcInfo = ''
    }
  }
  if (msvcInfo) {
    console.log(`OK MSVC 工具链：${msvcInfo}`)
  } else if (linkExe) {
    console.log('OK link.exe 在 PATH 上')
  } else {
    failures.push(
      '缺少 MSVC 生成工具（C++ 生成工具 + Windows SDK）。安装：winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"（需要管理员权限）',
    )
  }

  // 3. WebView2 运行时：Tauri 在 Windows 上的渲染依赖
  try {
    const key =
      'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
    const version = execFileSync('reg', ['query', key, '/v', 'pv'], { encoding: 'utf8' })
    const match = version.match(/pv\s+REG_SZ\s+(\S+)/)
    console.log(`OK WebView2 运行时：${match?.[1] ?? '已安装'}`)
  } catch {
    failures.push(
      '缺少 WebView2 运行时。Win10/11 通常自带；没有时安装：winget install Microsoft.EdgeWebView2Runtime',
    )
  }

  // 4. 生成 MSI 需要 WiX，生成 NSIS 需要 nsis：Tauri 会自己下载到缓存，但要有网络
  notes.push('首次打包会下载 WiX / NSIS 到本地缓存，需要能访问外网。')
  notes.push(
    'Windows 的“签名”是 Authenticode：需要 OV/EV 代码签名证书，在 tauri.conf.json 的 bundle.windows 里配置。',
  )
  notes.push(
    '若要产出 MSI + NSIS：npm run tauri:build（产物在 src-tauri/target/release/bundle/）。',
  )
} else if (platform === 'darwin') {
  const xcode = hasCommand('xcode-select', ['-p'])
  if (xcode) console.log(`OK Xcode 命令行工具：${xcode}`)
  else failures.push('缺少 Xcode 命令行工具。安装：xcode-select --install')

  if (existsSync('/usr/bin/hdiutil')) console.log('OK hdiutil（生成 DMG 需要）')
  else failures.push('缺少 hdiutil，无法生成 DMG。')

  notes.push(
    'macOS 的“签名”是 Developer ID + 公证（notarytool），需要在 Apple 开发者账号下配置证书。',
  )
  notes.push('产物：src-tauri/target/release/bundle/dmg/*.dmg 与 macos/Resume Studio.app。')
} else {
  const pkgConfig = hasCommand('pkg-config', ['--version'])
  if (pkgConfig) console.log(`OK pkg-config ${pkgConfig}`)
  else failures.push('缺少 pkg-config（Tauri 在 Linux 上需要）。')
  notes.push('Linux 产物为 AppImage / deb / rpm，需要 webkit2gtk 等系统依赖。')
}

if (notes.length > 0) {
  console.log('\n说明：')
  for (const note of notes) console.log(`- ${note}`)
}

if (failures.length > 0) {
  console.error('\n桌面端打包环境未就绪：')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exitCode = 1
} else {
  console.log('\n桌面端打包环境已就绪，可以执行 `npm run tauri:build`。')
}
