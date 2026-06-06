#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::{Arc, Mutex};
use tauri::command;

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
                            .body(Body::from(buf)).unwrap();
                    }
                }
            }
        }

        // No Range header — return full file, signal range support
        let mut buf = vec![0u8; file_size as usize];
        if file.read_exact(&mut buf).is_ok() {
            Response::builder()
                .status(StatusCode::OK)
                .header("Content-Type", mime)
                .header("Content-Length", file_size.to_string())
                .header("Accept-Ranges", "bytes")
                .header("Access-Control-Allow-Origin", "*")
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
        .route("/video", get(serve_video))
        .with_state(video_path);

    let addr = format!("127.0.0.1:{}", port);
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();

    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    port
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

// ─── Inject Bridge command ────────────────────────────────────────────────────
#[command]
fn inject_bridge_script(session_id: String) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    { return inject_bridge_windows(&session_id); }
    #[cfg(not(target_os = "windows"))]
    { let _ = session_id; Ok("dev_noop".to_string()) }
}

#[cfg(target_os = "windows")]
fn inject_bridge_windows(session_id: &str) -> Result<String, String> {
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

    let script = BRIDGE_SCRIPT.replace("__SESSION_ID__", session_id);
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
        sleep(150);

        SendInput(
            &[vk(VK_MENU.0, false), vk(VK_CONTROL.0, false), vk(0x49, false),
              vk(0x49, true), vk(VK_CONTROL.0, true), vk(VK_MENU.0, true)],
            sz,
        );
        sleep(2500);

        SendInput(
            &[vk(VK_CONTROL.0, false), vk(VK_SHIFT.0, false), vk(0x4A, false),
              vk(0x4A, true), vk(VK_SHIFT.0, true), vk(VK_CONTROL.0, true)],
            sz,
        );
        sleep(800);

        let mut char_inputs: Vec<INPUT> = Vec::new();
        for c in "allow pasting".encode_utf16() {
            char_inputs.push(ch(c, false));
            char_inputs.push(ch(c, true));
        }
        SendInput(&char_inputs, sz);
        sleep(120);
        SendInput(&[vk(VK_RETURN.0, false), vk(VK_RETURN.0, true)], sz);
        sleep(600);

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
        sleep(400);
        SendInput(&[vk(VK_RETURN.0, false), vk(VK_RETURN.0, true)], sz);
        sleep(500);

        SendInput(
            &[vk(VK_MENU.0, false), vk(VK_CONTROL.0, false), vk(0x49, false),
              vk(0x49, true), vk(VK_CONTROL.0, true), vk(VK_MENU.0, true)],
            sz,
        );
        sleep(300);

        if !mark_hwnd.is_invalid() {
            SendInput(&[vk(VK_MENU.0, false), vk(VK_MENU.0, true)], sz);
            let _ = SetForegroundWindow(mark_hwnd);
        }
    }

    Ok("injected".to_string())
}

// ─── Legacy command ───────────────────────────────────────────────────────────
#[command]
fn send_key_to_collection_app(_exe_name: String, _key_code: String) -> Result<String, String> {
    Ok("noop".to_string())
}

fn main() {
    let video_path: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    let port_holder: Arc<Mutex<u16>> = Arc::new(Mutex::new(0));

    let video_path_for_server = video_path.clone();
    let port_holder_for_main = port_holder.clone();

    // Start HTTP server before Tauri launches
    let rt = tokio::runtime::Runtime::new().unwrap();
    let port = rt.block_on(start_video_server(video_path_for_server));
    *port_holder_for_main.lock().unwrap() = port;

    // Keep runtime alive in background thread
    std::thread::spawn(move || {
        rt.block_on(std::future::pending::<()>());
    });

    tauri::Builder::default()
        .manage(VideoState { path: video_path, port: port_holder })
        .invoke_handler(tauri::generate_handler![
            send_key_to_collection_app,
            inject_bridge_script,
            pick_video_file,
            get_video_url,
        ])
        .run(tauri::generate_context!())
        .expect("error while running MARK");
}
