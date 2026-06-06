#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::command;

const BRIDGE_SCRIPT: &str = include_str!("bridge_script.js");

// ─── Find the collection app window ───────────────────────────────────────────
#[cfg(target_os = "windows")]
unsafe fn find_collection_hwnd() -> Option<windows::Win32::Foundation::HWND> {
    use windows::Win32::Foundation::{HWND, LPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{EnumWindows, GetWindowTextW};
    use windows::core::BOOL;

    static FOUND: std::sync::atomic::AtomicIsize = std::sync::atomic::AtomicIsize::new(0);
    FOUND.store(0, std::sync::atomic::Ordering::SeqCst);

    unsafe extern "system" fn probe(hwnd: HWND, _: LPARAM) -> BOOL {
        let mut buf = [0u16; 512];
        let len = GetWindowTextW(hwnd, &mut buf);
        if len > 0 && String::from_utf16_lossy(&buf[..len as usize]).contains("Tag Once Collection App") {
            FOUND.store(hwnd.0 as isize, std::sync::atomic::Ordering::SeqCst);
            return BOOL(0);
        }
        BOOL(1)
    }

    let _ = EnumWindows(Some(probe), LPARAM(0));
    let raw = FOUND.load(std::sync::atomic::Ordering::SeqCst);
    if raw == 0 { None } else { Some(HWND(raw as *mut _)) }
}

// ─── Inject Bridge command ─────────────────────────────────────────────────────
#[command]
fn inject_bridge_script(session_id: String) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    { return inject_bridge_windows(&session_id); }
    #[cfg(not(target_os = "windows"))]
    { let _ = session_id; Ok("dev_noop".to_string()) }
}

#[cfg(target_os = "windows")]
fn inject_bridge_windows(session_id: &str) -> Result<String, String> {
    use windows::Win32::Foundation::{HANDLE, HGLOBAL};
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT,
        KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP, KEYEVENTF_UNICODE, VIRTUAL_KEY,
        VK_CONTROL, VK_MENU, VK_RETURN, VK_SHIFT,
    };
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, SetForegroundWindow};
    use windows::Win32::System::DataExchange::{CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData};
    use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};

    let collection_hwnd = unsafe { find_collection_hwnd() }
        .ok_or_else(|| "Collection app window not found".to_string())?;

    let script = BRIDGE_SCRIPT.replace("__SESSION_ID__", session_id);

    let sz = std::mem::size_of::<INPUT>() as i32;

    let vk = |code: u16, up: bool| -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(code), wScan: 0,
                    dwFlags: if up { KEYEVENTF_KEYUP } else { KEYBD_EVENT_FLAGS(0) },
                    time: 0, dwExtraInfo: 0,
                },
            },
        }
    };

    // Unicode character injection — Chrome treats these as TYPED, not pasted
    let ch = |c: u16, up: bool| -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(0), wScan: c,
                    dwFlags: KEYEVENTF_UNICODE | if up { KEYEVENTF_KEYUP } else { KEYBD_EVENT_FLAGS(0) },
                    time: 0, dwExtraInfo: 0,
                },
            },
        }
    };

    let sleep = |ms: u64| std::thread::sleep(std::time::Duration::from_millis(ms));

    unsafe {
        let mark_hwnd = GetForegroundWindow();

        // 1. Focus collection app
        SendInput(&[vk(VK_MENU.0, false), vk(VK_MENU.0, true)], sz);
        let _ = SetForegroundWindow(collection_hwnd);
        sleep(150);

        // 2. Open DevTools: Alt+Ctrl+I
        SendInput(
            &[vk(VK_MENU.0, false), vk(VK_CONTROL.0, false), vk(0x49, false),
              vk(0x49, true), vk(VK_CONTROL.0, true), vk(VK_MENU.0, true)],
            sz,
        );
        sleep(2500); // wait for DevTools to fully load

        // Ctrl+Shift+J: focus the Console panel input
        SendInput(
            &[vk(VK_CONTROL.0, false), vk(VK_SHIFT.0, false), vk(0x4A, false),
              vk(0x4A, true), vk(VK_SHIFT.0, true), vk(VK_CONTROL.0, true)],
            sz,
        );
        sleep(800);

        // 3. Type "allow pasting" char-by-char (Unicode = typed, not pasted)
        let mut char_inputs: Vec<INPUT> = Vec::new();
        for c in "allow pasting".encode_utf16() {
            char_inputs.push(ch(c, false));
            char_inputs.push(ch(c, true));
        }
        SendInput(&char_inputs, sz);
        sleep(120);
        SendInput(&[vk(VK_RETURN.0, false), vk(VK_RETURN.0, true)], sz);
        sleep(600);

        // 4. Put the script on the clipboard (CF_UNICODETEXT = 13)
        {
            let wide: Vec<u16> = script.encode_utf16().chain(Some(0)).collect();
            let byte_len = wide.len() * 2;
            OpenClipboard(None).map_err(|e| format!("OpenClipboard: {}", e))?;
            let _ = EmptyClipboard();
            let hmem: HGLOBAL = GlobalAlloc(GMEM_MOVEABLE, byte_len).map_err(|e| {
                let _ = CloseClipboard();
                format!("GlobalAlloc: {}", e)
            })?;
            let ptr = GlobalLock(hmem) as *mut u16;
            std::ptr::copy_nonoverlapping(wide.as_ptr(), ptr, wide.len());
            let _ = GlobalUnlock(hmem);
            SetClipboardData(13u32, Some(HANDLE(hmem.0))).map_err(|e| {
                let _ = CloseClipboard();
                format!("SetClipboardData: {}", e)
            })?;
            let _ = CloseClipboard();
        }

        // 5. Ctrl+V to paste, Enter to run
        SendInput(
            &[vk(VK_CONTROL.0, false), vk(0x56, false), vk(0x56, true), vk(VK_CONTROL.0, true)],
            sz,
        );
        sleep(400);
        SendInput(&[vk(VK_RETURN.0, false), vk(VK_RETURN.0, true)], sz);
        sleep(500); // let the script run & the bridge panel mount

        // 6. Close DevTools — Alt+Ctrl+I again toggles it shut.
        // Collection app is still focused here, so the keystroke reaches it.
        SendInput(
            &[vk(VK_MENU.0, false), vk(VK_CONTROL.0, false), vk(0x49, false),
              vk(0x49, true), vk(VK_CONTROL.0, true), vk(VK_MENU.0, true)],
            sz,
        );
        sleep(300);

        // 7. Return focus to MARK
        if !mark_hwnd.is_invalid() {
            SendInput(&[vk(VK_MENU.0, false), vk(VK_MENU.0, true)], sz);
            let _ = SetForegroundWindow(mark_hwnd);
        }
    }

    Ok("injected".to_string())
}

// ─── Legacy command kept for API compatibility (sync now goes via Firestore) ───
#[command]
fn send_key_to_collection_app(_exe_name: String, _key_code: String) -> Result<String, String> {
    Ok("noop".to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            send_key_to_collection_app,
            inject_bridge_script,
        ])
        .run(tauri::generate_context!())
        .expect("error while running MARK");
}
