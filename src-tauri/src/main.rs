#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! main.rs — MARK's Tauri (Rust) backend.
//! ===========================================================================
//! The desktop side that the React UI talks to via `invoke(...)`. Responsibilities:
//!
//!   • Video serving: a tiny local HTTP server streams the chosen file so the
//!     <video> element can play it (get_video_url + VideoState).
//!   • Native file dialogs via `rfd` (preferred over the scoped JS fs/dialog
//!     plugins — full access, always-visible dialogs):
//!       - pick_video_file  → open a video
//!       - save_xlsx_file   → save the session export (.xlsx)
//!   • Collection-app bridge: finds the StatsBomb window, injects
//!     bridge_script.js (embedded at compile time via include_str!), and relays
//!     keystrokes/commands so MARK and the collection app stay frame-synced.
//!   • Google Sheets export (create_google_sheet) and misc helpers (open_file).
//!
//! All commands are registered in the `invoke_handler!` near the bottom; the JS
//! side calls them by their snake_case names.

use std::sync::{Arc, Mutex};
use tauri::command;
use futures_util::{SinkExt, StreamExt};
use tokio::net::TcpListener;
use tokio_tungstenite::accept_async;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

// Windows process flag: spawn child processes (ffmpeg, powershell, rundll32)
// WITHOUT creating/attaching a console window, so no cmd windows flash on screen.
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const BRIDGE_SCRIPT: &str = include_str!("bridge_script.js");

// ─── Shared video path state ──────────────────────────────────────────────────
struct VideoState {
    path: Arc<Mutex<Option<String>>>,
    port: Arc<Mutex<u16>>,
}

// ─── HTTP video server with range request support ─────────────────────────────
async fn start_video_server(video_path: Arc<Mutex<Option<String>>>) -> u16 {
    use axum::{
        extract::{Query, State},
        http::{HeaderMap, StatusCode},
        response::Response,
        routing::get,
        Router,
    };
    use std::collections::HashMap;

    type ServerState = Arc<Mutex<Option<String>>>;

    async fn serve_video(
        State(path_state): State<ServerState>,
        headers: HeaderMap,
        Query(params): Query<HashMap<String, String>>,
    ) -> Response<axum::body::Body> {
        use axum::body::Body;
        use http_range::HttpRange;
        use std::io::{Read, Seek, SeekFrom};

        let path = params.get("path")
            .cloned()
            .or_else(|| path_state.lock().unwrap().clone());

        let path = match path {
            Some(p) => p,
            None => return Response::builder()
                .status(StatusCode::NOT_FOUND)
                .body(Body::empty()).unwrap(),
        };

        let mut file = match std::fs::File::open(&path) {
            Ok(f) => f,
            Err(_) => return Response::builder()
                .status(StatusCode::NOT_FOUND)
                .body(Body::empty()).unwrap(),
        };

        let file_size = match file.metadata() {
            Ok(m) => m.len(),
            Err(_) => return Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .body(Body::empty()).unwrap(),
        };

        let mime = if path.ends_with(".mp4") { "video/mp4" }
            else if path.ends_with(".webm") { "video/webm" }
            else if path.ends_with(".mkv") { "video/x-matroska" }
            else if path.ends_with(".mov") { "video/quicktime" }
            else if path.ends_with(".avi") { "video/x-msvideo" }
            else if path.ends_with(".mts") || path.ends_with(".m2ts") { "video/mp2t" }
            else { "video/mp4" };

        // Handle Range request — the key to seekable video in WebView2
        if let Some(range_header) = headers.get("range") {
            if let Ok(range_str) = range_header.to_str() {
                if let Ok(ranges) = HttpRange::parse(range_str, file_size) {
                    let range = &ranges[0];
                    let start = range.start;
                    let length = range.length.min(file_size - start);
                    let end = start + length - 1;

                    let mut buf = vec![0u8; length as usize];
                    if file.seek(SeekFrom::Start(start)).is_ok()
                        && file.read_exact(&mut buf).is_ok()
                    {
                        return Response::builder()
                            .status(StatusCode::PARTIAL_CONTENT)
                            .header("Content-Type", mime)
                            .header("Content-Length", length.to_string())
                            .header("Content-Range", format!("bytes {}-{}/{}", start, end, file_size))
                            .header("Accept-Ranges", "bytes")
                            .header("Access-Control-Allow-Origin", "*")
                            .header("Access-Control-Expose-Headers", "Content-Range, Accept-Ranges, Content-Length, Content-Type")
                            .body(Body::from(buf)).unwrap();
                    }
                }
            }
        }

        // No Range header — respond with 206 + full Content-Range so WebView2
        // knows the total size from the first request and can compute duration.
        // Also handle HEAD requests (browser probes for duration this way).
        let end = file_size.saturating_sub(1);
        let mut buf = vec![0u8; file_size as usize];
        if file.read_exact(&mut buf).is_ok() {
            Response::builder()
                .status(StatusCode::PARTIAL_CONTENT)
                .header("Content-Type", mime)
                .header("Content-Length", file_size.to_string())
                .header("Content-Range", format!("bytes 0-{}/{}", end, file_size))
                .header("Accept-Ranges", "bytes")
                .header("Access-Control-Allow-Origin", "*")
                .header("Access-Control-Expose-Headers", "Content-Range, Accept-Ranges, Content-Length, Content-Type")
                .body(Body::from(buf)).unwrap()
        } else {
            Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .body(Body::empty()).unwrap()
        }
    }

    // Find a free port
    let port = {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.local_addr().unwrap().port()
    };

    let app = Router::new()
        .route("/video", get(serve_video).head(serve_video))
        .with_state(video_path);

    let addr = format!("127.0.0.1:{}", port);
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();

    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    port
}

// ─── WebSocket sync server (localhost:9001) ───────────────────────────────────
// Receives sync commands from MARK's useSync.js and broadcasts them to the
// bridge running inside the collection app. Zero Firebase usage for sync.
// All 55 reviewers run their own independent instance — no shared server.

use std::sync::atomic::{AtomicUsize, Ordering};
use tokio::sync::broadcast;

static CLIENT_ID: AtomicUsize = AtomicUsize::new(0);

