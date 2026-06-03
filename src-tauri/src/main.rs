#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::command;
use std::io::{Read, Write};
use std::net::TcpStream;

// ── Launch the collection app with CDP debugging port enabled ──────────────
#[command]
fn launch_collection_app(exe_path: String) -> Result<String, String> {
    use std::process::Command;

    // Clean the path — strip surrounding quotes and whitespace that may
    // come from copy-paste, and normalize
    let clean = exe_path.trim().trim_matches('"').trim_matches('\'').to_string();

    let path = std::path::Path::new(&clean);
    if !path.exists() {
        // Return the exact path we tried so the user can verify it
        return Err(format!("File not found at: [{}]", clean));
    }

    // Inject the WebView2 debugging-port env var so Chromium opens port 9222
    // Set the working directory to the exe's folder so it finds its resources
    let mut cmd = Command::new(&clean);
    cmd.env("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "--remote-debugging-port=9222");
    if let Some(parent) = path.parent() {
        cmd.current_dir(parent);
    }
    cmd.spawn().map_err(|e| format!("Failed to launch: {}", e))?;

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

// ── Send navigation to collection app via CDP Runtime.evaluate ─────────────
// Returns the actual result from the page so we can diagnose what happened.
#[command]
fn send_key_via_cdp(key_code: String) -> Result<String, String> {
    use tungstenite::Message;

    // Map to seconds delta + synthetic key info
    let (delta, key, code, kc, shift): (f64, &str, &str, i64, bool) = match key_code.as_str() {
        "RIGHT"       => ( 0.6, "ArrowRight", "ArrowRight", 39, false),
        "LEFT"        => (-0.6, "ArrowLeft",  "ArrowLeft",  37, false),
        "SHIFT_RIGHT" => ( 0.2, "ArrowRight", "ArrowRight", 39, true),
        "SHIFT_LEFT"  => (-0.2, "ArrowLeft",  "ArrowLeft",  37, true),
        "SPACE"       => ( 0.0, " ",          "Space",      32, false),
        _             => return Err("unknown_key".to_string()),
    };

    let ws_url = get_ws_debugger_url()?;
    let (mut socket, _resp) = tungstenite::connect(&ws_url)
        .map_err(|e| format!("ws connect: {}", e))?;

    // Strategy: try BOTH approaches in one JS call and report what we find.
    // 1. Fire synthetic keyboard events (in case app uses key listeners)
    // 2. Directly manipulate the <video> element (most reliable)
    // Return a diagnostic string so we can see what's in the page.
    let js = format!(r#"
        (function() {{
            var report = [];
            var opts = {{ key:"{key}", code:"{code}", keyCode:{kc}, which:{kc}, shiftKey:{shift}, bubbles:true, cancelable:true }};

            // Approach 1: synthetic keyboard events
            [document, window, document.body].forEach(function(t) {{
                if (t) try {{
                    t.dispatchEvent(new KeyboardEvent('keydown', opts));
                    t.dispatchEvent(new KeyboardEvent('keyup', opts));
                }} catch(e) {{}}
            }});

            // Approach 2: direct video control
            var vids = document.querySelectorAll('video');
            report.push("videos=" + vids.length);
            if (vids.length > 0) {{
                var v = vids[0];
                report.push("before=" + v.currentTime.toFixed(2));
                if ({is_space}) {{
                    if (v.paused) v.play(); else v.pause();
                }} else {{
                    v.currentTime = Math.max(0, v.currentTime + ({delta}));
                }}
                report.push("after=" + v.currentTime.toFixed(2));
            }}
            return report.join(" | ");
        }})()
    "#, key=key, code=code, kc=kc, shift=shift, delta=delta,
        is_space=(key_code=="SPACE"));

    let cmd = serde_json::json!({
        "id": 1,
        "method": "Runtime.evaluate",
        "params": { "expression": js, "userGesture": true, "returnByValue": true }
    });

    socket.send(Message::Text(cmd.to_string()))
        .map_err(|e| format!("send eval: {}", e))?;

    // Read the response so we can return the diagnostic
    let mut result = "sent".to_string();
    if let Ok(Message::Text(txt)) = socket.read() {
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&txt) {
            if let Some(val) = parsed.pointer("/result/result/value").and_then(|v| v.as_str()) {
                result = val.to_string();
            }
        }
    }
    let _ = socket.close(None);

    Ok(result)
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
