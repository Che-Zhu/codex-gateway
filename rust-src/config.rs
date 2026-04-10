use std::env;
use std::path::PathBuf;
use std::time::Duration;

#[derive(Debug, Clone)]
pub struct ClientInfo {
    pub name: String,
    pub title: String,
    pub version: String,
}

#[derive(Debug, Clone)]
pub struct AppConfig {
    pub host: String,
    pub port: u16,
    pub bridge_cwd: PathBuf,
    pub public_dir: PathBuf,
    pub codex_bin: String,
    pub debug: bool,
    pub default_model: Option<String>,
    pub max_sessions: usize,
    pub session_ttl: Duration,
    pub session_sweep_interval: Duration,
    pub client_info: ClientInfo,
}

impl AppConfig {
    pub fn from_env(root_dir: PathBuf) -> Self {
        let public_dir = root_dir.join("public");

        Self {
            host: read_env("HOST").unwrap_or_else(|| "0.0.0.0".to_string()),
            port: read_u16("PORT").unwrap_or(1317),
            bridge_cwd: read_env("CODEX_CWD")
                .map(PathBuf::from)
                .unwrap_or_else(|| root_dir.clone()),
            public_dir,
            codex_bin: read_env("CODEX_BIN").unwrap_or_else(|| "codex".to_string()),
            debug: env::var("DEBUG").ok().as_deref() == Some("1"),
            default_model: read_env("CODEX_MODEL"),
            max_sessions: read_usize("MAX_SESSIONS").unwrap_or(12),
            session_ttl: Duration::from_millis(
                read_u64("SESSION_TTL_MS").unwrap_or(30 * 60 * 1000),
            ),
            session_sweep_interval: Duration::from_millis(
                read_u64("SESSION_SWEEP_INTERVAL_MS").unwrap_or(60 * 1000),
            ),
            client_info: ClientInfo {
                name: "codex_gateway_web".to_string(),
                title: "Codex Gateway Web".to_string(),
                version: env!("CARGO_PKG_VERSION").to_string(),
            },
        }
    }
}

fn read_env(name: &str) -> Option<String> {
    let value = env::var(name).ok()?;
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn read_u16(name: &str) -> Option<u16> {
    read_env(name)?.parse().ok()
}

fn read_u64(name: &str) -> Option<u64> {
    read_env(name)?.parse().ok().filter(|value| *value > 0)
}

fn read_usize(name: &str) -> Option<usize> {
    read_env(name)?.parse().ok().filter(|value| *value > 0)
}
