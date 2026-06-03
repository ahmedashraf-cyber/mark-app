#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::command;
use std::io::{Read, Write};
use std::net::TcpStream;

// ── Launch the collection app with CDP debugging port enabled ──────────────
#[command]
fn launch_collection_app(exe_path: String) -> Result<String, String> {
    use std::process::Command;

    if !std::path::Path::new(&exe_path).exists() {
        return Err(format!("File not found: {}", exe_path));
    }

    // Inject the WebView2 debugging-port env var so Chromium opens port 9222
    Command::new(&exe_path)
        .env("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "--remote-debugging-port=9222")
        .spawn()
        .map_err(|e| format!("Failed to launch: {}", e))?;

    Ok("launched".to_string())
}

// ── Check if the CDP debug port is reachable ───────────────────────────────
#[command]
fn check_cdp_available() -> Result<bool, String> {
    match get_ws_debugger_url() {
        Ok(_) => Ok(true),
        Err(_) => Ok(false),
    }
}

// ── HTTP GET 127.0.0.1:9222/json → extract webSocketDebuggerUrl ────────────
fn get_ws_debugger_url() -> Result<String, String> {
    let mut stream = TcpStream::connect("127.0.0.1:9222")
        .map_err(|e| format!("connect failed: {}", e))?;
    stream
        .set_read_timeout(Some(std::time::Duration::from_millis(1500)))
        .ok();

    let req = "GET /json HTTP/1.1\r\nHost: 127.0.0.1:9222\r\nConnection: close\r\n\r\n";
    stream.write_all(req.as_bytes()).map_err(|e| e.to_string())?;

    let mut response = String::new();
    stream.read_to_string(&mut response).map_err(|e| e.to_string())?;

    // Find the body (after \r\n\r\n)
    let body = response
        .split("\r\n\r\n")
        .nth(1)
        .ok_or("no body in response")?;

    // Parse JSON array, find first "page" type with a webSocketDebuggerUrl
    let parsed: serde_json::Value =
        serde_json::from_str(body).map_err(|e| format!("json parse: {}", e))?;

    if let Some(arr) = parsed.as_array() {
        // Prefer a "page" type target
        for item in arr {
            let typ = item.get("type").and_then(|t| t.as_str()).unwrap_or("");
            if typ == "page" {
                if let Some(url) = item.get("webSocketDebuggerUrl").and_then(|u| u.as_str()) {
                    return Ok(url.to_string());
                }
            }
        }
        // Fallback: first item with any webSocketDebuggerUrl
        for item in arr {
            if let Some(url) = item.get("webSocketDebuggerUrl").and_then(|u| u.as_str()) {
                return Ok(url.to_string());
            }
        }
    }

    Err("no webSocketDebuggerUrl found".to_string())
}

// ── Send a key to the collection app via CDP Input.dispatchKeyEvent ────────
#[command]
fn send_key_via_cdp(key_code: String) -> Result<String, String> {
    use tungstenite::Message;

    // Map key_code → (windowsVirtualKeyCode, key name, code, shift)
    let (vk, key_name, code, needs_shift): (i64, &str, &str, bool) = match key_code.as_str() {
        "RIGHT"       => (39, "ArrowRight", "ArrowRight", false),
        "LEFT"        => (37, "ArrowLeft",  "ArrowLeft",  false),
        "SHIFT_RIGHT" => (39, "ArrowRight", "ArrowRight", true),
        "SHIFT_LEFT"  => (37, "ArrowLeft",  "ArrowLeft",  true),
        "SPACE"       => (32, " ",          "Space",      false),
        _             => return Err("unknown_key".to_string()),
    };

    let ws_url = get_ws_debugger_url()?;

    let (mut socket, _resp) = tungstenite::connect(&ws_url)
        .map_err(|e| format!("ws connect: {}", e))?;

    // CDP modifiers bitmask: Shift = 8
    let modifiers = if needs_shift { 8 } else { 0 };

    // keyDown
    let down = serde_json::json!({
        "id": 1,
        "method": "Input.dispatchKeyEvent",
        "params": {
            "type": "keyDown",
            "windowsVirtualKeyCode": vk,
            "nativeVirtualKeyCode": vk,
            "key": key_name,
            "code": code,
            "modifiers": modifiers,
            "text": if key_code == "SPACE" { " " } else { "" }
        }
    });
    // keyUp
    let up = serde_json::json!({
        "id": 2,
        "method": "Input.dispatchKeyEvent",
        "params": {
            "type": "keyUp",
            "windowsVirtualKeyCode": vk,
            "nativeVirtualKeyCode": vk,
            "key": key_name,
            "code": code,
            "modifiers": modifiers
        }
    });

    socket.send(Message::Text(down.to_string()))
        .map_err(|e| format!("send down: {}", e))?;
    socket.send(Message::Text(up.to_string()))
        .map_err(|e| format!("send up: {}", e))?;

    // Read responses briefly to ensure delivery, then close
    let _ = socket.read();
    let _ = socket.close(None);

    Ok("sent".to_string())
}

// ── Legacy Win32 command — kept for fallback/compatibility ─────────────────
#[command]
fn send_key_to_collection_app(_exe_name: String, _key_code: String) -> Result<String, String> {
    // Superseded by send_key_via_cdp — kept so older JS calls don't error
    Ok("use_cdp_instead".to_string())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            launch_collection_app,
            check_cdp_available,
            send_key_via_cdp,
            send_key_to_collection_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running MARK");
}
