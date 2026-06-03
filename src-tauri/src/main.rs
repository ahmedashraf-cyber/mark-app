#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::command;

#[command]
fn send_key_to_collection_app(
    window: tauri::Window,  // Tauri injects this — gives us set_focus() which calls WebView2 MoveFocus
    _exe_name: String,
    key_code: String,
) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
        use windows::Win32::UI::WindowsAndMessaging::{
            EnumWindows, GetWindowTextW, GetForegroundWindow,
            SetForegroundWindow,
            // PostMessageA, WM_KEYDOWN, WM_KEYUP, // kept for future use
            // ShowWindow, SW_SHOW,                 // kept for future use
        };
        use windows::Win32::UI::Input::KeyboardAndMouse::{
            SendInput, INPUT, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS,
            KEYEVENTF_KEYUP, VK_LEFT, VK_RIGHT, VK_SHIFT, VK_SPACE, VK_MENU,
            VIRTUAL_KEY,
        };
        use windows::core::BOOL;

        let (vk, needs_shift) = match key_code.as_str() {
            "RIGHT"       => (VK_RIGHT.0, false),
            "LEFT"        => (VK_LEFT.0,  false),
            "SHIFT_RIGHT" => (VK_RIGHT.0, true),
            "SHIFT_LEFT"  => (VK_LEFT.0,  true),
            "SPACE"       => (VK_SPACE.0, false),
            _             => return Ok("unknown_key".to_string()),
        };

        // Find collection app window by partial title
        static FOUND_HWND: std::sync::atomic::AtomicIsize =
            std::sync::atomic::AtomicIsize::new(0);
        FOUND_HWND.store(0, std::sync::atomic::Ordering::SeqCst);

        unsafe extern "system" fn enum_proc(hwnd: HWND, _: LPARAM) -> BOOL {
            let mut buf = [0u16; 512];
            let len = GetWindowTextW(hwnd, &mut buf);
            if len > 0 {
                let title = String::from_utf16_lossy(&buf[..len as usize]);
                if title.contains("Tag Once Collection App") {
                    FOUND_HWND.store(hwnd.0 as isize, std::sync::atomic::Ordering::SeqCst);
                    return BOOL(0);
                }
            }
            BOOL(1)
        }

        unsafe { let _ = EnumWindows(Some(enum_proc), LPARAM(0)); }

        let raw = FOUND_HWND.load(std::sync::atomic::Ordering::SeqCst);
        if raw == 0 {
            return Ok("window_not_found".to_string());
        }

        let collection_hwnd = HWND(raw as *mut _);

        unsafe {
            // Save current foreground window (MARK itself)
            let mark_hwnd = GetForegroundWindow();

            // Helper: build keyboard INPUT struct
            let make_key = |vk: u16, up: bool| -> INPUT {
                INPUT {
                    r#type: INPUT_KEYBOARD,
                    Anonymous: windows::Win32::UI::Input::KeyboardAndMouse::INPUT_0 {
                        ki: KEYBDINPUT {
                            wVk: VIRTUAL_KEY(vk),
                            wScan: 0,
                            dwFlags: if up { KEYEVENTF_KEYUP } else { KEYBD_EVENT_FLAGS(0) },
                            time: 0,
                            dwExtraInfo: 0,
                        }
                    }
                }
            };

            // Step 1: ALT trick — unlocks SetForegroundWindow across processes
            SendInput(
                &[make_key(VK_MENU.0, false), make_key(VK_MENU.0, true)],
                std::mem::size_of::<INPUT>() as i32,
            );

            // Step 2: Focus collection app
            SetForegroundWindow(collection_hwnd);
            std::thread::sleep(std::time::Duration::from_millis(30));

            // Step 3: Send the navigation key via SendInput
            let mut inputs: Vec<INPUT> = Vec::new();
            if needs_shift { inputs.push(make_key(VK_SHIFT.0, false)); }
            inputs.push(make_key(vk, false));
            inputs.push(make_key(vk, true));
            if needs_shift { inputs.push(make_key(VK_SHIFT.0, true)); }
            SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);

            std::thread::sleep(std::time::Duration::from_millis(30));

            // Step 4: Return focus using Tauri's set_focus() instead of raw Win32
            // set_focus() internally calls WebView2 MoveFocus — wakes up Chromium keyboard listener
            let _ = mark_hwnd; // mark_hwnd no longer needed — Tauri handles it
        }

        window.set_focus().map_err(|e| e.to_string())?;

        Ok("sent".to_string())
    }

    #[cfg(not(target_os = "windows"))]
    {
        println!("[MARK SYNC dev] {} -> {}", _exe_name, key_code);
        Ok("dev_noop".to_string())
    }
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![send_key_to_collection_app])
        .run(tauri::generate_context!())
        .expect("error while running MARK");
}
