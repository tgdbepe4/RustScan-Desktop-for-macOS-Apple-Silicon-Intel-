use std::net::IpAddr;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use rustscan::input::ScanOrder;
use rustscan::port_strategy::PortStrategy;
use rustscan::scanner::{PortStatus, Scanner};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::{watch, Semaphore};

use crate::services::{probe, service_name, udp_service};
use crate::targets::{parse_ports, preview, resolve_targets, TargetPreview};

#[derive(Default)]
pub struct AppState {
    pub cancel: Arc<Mutex<Option<watch::Sender<bool>>>>,
    pub running: Arc<AtomicBool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanParams {
    pub targets: String,
    #[serde(default)]
    pub ports_mode: String,
    #[serde(default)]
    pub port_spec: String,
    #[serde(default = "default_batch")]
    pub batch: usize,
    #[serde(default = "default_timeout")]
    pub timeout: u64,
    #[serde(default = "default_tries")]
    pub tries: u8,
    #[serde(default)]
    pub exclude: String,
    #[serde(default)]
    pub order: String,
    #[serde(default)]
    pub interval: u64,
    #[serde(default = "default_max_hosts")]
    pub max_hosts: usize,
    #[serde(default)]
    pub udp: bool,
    #[serde(default = "default_true")]
    pub probe: bool,
}

fn default_batch() -> usize { 1000 }
fn default_timeout() -> u64 { 1000 }
fn default_tries() -> u8 { 1 }
fn default_max_hosts() -> usize { 1024 }
fn default_true() -> bool { true }

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanStarted {
    pub scan_id: String,
    pub hosts: usize,
    pub ports: usize,
    pub total: u64,
    pub batch: usize,
    pub timeout: u64,
    pub udp: bool,
    pub probe: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub scanned: u64,
    pub total: u64,
    pub open: u64,
    pub elapsed_ms: u64,
    pub rate: f64,
    pub phase: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortHit {
    pub id: u64,
    pub host: String,
    pub port: u16,
    pub proto: String,
    pub service: String,
    pub latency_ms: u64,
    pub banner: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanDone {
    pub cancelled: bool,
    pub elapsed_ms: u64,
    pub hosts: usize,
    pub ports: usize,
    pub total: u64,
    pub scanned: u64,
    pub open: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ScanLog {
    pub level: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewResult {
    pub hosts: u64,
    pub ips: Vec<String>,
    pub truncated: bool,
}

fn emit<T: Serialize + Clone>(app: &AppHandle, event: &str, payload: T) {
    let _ = app.emit(event, payload);
}

fn log(app: &AppHandle, level: &str, message: impl Into<String>) {
    emit(app, "scan://log", ScanLog { level: level.to_string(), message: message.into() });
}

fn scan_id() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("NC-{:X}", now & 0xFFFFFF)
}

#[tauri::command]
pub async fn preview_targets(text: String) -> Result<PreviewResult, String> {
    let p: TargetPreview = preview(&text);
    Ok(PreviewResult { hosts: p.hosts, ips: p.ips, truncated: p.truncated })
}

#[tauri::command]
pub async fn start_scan(
    app: AppHandle,
    state: State<'_, AppState>,
    params: ScanParams,
) -> Result<ScanStarted, String> {
    let running = state.running.clone();
    let cancel_slot = state.cancel.clone();

    if running.load(Ordering::SeqCst) {
        return Err("a sweep is already running".into());
    }

    let hosts = resolve_targets(&params.targets, params.max_hosts).await?;
    if hosts.is_empty() {
        return Err("no targets could be resolved".into());
    }
    let ports = parse_ports(&params.ports_mode, &params.port_spec)?;
    if ports.is_empty() {
        return Err("port vector is empty".into());
    }
    let exclude = if params.exclude.trim().is_empty() {
        Vec::new()
    } else {
        crate::targets::parse_port_spec(&params.exclude)?
    };
    let total = hosts.len() as u64 * ports.len() as u64;
    if total > 8_000_000 {
        return Err(format!(
            "sweep is too large: {} sockets (limit 8,000,000). Narrow the target block or port range.",
            total
        ));
    }
    let batch = params.batch.clamp(1, 20_000);
    let timeout_ms = params.timeout.clamp(10, 10_000);
    let tries = params.tries.clamp(1, 10);

    if running.swap(true, Ordering::SeqCst) {
        return Err("a sweep is already running".into());
    }

    let (tx, rx) = watch::channel(false);
    *cancel_slot.lock().unwrap() = Some(tx);

    let started = ScanStarted {
        scan_id: scan_id(),
        hosts: hosts.len(),
        ports: ports.len(),
        total,
        batch,
        timeout: timeout_ms,
        udp: params.udp,
        probe: params.probe,
    };

    emit(&app, "scan://started", started.clone());

    let app2 = app.clone();
    let hosts2 = hosts.clone();
    let ports2 = ports.clone();
    let params2 = params.clone();
    tauri::async_runtime::spawn(async move {
        run_scan(app2, hosts2, ports2, exclude, params2, rx).await;
    });

    log(&app, "info", format!(
        "engine armed: {} hosts / {} ports / {} sockets // batch {} / timeout {}ms / tries {}",
        hosts.len(), ports.len(), total, batch, timeout_ms, tries
    ));
    Ok(started)
}

#[tauri::command]
pub async fn cancel_scan(state: State<'_, AppState>) -> Result<bool, String> {
    let sent = if let Some(tx) = state.cancel.lock().unwrap().as_ref() {
        tx.send(true).is_ok()
    } else {
        false
    };
    Ok(sent)
}

async fn run_scan(
    app: AppHandle,
    hosts: Vec<IpAddr>,
    ports: Vec<u16>,
    exclude: Vec<u16>,
    params: ScanParams,
    mut rx: watch::Receiver<bool>,
) {
    let state = app.state::<AppState>();
    let running = state.running.clone();
    let cancel_slot = state.cancel.clone();

    let started = Instant::now();
    let total = hosts.len() as u64 * ports.len() as u64;
    let batch = params.batch.clamp(1, 20_000);
    let timeout_ms = params.timeout.clamp(10, 10_000);
    let tries = params.tries.clamp(1, 10);
    let proto = if params.udp { "udp" } else { "tcp" };
    let order = if params.order.eq_ignore_ascii_case("serial") {
        ScanOrder::Serial
    } else {
        ScanOrder::Random
    };
    let interval = if params.interval > 0 {
        Some(Duration::from_millis(params.interval))
    } else {
        None
    };

    // Keep roughly 20k sockets per chunk. That bounds progress latency while
    // leaving the RustScan async engine to run each chunk at full concurrency.
    let chunk_ports = ((20_000 / hosts.len().max(1)).clamp(16, 4096)).min(ports.len().max(1));

    let sem = Arc::new(Semaphore::new(128));
    let seq = Arc::new(AtomicU64::new(0));
    let mut probe_tasks = Vec::new();
    let mut scanned: u64 = 0;
    let mut open: u64 = 0;
    let mut cancelled = false;
    let chunks = ports.len().div_ceil(chunk_ports);

    emit(&app, "scan://progress", ScanProgress {
        scanned: 0, total, open: 0, elapsed_ms: 0, rate: 0.0, phase: "SWEEPING".into(),
    });
    log(&app, "info", format!(
        "sweep geometry: {} chunk(s) of {} ports // random={} // interval={}ms",
        chunks, chunk_ports, !matches!(order, ScanOrder::Serial), params.interval
    ));

    for (chunk_idx, slice) in ports.chunks(chunk_ports).enumerate() {
        if *rx.borrow() {
            cancelled = true;
            break;
        }

        let strategy = PortStrategy::pick(&None, Some(slice.to_vec()), order);
        let mut scanner = Scanner::new(
            &hosts,
            batch,
            Duration::from_millis(timeout_ms),
            tries,
            true,
            strategy,
            true,
            exclude.clone(),
            params.udp,
        );
        if let Some(iv) = interval {
            scanner = scanner.with_interval(iv);
        }

        let future = scanner.run_with_status();
        let result = tokio::select! {
            r = future => Some(r),
            _ = rx.changed() => None,
        };

        let Some(statuses) = result else {
            cancelled = true;
            break;
        };

        for status in statuses {
            let PortStatus::Open(socket) = status else { continue };
            open += 1;
            let ip = socket.ip();
            let port = socket.port();

            if params.udp || !params.probe {
                let id = seq.fetch_add(1, Ordering::Relaxed) + 1;
                let svc = if params.udp { udp_service(port) } else { service_name(port, false).to_string() };
                emit(&app, "scan://result", PortHit {
                    id,
                    host: ip.to_string(),
                    port,
                    proto: proto.to_string(),
                    service: svc,
                    latency_ms: 0,
                    banner: String::new(),
                });
                continue;
            }

            let app3 = app.clone();
            let sem3 = sem.clone();
            let seq3 = seq.clone();
            probe_tasks.push(tauri::async_runtime::spawn(async move {
                let _permit = sem3.acquire_owned().await.ok();
                let info = probe(ip, port, timeout_ms).await;
                let id = seq3.fetch_add(1, Ordering::Relaxed) + 1;
                let _ = app3.emit("scan://result", PortHit {
                    id,
                    host: ip.to_string(),
                    port,
                    proto: "tcp".to_string(),
                    service: info.service,
                    latency_ms: info.latency_ms,
                    banner: info.banner,
                });
            }));
        }

        scanned = (scanned + slice.len() as u64 * hosts.len() as u64).min(total);
        let elapsed = started.elapsed().as_millis() as u64;
        emit(&app, "scan://progress", ScanProgress {
            scanned,
            total,
            open,
            elapsed_ms: elapsed,
            rate: scanned as f64 / (elapsed as f64 / 1000.0).max(0.001),
            phase: "SWEEPING".into(),
        });

        if chunk_idx % 8 == 0 {
            log(&app, "info", format!(
                "sweep {}/{} // {} sockets // {} open",
                chunk_idx + 1, chunks, scanned, open
            ));
        }
    }

    if cancelled {
        log(&app, "warn", "cancellation signal received // dropping in-flight sockets");
        for task in &probe_tasks {
            task.abort();
        }
    } else if !probe_tasks.is_empty() {
        emit(&app, "scan://progress", ScanProgress {
            scanned,
            total,
            open,
            elapsed_ms: started.elapsed().as_millis() as u64,
            rate: scanned as f64 / (started.elapsed().as_secs_f64()).max(0.001),
            phase: "FINGERPRINTING".into(),
        });
        log(&app, "info", format!("sweep done // fingerprinting {} open services", probe_tasks.len()));
    }

    for task in probe_tasks {
        let _ = task.await;
    }

    let elapsed_ms = started.elapsed().as_millis() as u64;
    running.store(false, Ordering::SeqCst);
    *cancel_slot.lock().unwrap() = None;

    emit(&app, "scan://done", ScanDone {
        cancelled,
        elapsed_ms,
        hosts: hosts.len(),
        ports: ports.len(),
        total,
        scanned,
        open,
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scan_id_has_prefix() {
        assert!(scan_id().starts_with("NC-"));
    }
}
