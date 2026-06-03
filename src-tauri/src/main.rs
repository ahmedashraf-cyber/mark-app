#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::command;

#[command]
fn send_key_to_collection_app(exe_name: String, key_code: String) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
        use windows::Win32::UI::WindowsAndMessaging::{
            FindWindowA, PostMessageA, WM_KEYDOWN, WM_KEYUP,
        };
        use windows::Win32::UI::Input::KeyboardAndMouse::{
            VK_LEFT, VK_RIGHT, VK_SHIFT, VK_SPACE,
        };
        use windows::core::PCSTR;

        let (vk, needs_shift) = match key_code.as_str() {
            "RIGHT"       => (VK_RIGHT.0 as usize, false),
            "LEFT"        => (VK_LEFT.0  as usize, false),
            "SHIFT_RIGHT" => (VK_RIGHT.0 as usize, true),
            "SHIFT_LEFT"  => (VK_LEFT.0  as usize, true),
            "SPACE"       => (VK_SPACE.0 as usize, false),
            _             => return Ok("unknown_key".to_string()),
        };

        unsafe {
            let title = std::ffi::CString::new("Tag Once Collection App")
                .map_err(|e| e.to_string())?;

            let hwnd: HWND = FindWindowA(PCSTR::null(), PCSTR::from_raw(title.as_ptr() as _))
                .map_err(|_| "window_not_found".to_string())?;

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
        println!("[MARK SYNC dev] {} -> {}", key_code, exe_name);
        Ok("dev_noop".to_string())
    }
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![send_key_to_collection_app])
        .run(tauri::generate_context!())
        .expect("error while running MARK");
}
