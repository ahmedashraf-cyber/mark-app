//! open_target.rs — how `open_file` launches a file, folder or URL.
//!
//! Kept free of Tauri and of the OS so the one property that matters can be unit-tested anywhere:
//! **the target is never part of any command text.** It used to be interpolated into a PowerShell
//! command string (`Invoke-Item '<path>'`) with only the ASCII apostrophe escaped. PowerShell also
//! treats the typographic quotes U+2018, U+2019, U+201A and U+201B as quote characters, so a path
//! containing one (a player or team name copied from a sheet, say) could end the string and run
//! whatever followed. Now the PowerShell command is a CONSTANT and the path travels in an environment
//! variable, where it is only ever read as a value.
//!
//! Behaviour that stays the same: URLs open in the default browser through rundll32; everything else
//! opens with its default application through `Invoke-Item`; the check for a URL is case-sensitive,
//! exactly as before. One deliberate difference: `-LiteralPath`, so a name containing `[` or `]`
//! (e.g. "Match [1]") is opened instead of being treated as a wildcard pattern and failing.

/// The environment variable that carries the path to PowerShell.
pub const PATH_ENV: &str = "MARK_OPEN_PATH";

/// The PowerShell command text. Constant by design; see the module comment.
pub const POWERSHELL_COMMAND: &str = "Invoke-Item -LiteralPath $env:MARK_OPEN_PATH";

#[derive(Debug, PartialEq, Eq)]
pub struct Launch {
    pub program: &'static str,
    pub args: Vec<String>,
    /// (name, value) pairs to set on the child process.
    pub env: Vec<(&'static str, String)>,
    /// Suppress the console window flash (PowerShell only, as before).
    pub no_window: bool,
    pub is_url: bool,
}

pub fn plan(target: &str) -> Launch {
    if target.starts_with("http://") || target.starts_with("https://") {
        // single argument, so `&` in a URL is not treated as a command separator
        Launch {
            program: "rundll32",
            args: vec!["url.dll,FileProtocolHandler".to_string(), target.to_string()],
            env: vec![],
            no_window: false,
            is_url: true,
        }
    } else {
        Launch {
            program: "powershell",
            args: vec!["-NoProfile".to_string(), "-Command".to_string(), POWERSHELL_COMMAND.to_string()],
            env: vec![(PATH_ENV, target.to_string())],
            no_window: true,
            is_url: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Characters that are dangerous or odd in a PowerShell string, a shell, or a file name.
    const HOSTILE: &[&str] = &[
        "C:\\Users\\a\\O'Neill\\clip.mp4",                      // ASCII apostrophe
        "C:\\x\\O\u{2019}Neill.mp4",                            // U+2019 RIGHT SINGLE QUOTATION MARK
        "C:\\x\\\u{2018}a\u{2019}.mp4",                         // U+2018 / U+2019
        "C:\\x\\a\u{201A}b\u{201B}c.mp4",                       // U+201A / U+201B
        "C:\\x\\a\u{2019}; Remove-Item -Recurse C:\\ ; \u{2019}b",   // the actual attack shape
        "C:\\x\\$(calc.exe).mp4", "C:\\x\\`n.mp4", "C:\\x\\a\"b.mp4", "C:\\x\\a;b&c|d.mp4",
        "C:\\x\\%PATH%.mp4", "C:\\x\\line1\nline2.mp4", "C:\\Match [1]\\clip.mp4", "",
    ];

    #[test]
    fn a_file_path_never_becomes_command_text() {
        for p in HOSTILE {
            let l = plan(p);
            assert_eq!(l.program, "powershell");
            // the command is identical whatever the path is …
            assert_eq!(l.args, vec!["-NoProfile", "-Command", POWERSHELL_COMMAND], "args changed for {:?}", p);
            // … and the path is not in any argument
            assert!(l.args.iter().all(|a| p.is_empty() || !a.contains(p)), "path leaked into args for {:?}", p);
            // it is carried unchanged as an environment value
            assert_eq!(l.env, vec![(PATH_ENV, p.to_string())]);
        }
    }

    #[test]
    fn the_command_reads_the_environment_variable_it_is_given_and_nothing_else() {
        assert!(POWERSHELL_COMMAND.contains(&format!("$env:{}", PATH_ENV)));
        assert!(POWERSHELL_COMMAND.contains("-LiteralPath"));
        assert!(!POWERSHELL_COMMAND.contains('\'') && !POWERSHELL_COMMAND.contains('"'));
    }

    #[test]
    fn urls_go_to_the_browser_as_one_argument() {
        for u in ["https://docs.google.com/spreadsheets/d/x/edit?a=1&b=2", "http://127.0.0.1:1234/video"] {
            let l = plan(u);
            assert_eq!(l.program, "rundll32");
            assert_eq!(l.args, vec!["url.dll,FileProtocolHandler".to_string(), u.to_string()]);
            assert!(l.env.is_empty() && l.is_url && !l.no_window);
        }
    }

    #[test]
    fn the_url_check_is_case_sensitive_as_before() {
        // an upper-case scheme was never treated as a URL; it is a "file" and goes through Invoke-Item
        assert_eq!(plan("HTTP://example.com").program, "powershell");
        assert_eq!(plan("httpx://example.com").program, "powershell");
        assert_eq!(plan("C:\\http://x").program, "powershell");
    }

    #[test]
    fn only_powershell_hides_its_window() {
        assert!(plan("C:\\a.mp4").no_window);
        assert!(!plan("https://x").no_window);
    }
}
