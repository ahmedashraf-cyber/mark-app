#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::command;

#[command]
fn send_key_to_collection_app(_exe_name: String, key_code: String) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
        use windows::Win32::UI::WindowsAndMessaging::{
            EnumWindows, GetWindowTextW, GetForegroundWindow,
            SetForegroundWindow,
            // PostMessageA, WM_KEYDOWN, WM_KEYUP, // kept for future use
            // ShowWindow, SW_SHOW,                 // kept for future use
            EnumChildWindows, GetClassNameW,
            WM_LBUTTONDOWN, WM_LBUTTONUP,
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

        // Find MARK's Chrome_WidgetWin child for the fake click
        static MARK_CHROME_HWND: std::sync::atomic::AtomicIsize =
            std::sync::atomic::AtomicIsize::new(0);
        MARK_CHROME_HWND.store(0, std::sync::atomic::Ordering::SeqCst);

        unsafe extern "system" fn enum_chrome_proc(hwnd: HWND, _: LPARAM) -> BOOL {
            let mut buf = [0u16; 256];
            let len = GetClassNameW(hwnd, &mut buf);
            if len > 0 {
                let class = String::from_utf16_lossy(&buf[..len as usize]);
                if class.contains("Chrome_WidgetWin") {
                    MARK_CHROME_HWND.store(hwnd.0 as isize, std::sync::atomic::Ordering::SeqCst);
                    return BOOL(0); // stop — found it
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
            // Save MARK's foreground window
            let mark_hwnd = GetForegroundWindow();

            // Find MARK's Chrome child before we switch focus
            if !mark_hwnd.is_invalid() {
                let _ = EnumChildWindows(Some(mark_hwnd), Some(enum_chrome_proc), LPARAM(0));
            }

            // Helper: build keyboard INPUT
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

            // Step 3: Send the navigation key
            let mut inputs: Vec<INPUT> = Vec::new();
            if needs_shift { inputs.push(make_key(VK_SHIFT.0, false)); }
            inputs.push(make_key(vk, false));
            inputs.push(make_key(vk, true));
            if needs_shift { inputs.push(make_key(VK_SHIFT.0, true)); }
            SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);

            std::thread::sleep(std::time::Duration::from_millis(30));

            // Step 4: Return OS focus to MARK
            if !mark_hwnd.is_invalid() {
                // ALT trick again to allow focus switch back
                SendInput(
                    &[make_key(VK_MENU.0, false), make_key(VK_MENU.0, true)],
                    std::mem::size_of::<INPUT>() as i32,
                );
                SetForegroundWindow(mark_hwnd);
                std::thread::sleep(std::time::Duration::from_millis(20));

                // Step 5: Send a fake left click to MARK's Chrome webview
                // Target: bottom-left area (below the events sidebar) — always empty
                // x=80 (inside left sidebar width ~160px), y=700 (near bottom, below events list)
                // Using MAKELPARAM equivalent: low word = x, high word = y
                let click_coord = LPARAM(((700u32 << 16) | 80u32) as isize);
                let mark_chrome = MARK_CHROME_HWND.load(std::sync::atomic::Ordering::SeqCst);
                let click_target = if mark_chrome != 0 {
                    HWND(mark_chrome as *mut _)
                } else {
                    mark_hwnd
                };

                use windows::Win32::UI::WindowsAndMessaging::PostMessageA;
                let _ = PostMessageA(Some(click_target), WM_LBUTTONDOWN, WPARAM(0), click_coord);
                let _ = PostMessageA(Some(click_target), WM_LBUTTONUP,   WPARAM(0), click_coord);
            }
        }

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