async fn start_ws_server() {
    let (tx, _rx) = broadcast::channel::<String>(256);
    let tx = std::sync::Arc::new(tx);

    let listener = match TcpListener::bind("127.0.0.1:9001").await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[MARK WS] Could not bind to port 9001: {e}");
            return;
        }
    };
    println!("[MARK WS] sync server listening on ws://127.0.0.1:9001");

    loop {
        let (stream, addr) = match listener.accept().await {
            Ok(v) => v,
            Err(_) => continue,
        };
        let tx_clone = tx.clone();
        let mut rx = tx.subscribe();

        tokio::spawn(async move {
            let id = CLIENT_ID.fetch_add(1, Ordering::SeqCst);
            println!("[MARK WS] client {} connected from {}", id, addr);

            let ws_stream = match accept_async(stream).await {
                Ok(ws) => ws,
                Err(e) => { eprintln!("[MARK WS] handshake error: {e}"); return; }
            };

            let (mut write, mut read) = ws_stream.split();

            // Spawn a task to forward broadcast messages TO this client (bridge)
            let fwd = tokio::spawn(async move {
                while let Ok(msg) = rx.recv().await {
                    let _ = write.send(tokio_tungstenite::tungstenite::Message::Text(msg.into())).await;
                }
            });

            // Read messages FROM this client (MARK's useSync) and broadcast to all
            while let Some(Ok(msg)) = read.next().await {
                if let tokio_tungstenite::tungstenite::Message::Text(text) = msg {
                    let _ = tx_clone.send(text.to_string());
                }
            }

            println!("[MARK WS] client {} disconnected", id);
            fwd.abort();
        });
    }
}

// ─── Tauri command: set video path and return server URL ──────────────────────
#[command]
async fn get_video_url(
    path: String,
    state: tauri::State<'_, VideoState>,
) -> Result<String, String> {
    *state.path.lock().unwrap() = Some(path.clone());
    let port = *state.port.lock().unwrap();
    // Store path in state — server reads it directly, no URL encoding needed
    Ok(format!("http://127.0.0.1:{}/video", port))
}

// ─── Native file picker via rfd ───────────────────────────────────────────────
#[command]
fn pick_video_file() -> Option<String> {
    rfd::FileDialog::new()
        .add_filter("Video", &["mp4", "mkv", "mov", "avi", "webm", "mts", "m2ts"])
        .pick_file()
        .map(|p| p.to_string_lossy().to_string())
}

// ─── Save bytes to a user-chosen path via native save dialog (rfd) ────────────
#[command]
fn save_xlsx_file(name: String, data: Vec<u8>) -> Result<Option<String>, String> {
    match rfd::FileDialog::new()
        .set_file_name(name.as_str())
        .add_filter("Excel", &["xlsx"])
        .save_file()
    {
        Some(path) => {
            std::fs::write(&path, &data).map_err(|e| e.to_string())?;
            Ok(Some(path.to_string_lossy().to_string()))
        }
        None => Ok(None), // user cancelled
    }
}

// ─── Find the collection app window ──────────────────────────────────────────
#[cfg(target_os = "windows")]
unsafe fn find_collection_hwnd() -> Option<windows::Win32::Foundation::HWND> {
    use windows::Win32::Foundation::{HWND, LPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{EnumWindows, GetWindowTextW};
    use windows::core::BOOL;

    static FOUND: std::sync::atomic::AtomicIsize = std::sync::atomic::AtomicIsize::new(0);
    FOUND.store(0, std::sync::atomic::Ordering::SeqCst);

    unsafe extern "system" fn probe(hwnd: HWND, _: LPARAM) -> BOOL {
        let mut buf = [0u16; 512];
        let len = GetWindowTextW(hwnd, &mut buf);
        if len > 0 && String::from_utf16_lossy(&buf[..len as usize]).contains("Tag Once Collection App") {
            FOUND.store(hwnd.0 as isize, std::sync::atomic::Ordering::SeqCst);
            return BOOL(0);
        }
        BOOL(1)
    }

    let _ = EnumWindows(Some(probe), LPARAM(0));
    let raw = FOUND.load(std::sync::atomic::Ordering::SeqCst);
    if raw == 0 { None } else { Some(HWND(raw as *mut _)) }
}

// ─── Patch Tag Once shortcuts ─────────────────────────────────────────────────
// Adds `--unsafely-disable-devtools-self-xss-warnings` to the Arguments of any
// Tag Once .lnk shortcut found on Desktop / Start Menu. Runs on every MARK
// launch, fire-and-forget. Idempotent — skips shortcuts that already have it.
#[command]
fn patch_tag_once_shortcuts() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    { return patch_tag_once_shortcuts_windows(); }
    #[cfg(not(target_os = "windows"))]
    { Ok("noop".to_string()) }
}

#[cfg(target_os = "windows")]
fn patch_tag_once_shortcuts_windows() -> Result<String, String> {
    use std::path::PathBuf;

    let mut roots: Vec<PathBuf> = Vec::new();

    // Desktop
    if let Ok(p) = std::env::var("USERPROFILE") {
        roots.push(PathBuf::from(&p).join("Desktop"));
        roots.push(PathBuf::from(&p).join("OneDrive").join("Desktop"));
    }
    // User Start Menu
    if let Ok(p) = std::env::var("APPDATA") {
        roots.push(PathBuf::from(&p).join("Microsoft").join("Windows").join("Start Menu").join("Programs"));
    }
    // System-wide Start Menu
    if let Ok(p) = std::env::var("PROGRAMDATA") {
        roots.push(PathBuf::from(&p).join("Microsoft").join("Windows").join("Start Menu").join("Programs"));
    }

    let mut lnk_files: Vec<PathBuf> = Vec::new();
    for root in &roots {
        collect_lnks(root, &mut lnk_files, 0);
    }

    let mut patched = 0u32;
    let mut skipped = 0u32;
    let mut errors = 0u32;

    for lnk in &lnk_files {
        match patch_one_shortcut(lnk) {
            Ok(true)  => patched += 1,
            Ok(false) => skipped += 1,
            Err(_)    => errors += 1,
        }
    }

    Ok(format!("scanned={} patched={} skipped={} errors={}", lnk_files.len(), patched, skipped, errors))
}

#[cfg(target_os = "windows")]
fn collect_lnks(dir: &std::path::Path, out: &mut Vec<std::path::PathBuf>, depth: u32) {
    if depth > 4 { return; }
    let Ok(entries) = std::fs::read_dir(dir) else { return; };
    for entry in entries.flatten() {
        let p = entry.path();
        if p.is_dir() {
            collect_lnks(&p, out, depth + 1);
        } else if p.extension().and_then(|s| s.to_str()).map(|s| s.eq_ignore_ascii_case("lnk")).unwrap_or(false) {
            out.push(p);
        }
    }
}

