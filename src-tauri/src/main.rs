#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::command;

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

        let (vk, needs_shift) = match key_code.as_str() {
            "RIGHT"       => (VK_RIGHT.0 as usize, false),
            "LEFT"        => (VK_LEFT.0  as usize, false),
            "SHIFT_RIGHT" => (VK_RIGHT.0 as usize, true),
            "SHIFT_LEFT"  => (VK_LEFT.0  as usize, true),
            "SPACE"       => (VK_SPACE.0 as usize, false),
            _             => return Ok("unknown_key".to_string()),
        };

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
                    return BOOL(0); // stop enumeration
                }
            }
            BOOL(1) // continue
        }

        unsafe { let _ = EnumWindows(Some(enum_proc), LPARAM(0)); }

        let raw = FOUND_HWND.load(std::sync::atomic::Ordering::SeqCst);
        if raw == 0 {
            return Ok("window_not_found".to_string());
        }

        let hwnd = HWND(raw as *mut _);

        unsafe {
            if needs_shift {
                let _ = PostMessageA(Some(hwnd), WM_KEYDOWN, WPARAM(VK_SHIFT.0 as usize), LPARAM(0));
            }
            let _ = PostMessageA(Some(hwnd), WM_KEYDOWN, WPARAM(vk), LPARAM(0));
            let _ = PostMessageA(Some(hwnd), WM_KEYUP,   WPARAM(vk), LPARAM(0));
            if needs_shift {
                let _ = PostMessageA(Some(hwnd), WM_KEYUP, WPARAM(VK_SHIFT.0 as usize), LPARAM(0));
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
