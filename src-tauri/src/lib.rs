use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::Duration;
use tauri::Manager;

/// 内嵌 Fastify 导出服务的子进程句柄。应用退出时由 `on_window_event` 关闭。
struct ServerProcess(Mutex<Option<Child>>);

/// 导出服务监听的端口，与 `server/config.ts` 的默认值保持一致。
const EXPORT_PORT: u16 = 4173;

/// Windows 下隐藏 node 子进程的控制台窗口，避免打开应用时闪一个黑框。
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 安装包里自带的 node 运行时。
///
/// Tauri 打包 externalBin 时会去掉 `-<target-triple>` 后缀，把 `node`（Windows 是
/// `node.exe`）放在主程序同目录；不再回退到系统 Node。
fn bundled_node(exe_dir: &Path) -> Option<PathBuf> {
    let name = if cfg!(windows) { "node.exe" } else { "node" };
    let candidate = exe_dir.join(name);
    candidate.is_file().then_some(candidate)
}

/// 端口已被占用说明服务已在运行。
///
/// 早期实现用 `sh -c "curl …"`，Windows 上没有 `sh` 也没有 curl 保证，判断会静默失效。
/// 这里改成直接连 TCP，跨平台且不依赖外部命令。
fn export_server_running() -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], EXPORT_PORT));
    TcpStream::connect_timeout(&address, Duration::from_millis(300)).is_ok()
}

/// 启动本机 Fastify 导出服务（PDF/DOCX 导出、PDF 导入）。
///
/// 开发模式下前端由 Vite 提供服务，服务可独立用 `npm run server:dev` 启动；
/// 这里仅在桌面端启动。优先复用已运行的服务（端口已被占用时跳过），
/// 否则拉起 `node dist-server/server/index.js` 子进程。
fn start_export_server(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let resource_dir = app
        .path()
        .resource_dir()
        .expect("failed to resolve resource dir");

    let server_entry = resource_dir
        .join("server-bundle")
        .join("server")
        .join("index.js");
    if !server_entry.exists() {
        // 资源目录缺少已编译的服务入口时静默跳过，前端会提示服务未启动。
        eprintln!(
            "[resume-studio] export server entry not found: {}",
            server_entry.display()
        );
        return Ok(());
    }

    if export_server_running() {
        return Ok(());
    }

    let node = match std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.to_path_buf()))
        .and_then(|dir| bundled_node(&dir))
    {
        Some(node) => node,
        None => {
            // 安装包里缺少自带 node 时不要让应用崩掉：前端会显示“导出服务未启动”。
            eprintln!("[resume-studio] bundled node runtime not found; export server not started");
            return Ok(());
        }
    };

    let server_dir = server_entry
        .parent()
        .expect("server entry has no parent directory")
        .to_path_buf();

    // 将子进程的 stdout/stderr 写入日志文件，便于排查启动问题。
    let log_file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(app.path().app_log_dir()?.join("export-server.log"))
        .ok();

    let mut command = Command::new(&node);
    command
        .arg(&server_entry)
        .current_dir(&server_dir)
        .env("PORT", EXPORT_PORT.to_string())
        .env("HOST", "127.0.0.1")
        // 清除从宿主环境继承的代理变量，避免子进程网络初始化时走失效的本地代理隧道。
        .env_remove("HTTP_PROXY")
        .env_remove("HTTPS_PROXY")
        .env_remove("http_proxy")
        .env_remove("https_proxy")
        .env_remove("ALL_PROXY")
        .env_remove("all_proxy");

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    if let Some(file) = log_file {
        command.stdout(file.try_clone()?).stderr(file);
    }
    let child = command.spawn()?;

    let state = app.state::<ServerProcess>();
    *state.0.lock().unwrap() = Some(child);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ServerProcess(Mutex::new(None)))
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // 生产/打包环境下拉起导出服务；开发调试由 npm 脚本负责。
            if !cfg!(debug_assertions) {
                if let Err(error) = start_export_server(app.handle()) {
                    eprintln!("[resume-studio] failed to start export server: {error}");
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let app = window.app_handle();
                if let Some(state) = app.try_state::<ServerProcess>() {
                    if let Some(mut child) = state.0.lock().unwrap().take() {
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
