//! drive_export.rs — the decisions behind the Session History export.
//!
//! Kept free of Tauri and HTTP so it can be unit-tested (`cargo test` on this file
//! alone). main.rs does the requests; this file decides what a failure MEANS and
//! whether the folder may be given up on.
//!
//! The rule it enforces (Session History export, v7.12.20):
//!   • try to create the sheet INSIDE the shared MARK Trainer Reviews folder;
//!   • only if Google refuses because of that PARENT (drive.file cannot name a
//!     folder the app did not create: 404 "File not found", or 403 on the parent)
//!     create it in the reviewer's own Drive root instead — and say which path ran;
//!   • any other failure (storage full, network, a genuine permission problem) is
//!     NOT retried somewhere else and is reported with its real cause.

use serde_json::{json, Value};
use std::future::Future;

#[derive(Debug, Clone, PartialEq)]
pub enum Kind {
    /// The reviewer's Google storage is full (storageQuotaExceeded).
    Quota,
    /// Google refused the PARENT folder, not the file. The only fallback trigger.
    Parent,
    /// A real permission refusal (401 / 403 not about the parent).
    Permission,
    /// No answer at all.
    Network,
    Other,
}

impl Kind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Kind::Quota => "quota",
            Kind::Parent => "parent",
            Kind::Permission => "permission",
            Kind::Network => "network",
            Kind::Other => "other",
        }
    }
}

#[derive(Debug, Clone)]
pub struct DriveErr {
    pub kind: Kind,
    /// HTTP status; 0 when the request never got an answer.
    pub status: u16,
    /// Google's machine reason, e.g. "storageQuotaExceeded"; empty if none.
    pub reason: String,
    /// Google's own message, untouched.
    pub message: String,
}

impl DriveErr {
    pub fn network(message: String) -> Self {
        DriveErr { kind: Kind::Network, status: 0, reason: String::new(), message }
    }
}

/// Turn an HTTP status plus Google's error body into a DriveErr.
pub fn classify(status: u16, body: &Value) -> DriveErr {
    let err = &body["error"];
    let message = err["message"].as_str().unwrap_or("").to_string();
    let lower = message.to_lowercase();
    let reasons: Vec<String> = err["errors"]
        .as_array()
        .map(|a| a.iter().filter_map(|e| e["reason"].as_str().map(|s| s.to_string())).collect())
        .unwrap_or_default();
    let reason = reasons
        .first()
        .cloned()
        .or_else(|| err["status"].as_str().map(|s| s.to_string()))
        .unwrap_or_default();
    let has = |r: &str| reasons.iter().any(|x| x == r);

    // Storage quota FIRST: it arrives as a 403, and must never be mistaken for a
    // parent or permission problem (that mistake is what told people to "ask Fady
    // for access" when the account was simply full).
    let kind = if has("storageQuotaExceeded") || lower.contains("storage quota") {
        Kind::Quota
    } else if (status == 404 && lower.contains("file not found"))
        || (status == 403
            && (has("insufficientParentPermissions")
                || has("insufficientFilePermissions")
                || has("appNotAuthorizedToFile")
                || has("forbidden")))
    {
        Kind::Parent
    } else if status == 401 || status == 403 {
        Kind::Permission
    } else {
        Kind::Other
    };
    DriveErr { kind, status, reason, message }
}

/// What JS receives as the rejection string. `account` is the signed-in email,
/// filled in only when the message needs it (quota / permission).
pub fn to_json_string(e: &DriveErr, account: Option<&str>) -> String {
    json!({
        "kind": e.kind.as_str(),
        "status": e.status,
        "reason": e.reason,
        "message": e.message,
        "account": account,
    })
    .to_string()
}

