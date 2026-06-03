#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::command;

#[cfg(target_os = "windows")]
mod hook {
    use std::sync::atomic::{AtomicIsize, AtomicBool};
    pub static COLLECTION_HWND: AtomicIsize = AtomicIsize::new(0);
    pub static HOOK_HANDLE:     AtomicIsize = AtomicIsize::new(0);
    pub static HOOK_ACTIVE:     AtomicBool  = AtomicBool::new(false);
}

#[command]
fn start_sync(_exe_name: String) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        use std::sync::atomic::Ordering;
        use windows::Win32::Foundation::{HWND, LPARAM, WPARAM, HINSTANCE};
        use windows::Win32::UI::WindowsAndMessaging::{
            EnumWindows, GetWindowTextW, GetForegroundWindow,
            SetWindowsHookExW, CallNextHookEx,
            WH_KEYBOARD_LL, KBDLLHOOKSTRUCT,
            PostMessageA, WM_KEYDOWN,
            GetMessageW, MSG, HHOOK,
        };
        use windows::Win32::UI::Input::KeyboardAndMouse::{VK_LEFT, VK_RIGHT, VK_SPACE};
        use windows::Win32::System::LibraryLoader::GetModuleHandleW;
        use windows::core::BOOL;

        // Step 1: Find collection app window
        hook::COLLECTION_HWND.store(0, Ordering::SeqCst);

        unsafe extern "system" fn enum_proc(hwnd: HWND, _: LPARAM) -> BOOL {
            let mut buf = [0u16; 512];
            let len = GetWindowTextW(hwnd, &mut buf);
            if len > 0 {
                let title = String::from_utf16_lossy(&buf[..len as usize]);
                if title.contains("Tag Once Collection App") {
                    hook::COLLECTION_HWND.store(hwnd.0 as isize, std::sync::atomic::Ordering::SeqCst);
                    return BOOL(0);
                }
            }
            BOOL(1)
        }

        unsafe { let _ = EnumWindows(Some(enum_proc), LPARAM(0)); }

        let col_raw = hook::COLLECTION_HWND.load(Ordering::SeqCst);
        if col_raw == 0 {
            return Ok("collection_not_found".to_string());
        }

        // Step 2: Install hook once
        if !hook::HOOK_ACTIVE.load(Ordering::SeqCst) {

            unsafe extern "system" fn keyboard_hook(
                code: i32,
                wparam: WPARAM,
                lparam: LPARAM,
            ) -> windows::Win32::Foundation::LRESULT {
                use std::sync::atomic::Ordering;

                if code >= 0 && wparam.0 as u32 == WM_KEYDOWN {
                    let kb = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
                    let vk = kb.vkCode as u16;
                    let is_nav = vk == VK_LEFT.0 || vk == VK_RIGHT.0 || vk == VK_SPACE.0;

                    if is_nav {
                        let fg = GetForegroundWindow();
                        let mut buf = [0u16; 256];
                        let len = GetWindowTextW(fg, &mut buf);
                        let title = if len > 0 {
                            String::from_utf16_lossy(&buf[..len as usize])
                        } else {
                            String::new()
                        };

                        if title.contains("MARK") {
                            let col_raw = hook::COLLECTION_HWND.load(Ordering::SeqCst);
                            if col_raw != 0 {
                                let col_hwnd = HWND(col_raw as *mut _);
                                let _ = PostMessageA(
                                    Some(col_hwnd),
                                    WM_KEYDOWN,
                                    WPARAM(vk as usize),
                                    LPARAM(0),
                                );
                            }
                        }
                    }
                }

                // Pass key through — MARK still receives it normally
                CallNextHookEx(
                    Some(HHOOK(hook::HOOK_HANDLE.load(Ordering::SeqCst) as *mut _)),
                    code, wparam, lparam,
                )
            }

            unsafe {
                let hmod = GetModuleHandleW(windows::core::PCWSTR::null())
                    .map_err(|e| e.to_string())?;
                // Cast HMODULE to HINSTANCE — same underlying type in Win32
                let hinstance = HINSTANCE(hmod.0);
                let hhook = SetWindowsHookExW(
                    WH_KEYBOARD_LL,
                    Some(keyboard_hook),
                    Some(hinstance),
                    0,
                ).map_err(|e| e.to_string())?;
                hook::HOOK_HANDLE.store(hhook.0 as isize, Ordering::SeqCst);
                hook::HOOK_ACTIVE.store(true, Ordering::SeqCst);
            }

            // Message loop thread — required for WH_KEYBOARD_LL to fire
            std::thread::spawn(|| {
                unsafe {
                    let mut msg = MSG::default();
                    while GetMessageW(&mut msg, None, 0, 0).as_bool() {}
                }
            });
        }

        Ok("hook_started".to_string())
    }

    #[cfg(not(target_os = "windows"))]
    {
        println!("[SYNC dev] start_sync called");
        Ok("dev_noop".to_string())
    }
}

// Kept for JS compatibility — hook now handles forwarding
#[command]
fn send_key_to_collection_app(_exe_name: String, _key_code: String) -> Result<String, String> {
    Ok("hook_handles_this".to_string())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            start_sync,
            send_key_to_collection_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running MARK");
}
