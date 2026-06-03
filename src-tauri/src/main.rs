#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// =============================================================================
// MARK — Global Hook Sync (v1.4.0 architecture)
//
// Arrow / Space are captured at the OS level by a WH_KEYBOARD_LL hook, NOT by
// MARK's WebView2 keydown handler. This makes MARK's own video control immune to
// Chromium's keyboard-focus sleep after the SendInput focus-dance.
//
// Flow on each physical Left/Right/Space (only while MARK is foreground):
//   1. Hook emits Tauri event `mark://nav`  -> JS moves MARK's video via DOM
//      (programmatic, focus-independent — works even if the webview is "asleep")
//   2. Hook hands a NavMsg to a worker thread -> worker runs the SendInput dance
//      that moves the Collection App's video (unchanged from v1.3.0)
//   3. Hook swallows the key (returns LRESULT(1)) so the webview never sees it
//
// Self-injected keys carry dwExtraInfo = 0x4D41524B ("MARK") and are ignored by
// the hook, preventing an infinite re-trigger loop.
// =============================================================================

use tauri::command;

#[cfg(target_os = "windows")]
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(target_os = "windows")]
use std::sync::{mpsc, Mutex, OnceLock};
#[cfg(target_os = "windows")]
use tauri::{AppHandle, Emitter};
#[cfg(target_os = "windows")]
use windows::core::BOOL;
#[cfg(target_os = "windows")]
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};

// ASCII "MARK" — stamped on every key we inject so the hook can ignore them.
#[cfg(target_os = "windows")]
const MARK_MAGIC: usize = 0x4D41_524B;

// Globals reachable from the (non-capturing) hook proc.
#[cfg(target_os = "windows")]
static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();
#[cfg(target_os = "windows")]
static NAV_TX: OnceLock<Mutex<mpsc::Sender<NavMsg>>> = OnceLock::new();
// Set true by JS (via set_sync_suppress) whenever a text input / modal is open.
#[cfg(target_os = "windows")]
static SUPPRESS: AtomicBool = AtomicBool::new(false);

#[cfg(target_os = "windows")]
#[derive(Clone, Copy)]
enum NavKey {
    Forward,
    Backward,
    PlayPause,
}

#[cfg(target_os = "windows")]
struct NavMsg {
    key: NavKey,
    shift: bool,
}

#[cfg(target_os = "windows")]
#[derive(Clone, serde::Serialize)]
struct NavPayload {
    action: String, // "forward" | "backward" | "playpause"
    shift: bool,
}

// -----------------------------------------------------------------------------
// The low-level keyboard hook
// -----------------------------------------------------------------------------
#[cfg(target_os = "windows")]
unsafe extern "system" fn keyboard_hook_proc(ncode: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, VK_LEFT, VK_RIGHT, VK_SHIFT, VK_SPACE,
    };
    use windows::Win32::UI::WindowsAndMessaging::{CallNextHookEx, HC_ACTION, KBDLLHOOKSTRUCT, WM_KEYDOWN};

    if ncode == HC_ACTION as i32 {
        let kb = &*(lparam.0 as *const KBDLLHOOKSTRUCT);

        // (1) Ignore anything we injected ourselves -> no infinite loop.
        if kb.dwExtraInfo == MARK_MAGIC {
            return CallNextHookEx(None, ncode, wparam, lparam);
        }

        if wparam.0 as u32 == WM_KEYDOWN {
            let vk = kb.vkCode;
            let is_nav = vk == VK_LEFT.0 as u32 || vk == VK_RIGHT.0 as u32 || vk == VK_SPACE.0 as u32;

            // Only act on nav keys, only when not suppressed, only when MARK is foreground.
            if is_nav && !SUPPRESS.load(Ordering::SeqCst) && foreground_title_contains("MARK") {
                let shift = (GetAsyncKeyState(VK_SHIFT.0 as i32) as u16 & 0x8000) != 0;

                let (action, navkey): (&str, NavKey) = if vk == VK_SPACE.0 as u32 {
                    ("playpause", NavKey::PlayPause)
                } else if vk == VK_RIGHT.0 as u32 {
                    ("forward", NavKey::Forward)
                } else {
                    ("backward", NavKey::Backward)
                };

                // (a) Instant MARK move — focus-independent DOM seek on the JS side.
                if let Some(app) = APP_HANDLE.get() {
                    let _ = app.emit(
                        "mark://nav",
                        NavPayload {
                            action: action.to_string(),
                            shift,
                        },
                    );
                }

                // (b) Collection App move — offload the focus-dance to the worker.
                //     Never run SendInput here; the hook callback must return fast
                //     (LowLevelHooksTimeout ~300ms or Windows drops the hook).
                if let Some(lock) = NAV_TX.get() {
                    if let Ok(tx) = lock.lock() {
                        let _ = tx.send(NavMsg { key: navkey, shift });
                    }
                }

                // (c) Swallow so MARK's webview never double-handles the nav key.
                return LRESULT(1);
            }
        }
    }

    CallNextHookEx(None, ncode, wparam, lparam)
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------
#[cfg(target_os = "windows")]
unsafe fn foreground_title_contains(needle: &str) -> bool {
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowTextW};

    let hwnd = GetForegroundWindow();
    if hwnd.is_invalid() {
        return false;
    }
    let mut buf = [0u16; 512];
    let len = GetWindowTextW(hwnd, &mut buf);
    if len <= 0 {
        return false;
    }
    String::from_utf16_lossy(&buf[..len as usize]).contains(needle)
}