#[cfg(target_os = "windows")]
fn patch_one_shortcut(lnk_path: &std::path::Path) -> Result<bool, String> {
    use windows::core::{Interface, PCWSTR};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
        COINIT_APARTMENTTHREADED, IPersistFile, STGM_READWRITE,
    };
    use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};

    const FLAG: &str = "--unsafely-disable-devtools-self-xss-warnings";

    unsafe {
        // Initialize COM (per-thread, fail silently if already initialized)
        let hr = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let _need_uninit = hr.is_ok();

        let result = (|| -> Result<bool, String> {
            let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)
                .map_err(|e| format!("CoCreateInstance: {e}"))?;
            let persist: IPersistFile = link.cast().map_err(|e| format!("cast IPersistFile: {e}"))?;

            // Load the .lnk
            let lnk_w: Vec<u16> = lnk_path.to_string_lossy().encode_utf16().chain(Some(0)).collect();
            persist.Load(PCWSTR(lnk_w.as_ptr()), STGM_READWRITE)
                .map_err(|e| format!("Load: {e}"))?;

            // Read target path — only patch shortcuts that point at a Tag Once binary
            let mut target_buf = [0u16; 1024];
            link.GetPath(&mut target_buf, std::ptr::null_mut(), 0)
                .map_err(|e| format!("GetPath: {e}"))?;
            let target = String::from_utf16_lossy(&target_buf[..target_buf.iter().position(|&c| c == 0).unwrap_or(target_buf.len())]);
            let target_lc = target.to_lowercase();
            let looks_like_tag_once = target_lc.contains("tag once")
                || target_lc.contains("tag-once")
                || target_lc.contains("live-collection-app")
                || target_lc.contains("statsbomb");
            if !looks_like_tag_once {
                return Ok(false);
            }

            // Read current Arguments
            let mut args_buf = [0u16; 2048];
            link.GetArguments(&mut args_buf)
                .map_err(|e| format!("GetArguments: {e}"))?;
            let current_args = String::from_utf16_lossy(&args_buf[..args_buf.iter().position(|&c| c == 0).unwrap_or(args_buf.len())]);

            if current_args.contains(FLAG) {
                return Ok(false); // already patched
            }

            let new_args = if current_args.trim().is_empty() {
                FLAG.to_string()
            } else {
                format!("{} {}", current_args.trim(), FLAG)
            };

            // Write Arguments back
            let new_args_w: Vec<u16> = new_args.encode_utf16().chain(Some(0)).collect();
            link.SetArguments(PCWSTR(new_args_w.as_ptr()))
                .map_err(|e| format!("SetArguments: {e}"))?;

            // Save .lnk
            persist.Save(PCWSTR(lnk_w.as_ptr()), true)
                .map_err(|e| format!("Save: {e}"))?;

            Ok(true)
        })();

        if _need_uninit { CoUninitialize(); }
        result
    }
}

// ─── Patch Tag Once app.asar — embed the bridge script directly ───────────────
// The asar format: [8-byte Pickle1: outer size + Pickle2 size]
//                  [Pickle2: payload-size u32 + json-length u32 + JSON + padding]
//                  [file data, raw concatenation in offset order]
// We:
//   1. Read the file
//   2. Parse the JSON header → find app.html's offset+size
//   3. Read app.html bytes from the data section
//   4. Inject our bridge script before </body>
//   5. Shift offsets of files that come AFTER app.html by the size delta
//   6. Rebuild and write the file
// Version-specific marker: the guard below only treats the asar as "already
// patched" when THIS exact version is embedded. An older embed (any prior
// marker) does not match, so it gets stripped and replaced — that's what was
// previously frozen by a fixed marker. Bump this whenever the embedded bridge
// changes so existing installs re-embed the new version.
const ASAR_MARKER: &str = "<!-- MARK_BRIDGE_INJECTED v7.5.1 -->";

#[command]
fn patch_tag_once_asar() -> Result<String, String> {
    let asar_path = find_tag_once_asar()?;
    patch_asar_impl(&asar_path).map_err(|e| {
        let low = e.to_lowercase();
        if low.contains("write asar") || low.contains("os error")
            || low.contains("denied") || low.contains("process") {
            format!("Couldn't update the collection app — please fully CLOSE it \
                     (check the system tray too), then click Embed Bridge again. [{e}]")
        } else { e }
    })
}

fn find_tag_once_asar() -> Result<std::path::PathBuf, String> {
    let candidates = [
        std::env::var("LOCALAPPDATA").ok().map(|p|
            std::path::PathBuf::from(p).join("Programs").join("live-collection-app").join("resources").join("app.asar")),
        Some(std::path::PathBuf::from(r"C:\Program Files\live-collection-app\resources\app.asar")),
        Some(std::path::PathBuf::from(r"C:\Program Files (x86)\live-collection-app\resources\app.asar")),
    ];
    for opt in &candidates {
        if let Some(p) = opt {
            if p.exists() { return Ok(p.clone()); }
        }
    }
    Err("Tag Once app.asar not found in any known location".to_string())
}

fn read_asar(path: &std::path::Path) -> Result<(serde_json::Value, Vec<u8>), String> {
    let bytes = std::fs::read(path).map_err(|e| format!("read asar: {e}"))?;
    if bytes.len() < 16 { return Err("asar file too small".into()); }
    let json_len = u32::from_le_bytes(bytes[12..16].try_into().unwrap()) as usize;
    if bytes.len() < 16 + json_len { return Err("asar truncated".into()); }
    let json_str = std::str::from_utf8(&bytes[16..16 + json_len])
        .map_err(|e| format!("asar header not utf8: {e}"))?;
    let header: serde_json::Value = serde_json::from_str(json_str)
        .map_err(|e| format!("asar header not valid JSON: {e}"))?;
    let aligned = (json_len + 3) & !3;
    let data_start = 16 + aligned;
    let data = bytes[data_start..].to_vec();
    Ok((header, data))
}

fn write_asar(path: &std::path::Path, header: &serde_json::Value, data: &[u8]) -> Result<(), String> {
    let json_str = serde_json::to_string(header).map_err(|e| format!("serialize header: {e}"))?;
    let json_bytes = json_str.as_bytes();
    let json_len = json_bytes.len();
    let aligned = (json_len + 3) & !3;
    let padding = aligned - json_len;

    let mut out = Vec::with_capacity(16 + aligned + data.len());
    out.extend_from_slice(&4u32.to_le_bytes());                       // Pickle1 payload size
    out.extend_from_slice(&((8 + aligned) as u32).to_le_bytes());     // Pickle2 total size
    out.extend_from_slice(&((4 + aligned) as u32).to_le_bytes());     // Pickle2 payload size
    out.extend_from_slice(&(json_len as u32).to_le_bytes());          // JSON actual length
    out.extend_from_slice(json_bytes);
    out.extend(std::iter::repeat(0u8).take(padding));
    out.extend_from_slice(data);

    std::fs::write(path, out).map_err(|e| format!("write asar: {e}"))
}

