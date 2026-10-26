use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::Manager;

/// 内嵌 Fastify 导出服务的子进程句柄。应用退出时由 `on_window_event` 关闭。
struct ServerProcess(Mutex<Option<Child>>);

/// 查找可用的 Node.js 可执行文件。
///
/// macOS GUI 应用继承的 `PATH` 只有系统最小集，通常不含用户通过
/// Homebrew、nvm 等安装的 node，因此这里按常见路径逐一下探，
/// 再回退到裸 `node` 命令（依赖系统 PATH）。
fn find_node() -> Option<String> {
    let mut candidates: Vec<String> = vec![
        "/opt/homebrew/bin/node".to_string(),
        "/usr/local/bin/node".to_string(),
        "/usr/bin/node".to_string(),
    ];

    // 常见用户级安装位置：nvm 与 workbuddy 管理的 node 运行时。
    if let Ok(home) = std::env::var("HOME") {
        candidates.push(format!("{home}/.nvm/versions/node"));
        candidates.push(format!("{home}/.workbuddy/binaries/node/versions"));
    }

    for candidate in candidates {
        let path = std::path::Path::new(&candidate);
        if path.is_file() && is_executable(path) {
            return Some(candidate);
        }
        // 目录形式：取其中最新版本子目录下的 bin/node。
        if path.is_dir() {
            if let Some(node) = find_node_in_dir(path) {
                return Some(node);
            }
        }
    }
    Some("node".to_string())
}

fn is_executable(path: &std::path::Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path)
        .map(|meta| meta.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

/// 在版本目录（如 `~/.nvm/versions/node`）下递归查找 `bin/node`。
fn find_node_in_dir(dir: &std::path::Path) -> Option<String> {
    let entries = std::fs::read_dir(dir).ok()?;
    let mut version_dirs: Vec<std::path::PathBuf> = entries
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path.is_dir())
        .collect();
    // 版本号目录按名称倒序，取最新的。
    version_dirs.sort_by(|a, b| b.cmp(a));
    for version_dir in version_dirs {
        let node = version_dir.join("bin").join("node");
        if node.is_file() && is_executable(&node) {
            return Some(node.to_string_lossy().to_string());
        }
    }
    None
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

    let server_entry = resource_dir.join("server").join("server").join("index.js");
    if !server_entry.exists() {
        // 资源目录缺少已编译的服务入口时静默跳过，前端会提示服务未启动。
        eprintln!("[resume-studio] export server entry not found: {}", server_entry.display());
        return Ok(());
    }

    // 端口已被占用说明服务已在运行，无需重复拉起。
    if let Ok(output) = Command::new("sh")
        .arg("-c")
        .arg("curl -s http://127.0.0.1:4173/api/health")
        .output()
    {
        if output.status.success() {
            return Ok(());
        }
    }

    let node = find_node().expect("node runtime not found");
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

    let mut command = Command::new(node);
    command
        .arg(&server_entry)
        .current_dir(&server_dir)
        .env("PORT", "4173")
        .env("HOST", "127.0.0.1")
        // 清除从宿主环境继承的代理变量，避免子进程网络初始化时走失效的本地代理隧道。
        .env_remove("HTTP_PROXY")
        .env_remove("HTTPS_PROXY")
        .env_remove("http_proxy")
        .env_remove("https_proxy")
        .env_remove("ALL_PROXY")
        .env_remove("all_proxy");
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
