#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::command;

// ── Global state for the keyboard hook ────────────────────────────────────
#[cfg(target_os = "windows")]
mod hook {
    use std::sync::atomic::{AtomicIsize, AtomicBool, Ordering};

    // HWND of the collection app — set once when found, reused every keystroke
    pub static COLLECTION_HWND: AtomicIsize = AtomicIsize::new(0);
    // HHOOK handle — stored so we can unhook on shutdown
    pub static HOOK_HANDLE: AtomicIsize = AtomicIsize::new(0);
    // Whether hook is active
    pub static HOOK_ACTIVE: AtomicBool = AtomicBool::new(false);
}

// ── Tauri command: start the hook + find collection app window ────────────
#[command]
fn start_sync(exe_name: String) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
        use windows::Win32::UI::WindowsAndMessaging::{
            EnumWindows, GetWindowTextW,
            SetWindowsHookExW, WH_KEYBOARD_LL,
            CallNextHookEx, KBDLLHOOKSTRUCT,
            PostMessageA, WM_KEYDOWN, WM_KEYUP,
        };
        use windows::Win32::UI::Input::KeyboardAndMouse::{
            VK_LEFT, VK_RIGHT, VK_SHIFT, VK_SPACE,
            SendInput, INPUT, INPUT_KEYBOARD, KEYBDINPUT,
            KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP, VK_MENU, VIRTUAL_KEY,
        };
        use windows::Win32::System::LibraryLoader::GetModuleHandleW;
        use windows::core::BOOL;

        // Step 1: Find the collection app window
        hook::COLLECTION_HWND.store(0, std::sync::atomic::Ordering::SeqCst);

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

        let col_raw = hook::COLLECTION_HWND.load(std::sync::atomic::Ordering::SeqCst);
        if col_raw == 0 {
            return Ok("collection_not_found".to_string());
        }

        // Step 2: Install low-level keyboard hook if not already active
        if !hook::HOOK_ACTIVE.load(std::sync::atomic::Ordering::SeqCst) {

            // The hook callback — called for every keypress system-wide
            unsafe extern "system" fn keyboard_hook(
                code: i32,
                wparam: WPARAM,
                lparam: LPARAM,
            ) -> windows::Win32::Foundation::LRESULT {
                use windows::Win32::UI::WindowsAndMessaging::{
                    GetForegroundWindow, GetWindowTextW, CallNextHookEx,
                    HC_ACTION, HHOOK,
                    WM_KEYDOWN, PostMessageA,
                };
                use windows::Win32::UI::Input::KeyboardAndMouse::KBDLLHOOKSTRUCT;

                if code >= 0 && wparam.0 as u32 == WM_KEYDOWN {
                    let kb = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
                    let vk = kb.vkCode as u16;

                    // Only forward navigation keys
                    let is_nav = vk == VK_LEFT.0 || vk == VK_RIGHT.0 || vk == VK_SPACE.0;

                    if is_nav {
                        // Check if MARK is the foreground window
                        let fg = GetForegroundWindow();
                        let mut buf = [0u16; 256];
                        let len = GetWindowTextW(fg, &mut buf);
                        let title = if len > 0 {
                            String::from_utf16_lossy(&buf[..len as usize])
                        } else {
                            String::new()
                        };

                        // Only forward when MARK is focused
                        if title.contains("MARK") {
                            let col_raw = hook::COLLECTION_HWND.load(std::sync::atomic::Ordering::SeqCst);
                            if col_raw != 0 {
                                let col_hwnd = HWND(col_raw as *mut _);
                                // Post key directly to collection app — no focus change
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

                // Always pass the key through — MARK still receives it normally
                CallNextHookEx(
                    windows::Win32::UI::WindowsAndMessaging::HHOOK(
                        hook::HOOK_HANDLE.load(std::sync::atomic::Ordering::SeqCst) as *mut _
                    ),
                    code, wparam, lparam,
                )
            }

            unsafe {
                let hmod = GetModuleHandleW(windows::core::PCWSTR::null())
                    .map_err(|e| e.to_string())?;
                let hhook = SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_hook), hmod, 0)
                    .map_err(|e| e.to_string())?;
                hook::HOOK_HANDLE.store(hhook.0 as isize, std::sync::atomic::Ordering::SeqCst);
                hook::HOOK_ACTIVE.store(true, std::sync::atomic::Ordering::SeqCst);
            }

            // Spin a background thread to run the Windows message loop
            // Required for WH_KEYBOARD_LL hooks to fire
            std::thread::spawn(|| {
                unsafe {
                    use windows::Win32::UI::WindowsAndMessaging::{GetMessageW, MSG};
                    let mut msg = MSG::default();
                    while GetMessageW(&mut msg, None, 0, 0).as_bool() {}
                }
            });
        }

        Ok("hook_started".to_string())
    }

    #[cfg(not(target_os = "windows"))]
    {
        println!("[MARK SYNC dev] start_sync called for {}", exe_name);
        Ok("dev_noop".to_string())
    }
}

// ── Legacy command kept for compatibility ─────────────────────────────────
#[command]
fn send_key_to_collection_app(_exe_name: String, _key_code: String) -> Result<String, String> {
    // Now handled by the keyboard hook — this command is no longer needed
    // Kept so existing JS calls don't error
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