#[cfg(target_os = "windows")]
unsafe fn find_collection_hwnd() -> Option<HWND> {
    use std::sync::atomic::AtomicIsize;
    use windows::Win32::UI::WindowsAndMessaging::{EnumWindows, GetWindowTextW};

    static FOUND: AtomicIsize = AtomicIsize::new(0);
    FOUND.store(0, Ordering::SeqCst);

    unsafe extern "system" fn enum_proc(hwnd: HWND, _: LPARAM) -> BOOL {
        let mut buf = [0u16; 512];
        let len = GetWindowTextW(hwnd, &mut buf);
        if len > 0 {
            let title = String::from_utf16_lossy(&buf[..len as usize]);
            if title.contains("Tag Once Collection App") {
                FOUND.store(hwnd.0 as isize, Ordering::SeqCst);
                return BOOL(0); // stop enumerating
            }
        }
        BOOL(1) // keep going
    }

    let _ = EnumWindows(Some(enum_proc), LPARAM(0));
    let raw = FOUND.load(Ordering::SeqCst);
    if raw == 0 {
        None
    } else {
        Some(HWND(raw as *mut _))
    }
}

/// The original v1.3.0 SendInput focus-dance, now stamped with MARK_MAGIC.
/// Returns true if the Collection App was found and driven.
#[cfg(target_os = "windows")]
unsafe fn drive_collection_app(vk: u16, needs_shift: bool) -> bool {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP,
        VIRTUAL_KEY, VK_MENU, VK_SHIFT,
    };
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, SetForegroundWindow};

    let collection_hwnd = match find_collection_hwnd() {
        Some(h) => h,
        None => return false,
    };

    let mark_hwnd = GetForegroundWindow();

    // ALT tap satisfies SetForegroundWindow's foreground-rights rules.
    let alt_down = INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: VK_MENU,
                wScan: 0,
                dwFlags: KEYBD_EVENT_FLAGS(0),
                time: 0,
                dwExtraInfo: MARK_MAGIC,
            },
        },
    };
    let alt_up = INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: VK_MENU,
                wScan: 0,
                dwFlags: KEYEVENTF_KEYUP,
                time: 0,
                dwExtraInfo: MARK_MAGIC,
            },
        },
    };
    SendInput(&[alt_down, alt_up], std::mem::size_of::<INPUT>() as i32);

    let _ = SetForegroundWindow(collection_hwnd);
    std::thread::sleep(std::time::Duration::from_millis(30));

    let make_key = |code: u16, up: bool| -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(code),
                    wScan: 0,
                    dwFlags: if up { KEYEVENTF_KEYUP } else { KEYBD_EVENT_FLAGS(0) },
                    time: 0,
                    dwExtraInfo: MARK_MAGIC,
                },
            },
        }
    };

    let mut inputs: Vec<INPUT> = Vec::new();
    if needs_shift {
        inputs.push(make_key(VK_SHIFT.0, false));
    }
    inputs.push(make_key(vk, false));
    inputs.push(make_key(vk, true));
    if needs_shift {
        inputs.push(make_key(VK_SHIFT.0, true));
    }
    SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);

    std::thread::sleep(std::time::Duration::from_millis(30));
    if !mark_hwnd.is_invalid() {
        let _ = SetForegroundWindow(mark_hwnd);
    }

    true
}

