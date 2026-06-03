#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::command;

// Virtual key codes
const VK_LEFT:  u16 = 0x25;
const VK_RIGHT: u16 = 0x27;
const VK_SHIFT: u16 = 0x10;
const VK_SPACE: u16 = 0x20;
const WM_KEYDOWN: u32 = 0x0100;
const WM_KEYUP:   u32 = 0x0101;

#[command]
fn send_key_to_collection_app(exe_name: String, key_code: String) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::{
            FindWindowA, PostMessageA, LPARAM, WPARAM,
        };
        use windows::core::PCSTR;

        // Map key_code to VK
        let vk: u16 = match key_code.as_str() {
            "RIGHT"       => VK_RIGHT,
            "LEFT"        => VK_LEFT,
            "SHIFT_RIGHT" => VK_RIGHT,
            "SHIFT_LEFT"  => VK_LEFT,
            "SPACE"       => VK_SPACE,
            _             => return Ok("unknown_key".to_string()),
        };

        let needs_shift = key_code == "SHIFT_RIGHT" || key_code == "SHIFT_LEFT";

        unsafe {
            // Find window by exe name using EnumWindows approach
            // First try FindWindow with NULL class (searches by title pattern)
            // The collection app window title: "Tag Once Collection App / ..."
            let title_cstr = std::ffi::CString::new("Tag Once Collection App")
                .map_err(|e| e.to_string())?;

            let hwnd = FindWindowA(PCSTR::null(), PCSTR::from_raw(title_cstr.as_ptr() as _));

            let hwnd = if hwnd.0.is_null() {
                // Try finding by partial title — enumerate all windows
                find_window_by_exe(&exe_name)?
            } else {
                hwnd
            };

            if hwnd.0.is_null() {
                return Ok("window_not_found".to_string());
            }

            // Send shift down if needed
            if needs_shift {
                let _ = PostMessageA(
                    hwnd,
                    WM_KEYDOWN,
                    WPARAM(VK_SHIFT as usize),
                    LPARAM(0),
                );
            }

            // Send main key down + up
            let _ = PostMessageA(hwnd, WM_KEYDOWN, WPARAM(vk as usize), LPARAM(0));
            let _ = PostMessageA(hwnd, WM_KEYUP,   WPARAM(vk as usize), LPARAM(0));

            // Send shift up if needed
            if needs_shift {
                let _ = PostMessageA(
                    hwnd,
                    WM_KEYUP,
                    WPARAM(VK_SHIFT as usize),
                    LPARAM(0),
                );
            }

            Ok("sent".to_string())
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        println!("[MARK SYNC dev] {} -> {}", key_code, exe_name);
        Ok("dev_noop".to_string())
    }
}

#[cfg(target_os = "windows")]
fn find_window_by_exe(exe_name: &str) -> Result<windows::Win32::Foundation::HWND, String> {
    use windows::Win32::Foundation::{BOOL, HWND, LPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{EnumWindows, GetWindowTextW, IsWindowVisible};
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId;
    use std::sync::{Arc, Mutex};

    let result = Arc::new(Mutex::new(windows::Win32::Foundation::HWND(std::ptr::null_mut())));
    let result_clone = result.clone();
    let exe_lower = exe_name.to_lowercase();

    unsafe {
        let _ = EnumWindows(
            Some(enum_windows_proc),
            LPARAM(Box::into_raw(Box::new((result_clone, exe_lower))) as isize),
        );
    }

    let hwnd = *result.lock().unwrap();
    Ok(hwnd)
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn enum_windows_proc(
    hwnd: windows::Win32::Foundation::HWND,
    lparam: windows::Win32::Foundation::LPARAM,
) -> windows::Win32::Foundation::BOOL {
    use windows::Win32::UI::WindowsAndMessaging::{GetWindowThreadProcessId, IsWindowVisible};
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::Foundation::BOOL;

    let data = &*(lparam.0 as *mut (
        std::sync::Arc<std::sync::Mutex<windows::Win32::Foundation::HWND>>,
        String,
    ));

    if IsWindowVisible(hwnd).as_bool() {
        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid != 0 {
            if let Ok(proc) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
                let mut buf = vec![0u16; 512];
                let mut size = buf.len() as u32;
                if QueryFullProcessImageNameW(proc, windows::Win32::System::Threading::PROCESS_NAME_WIN32, windows::core::PWSTR(buf.as_mut_ptr()), &mut size).is_ok() {
                    let path = String::from_utf16_lossy(&buf[..size as usize]).to_lowercase();
                    if path.contains(&data.1.to_lowercase().replace(".exe", "")) {
                        *data.0.lock().unwrap() = hwnd;
                        return BOOL(0); // stop enumeration
                    }
                }
            }
        }
    }
    BOOL(1) // continue
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![send_key_to_collection_app])
        .run(tauri::generate_context!())
        .expect("error while running MARK");
}