fn patch_asar_impl(asar_path: &std::path::Path) -> Result<String, String> {
    let (mut header, data) = read_asar(asar_path)?;

    let files = header.get("files").and_then(|f| f.as_object())
        .ok_or_else(|| "asar header has no 'files' object".to_string())?;
    let app_html = files.get("app.html")
        .ok_or_else(|| "app.html not found in asar".to_string())?;
    let html_offset: u64 = app_html.get("offset").and_then(|o| o.as_str())
        .ok_or_else(|| "app.html has no offset".to_string())?
        .parse().map_err(|e| format!("invalid offset: {e}"))?;
    let html_size: u64 = app_html.get("size").and_then(|s| s.as_u64())
        .ok_or_else(|| "app.html has no size".to_string())?;

    let html_start = html_offset as usize;
    let html_end = html_start + html_size as usize;
    if data.len() < html_end { return Err("asar data section truncated".into()); }

    let html_str = std::str::from_utf8(&data[html_start..html_end])
        .map_err(|e| format!("app.html not utf8: {e}"))?;

    if html_str.contains(ASAR_MARKER) {
        return Ok("already patched".to_string());
    }

    // Strip any previous MARK bridge injection (v1 or older) before injecting v2.
    // Prevents stacking multiple bridge scripts across upgrades.
    let html_str_clean = if let Some(start) = html_str.find("<!-- MARK_BRIDGE_INJECTED") {
        let before = &html_str[..start];
        let before_trimmed = before.trim_end_matches(|c: char| c == ' ' || c == '\n' || c == '\r');
        format!("{}\n  </body>", before_trimmed)
    } else {
        html_str.to_string()
    };

    // Build injection: marker + <script>...bridge code...</script> before </body>
    let injection = format!(
        "    {}\n    <script>\n{}\n    </script>\n  </body>",
        ASAR_MARKER, BRIDGE_SCRIPT
    );
    let new_html = html_str_clean.replace("</body>", &injection);
    if new_html == html_str_clean {
        return Err("</body> not found in app.html — Tag Once structure changed?".into());
    }

    let new_html_bytes = new_html.as_bytes();
    let new_html_size = new_html_bytes.len() as u64;
    let size_delta: i64 = new_html_size as i64 - html_size as i64;

    // Update app.html's size in header
    if let Some(files_obj) = header.get_mut("files").and_then(|f| f.as_object_mut()) {
        if let Some(app_html_mut) = files_obj.get_mut("app.html").and_then(|h| h.as_object_mut()) {
            app_html_mut.insert("size".to_string(),
                serde_json::Value::Number(serde_json::Number::from(new_html_size)));
        }
    }

    // Recursively shift offsets of every file with offset > html_offset
    fn shift_offsets(node: &mut serde_json::Value, threshold: u64, delta: i64) {
        if let Some(obj) = node.as_object_mut() {
            // Determine if this is a file entry (has "offset")
            let off_opt = obj.get("offset")
                .and_then(|v| v.as_str())
                .and_then(|s| s.parse::<u64>().ok());
            if let Some(off) = off_opt {
                if off > threshold {
                    let new_off = ((off as i64) + delta) as u64;
                    obj.insert("offset".to_string(),
                        serde_json::Value::String(new_off.to_string()));
                }
            }
            // Recurse into "files" (directory entries)
            if let Some(files) = obj.get_mut("files") {
                if let Some(files_obj) = files.as_object_mut() {
                    for (_, child) in files_obj.iter_mut() {
                        shift_offsets(child, threshold, delta);
                    }
                }
            }
        }
    }
    shift_offsets(&mut header, html_offset, size_delta);

    // Rebuild data: bytes before html | new html | bytes after old html
    let mut new_data = Vec::with_capacity(data.len() + size_delta.unsigned_abs() as usize);
    new_data.extend_from_slice(&data[..html_start]);
    new_data.extend_from_slice(new_html_bytes);
    new_data.extend_from_slice(&data[html_end..]);

    // Create backup if not already present
    let backup_path = asar_path.with_extension("asar.markbackup");
    if !backup_path.exists() {
        let _ = std::fs::copy(asar_path, &backup_path);
    }

    write_asar(asar_path, &header, &new_data)?;

    Ok(format!("patched (delta={:+} bytes)", size_delta))
}

// ─── Inject Bridge command ────────────────────────────────────────────────────
#[command]
fn inject_bridge_script(
    id_token: String,
    refresh_token: String,
    user_uid: String,
    user_email: String,
) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    { return inject_bridge_windows(&id_token, &refresh_token, &user_uid, &user_email); }
    #[cfg(not(target_os = "windows"))]
    { let _ = (id_token, refresh_token, user_uid, user_email); Ok("dev_noop".to_string()) }
}

