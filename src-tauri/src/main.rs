#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::command;

// ─── Windows-only global keyboard hook ────────────────────────────────────────
#[cfg(target_os = "windows")]
mod hook {
    use std::sync::{
        atomic::{AtomicBool, AtomicIsize, Ordering},
        mpsc, Mutex, OnceLock,
    };

    use tauri::Emitter;
    use windows::Win32::Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT,
        KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP, VIRTUAL_KEY, VK_LEFT, VK_MENU, VK_RIGHT,
        VK_SHIFT, VK_SPACE,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, EnumWindows, GetForegroundWindow, GetMessageW, GetWindowTextW,
        SetForegroundWindow, SetWindowsHookExW, HHOOK, KBDLLHOOKSTRUCT, MSG,
        WH_KEYBOARD_LL, WM_KEYDOWN,
    };
    use windows::core::BOOL;

    // Magic tag: ASCII "MARK". Every key we inject carries this so the hook
    // recognises its own output and never re-processes it.
    pub const MAGIC: usize = 0x4D41524B;

    pub static APP_HANDLE: OnceLock<tauri::AppHandle> = OnceLock::new();
    // Set to true from JS (via `set_input_focused` command) when a text input
    // inside MARK is focused, so arrows reach the DOM instead of being swallowed.
    pub static INPUT_FOCUSED: AtomicBool = AtomicBool::new(false);

    static HOOK_HANDLE: AtomicIsize = AtomicIsize::new(0);
    static WORK_TX: OnceLock<Mutex<mpsc::SyncSender<NavWork>>> = OnceLock::new();

    pub enum NavWork {
        SendKey { vk: u16, needs_shift: bool },
    }

    /// Install the hook and start the worker thread. Call once from `setup`.
    pub fn install(app_handle: tauri::AppHandle) {
        APP_HANDLE.set(app_handle).ok();

        let (tx, rx) = mpsc::sync_channel::<NavWork>(32);
        WORK_TX.set(Mutex::new(tx)).ok();

        // Worker thread: runs the focus-steal + SendInput dance.
        // Kept off the hook thread so the hook callback returns in microseconds.
        std::thread::spawn(move || {
            for work in rx {
                let NavWork::SendKey { vk, needs_shift } = work;
                send_to_collection(vk, needs_shift);
            }
        });

        // Hook thread: WH_KEYBOARD_LL fires on the thread that installed it,
        // so that thread must spin a GetMessageW loop.
        std::thread::spawn(|| unsafe {
            let hmod = GetModuleHandleW(None).unwrap_or_default();
            let hook = SetWindowsHookExW(
                WH_KEYBOARD_LL,
                Some(keyboard_proc),
                Some(HINSTANCE(hmod.0 as *mut _)),
                0,
            )
            .expect("WH_KEYBOARD_LL install failed");

            HOOK_HANDLE.store(hook.0 as isize, Ordering::SeqCst);

            let mut msg = MSG::default();
            // Spin the message loop — the hook fires as part of this pump.
            while GetMessageW(&mut msg, None, 0, 0).as_bool() {}
        });
    }

    unsafe extern "system" fn keyboard_proc(
        code: i32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        let hook = HHOOK(HOOK_HANDLE.load(Ordering::SeqCst) as *mut _);

        if code < 0 {
            return CallNextHookEx(Some(hook), code, wparam, lparam);
        }

        let kb = &*(lparam.0 as *const KBDLLHOOKSTRUCT);

        // Our own injected keys — never re-process, return immediately.
        if kb.dwExtraInfo == MAGIC {
            return CallNextHookEx(Some(hook), code, wparam, lparam);
        }

        // Only act on key-down, not key-up or sys-key variants.
        if wparam.0 as u32 != WM_KEYDOWN {
            return CallNextHookEx(Some(hook), code, wparam, lparam);
        }

        // Only intercept when MARK is the foreground window.
        if !foreground_is_mark() {
            return CallNextHookEx(Some(hook), code, wparam, lparam);
        }

        // If a text input inside MARK is focused (e.g. reviewed-events field),
        // let arrows reach the DOM so the user can edit the number.
        if INPUT_FOCUSED.load(Ordering::Relaxed) {
            return CallNextHookEx(Some(hook), code, wparam, lparam);
        }

        let vk = VIRTUAL_KEY(kb.vkCode as u16);

        // GetAsyncKeyState is reliable inside WH_KEYBOARD_LL (fires before dispatch).
        let shift = GetAsyncKeyState(VK_SHIFT.0 as i32) as u16 & 0x8000 != 0;

        let action = match vk {
            VK_RIGHT => "forward",
            VK_LEFT => "backward",
            VK_SPACE => "playpause",
            // All other keys (letter tags, ESC, …) pass through untouched.
            _ => return CallNextHookEx(Some(hook), code, wparam, lparam),
        };

        // Tell the frontend to move MARK's own video (programmatic DOM, not keyboard).
        if let Some(app) = APP_HANDLE.get() {
            let _ = app.emit(
                "mark://nav",
                serde_json::json!({ "action": action, "shift": shift }),
            );
        }

        // Dispatch to worker — it will do the focus-steal + SendInput for the
        // Collection App. We never sleep or SendInput on the hook thread itself.
        if let Some(tx) = WORK_TX.get() {
            if let Ok(guard) = tx.lock() {
                let _ = guard.try_send(NavWork::SendKey {
                    vk: vk.0,
                    needs_shift: shift,
                });
            }
        }

        LRESULT(1) // swallow: prevents the key from reaching MARK's WebView2
    }

    fn foreground_is_mark() -> bool {
        unsafe {
            let hwnd = GetForegroundWindow();
            if hwnd.0.is_null() {
                return false;
            }
            let mut buf = [0u16; 512];
            let len = GetWindowTextW(hwnd, &mut buf);
            if len == 0 {
                return false;
            }
            String::from_utf16_lossy(&buf[..len as usize]).contains("MARK")
        }
    }

    /// Focus-steal + SendInput dance for the Collection App.
    /// Called on the worker thread — safe to sleep here.
    pub fn send_to_collection(vk: u16, needs_shift: bool) {
        // Function-body static: accessible to the nested enum_proc item below.
        static FOUND: AtomicIsize = AtomicIsize::new(0);

        unsafe extern "system" fn enum_proc(hwnd: HWND, _: LPARAM) -> BOOL {
            let mut buf = [0u16; 512];
            let len = GetWindowTextW(hwnd, &mut buf);
            if len > 0
                && String::from_utf16_lossy(&buf[..len as usize])
                    .contains("Tag Once Collection App")
            {
                FOUND.store(hwnd.0 as isize, Ordering::SeqCst);
                return BOOL(0); // stop enumeration
            }
            BOOL(1)
        }

        unsafe {
            FOUND.store(0, Ordering::SeqCst);
            let _ = EnumWindows(Some(enum_proc), LPARAM(0));
            let raw = FOUND.load(Ordering::SeqCst);
            let connected = raw != 0;
            if let Some(app) = APP_HANDLE.get() {
                let _ = app.emit("mark://sync-status", serde_json::json!({ "connected": connected }));
            }
            if raw == 0 {
                return; // Collection App not running
            }

            let collection_hwnd = HWND(raw as *mut _);
            let mark_hwnd = GetForegroundWindow();

            // Every key we inject carries the MAGIC tag so the hook ignores it.
            let make = |vk: u16, up: bool| INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: VIRTUAL_KEY(vk),
                        wScan: 0,
                        dwFlags: if up { KEYEVENTF_KEYUP } else { KEYBD_EVENT_FLAGS(0) },
                        time: 0,
                        dwExtraInfo: MAGIC,
                    },
                },
            };

            // ALT tap unlocks SetForegroundWindow across processes.
            SendInput(
                &[make(VK_MENU.0, false), make(VK_MENU.0, true)],
                std::mem::size_of::<INPUT>() as i32,
            );

            SetForegroundWindow(collection_hwnd);
            std::thread::sleep(std::time::Duration::from_millis(30));

            let mut inputs: Vec<INPUT> = Vec::new();
            if needs_shift {
                inputs.push(make(VK_SHIFT.0, false));
            }
            inputs.push(make(vk, false));
            inputs.push(make(vk, true));
            if needs_shift {
                inputs.push(make(VK_SHIFT.0, true));
            }
            SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);

            std::thread::sleep(std::time::Duration::from_millis(30));
            if !mark_hwnd.is_invalid() {
                SetForegroundWindow(mark_hwnd);
            }
        }
    }
}

