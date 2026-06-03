#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::command;

/// Sends a keystroke to the collection app window without focusing it
/// Uses Windows SendMessage/PostMessage API via AHK subprocess approach
/// In development (non-Windows) this is a no-op
#[command]
async fn send_key_to_collection_app(exe_name: String, key_code: String) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        
        // Build AHK script content for the key
        let ahk_key = match key_code.as_str() {
            "RIGHT"       => "{Right}",
            "LEFT"        => "{Left}",
            "SHIFT_RIGHT" => "+{Right}",
            "SHIFT_LEFT"  => "+{Left}",
            "SPACE"       => "{Space}",
            _             => return Err(format!("Unknown key code: {}", key_code)),
        };
        
        let script = format!(
            "ControlSend, , {}, ahk_exe {}\nExitApp",
            ahk_key, exe_name
        );
        
        // Write temp script
        let tmp = std::env::temp_dir().join("mark_sync.ahk");
        std::fs::write(&tmp, script).map_err(|e| e.to_string())?;
        
        // Run with AutoHotkey if available
        // Look for AHK in common install paths
        let ahk_paths = [
            "C:\\Program Files\\AutoHotkey\\AutoHotkey.exe",
            "C:\\Program Files (x86)\\AutoHotkey\\AutoHotkey.exe",
        ];
        
        for ahk_path in &ahk_paths {
            if std::path::Path::new(ahk_path).exists() {
                let _ = Command::new(ahk_path)
                    .arg(tmp.to_str().unwrap_or(""))
                    .spawn();
                return Ok("sent".to_string());
            }
        }
        
        // AHK not found — try direct Windows API via PowerShell as fallback
        let ps_script = format!(
            r#"
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {{
    [DllImport("user32.dll")] public static extern IntPtr FindWindow(string a, string b);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
}}
"@
$hwnd = [Win32]::FindWindow([NullString]::Value, $null)
# Find by process name
$proc = Get-Process | Where-Object {{ $_.MainWindowTitle -ne "" -and $_.ProcessName -like "*{}*" }} | Select-Object -First 1
if ($proc) {{
    $hwnd = $proc.MainWindowHandle
    # WM_KEYDOWN = 0x0100, VK_RIGHT = 0x27
    [Win32]::PostMessage($hwnd, 0x0100, [IntPtr]0x27, [IntPtr]0)
}}
"#,
            exe_name.replace(".exe", "")
        );
        
        let _ = Command::new("powershell")
            .args(["-NoProfile", "-Command", &ps_script])
            .spawn();
        
        Ok("sent_via_powershell".to_string())
    }
    
    #[cfg(not(target_os = "windows"))]
    {
        // Dev mode on Mac/Linux — log only
        println!("[MARK SYNC] Would send {} to {}", key_code, exe_name);
        Ok("dev_noop".to_string())
    }
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![send_key_to_collection_app])
        .run(tauri::generate_context!())
        .expect("error while running MARK");
}
