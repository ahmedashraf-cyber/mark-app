#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::command;

// Find the deepest Chrome_WidgetWin child of a window — that's the actual webview that handles keys
#[cfg(target_os = "windows")]
unsafe fn find_chrome_child(parent: windows::Win32::Foundation::HWND) -> windows::Win32::Foundation::HWND {
    use windows::Win32::Foundation::{HWND, LPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{EnumChildWindows, GetClassNameW};
    use windows::core::BOOL;

    static CHROME_HWND: std::sync::atomic::AtomicIsize = std::sync::atomic::AtomicIsize::new(0);
    CHROME_HWND.store(0, std::sync::atomic::Ordering::SeqCst);

    unsafe extern "system" fn child_proc(hwnd: HWND, _: LPARAM) -> BOOL {
        let mut buf = [0u16; 256];
        let len = GetClassNameW(hwnd, &mut buf);
        if len > 0 {
            let name = String::from_utf16_lossy(&buf[..len as usize]);
            if name.contains("Chrome_WidgetWin") || name.contains("Chrome_RenderWidgetHostHWND") {
                CHROME_HWND.store(hwnd.0 as isize, std::sync::atomic::Ordering::SeqCst);
                return BOOL(0); // stop — found it
            }
        }
        BOOL(1)
    }

    let _ = EnumChildWindows(Some(parent), Some(child_proc), LPARAM(0));
    let raw = CHROME_HWND.load(std::sync::atomic::Ordering::SeqCst);
    HWND(raw as *mut _)
}

#[command]
fn send_key_to_collection_app(_exe_name: String, key_code: String) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
        use windows::Win32::UI::WindowsAndMessaging::{
            EnumWindows, GetWindowTextW,
            PostMessageA, WM_KEYDOWN, WM_KEYUP,
        };
        use windows::Win32::UI::Input::KeyboardAndMouse::{
            VK_LEFT, VK_RIGHT, VK_SHIFT, VK_SPACE,
        };
        use windows::core::BOOL;

        // Map key to virtual key code and scan code
        let (vk, scan, needs_shift): (u16, u16, bool) = match key_code.as_str() {
            "RIGHT"       => (VK_RIGHT.0, 0x4D, false),
            "LEFT"        => (VK_LEFT.0,  0x4B, false),
            "SHIFT_RIGHT" => (VK_RIGHT.0, 0x4D, true),
            "SHIFT_LEFT"  => (VK_LEFT.0,  0x4B, true),
            "SPACE"       => (VK_SPACE.0, 0x39, false),
            _             => return Ok("unknown_key".to_string()),
        };

        // Find collection app top-level window
        static FOUND_HWND: std::sync::atomic::AtomicIsize = std::sync::atomic::AtomicIsize::new(0);
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

        let top_hwnd = HWND(raw as *mut _);

        unsafe {
            // Find the Chrome webview child — it processes key messages directly
            let chrome_hwnd = find_chrome_child(top_hwnd);
            // Use chrome child if found, otherwise fall back to top-level
            let target = if !chrome_hwnd.is_invalid() && chrome_hwnd.0 != std::ptr::null_mut() {
                chrome_hwnd
            } else {
                top_hwnd
            };

            // Build lParam for key messages:
            // bits 0-15: repeat count (1)
            // bits 16-23: scan code
            // bit 24: extended key flag (1 for arrow keys)
            let make_lparam = |scan: u16, extended: bool, up: bool| -> LPARAM {
                let mut lp: u32 = 1; // repeat count
                lp |= (scan as u32) << 16;
                if extended { lp |= 1 << 24; }
                if up {
                    lp |= 1 << 30; // previous key state
                    lp |= 1 << 31; // transition state
                }
                LPARAM(lp as isize)
            };

            // Arrow keys are extended keys
            let extended = matches!(key_code.as_str(), "RIGHT"|"LEFT"|"SHIFT_RIGHT"|"SHIFT_LEFT");

            if needs_shift {
                let _ = PostMessageA(Some(target), WM_KEYDOWN, WPARAM(VK_SHIFT.0 as usize), make_lparam(0x2A, false, false));
            }
            let _ = PostMessageA(Some(target), WM_KEYDOWN, WPARAM(vk as usize), make_lparam(scan, extended, false));
            let _ = PostMessageA(Some(target), WM_KEYUP,   WPARAM(vk as usize), make_lparam(scan, extended, true));
            if needs_shift {
                let _ = PostMessageA(Some(target), WM_KEYUP, WPARAM(VK_SHIFT.0 as usize), make_lparam(0x2A, false, true));
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