// ─── Tauri commands ────────────────────────────────────────────────────────────

/// Called from JS when a text <input> inside MARK gains or loses focus,
/// so the hook doesn't swallow arrow keys while the user is typing.
#[command]
fn set_input_focused(focused: bool) {
    #[cfg(target_os = "windows")]
    hook::INPUT_FOCUSED.store(focused, std::sync::atomic::Ordering::SeqCst);
}

/// Fallback command kept for non-Windows dev and manual invocation.
/// On Windows the hook worker calls `send_to_collection` directly.
#[command]
fn send_key_to_collection_app(_exe_name: String, key_code: String) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::UI::Input::KeyboardAndMouse::{VK_LEFT, VK_RIGHT, VK_SPACE};
        let (vk, needs_shift) = match key_code.as_str() {
            "RIGHT" => (VK_RIGHT.0, false),
            "LEFT" => (VK_LEFT.0, false),
            "SHIFT_RIGHT" => (VK_RIGHT.0, true),
            "SHIFT_LEFT" => (VK_LEFT.0, true),
            "SPACE" => (VK_SPACE.0, false),
            _ => return Ok("unknown_key".to_string()),
        };
        hook::send_to_collection(vk, needs_shift);
        return Ok("sent".to_string());
    }

    #[cfg(not(target_os = "windows"))]
    {
        println!("[MARK SYNC dev] {} -> {}", _exe_name, key_code);
        Ok("dev_noop".to_string())
    }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            #[cfg(target_os = "windows")]
            hook::install(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            send_key_to_collection_app,
            set_input_focused,
        ])
        .run(tauri::generate_context!())
        .expect("error while running MARK");
}