// -----------------------------------------------------------------------------
// Worker thread — drains nav messages and runs the dance, decoupled from the hook
// -----------------------------------------------------------------------------
#[cfg(target_os = "windows")]
fn worker_loop(rx: mpsc::Receiver<NavMsg>) {
    use windows::Win32::UI::Input::KeyboardAndMouse::{VK_LEFT, VK_RIGHT, VK_SPACE};

    while let Ok(msg) = rx.recv() {
        let (vk, needs_shift) = match msg.key {
            NavKey::Forward => (VK_RIGHT.0, msg.shift),
            NavKey::Backward => (VK_LEFT.0, msg.shift),
            NavKey::PlayPause => (VK_SPACE.0, false),
        };

        let ok = unsafe { drive_collection_app(vk, needs_shift) };

        // Keep the "Collection app synced" indicator live.
        if let Some(app) = APP_HANDLE.get() {
            let _ = app.emit("mark://sync-status", if ok { "connected" } else { "disconnected" });
        }
    }
}

// -----------------------------------------------------------------------------
// Hook installation (own thread + message loop so the hook actually fires)
// -----------------------------------------------------------------------------
#[cfg(target_os = "windows")]
fn install_keyboard_hook(app: AppHandle) {
    let _ = APP_HANDLE.set(app);

    let (tx, rx) = mpsc::channel::<NavMsg>();
    let _ = NAV_TX.set(Mutex::new(tx));

    // Worker: runs the blocking SendInput focus-dance.
    std::thread::spawn(move || worker_loop(rx));

    // Hook thread: installs WH_KEYBOARD_LL and pumps messages.
    std::thread::spawn(|| unsafe {
        use windows::core::PCWSTR;
        use windows::Win32::Foundation::HINSTANCE;
        use windows::Win32::System::LibraryLoader::GetModuleHandleW;
        use windows::Win32::UI::WindowsAndMessaging::{
            DispatchMessageW, GetMessageW, SetWindowsHookExW, TranslateMessage, MSG, WH_KEYBOARD_LL,
        };

        let hmod = match GetModuleHandleW(PCWSTR::null()) {
            Ok(h) => h,
            Err(_) => return,
        };

        // Per your confirmed 0.61 gotcha: hmod param is Option<HINSTANCE>.
        // If your crate types it as a plain HINSTANCE, drop the Some(...).
        let hook = SetWindowsHookExW(
            WH_KEYBOARD_LL,
            Some(keyboard_hook_proc),
            Some(HINSTANCE(hmod.0)),
            0,
        );
        if hook.is_err() {
            return;
        }

        // The hook only fires while this thread services its message queue.
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    });
}

// -----------------------------------------------------------------------------
// Commands
// -----------------------------------------------------------------------------

/// JS sets this true when an editable field / modal is focused, false on blur.
/// While true, the hook passes Left/Right/Space straight through to the webview
/// so the reviewer can move the caret / type spaces normally.
#[command]
fn set_sync_suppress(_suppressed: bool) {
    #[cfg(target_os = "windows")]
    SUPPRESS.store(_suppressed, Ordering::SeqCst);
}

/// Fallback / manual path. The hook now drives sync automatically, but this is
/// kept for testing and as a safety valve. Mirrors the v1.3.0 contract.
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

        let ok = unsafe { drive_collection_app(vk, needs_shift) };
        return Ok(if ok { "sent".to_string() } else { "window_not_found".to_string() });
    }

    #[cfg(not(target_os = "windows"))]
    {
        println!("[MARK SYNC dev] {} -> {}", _exe_name, key_code);
        Ok("dev_noop".to_string())
    }
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            send_key_to_collection_app,
            set_sync_suppress
        ])
        .setup(|_app| {
            #[cfg(target_os = "windows")]
            install_keyboard_hook(_app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running MARK");
}