/// Create the sheet, preferring the shared folder.
/// `upload(Some(folder))` is tried first; `upload(None)` (the reviewer's own Drive
/// root) is tried ONLY when the first attempt failed with Kind::Parent.
/// Returns the Drive file object with `path` ("folder" | "own_drive") added, and,
/// for the fallback, `fallback_reason`.
pub async fn create_with_fallback<F, Fut>(folder: Option<&str>, mut upload: F) -> Result<Value, DriveErr>
where
    F: FnMut(Option<String>) -> Fut,
    Fut: Future<Output = Result<Value, DriveErr>>,
{
    let folder = folder.map(|f| f.trim()).filter(|f| !f.is_empty());
    let Some(fid) = folder else {
        let mut v = upload(None).await?;
        v["path"] = json!("own_drive");
        v["fallback_reason"] = json!("no folder id supplied");
        return Ok(v);
    };
    match upload(Some(fid.to_string())).await {
        Ok(mut v) => {
            v["path"] = json!("folder");
            Ok(v)
        }
        Err(e) if e.kind == Kind::Parent => {
            let why = format!("HTTP {} {} {}", e.status, e.reason, e.message);
            eprintln!("[MARK] drive_create_sheet: folder {} refused ({}); creating in the reviewer's own Drive instead", fid, why);
            // No second fallback: whatever the own-Drive attempt returns is final.
            let mut v = upload(None).await?;
            v["path"] = json!("own_drive");
            v["fallback_reason"] = json!(why);
            Ok(v)
        }
        Err(e) => Err(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    fn gerr(status: u16, reason: &str, message: &str) -> Value {
        json!({ "error": { "code": status, "message": message, "errors": [{ "reason": reason, "message": message }] } })
    }

    #[test]
    fn quota_is_quota_even_though_it_is_a_403() {
        let e = classify(403, &gerr(403, "storageQuotaExceeded", "The user's Drive storage quota has been exceeded."));
        assert_eq!(e.kind, Kind::Quota);
        // and by message alone, if the reason is ever missing
        let e2 = classify(403, &json!({"error":{"message":"The user's Drive storage quota has been exceeded."}}));
        assert_eq!(e2.kind, Kind::Quota);
    }
    #[test]
    fn missing_parent_is_a_parent_error() {
        let e = classify(404, &gerr(404, "notFound", "File not found: 18lGrKFiZwgg3IRJUA59ryBh3TJVWWyn8."));
        assert_eq!(e.kind, Kind::Parent);
    }
    #[test]
    fn forbidden_on_the_parent_is_a_parent_error() {
        for r in ["insufficientParentPermissions", "insufficientFilePermissions", "appNotAuthorizedToFile", "forbidden"] {
            assert_eq!(classify(403, &gerr(403, r, "x")).kind, Kind::Parent, "{}", r);
        }
    }
    #[test]
    fn other_refusals_are_permission_or_other() {
        assert_eq!(classify(401, &gerr(401, "authError", "Invalid Credentials")).kind, Kind::Permission);
        assert_eq!(classify(403, &gerr(403, "domainPolicy", "blocked by admin")).kind, Kind::Permission);
        assert_eq!(classify(500, &gerr(500, "backendError", "boom")).kind, Kind::Other);
        assert_eq!(classify(429, &gerr(429, "rateLimitExceeded", "slow down")).kind, Kind::Other);
        // a 404 that is NOT about a missing file must not trigger the fallback
        assert_eq!(classify(404, &gerr(404, "x", "Not Found")).kind, Kind::Other);
    }
    #[test]
    fn json_string_carries_the_real_cause_and_account() {
        let e = classify(403, &gerr(403, "storageQuotaExceeded", "quota"));
        let v: Value = serde_json::from_str(&to_json_string(&e, Some("ahmed@hudl.com"))).unwrap();
        assert_eq!(v["kind"], "quota");
        assert_eq!(v["account"], "ahmed@hudl.com");
        assert_eq!(v["reason"], "storageQuotaExceeded");
    }

    // ── the fallback, driven by a fake uploader that records every call ──
    type Calls = Arc<Mutex<Vec<Option<String>>>>;
    fn run(first: Result<Value, DriveErr>, second: Result<Value, DriveErr>, folder: Option<&str>) -> (Result<Value, DriveErr>, Vec<Option<String>>) {
        let calls: Calls = Arc::new(Mutex::new(vec![]));
        let c2 = calls.clone();
        let results = Arc::new(Mutex::new(vec![second, first]));
        let rt = tokio::runtime::Builder::new_current_thread().build().unwrap();
        let out = rt.block_on(create_with_fallback(folder, move |p| {
            c2.lock().unwrap().push(p);
            let next = results.lock().unwrap().pop().expect("uploader called more times than the test allows");
            async move { next }
        }));
        let log = calls.lock().unwrap().clone();
        (out, log)
    }
    const F: &str = "18lGrKFiZwgg3IRJUA59ryBh3TJVWWyn8";

    #[test]
    fn folder_works_first_time_so_there_is_one_call_and_no_fallback() {
        let (out, calls) = run(Ok(json!({"id":"a"})), Err(DriveErr::network("must not be called".into())), Some(F));
        let v = out.unwrap();
        assert_eq!(v["path"], "folder");
        assert_eq!(calls, vec![Some(F.to_string())]);
    }
    #[test]
    fn parent_404_falls_back_to_own_drive_and_says_so() {
        let (out, calls) = run(Err(classify(404, &gerr(404, "notFound", "File not found: x"))), Ok(json!({"id":"b"})), Some(F));
        let v = out.unwrap();
        assert_eq!(v["path"], "own_drive");
        assert!(v["fallback_reason"].as_str().unwrap().contains("404"));
        assert_eq!(calls, vec![Some(F.to_string()), None]);
    }
    #[test]
    fn parent_403_also_falls_back() {
        let (out, calls) = run(Err(classify(403, &gerr(403, "insufficientParentPermissions", "no"))), Ok(json!({"id":"c"})), Some(F));
        assert_eq!(out.unwrap()["path"], "own_drive");
        assert_eq!(calls.len(), 2);
    }
    #[test]
    fn quota_never_falls_back() {
        let (out, calls) = run(Err(classify(403, &gerr(403, "storageQuotaExceeded", "full"))), Ok(json!({"id":"x"})), Some(F));
        assert_eq!(out.unwrap_err().kind, Kind::Quota);
        assert_eq!(calls, vec![Some(F.to_string())], "a full Drive must not be retried in the Drive root");
    }
    #[test]
    fn network_and_real_permission_errors_never_fall_back() {
        let (o1, c1) = run(Err(DriveErr::network("dns".into())), Ok(json!({})), Some(F));
        assert_eq!(o1.unwrap_err().kind, Kind::Network); assert_eq!(c1.len(), 1);
        let (o2, c2) = run(Err(classify(403, &gerr(403, "domainPolicy", "admin"))), Ok(json!({})), Some(F));
        assert_eq!(o2.unwrap_err().kind, Kind::Permission); assert_eq!(c2.len(), 1);
    }
    #[test]
    fn if_the_own_drive_attempt_also_fails_that_error_is_final() {
        let (out, calls) = run(Err(classify(404, &gerr(404, "notFound", "File not found"))), Err(classify(403, &gerr(403, "storageQuotaExceeded", "full"))), Some(F));
        assert_eq!(out.unwrap_err().kind, Kind::Quota);
        assert_eq!(calls.len(), 2);
    }
    #[test]
    fn no_folder_id_goes_straight_to_own_drive() {
        let (out, calls) = run(Ok(json!({"id":"d"})), Ok(json!({})), None);
        assert_eq!(out.unwrap()["path"], "own_drive");
        assert_eq!(calls, vec![None]);
    }
}
