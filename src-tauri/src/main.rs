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

// ─── Open a file or URL using the system default application ─────────────────
#[command]
fn open_file(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        if path.starts_with("http://") || path.starts_with("https://") {
            // Open URL in default browser
            std::process::Command::new("cmd")
                .args(["/c", "start", "", &path])
                .spawn()
                .map_err(|e| format!("Failed to open URL: {}", e))?;
        } else {
            // Open file with default app via PowerShell
            std::process::Command::new("powershell")
                .args(["-NoProfile", "-Command", &format!("Invoke-Item '{}'", path.replace('\'', "''"))])
                .spawn()
                .map_err(|e| format!("Failed to open file: {}", e))?;
        }
    }
    Ok(())
}
#[command]
fn send_key_to_collection_app(_exe_name: String, _key_code: String) -> Result<String, String> {
    Ok("noop".to_string())
}


// --- Google Sheets API via Service Account JWT --------------------------------
const SA_CLIENT_EMAIL: &str = "mark-reporter@hudl-studio.iam.gserviceaccount.com";
const SA_PRIVATE_KEY: &str = "-----BEGIN PRIVATE KEY-----\nMIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQC6LAc8XSxg5QLj\nfctNEIVaogAnA1WSvS1UtM8slnFGJSRc63OEhw6Y4SYaF/63XRlzevPHM5d825YZ\nHaxukZnHrOi436kq9+LzxBUnN0h9tGX9MaFoHHg1ra+Hj7fEHyZShVEkR6ogecG8\nbYuWXz1Un5f4hp4009ZbRx0bVYvYnyi6gCiFVNZZcAU4GzFo9jVVrbwyjL9OHHdl\nkmwRb+C/k57FnoE5vBMb2HZf3Q9H/CbBDK5IapNVG0Hib26MuPS4/kx5fBSr5DKl\n5AcfMrddh2YDgOpYwwgSgSKKfXmcZ2Iu6bMaG7Jv+j+i+CFaRN7kVmifsAK8mKQE\nZYLWzKz1AgMBAAECggEAFf1vWVz0Cfni7nYEVnT2G295LyKAsBVyTkgRFIYsmQl4\nExWojmXZfotRkdF1v7jacb57HvNkGFZjk1Hi9ShzjpdI4dVhSPcAsqRdj0VDZb2y\nMkbzdrWuKUD7s7pxDVRUlXizzeI9IRrgnF4gF8HmH6G+NJfKBhljf2KV+I2ROCPY\n+tfwH8iJuIyZL7PTcSTxg54UUhCY6+arCkJ2tF268MJCb6ydrXGDzgQU5CfNWQNY\n9o1jK8BggvSr0LVxPiF6otITH3AhgLal+E5T3CdORfLR1PU9hMCSii6xxr7Q3EDM\nsY1x/BoIz9jRZwg9FfKn4ZAGClsHlZmWTzDZ0pSWPQKBgQDdLdfFp03MZpkdrZti\nznpMd+8peUiYp7gJ6UXy2Mrf2Ne76v5j+rY8J9GAQr3glR0bLCfRvQKkxE1xPmW6\n3YdkfNsSrj42sYmbBWeLvzEmDg/0MgyoI45epvnOKwotiuDdjxV8qTGG6l6kYCmR\n+3r9i/MqPsGPUv++aRifUxtqPwKBgQDXe0xiessqDqymHgbt0rl3JpRYDTPIDSgK\n539FcDBaaExVFQ9Ay5EXjkXEAP0i1RwHQK864/vyjmI+Y8XonI0Lacjg6oSj6Tfg\n6bpaBh1VNm3UC59/0ZgHjBhx7Gk5P7yGMzhmJNoAVeYsLnr0GOs4nIypSJbQyIEf\nQZMH+iNTywKBgBTbUdGNqURxGFc4G8MBfX7ggGkEyte6WRx2JuZzkw3wwMczrbF3\n3t9lUdgqcwVOimQZkdexXyJycGsRWz53zWCodXAZhjxaGYPIyq7e5J+WC+MXJSJl\n1/MNA9lxLZCF3BaIe5o5yjXSvAH8H29oq3xlShTdvhrp1Lv75RqBF8C5AoGActCX\n2sFjD33SMJE/T+lAOWStFl2ygZ3BAE5pWi51FTcNtSgLgJL3NH3yXoXIW48B6Dtn\nIxHnZU7IukWfZlpELRiomG9dTZku1QC08tLfPlBKJPoseobLYvoa7FjzmDWF1lvk\naUipgBRFGLWLfhTpALkpmem7snOjmWvvVAjMWhECgYB4CdgjA8nGZiGb+SSfAkXT\nHpPWLkD3UdNBX1zc8GOZeT59UzyGzqQ/yxhUzYixHDLRRa1hJqrU/nlkZCGus2HE\nbWOnU3k713wI/8qoBywrtVDDejLHOYqwJwQHjy8MsnZTggs6+RWpbGqeq8CUA6Lg\n9Ay6VxPbsVq7lICbee2LoA==\n-----END PRIVATE KEY-----\n";

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

    std::thread::spawn(move || {
        rt.block_on(std::future::pending::<()>());
    });

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .manage(VideoState { path: video_path, port: port_holder })
        .invoke_handler(tauri::generate_handler![
            send_key_to_collection_app,
            inject_bridge_script,
            pick_video_file,
            get_video_url,
            open_file,
            create_google_sheet,
        ])
        .run(tauri::generate_context!())
        .expect("error while running MARK");
}