#[cfg(target_os = "windows")]
fn inject_bridge_windows(id_token: &str, refresh_token: &str, user_uid: &str, user_email: &str) -> Result<String, String> {
    use windows::Win32::Foundation::{HANDLE, HGLOBAL};
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT,
        KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP, KEYEVENTF_UNICODE, VIRTUAL_KEY,
        VK_CONTROL, VK_MENU, VK_RETURN, VK_SHIFT,
    };
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, SetForegroundWindow};
    use windows::Win32::System::DataExchange::{CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData};
    use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};

    let collection_hwnd = unsafe { find_collection_hwnd() }
        .ok_or_else(|| "Collection app window not found".to_string())?;

    let script = BRIDGE_SCRIPT
        .replace("__ID_TOKEN__", id_token)
        .replace("__REFRESH_TOKEN__", refresh_token)
        .replace("__USER_UID__", user_uid)
        .replace("__USER_EMAIL__", user_email);
    let sz = std::mem::size_of::<INPUT>() as i32;

    let vk = |code: u16, up: bool| -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(code), wScan: 0,
                    dwFlags: if up { KEYEVENTF_KEYUP } else { KEYBD_EVENT_FLAGS(0) },
                    time: 0, dwExtraInfo: 0,
                },
            },
        }
    };

    let ch = |c: u16, up: bool| -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(0), wScan: c,
                    dwFlags: KEYEVENTF_UNICODE | if up { KEYEVENTF_KEYUP } else { KEYBD_EVENT_FLAGS(0) },
                    time: 0, dwExtraInfo: 0,
                },
            },
        }
    };

    let sleep = |ms: u64| std::thread::sleep(std::time::Duration::from_millis(ms));

    unsafe {
        let mark_hwnd = GetForegroundWindow();
        SendInput(&[vk(VK_MENU.0, false), vk(VK_MENU.0, true)], sz);
        let _ = SetForegroundWindow(collection_hwnd);
        sleep(300);

        // Open DevTools (Alt+Ctrl+I)
        SendInput(
            &[vk(VK_MENU.0, false), vk(VK_CONTROL.0, false), vk(0x49, false),
              vk(0x49, true), vk(VK_CONTROL.0, true), vk(VK_MENU.0, true)],
            sz,
        );
        sleep(4000); // wait for DevTools to fully open

        // Switch to Console tab (Ctrl+Shift+J)
        SendInput(
            &[vk(VK_CONTROL.0, false), vk(VK_SHIFT.0, false), vk(0x4A, false),
              vk(0x4A, true), vk(VK_SHIFT.0, true), vk(VK_CONTROL.0, true)],
            sz,
        );
        sleep(1500);

        // NOTE: No mouse click here — Ctrl+Shift+J already focuses the console input,
        // regardless of whether DevTools is docked to the bottom or to the side.
        // The 2.9.10 mouse click broke side-docked DevTools (typing landed on the page).

        // Type "allow pasting" — Chromium treats Unicode-injected chars as typed
        let mut char_inputs: Vec<INPUT> = Vec::new();
        for c in "allow pasting".encode_utf16() {
            char_inputs.push(ch(c, false));
            char_inputs.push(ch(c, true));
        }
        SendInput(&char_inputs, sz);
        sleep(800); // wait for Chromium to register the full phrase
        SendInput(&[vk(VK_RETURN.0, false), vk(VK_RETURN.0, true)], sz);
        sleep(1200); // wait for paste permission

        {
            let wide: Vec<u16> = script.encode_utf16().chain(Some(0)).collect();
            let byte_len = wide.len() * 2;
            OpenClipboard(None).map_err(|e| format!("OpenClipboard: {}", e))?;
            let _ = EmptyClipboard();
            let hmem: HGLOBAL = GlobalAlloc(GMEM_MOVEABLE, byte_len).map_err(|e| {
                let _ = CloseClipboard();
                format!("GlobalAlloc: {}", e)
            })?;
            let ptr = GlobalLock(hmem) as *mut u16;
            std::ptr::copy_nonoverlapping(wide.as_ptr(), ptr, wide.len());
            let _ = GlobalUnlock(hmem);
            SetClipboardData(13u32, Some(HANDLE(hmem.0))).map_err(|e| {
                let _ = CloseClipboard();
                format!("SetClipboardData: {}", e)
            })?;
            let _ = CloseClipboard();
        }

        SendInput(
            &[vk(VK_CONTROL.0, false), vk(0x56, false), vk(0x56, true), vk(VK_CONTROL.0, true)],
            sz,
        );
        sleep(800);
        SendInput(&[vk(VK_RETURN.0, false), vk(VK_RETURN.0, true)], sz);
        sleep(1000);

        // Close DevTools (Alt+Ctrl+I again)
        SendInput(
            &[vk(VK_MENU.0, false), vk(VK_CONTROL.0, false), vk(0x49, false),
              vk(0x49, true), vk(VK_CONTROL.0, true), vk(VK_MENU.0, true)],
            sz,
        );
        sleep(500);

        if !mark_hwnd.is_invalid() {
            SendInput(&[vk(VK_MENU.0, false), vk(VK_MENU.0, true)], sz);
            let _ = SetForegroundWindow(mark_hwnd);
        }
    }

    Ok("injected".to_string())
}

// ─── Open a file or URL using the system default application ─────────────────
#[command]
fn open_file(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        if path.starts_with("http://") || path.starts_with("https://") {
            // Open URL in the default browser via rundll32 — single-arg, so `&`
            // in the URL isn't chopped by cmd's command separator.
            std::process::Command::new("rundll32")
                .args(["url.dll,FileProtocolHandler", &path])
                .spawn()
                .map_err(|e| format!("Failed to open URL: {}", e))?;
        } else {
            // Open file with default app via PowerShell
            let mut cmd = std::process::Command::new("powershell");
            cmd.args(["-NoProfile", "-Command", &format!("Invoke-Item '{}'", path.replace('\'', "''"))]);
            #[cfg(target_os = "windows")]
            cmd.creation_flags(CREATE_NO_WINDOW);
            cmd.spawn()
                .map_err(|e| format!("Failed to open file: {}", e))?;
        }
    }
    Ok(())
}
#[command]
fn send_key_to_collection_app(_exe_name: String, _key_code: String) -> Result<String, String> {
    Ok("noop".to_string())
}


// --- Google OAuth (desktop loopback) + Drive upload ---------------------------
// Sign-in-as-the-reviewer path: MARK gets the user's OWN Google token and creates
// the master sheet IN THEIR OWN DRIVE, using only the non-sensitive `drive.file`
// scope (no app verification, works for any Google account). A Desktop-app client
// secret is treated as non-confidential by Google, so embedding it here is fine.
const OAUTH_CLIENT_ID: &str =
    "680107914768-8ndh7e12cluc5jbptfrarg7rlrg9mfjt.apps.googleusercontent.com";
// Client secret is injected at BUILD time from the MARK_GOOGLE_CLIENT_SECRET
// GitHub Actions secret — never committed to the repo. (Empty in local builds.)
fn oauth_client_secret() -> &'static str {
    option_env!("MARK_GOOGLE_CLIENT_SECRET").unwrap_or("")
}
const OAUTH_SCOPE: &str = "https://www.googleapis.com/auth/drive.file openid email";

