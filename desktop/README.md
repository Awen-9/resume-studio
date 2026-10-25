# Desktop Packaging

第三轮暂提供桌面端打包入口说明。当前仓库的前端和本地 PDF/DOCX 服务已经可以独立运行，桌面封装建议使用 Tauri 2。

环境要求：

- Rust stable
- Cargo
- Tauri CLI

安装工具链后，可以在项目根目录初始化 Tauri：

```bash
cargo install tauri-cli
cargo tauri init
```

推荐配置：

- `devUrl`: `http://127.0.0.1:5173`
- `beforeDevCommand`: `npm run dev`
- `frontendDist`: `../dist`
- 生产启动时由 Tauri sidecar 启动 `dist-server/server/index.js`

当前环境没有 Rust/Cargo，因此没有在本机生成或编译安装包；浏览器本地部署仍然是完整可用的。
