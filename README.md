# Resume Studio

[中文](./README.md) | [English](./README.en.md)

[![CI](https://github.com/Awen-9/resume-studio/actions/workflows/ci.yml/badge.svg)](https://github.com/Awen-9/resume-studio/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

一个本地优先的个人简历编辑器。它把简历内容、模板样式和 A4 排版分开管理，支持实时预览、本地自动保存和 PDF 导出。

项目定位是个人本地工具，不包含账号、付费、云同步、求职信、在线数据分析或职业测评。

## 当前内容

已实现：

- 本地简历列表和多份简历管理
- 新建、复制、重命名、删除简历
- 个人信息、教育经历、工作经历、项目经历、专业技能、个人总结、自定义模块
- 模块显示/隐藏、上下移动、删除和新增内容
- 富文本描述：粗体、斜体、无序列表、清除格式
- 经典黑白、紧凑单页、蓝色强调三套模板
- 字体、字号、行距、页边距、模块间距和页码设置
- A4 多页预览、实际容器测量、溢出提示和二次分页
- IndexedDB 本地自动保存、历史版本、快捷键保存、JSON 备份和恢复
- 本地 Playwright/Chromium PDF 导出服务
- DOCX/Word 导出服务
- PDF 简历导入：提取文字并识别姓名、联系方式和常见简历模块
- PDF 原文和模板结果并排确认，确认后才写入本地简历
- 导入确认页支持修改个人信息、移动/删除模块和新增自定义模块
- 导入头部智能排版：职位标题、姓名、联系方式、基本信息和当前职位分层展示
- 教育经历中的课程信息自动转换为要点列表
- 标准模式和一页模式，一页模式自动压缩字号、行距、边距和模块间距
- 一页优先与强制一页两种紧凑策略
- 导出前检查姓名、联系方式、空模块、页数和内容溢出
- 编辑器撤销/重做和模块拖拽排序
- 单元测试、浏览器端集成测试和导出接口验证
- 超长内容块的段落级自动拆分（单条经历跨页时按句子边界切分为「（续）」条目）
- 配色预设与字体预设快速换肤
- 环境自愈安装脚本（自动修复 rollup 原生包缺失与 macOS Gatekeeper 拦截）
- Tauri 桌面打包支持（`npm run tauri:build` 产出约 10 MB 的原生应用）

当前没有实现：

- 扫描版 PDF 的 OCR 导入（OCR 状态检测已就绪，识别需安装 Tesseract）
- 自定义拖拽画布、任意定位和图片编辑
- 模板在线下载和模板编辑器
- 云端同步、登录、分享链接和跨设备访问
- AI 内容优化、ATS 评分和求职投递管理
- 桌面端 sidecar 二进制化（当前桌面包依赖系统 Node 运行时）
- Docker 镜像

## 技术栈

- Vue 3 + TypeScript + Vite
- Pinia：编辑状态管理
- Tiptap：结构化富文本编辑
- 共享简历渲染器：预览和 PDF 导出使用同一份分页与 HTML 模型
- Fastify：本地导出 API
- `@fastify/multipart` + `pdfjs-dist`：本地 PDF 上传和文字提取
- Playwright：Chromium PDF 渲染
- Vitest：单元测试
- Playwright Test：端到端测试
- ESLint + Prettier：代码规范

## 环境要求

- Node.js 20 或更高版本
- npm 10 或更高版本
- 可用的 Chromium 浏览器（推荐使用项目管理的 Playwright Chromium）

项目会优先使用 `CHROME_PATH` 或系统 Chrome；未找到时使用 Playwright 管理的 Chromium。跨平台初始化请执行 `npm run setup`。如果只想使用本机 Chrome，可以在 `.env` 中设置 `CHROME_PATH`。

## 安装与启动

首次从 GitHub 克隆后，在项目目录执行：

```bash
git clone <你的仓库地址>
cd resume-studio
npm ci
npm run setup
npm run doctor
npm run dev
```

启动后打开 `http://127.0.0.1:5173`。`npm run dev` 会同时启动 Vite 前端 `5173` 和 PDF 导出服务 `4173`。

如果不需要使用自定义端口，可以不创建 `.env`。需要修改端口或浏览器路径时，复制环境模板：

```bash
cp .env.example .env
```

`.env` 已被 Git 忽略，不要把个人路径、私有配置或简历数据提交到仓库。

初始化命令说明：

- `npm run setup`：安装 Playwright Chromium，只需在新电脑或 CI 环境执行一次；同时会自动修复常见的原生依赖缺失问题。
- `npm run doctor`：检查 Node.js、浏览器和本机监听配置。
- `npm run dev`：同时启动前端和本地 API 服务。

## 常见问题

### 启动时报 `Cannot find module @rollup/rollup-darwin-arm64`

这是 npm 在 macOS Apple Silicon 上漏装可选依赖的已知 bug。`npm run setup` 会自动补装，也可以手动执行：

```bash
npm install @rollup/rollup-darwin-arm64 --no-save
```

### macOS 弹出「无法验证开发者」提示（fsevents.node）

这是系统 Gatekeeper 对未签名原生模块的正常拦截，不是安全问题。请在弹窗中点击「取消」，然后执行 `npm run setup`（会自动清除隔离标记）。请勿点击「移到废纸篓」，否则会删除前端热更新所需模块。

### 导入扫描版 PDF 提示需要 OCR

扫描版（纯图片）PDF 无法直接提取文字，需要安装 Tesseract：

```bash
# macOS
brew install tesseract

# 安装后确认可用
tesseract --version
```

如果 Tesseract 不在默认 `PATH`，可在 `.env` 中设置 `TESSERACT_CMD=/path/to/tesseract`。查看当前 OCR 状态可访问 `http://127.0.0.1:4173/api/ocr/status`。

只启动前端：

```bash
npm run dev:web
```

只启动导出服务：

```bash
npm run server:dev
```

## 生产构建

```bash
npm run build
npm run start
```

生产模式下，Fastify 会同时提供 `dist/` 前端静态文件和 `/api/export/pdf` 接口。

健康检查：

```bash
curl http://127.0.0.1:4173/api/health
```

## 使用方式

1. 在首页点击“新建简历”或选择一个模板。
2. 左侧选择教育、工作、项目等内容模块。
3. 右侧属性面板修改个人信息、内容和页面样式。
4. 中间 A4 纸张实时预览排版结果。
5. 需要紧凑排版时，在属性面板切换“一页优先”或“强制一页”。
6. 使用顶部“导出 PDF”或“导出 Word”，检查通过后生成文件。
7. 在属性面板调整强调色，并可以保存/恢复当前模板样式。
8. 使用首页“导出备份”保存本地 JSON，换机器时通过“导入备份”恢复。

内容默认保存在浏览器本机的 IndexedDB 中，旧版本的 `localStorage` 数据会在首次启动时迁移；测试环境或不支持 IndexedDB 的环境会自动回退到 `localStorage`。应用没有远程数据上传逻辑；PDF 导入和生成请求只发送到本机的 `127.0.0.1` 导出服务。

导入 PDF 时，应用会提取文字并根据“教育经历”“工作经历”“项目经历”“专业技能”等标题建立模块。确认页左侧显示 PDF 原文，右侧显示模板结果，并保留“打开原文件”入口。姓名、手机号和邮箱会填入个人信息；类似“职位 + 姓名”“年龄/性别/学校”“当前职位”的顶部内容会按简历头部层级重新排版；教育经历中的“相关课程”会转换成要点列表。扫描版或只有图片的 PDF 会提示 OCR 引擎状态；当前环境需安装 Tesseract 后才能执行 OCR。

## 测试与校验

```bash
npm test              # 单元测试
npm run lint          # ESLint
npm run format:check  # Prettier
npm run test:e2e      # 浏览器集成测试
npm run test:all      # 单元测试、构建和集成测试
npm run typecheck     # 前端和服务端 TypeScript 类型检查
npm run format        # 自动格式化
```

当前测试覆盖：文档结构校验、必填字段、重复 id、标准/一页分页、导出前检查、富文本清理、隐藏模块、本地保存加载删除、历史版本、JSON 备份恢复、PDF 文本解析、真实中文 PDF 导入、浏览器创建编辑模板切换、历史版本面板、PDF 原文对照、导入确认、刷新恢复、PDF 导出请求和真实 PDF 输出。

真实 PDF 导入测试使用可选环境变量，不依赖仓库内的个人文件：

```bash
RESUME_FIXTURE_PDF=/absolute/path/to/resume.pdf npm test
```

如需增加姓名断言，可额外设置 `RESUME_FIXTURE_NAME`。没有设置文件时，该测试会跳过，其他导入和导出测试仍会执行。

## 目录结构

- `src/app`：应用启动、根组件和全局样式
- `src/domain/resume`：简历模型、默认值、导入解析、分页、导出检查和 HTML 渲染
- `src/features/home`：首页简历列表和模板入口
- `src/features/editor`：编辑器、属性面板、内容大纲、富文本和 A4 预览
- `src/features/import-review`：PDF 导入确认与修订
- `src/infrastructure/api`：浏览器调用本机 API 的适配器
- `src/infrastructure/storage`：IndexedDB、备份和模板样式持久化
- `src/infrastructure/export`：DOCX 渲染适配器
- `src/infrastructure/state`：Pinia 编辑状态
- `src/shared`：无业务依赖的浏览器工具
- `server/app.ts`：Fastify 应用组装
- `server/routes`：健康检查、PDF 导入、PDF/DOCX 导出和 OCR 状态路由
- `server/services`：PDF 文字提取、PDF 渲染和 Word 导出服务
- `server/index.ts`：唯一的本地服务启动入口
- `tests/unit`：Vitest 单元测试
- `tests/integration`：本地导入和导出接口测试
- `tests/e2e`：Playwright 浏览器流程测试

完整的依赖方向和扩展约定见 [`ARCHITECTURE.md`](./ARCHITECTURE.md)。历史版本用于兼容的 `src/lib`、`src/data`、`src/types`、`src/stores` 路径已移除，业务实现统一放在 `src/features` 与 `src/domain` 分层目录。

## GitHub 开源和换机

仓库已经包含锁定依赖的 `package-lock.json`、Node 版本文件、环境变量模板、CI 工作流、许可证和贡献说明。换电脑时不需要迁移 `node_modules`、`dist`、`dist-server` 或浏览器缓存，只需要重新安装依赖和浏览器：

```bash
git clone <你的仓库地址>
cd resume-studio
npm ci
npm run setup
npm run doctor
npm run dev
```

简历内容保存在浏览器本机，不会随着 Git 仓库同步。换机前请在首页使用“导出备份”生成 JSON 文件，通过安全方式转移后，在新电脑使用“导入备份”恢复。不要把导出的 JSON、个人 PDF、截图或 `.env` 提交到 GitHub。

发布到自己的 GitHub 仓库前，请把 README 顶部 CI 徽章中的 `your-org/resume-studio` 替换成真实的 `owner/repository`；如果不使用 GitHub Actions，也可以删除该徽章。许可证默认为 MIT，详见 [`LICENSE`](./LICENSE)。

更多协作约定见 [`CONTRIBUTING.md`](./CONTRIBUTING.md)，安全问题请按 [`SECURITY.md`](./SECURITY.md) 提交。

如果这是一个全新的本地目录，可以在确认没有个人文件后初始化并推送：

```bash
git init
git add .
git status
git commit -m "chore: prepare open-source release"
git branch -M main
git remote add origin https://github.com/<owner>/<repository>.git
git push -u origin main
```

推送前重点确认 `git status` 中没有简历 PDF、备份 JSON、截图、`.env`、`node_modules`、`dist` 或 `dist-server`。

## 代码规范

本项目按前端项目可执行的阿里开发规范原则落地：

- TypeScript 开启 `strict`、`noUnusedLocals`、`noUnusedParameters`
- 领域对象使用明确类型，不使用无约束的 `any`
- 函数保持单一职责，排版和存储逻辑不放入页面模板
- 业务命名使用完整英文语义，界面文案使用简洁中文
- 统一使用 ESLint 和 Prettier
- 组件通过 props/emits 通信，状态集中在 Pinia
- 数据结构包含 `schemaVersion`，方便未来迁移
- 本地服务只监听 `127.0.0.1`，避免个人简历数据暴露到局域网
- 导出前校验请求结构，富文本内容进行基础清理

## 后续建议

1. 完善扫描版 PDF 的 OCR 导入，并增加识别耗时与结果校对提示。
2. 增加 Electron 或 Tauri 打包，让用户不需要手动启动两个服务。
3. 在稳定的模板模型之上增加模板编辑能力。

## 依赖审计说明

Tiptap 已升级到 3.x，先前的中危审计告警已消除。当前剩余审计项集中在 vitest 开发依赖链（tinypool 等），不影响生产产物；升级 vitest 5 列入后续任务。应用只监听本机地址，并对导出富文本做基础清理。

## 桌面端打包

```bash
npm run tauri:build
```

需要 Rust 工具链（`rustup`）。产物输出到 `src-tauri/target/release/bundle/`，macOS 下为 `Resume Studio.app`（约 10 MB）。应用启动时会自动查找系统 Node 并拉起导出服务，退出时自动回收。