// Open the browser, run the loopback OAuth flow, return the token JSON
// (access_token, refresh_token, expires_in, ...).
#[command]
async fn google_oauth_sign_in() -> Result<serde_json::Value, String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Local sign-in server failed to start: {}", e))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect_uri = format!("http://127.0.0.1:{}", port);

    let auth_url = format!(
        "https://accounts.google.com/o/oauth2/v2/auth?client_id={}&redirect_uri={}&response_type=code&scope={}&access_type=offline&prompt=consent",
        urlencoding::encode(OAUTH_CLIENT_ID),
        urlencoding::encode(&redirect_uri),
        urlencoding::encode(OAUTH_SCOPE),
    );

    #[cfg(target_os = "windows")]
    {
        // Open the default browser via rundll32 — the whole URL is passed as a
        // single argument, so the `&` between query params isn't treated as a
        // cmd command separator (which had been dropping response_type/scope).
        std::process::Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", &auth_url])
            .spawn()
            .map_err(|e| format!("Could not open browser: {}", e))?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = &auth_url;
    }

    // Wait for Google's redirect and pull the ?code= out of the request line.
    let (mut stream, _) = listener
        .accept()
        .await
        .map_err(|e| format!("No sign-in redirect received: {}", e))?;
    let mut buf = vec![0u8; 8192];
    let n = stream.read(&mut buf).await.map_err(|e| e.to_string())?;
    let req = String::from_utf8_lossy(&buf[..n]);
    let first_line = req.lines().next().unwrap_or("");
    let code = first_line
        .split_whitespace()
        .nth(1)
        .and_then(|p| p.split('?').nth(1))
        .and_then(|qs| qs.split('&').find(|kv| kv.starts_with("code=")))
        .map(|kv| kv.trim_start_matches("code="))
        .map(|c| {
            urlencoding::decode(c)
                .map(|s| s.into_owned())
                .unwrap_or_else(|_| c.to_string())
        })
        .ok_or_else(|| "Sign-in was cancelled (no authorization code).".to_string())?;

    let page = "<html><body style='font-family:sans-serif;text-align:center;padding-top:60px'><h2>MARK is signed in</h2><p>You can close this tab and return to MARK.</p></body></html>";
    let resp = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        page.len(),
        page
    );
    let _ = stream.write_all(resp.as_bytes()).await;

    let client = reqwest::Client::new();
    let params = [
        ("client_id", OAUTH_CLIENT_ID),
        ("client_secret", oauth_client_secret()),
        ("code", code.as_str()),
        ("grant_type", "authorization_code"),
        ("redirect_uri", redirect_uri.as_str()),
    ];
    let token_json: serde_json::Value = client
        .post("https://oauth2.googleapis.com/token")
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("Token exchange failed: {}", e))?
        .json()
        .await
        .map_err(|e| format!("Token parse failed: {}", e))?;
    if token_json.get("error").is_some() {
        return Err(format!("Google sign-in error: {}", token_json));
    }
    Ok(token_json)
}

// Exchange a stored refresh_token for a fresh access_token.
#[command]
async fn google_oauth_refresh(refresh_token: String) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let params = [
        ("client_id", OAUTH_CLIENT_ID),
        ("client_secret", oauth_client_secret()),
        ("refresh_token", refresh_token.as_str()),
        ("grant_type", "refresh_token"),
    ];
    let json: serde_json::Value = client
        .post("https://oauth2.googleapis.com/token")
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("Token refresh failed: {}", e))?
        .json()
        .await
        .map_err(|e| format!("Token refresh parse failed: {}", e))?;
    if json.get("error").is_some() {
        return Err(format!("Token refresh error: {}", json));
    }
    Ok(json)
}

// Create a Google Sheet in the signed-in user's Drive from .xlsx bytes (converted
// to a native Sheet on upload), share "anyone with link (view)", return id+url.
#[command]
async fn drive_create_sheet(
    access_token: String,
    name: String,
    data: Vec<u8>,
) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let boundary = "MARKb0undary7e3f2a";
    let metadata = serde_json::json!({
        "name": name,
        "mimeType": "application/vnd.google-apps.spreadsheet"
    });

    let mut body: Vec<u8> = Vec::new();
    body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body.extend_from_slice(b"Content-Type: application/json; charset=UTF-8\r\n\r\n");
    body.extend_from_slice(metadata.to_string().as_bytes());
    body.extend_from_slice(format!("\r\n--{}\r\n", boundary).as_bytes());
    body.extend_from_slice(
        b"Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n",
    );
    body.extend_from_slice(&data);
    body.extend_from_slice(format!("\r\n--{}--\r\n", boundary).as_bytes());

    let json: serde_json::Value = client
        .post("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink")
        .header("Authorization", format!("Bearer {}", access_token))
        .header("Content-Type", format!("multipart/related; boundary={}", boundary))
        .body(body)
        .send()
        .await
        .map_err(|e| format!("Drive upload failed: {}", e))?
        .json()
        .await
        .map_err(|e| format!("Drive upload parse failed: {}", e))?;
    if json.get("error").is_some() {
        return Err(format!("Drive upload error: {}", json));
    }

    if let Some(id) = json.get("id").and_then(|v| v.as_str()) {
        let perm = serde_json::json!({ "role": "reader", "type": "anyone" });
        let _ = client
            .post(format!(
                "https://www.googleapis.com/drive/v3/files/{}/permissions",
                id
            ))
            .header("Authorization", format!("Bearer {}", access_token))
            .json(&perm)
            .send()
            .await;
    }
    Ok(json)
}


// --- ffmpeg clip cutting ------------------------------------------------------
// Resolve the bundled ffmpeg.exe (shipped as a Tauri resource), falling back to
// common install layouts and finally PATH.
fn resolve_ffmpeg(app: &tauri::AppHandle) -> String {
    use tauri::Manager;
    if let Ok(p) = app
        .path()
        .resolve("binaries/ffmpeg.exe", tauri::path::BaseDirectory::Resource)
    {
        if p.exists() {
            return p.to_string_lossy().to_string();
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            for cand in ["ffmpeg.exe", "binaries/ffmpeg.exe", "resources/binaries/ffmpeg.exe"] {
                let p = dir.join(cand);
                if p.exists() {
                    return p.to_string_lossy().to_string();
                }
            }
        }
    }
    "ffmpeg".to_string()
}

// Cut a 10-second clip (−5s / +5s, frame-accurate) per error into
// %USERPROFILE%\Downloads\<subfolder>. `clips` = [{ "ts": <sec>, "name": <file> }].
#[command]
async fn cut_clips(
    app: tauri::AppHandle,
    video_path: String,
    subfolder: String,
    clips: Vec<serde_json::Value>,
) -> Result<Vec<String>, String> {
    let ffmpeg = resolve_ffmpeg(&app);

    let userprofile = std::env::var("USERPROFILE")
        .map_err(|_| "Could not locate your Downloads folder.".to_string())?;
    let out_dir = std::path::PathBuf::from(userprofile)
        .join("Downloads")
        .join(&subfolder);
    std::fs::create_dir_all(&out_dir)
        .map_err(|e| format!("Could not create clip folder: {}", e))?;

    let mut written: Vec<String> = Vec::new();
    for c in &clips {
        let ts = c.get("ts").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let name = c
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("clip.mp4")
            .to_string();

        // Fast input-seek near the start, then accurate output-seek the small
        // remainder → frame-accurate without decoding from 0. Clip starts 5s
        // before the error and runs 10s (clamped at the video start).
        let start = (ts - 5.0).max(0.0);
        let in_seek = (start - 3.0).max(0.0);
        let out_seek = start - in_seek;

        let in_s = format!("{:.3}", in_seek);
        let out_s = format!("{:.3}", out_seek);
        let out_p = out_dir.join(&name).to_string_lossy().to_string();

        let args: Vec<&str> = vec![
            "-y",
            "-ss", &in_s,
            "-i", &video_path,
            "-ss", &out_s,
            "-t", "10",
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-crf", "20",
            "-c:a", "aac",
            "-movflags", "+faststart",
            &out_p,
        ];

        let mut cmd = tokio::process::Command::new(&ffmpeg);
        cmd.args(&args);
        #[cfg(target_os = "windows")]
        cmd.creation_flags(CREATE_NO_WINDOW);
        let status = cmd
            .status()
            .await
            .map_err(|e| format!("Could not run ffmpeg ({}). Is it bundled?", e))?;

        if status.success() {
            written.push(name);
        } else {
            return Err(format!("ffmpeg failed on clip '{}'.", name));
        }
    }
    Ok(written)
}


// --- Google Sheets API via Service Account JWT --------------------------------
const SA_CLIENT_EMAIL: &str = "mark-reporter@mark-app-498618.iam.gserviceaccount.com";
const SA_PRIVATE_KEY: &str = "-----BEGIN PRIVATE KEY-----\nMIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQDppEco89tq/jUH\nn7Krqf15QeKUnw03Js9FwLaaocMAtpgtvG0cP3sBBFQkhEAsDLVh1m69jRAKZcN2\n1FOShXhhmlxggl4Z8fkJF+fUqQyPGTtCm9BeeKlDpfNBuWSznQl+gIIn4Gn0YInY\nI0LC0E2umQFNxf7kIhV1D14Ymwn3MmpdXMFjp0kg3odSmp4jwc9by+IVS8GjdctW\nVrOLkxM8wzKi0cMFYtBXJVIRdm6IIxJwyHPVPkyNyYBJARifdy63D71ubfnLCXvq\n5dhyr/ViX8vnzBFLkYDGHss9Uy4r3CymSnfwSSJng0wWtK8MIIQVJEcEpRaL2uk2\n49JhfZ4JAgMBAAECggEABRUOpYsnwMwj9/+8ZE63uwwYwz4Hd1A9ONRK6eeuunn+\nVZuwQumgQcLSmBMWuJk+gSY9NUXXgru5H1avNQl5YiQjB3K73HQemZj0cR7hQqPx\nnaQOibOLDl6SgUw+BB3cdOzo3Thc4v+OQrjs95hjjDKmAYdW9qbwJmJNxsVpQirY\nW3KrQtMDsrw6afuai8CWSlrA6ucKSf1t1XflG6565ZkjnP1NlueTJ1ojK5eeVac9\nnMrn0jLQ4/JCBSZBr7x3KAHLQX6e8929V08X3ObnT1HVyWfzfYQmMOgJA7P/TwG9\nahtRTCktZ4PynDBtVSVMs/3rLxw6qHCi8tZ0eNc5IQKBgQD10Q/ZAkH34jShCwcF\nbQ94Twrri7LcgYtInE5H5anikdT6hRgXXugHYn5S0T0Zsf0QK3l9Zee2bN6ugDjq\nZCqAr4aEqyK+VL+jSODgx9dHngRRSozrZKvr0av3FGkj0ZU1O3X6hwThyfN0RX+W\nO7yL/VFuQyTWpuwg/H7Ki513sQKBgQDzUhknBgwMnfTrnS+gq7f5Wg2boRWXRB2x\nADSzu+SgdFVFySFYpipxwUGjONbkZz88hac0IWC3bDUno1nBj0x1rXU2Mm2s5XTF\nwPaOOjg4SNQD05mz5Grk/aBKYe1nxq/xS1zVvIEhvR5yy9u9O3vOFHMdxH6ZptYj\n83Md1xj52QKBgFuXSSNfnvrg0yFKPZR8/W2jbfsz8zIMJryoWNabMUCVe9jYbJCQ\nsT3HKjBrfCut0RAMUtkxdjPXvuUgK5TSO6/1NtcJ+QkYBMuvZPL8Iy+xJgSwFW/D\n8/cLCdsnRMGu3ryV6jCtzFjg6ZBiMNbmbStv+L5v0DMWwRbNXeTUPpkRAoGAYDcX\noRnADAEuBzlJyxP8FMrqVJ8XBZC22PYG4QeseVJnIchNultCr2bHCL8CIqE9HTaQ\njomgUAem4Tyz0llS17m2fq7kNZkqWsRZ+pXFA2SxCa5TuhHZvyEXkDI3CXFEw3qU\nhCQdP/UjpCs+gg6Sf0QQ3TWFBkc1qFOtMqCKzMkCgYBmPGzmQ2xGEa/b4PnIrblR\nM2Y4e9zCEV6hc/37qy0LJIpe0iZTUPMd8pIyNtZXVWFDsJ/U3ai3zUKCYAJAGct8\nZHnLFBl8rjsWB7woJk6LdVeYItgU/jVAw54n5PwEaajFvZO15q1zsAOjhj/vmksi\nQIGusOLsrprvflY8YpinSQ==\n-----END PRIVATE KEY-----\n";

#[derive(serde::Serialize, serde::Deserialize)]
struct JwtClaims {
    iss: String,
    scope: String,
    aud: String,
    exp: u64,
    iat: u64,
}

async fn get_google_access_token() -> Result<String, String> {
    use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();

    let claims = JwtClaims {
        iss: SA_CLIENT_EMAIL.to_string(),
        scope: "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive".to_string(),
        aud: "https://oauth2.googleapis.com/token".to_string(),
        exp: now + 3600,
        iat: now,
    };

    let key = EncodingKey::from_rsa_pem(SA_PRIVATE_KEY.as_bytes())
        .map_err(|e| format!("Key error: {}", e))?;

    let jwt = encode(&Header::new(Algorithm::RS256), &claims, &key)
        .map_err(|e| format!("JWT error: {}", e))?;

    let client = reqwest::Client::new();
    let resp = client
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer"),
            ("assertion", &jwt),
        ])
        .send()
        .await
        .map_err(|e| format!("Token request failed: {}", e))?;

    let json: serde_json::Value = resp.json().await
        .map_err(|e| format!("Token parse failed: {}", e))?;

    json["access_token"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| format!("No access_token in response: {}", json))
}

#[command]
async fn create_google_sheet(payload: String) -> Result<String, String> {
    let data: serde_json::Value = serde_json::from_str(&payload)
        .map_err(|e| format!("Parse payload: {}", e))?;

    let token = get_google_access_token().await?;
    let client = reqwest::Client::new();

    // 1. Create the spreadsheet
    let sheet_name = data["sheetName"].as_str().unwrap_or("MARK Report");
    let tab_name   = data["tabName"].as_str().unwrap_or("Session");

    let create_body = serde_json::json!({
        "properties": { "title": sheet_name },
        "sheets": [{ "properties": { "title": tab_name } }]
    });

    let create_resp = client
        .post("https://sheets.googleapis.com/v4/spreadsheets")
        .bearer_auth(&token)
        .json(&create_body)
        .send()
        .await
        .map_err(|e| format!("Create sheet failed: {}", e))?;

    let sheet_data: serde_json::Value = create_resp.json().await
        .map_err(|e| format!("Create sheet parse: {}", e))?;

    let spreadsheet_id = sheet_data["spreadsheetId"]
        .as_str()
        .ok_or_else(|| format!("No spreadsheetId: {}", sheet_data))?
        .to_string();

    let sheet_url = format!("https://docs.google.com/spreadsheets/d/{}/edit", spreadsheet_id);

    // 2. Build rows: quality row + headers + data
    let quality_row = data["qualityRow"].as_str().unwrap_or("");
    let headers = data["headers"].as_array().cloned().unwrap_or_default();
    let rows    = data["rows"].as_array().cloned().unwrap_or_default();
    let video_links  = data["videoLinks"].as_array().cloned().unwrap_or_default();
    let timestamps   = data["timestamps"].as_array().cloned().unwrap_or_default();

    let col_count = headers.len();

    // Build values array for batchUpdate
    let mut values: Vec<serde_json::Value> = vec![];

    // Row 1: quality score
    let mut q_row = vec![serde_json::Value::String(quality_row.to_string())];
    for _ in 1..col_count { q_row.push(serde_json::Value::String("".to_string())); }
    values.push(serde_json::Value::Array(q_row));

    // Row 2: headers
    values.push(serde_json::Value::Array(headers.clone()));

    // Rows 3+: data, with video link in last column
    for (i, row) in rows.iter().enumerate() {
        let mut r = row.as_array().cloned().unwrap_or_default();
        // Replace last empty cell with hyperlink formula if video link exists
        let link = video_links.get(i).and_then(|v| v.as_str()).unwrap_or("");
        let ts   = timestamps.get(i).and_then(|v| v.as_str()).unwrap_or("");
        if !link.is_empty() {
            let formula = format!("=HYPERLINK(\"{}\",\"Open Video ({})\") ", link, ts);
            if let Some(last) = r.last_mut() {
                *last = serde_json::Value::String(formula);
            }
        }
        values.push(serde_json::Value::Array(r));
    }

    // 3. Write values
    let range = format!("{}!A1", tab_name);
    let update_body = serde_json::json!({
        "range": range,
        "majorDimension": "ROWS",
        "values": values
    });

    client
        .put(format!(
            "https://sheets.googleapis.com/v4/spreadsheets/{}/values/{}?valueInputOption=USER_ENTERED",
            spreadsheet_id, urlencoding::encode(&range)
        ))
        .bearer_auth(&token)
        .json(&update_body)
        .send()
        .await
        .map_err(|e| format!("Write values failed: {}", e))?;

    // 4. Format: bold row 1+2, merge row 1
    let requests = serde_json::json!({
        "requests": [
            // Merge quality row
            {
                "mergeCells": {
                    "range": { "sheetId": 0, "startRowIndex": 0, "endRowIndex": 1, "startColumnIndex": 0, "endColumnIndex": col_count },
                    "mergeType": "MERGE_ALL"
                }
            },
            // Bold rows 1 and 2
            {
                "repeatCell": {
                    "range": { "sheetId": 0, "startRowIndex": 0, "endRowIndex": 2 },
                    "cell": { "userEnteredFormat": { "textFormat": { "bold": true } } },
                    "fields": "userEnteredFormat.textFormat.bold"
                }
            },
            // Orange text for quality row
            {
                "repeatCell": {
                    "range": { "sheetId": 0, "startRowIndex": 0, "endRowIndex": 1 },
                    "cell": { "userEnteredFormat": {
                        "textFormat": { "bold": true, "foregroundColor": { "red": 0.91, "green": 0.35, "blue": 0.047 } },
                        "backgroundColor": { "red": 0.1, "green": 0.1, "blue": 0.18 }
                    }},
                    "fields": "userEnteredFormat.textFormat,userEnteredFormat.backgroundColor"
                }
            },
            // Freeze 2 rows
            {
                "updateSheetProperties": {
                    "properties": { "sheetId": 0, "gridProperties": { "frozenRowCount": 2 } },
                    "fields": "gridProperties.frozenRowCount"
                }
            }
        ]
    });

    client
        .post(format!(
            "https://sheets.googleapis.com/v4/spreadsheets/{}/batchUpdate",
            spreadsheet_id
        ))
        .bearer_auth(&token)
        .json(&requests)
        .send()
        .await
        .map_err(|e| format!("Format failed: {}", e))?;

    // 5. Make sheet publicly viewable (anyone with link)
    let drive_body = serde_json::json!({
        "role": "reader",
        "type": "anyone"
    });
    client
        .post(format!(
            "https://www.googleapis.com/drive/v3/files/{}/permissions",
            spreadsheet_id
        ))
        .bearer_auth(&token)
        .json(&drive_body)
        .send()
        .await
        .map_err(|e| format!("Share failed: {}", e))?;

    Ok(sheet_url)
}

fn main() {
    let video_path: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    let port_holder: Arc<Mutex<u16>> = Arc::new(Mutex::new(0));

    let video_path_for_server = video_path.clone();
    let port_holder_for_main = port_holder.clone();

    let rt = tokio::runtime::Runtime::new().unwrap();
    let port = rt.block_on(start_video_server(video_path_for_server));
    *port_holder_for_main.lock().unwrap() = port;

    // Start localhost WebSocket sync server on port 9001
    rt.spawn(start_ws_server());

    std::thread::spawn(move || {
        rt.block_on(std::future::pending::<()>());
    });

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .manage(VideoState { path: video_path, port: port_holder })
        .invoke_handler(tauri::generate_handler![
            send_key_to_collection_app,
            inject_bridge_script,
            patch_tag_once_shortcuts,
            patch_tag_once_asar,
            pick_video_file,
            save_xlsx_file,
            google_oauth_sign_in,
            google_oauth_refresh,
            drive_create_sheet,
            cut_clips,
            get_video_url,
            open_file,
            create_google_sheet,
        ])
        .run(tauri::generate_context!())
        .expect("error while running MARK");
}
