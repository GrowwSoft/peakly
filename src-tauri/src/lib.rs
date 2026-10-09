//! Native side of the Peakly Mac app.
//!
//! - The App Store Connect key lives in the macOS Keychain. Requests are signed
//!   here, so the private key never goes back to the web view after it's saved.
//! - The Keychain is read only when the person clicks Unlock, never at launch:
//!   each read can show a macOS password prompt. What the UI needs before that
//!   (Key ID, vendor number, saved date) is kept in a plain file, `connection.json`.
//! - Published Apple reports are cached under the app's cache folder.
//! - Network calls from the web view go through tauri-plugin-http, limited to
//!   Apple's hosts by `capabilities/default.json`.
//! - The window only ever shows Peakly's own pages (`allowed_navigation`); Feedback
//!   talks to VoteWant's API and opens its board in the browser.

use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State, Url};

const KEYCHAIN_SERVICE: &str = "com.peakly.desktop";
const KEYCHAIN_ACCOUNT: &str = "app-store-connect";

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Credentials {
    issuer_id: String,
    key_id: String,
    private_key: String,
    #[serde(default)]
    vendor_number: String,
    #[serde(default)]
    saved_at: String,
}

/// What the web view may know about the saved key: never the private key itself.
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
struct Status {
    configured: bool,
    /// A key is saved but hasn't been read from the Keychain in this launch.
    locked: bool,
    /// This build may unlock by itself at launch (see `signed_by_team`).
    auto_unlock: bool,
    issuer_id: Option<String>,
    key_id: Option<String>,
    vendor_number: Option<String>,
    saved_at: Option<String>,
}

/// The non-secret part of the saved key, readable without the Keychain.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
struct Summary {
    issuer_id: String,
    key_id: String,
    vendor_number: String,
    saved_at: String,
}

impl From<&Credentials> for Summary {
    fn from(c: &Credentials) -> Self {
        Summary { issuer_id: c.issuer_id.clone(), key_id: c.key_id.clone(), vendor_number: c.vendor_number.clone(), saved_at: c.saved_at.clone() }
    }
}

#[derive(Serialize, Deserialize)]
struct SummaryFile {
    saved: Option<Summary>,
}

/// `None` when the file doesn't exist yet (first launch, or a key saved by an older Peakly).
fn read_summary(path: &std::path::Path) -> Result<Option<Option<Summary>>, String> {
    match fs::read_to_string(path) {
        Ok(text) => Ok(Some(serde_json::from_str::<SummaryFile>(&text).map(|f| f.saved).unwrap_or(None))),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

fn write_summary(path: &std::path::Path, saved: Option<Summary>) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let temp = path.with_extension("tmp");
    fs::write(&temp, serde_json::to_string(&SummaryFile { saved }).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    fs::rename(&temp, path).map_err(|e| e.to_string())
}

/// The status shown before and after unlocking. `earlier_use` is true when an older Peakly
/// may have saved a key without writing the summary file: then only an unlock can tell.
fn status_of(cached: Option<Option<Credentials>>, summary: Option<Option<Summary>>, earlier_use: bool) -> Status {
    let shown = |s: Option<Summary>, locked: bool| match s {
        Some(s) => Status { configured: true, locked, auto_unlock: false, issuer_id: Some(s.issuer_id), key_id: Some(s.key_id), vendor_number: Some(s.vendor_number), saved_at: Some(s.saved_at) },
        None => Status { configured: false, locked: false, auto_unlock: false, issuer_id: None, key_id: None, vendor_number: None, saved_at: None },
    };
    match (cached, summary) {
        (Some(credentials), _) => shown(credentials.as_ref().map(Summary::from), false),
        (None, Some(saved)) => shown(saved, true),
        (None, None) if earlier_use => Status { configured: true, locked: true, auto_unlock: false, issuer_id: None, key_id: None, vendor_number: None, saved_at: None },
        (None, None) => shown(None, false),
    }
}

/// True when this build is signed by a developer team, not ad hoc. macOS lets such an app
/// read the Keychain item it saved without a password prompt, so it can unlock at launch.
/// Unsigned development builds look like a new app after every rebuild and would prompt.
fn signed_by_team() -> bool {
    static SIGNED: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *SIGNED.get_or_init(|| {
        let Ok(exe) = std::env::current_exe() else { return false };
        let Ok(out) = std::process::Command::new("/usr/bin/codesign").args(["-dv", "--verbose=2"]).arg(&exe).output() else { return false };
        team_signed(&String::from_utf8_lossy(&out.stderr))
    })
}

fn team_signed(codesign_info: &str) -> bool {
    !codesign_info.contains("Signature=adhoc")
        && codesign_info.lines().any(|line| line.strip_prefix("TeamIdentifier=").is_some_and(|team| !team.is_empty() && team != "not set"))
}

const LOCKED: &str = "Peakly is locked. Click Unlock to let it read your App Store Connect key from the Keychain.";

#[derive(Serialize)]
struct Claims<'a> {
    iss: &'a str,
    iat: u64,
    exp: u64,
    aud: &'a str,
}

/// Where the saved key lives. The real app uses the macOS Keychain; tests use memory.
trait Secrets: Send + Sync {
    fn get(&self) -> Result<Option<String>, String>;
    fn set(&self, value: &str) -> Result<(), String>;
    fn delete(&self) -> Result<(), String>;
}

struct Keychain;

impl Keychain {
    fn entry() -> Result<keyring::Entry, String> {
        keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT).map_err(|e| format!("Keychain unavailable: {e}"))
    }
}

impl Secrets for Keychain {
    fn get(&self) -> Result<Option<String>, String> {
        match Self::entry()?.get_password() {
            Ok(json) => Ok(Some(json)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(format!("Keychain error: {e}")),
        }
    }
    fn set(&self, value: &str) -> Result<(), String> {
        Self::entry()?.set_password(value).map_err(|e| format!("Keychain error: {e}"))
    }
    fn delete(&self) -> Result<(), String> {
        match Self::entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("Keychain error: {e}")),
        }
    }
}

/// The saved key, read from the Keychain at most once per launch, and only when the
/// person unlocks. Every Keychain read can show a macOS password prompt, and the app
/// signs a token for each request to Apple, so reading per request meant a prompt
/// that never ended.
struct Vault {
    secrets: Box<dyn Secrets>,
    /// `None` until the first read; then the saved key (or its absence).
    cached: Mutex<Option<Option<Credentials>>>,
}

impl Vault {
    fn new(secrets: Box<dyn Secrets>) -> Self {
        Self { secrets, cached: Mutex::new(None) }
    }

    fn load(&self) -> Result<Option<Credentials>, String> {
        let mut cached = self.cached.lock().map_err(|_| "Keychain state unavailable.".to_string())?;
        if let Some(credentials) = cached.as_ref() {
            return Ok(credentials.clone());
        }
        let credentials = match self.secrets.get()? {
            Some(json) => Some(serde_json::from_str(&json).map_err(|_| "The saved key couldn't be read. Remove it and connect again.".to_string())?),
            None => None,
        };
        *cached = Some(credentials.clone());
        Ok(credentials)
    }

    /// What's in memory, without touching the Keychain.
    fn peek(&self) -> Result<Option<Option<Credentials>>, String> {
        Ok(self.cached.lock().map_err(|_| "Keychain state unavailable.".to_string())?.clone())
    }

    /// The key for signing. Never reads the Keychain: that only happens on unlock.
    fn unlocked(&self) -> Result<Credentials, String> {
        match self.peek()? {
            Some(Some(credentials)) => Ok(credentials),
            Some(None) => Err("No App Store Connect key saved.".into()),
            None => Err(LOCKED.into()),
        }
    }

    fn store(&self, credentials: Credentials) -> Result<(), String> {
        let json = serde_json::to_string(&credentials).map_err(|e| e.to_string())?;
        self.secrets.set(&json)?;
        *self.cached.lock().map_err(|_| "Keychain state unavailable.".to_string())? = Some(Some(credentials));
        Ok(())
    }

    fn delete(&self) -> Result<(), String> {
        self.secrets.delete()?;
        *self.cached.lock().map_err(|_| "Keychain state unavailable.".to_string())? = Some(None);
        Ok(())
    }
}

/// Short-lived ES256 token for api.appstoreconnect.apple.com (10 minutes).
fn sign(issuer_id: &str, key_id: &str, private_key: &str, now: u64) -> Result<String, String> {
    let key = EncodingKey::from_ec_pem(private_key.as_bytes())
        .map_err(|_| "The private key couldn't be read. Use the .p8 file from App Store Connect.".to_string())?;
    let mut header = Header::new(Algorithm::ES256);
    header.kid = Some(key_id.to_string());
    header.typ = Some("JWT".to_string());
    let claims = Claims { iss: issuer_id, iat: now, exp: now + 600, aud: "appstoreconnect-v1" };
    encode(&header, &claims, &key).map_err(|e| format!("Couldn't sign the request: {e}"))
}

fn now() -> Result<u64, String> {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).map_err(|e| e.to_string())
}

/// Cache keys are relative paths of safe characters only, so nothing can escape the cache folder.
fn valid_cache_key(key: &str) -> bool {
    !key.is_empty()
        && key.split('/').all(|part| {
            !part.is_empty() && part != "." && part != ".." && part.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
        })
}

fn cache_path(app: &AppHandle, key: &str) -> Result<PathBuf, String> {
    if !valid_cache_key(key) {
        return Err(format!("Invalid cache key: {key}"));
    }
    let base = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("reports");
    Ok(base.join(key))
}

fn summary_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("connection.json"))
}

/// Never reads the Keychain.
#[tauri::command]
fn credentials_status(app: AppHandle, vault: State<Vault>) -> Result<Status, String> {
    let earlier_use = app.path().app_cache_dir().map(|dir| dir.exists()).unwrap_or(false);
    let mut status = status_of(vault.peek()?, read_summary(&summary_path(&app)?)?, earlier_use);
    status.auto_unlock = status.locked && signed_by_team();
    Ok(status)
}

/// The one place that reads the Keychain: the person clicked Unlock.
#[tauri::command]
fn credentials_unlock(app: AppHandle, vault: State<Vault>) -> Result<Status, String> {
    let credentials = vault.load()?;
    write_summary(&summary_path(&app)?, credentials.as_ref().map(Summary::from))?;
    Ok(status_of(Some(credentials), None, false))
}

#[tauri::command]
fn credentials_save(app: AppHandle, vault: State<Vault>, issuer_id: String, key_id: String, private_key: String, vendor_number: String, saved_at: String) -> Result<(), String> {
    sign(&issuer_id, &key_id, &private_key, now()?)?; // reject keys that can't sign before storing
    let credentials = Credentials { issuer_id, key_id, private_key, vendor_number, saved_at };
    let summary = Summary::from(&credentials);
    vault.store(credentials)?;
    write_summary(&summary_path(&app)?, Some(summary))
}

#[tauri::command]
fn credentials_set_vendor(app: AppHandle, vault: State<Vault>, vendor_number: String) -> Result<(), String> {
    let mut credentials = vault.unlocked()?;
    credentials.vendor_number = vendor_number;
    let summary = Summary::from(&credentials);
    vault.store(credentials)?;
    write_summary(&summary_path(&app)?, Some(summary))
}

#[tauri::command]
fn credentials_delete(app: AppHandle, vault: State<Vault>) -> Result<(), String> {
    vault.delete()?;
    write_summary(&summary_path(&app)?, None)
}

#[tauri::command]
fn asc_token(vault: State<Vault>) -> Result<String, String> {
    let c = vault.unlocked()?;
    sign(&c.issuer_id, &c.key_id, &c.private_key, now()?)
}

/// Token for a key that hasn't been saved yet, so the web view can verify it with Apple first.
#[tauri::command]
fn asc_token_for(issuer_id: String, key_id: String, private_key: String) -> Result<String, String> {
    sign(&issuer_id, &key_id, &private_key, now()?)
}

#[tauri::command]
fn cache_get(app: AppHandle, key: String) -> Result<Option<String>, String> {
    let path = cache_path(&app, &key)?;
    match fs::read_to_string(&path) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn cache_set(app: AppHandle, key: String, value: String) -> Result<(), String> {
    let path = cache_path(&app, &key)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let temp = path.with_extension("tmp");
    fs::write(&temp, value).map_err(|e| e.to_string())?;
    fs::rename(&temp, &path).map_err(|e| e.to_string())
}

/// What the web view may load. Only Peakly's own pages: Feedback is drawn natively from
/// VoteWant's API (connect-src), and frames are refused (frame-src 'none'), so a stray link
/// or a compromised page can't put a look-alike page in a window people trust.
fn allowed_navigation(url: &Url, dev_url: Option<&Url>) -> bool {
    match url.scheme() {
        "tauri" => url.host_str() == Some("localhost"),
        "about" => matches!(url.path(), "blank" | "srcdoc"),
        _ => dev_url.is_some_and(|dev| url.origin() == dev.origin()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri::plugin::Builder::<tauri::Wry>::new("navigation-guard")
                .on_navigation(|webview, url| {
                    let dev_url = if tauri::is_dev() { webview.config().build.dev_url.clone() } else { None };
                    allowed_navigation(url, dev_url.as_ref())
                })
                .build(),
        )
        .manage(Vault::new(Box::new(Keychain)))
        .invoke_handler(tauri::generate_handler![
            credentials_status,
            credentials_unlock,
            credentials_save,
            credentials_set_vendor,
            credentials_delete,
            asc_token,
            asc_token_for,
            cache_get,
            cache_set
        ])
        .run(tauri::generate_context!())
        .expect("error while running Peakly");
}

#[cfg(test)]
mod tests {
    use super::*;
    use jsonwebtoken::{decode, decode_header, DecodingKey, Validation};

    // A throwaway P-256 key generated only for these tests.
    const TEST_KEY: &str = include_str!("test-signing-key.txt");
    const TEST_PUBLIC_KEY: &str = include_str!("test-signing-key.pub.txt");

    #[test]
    fn the_window_only_shows_peakly() {
        let url = |s: &str| Url::parse(s).unwrap();
        let dev = url("http://127.0.0.1:5174");
        for ok in ["tauri://localhost/", "tauri://localhost/index.html", "about:blank"] {
            assert!(allowed_navigation(&url(ok), None), "{ok} should load");
        }
        for blocked in [
            "https://example.com/",
            // Feedback no longer frames VoteWant; its pages open in the browser instead.
            "https://votewant.com/boards/getpeakly-com-a180b4a4",
            "https://votewant.com/boards/getpeakly-com-a180b4a4?accent=2a78d6",
            "tauri://evil/",
            "file:///etc/passwd",
            "http://127.0.0.1:5174/",
        ] {
            assert!(!allowed_navigation(&url(blocked), None), "{blocked} should be cancelled");
        }
        // The dev server only counts while running `tauri dev`.
        assert!(allowed_navigation(&url("http://127.0.0.1:5174/src/main.tsx"), Some(&dev)));
        assert!(!allowed_navigation(&url("http://127.0.0.1:9999/"), Some(&dev)));
    }

    #[test]
    fn signs_an_app_store_connect_token() {
        let token = sign("issuer-123", "ABCDEFGHIJ", TEST_KEY, 1_000).unwrap();
        let header = decode_header(&token).unwrap();
        assert_eq!(header.alg, Algorithm::ES256);
        assert_eq!(header.kid.as_deref(), Some("ABCDEFGHIJ"));

        let parts: Vec<&str> = token.split('.').collect();
        assert_eq!(parts.len(), 3);
        let payload: serde_json::Value = serde_json::from_slice(
            &base64_url_decode(parts[1]),
        ).unwrap();
        assert_eq!(payload["iss"], "issuer-123");
        assert_eq!(payload["aud"], "appstoreconnect-v1");
        assert_eq!(payload["exp"].as_u64().unwrap() - payload["iat"].as_u64().unwrap(), 600);
        // The signature verifies with the matching public key (expiry not checked: fixed clock).
        let mut validation = Validation::new(Algorithm::ES256);
        validation.validate_exp = false;
        validation.set_audience(&["appstoreconnect-v1"]);
        let key = DecodingKey::from_ec_pem(TEST_PUBLIC_KEY.as_bytes()).unwrap();
        assert!(decode::<serde_json::Value>(&token, &key, &validation).is_ok());
    }

    #[test]
    fn rejects_a_key_that_is_not_a_p8() {
        assert!(sign("issuer", "KEY", "not a key", 0).is_err());
    }

    #[test]
    fn cache_keys_cannot_escape_the_cache_folder() {
        assert!(valid_cache_key("sales/88123456/2026-10-01.json"));
        assert!(valid_cache_key("analytics/abc-123.json"));
        for bad in ["", "../secret", "/etc/passwd", "a/../../b", "a//b", "a b", "a\\b"] {
            assert!(!valid_cache_key(bad), "{bad} should be rejected");
        }
    }

    /// Counts reads so the tests can prove the Keychain is asked once per launch.
    #[derive(Default, Clone)]
    struct FakeKeychain {
        value: std::sync::Arc<Mutex<Option<String>>>,
        reads: std::sync::Arc<Mutex<u32>>,
    }

    impl Secrets for FakeKeychain {
        fn get(&self) -> Result<Option<String>, String> {
            *self.reads.lock().unwrap() += 1;
            Ok(self.value.lock().unwrap().clone())
        }
        fn set(&self, value: &str) -> Result<(), String> {
            *self.value.lock().unwrap() = Some(value.to_string());
            Ok(())
        }
        fn delete(&self) -> Result<(), String> {
            *self.value.lock().unwrap() = None;
            Ok(())
        }
    }

    fn saved(keychain: &FakeKeychain) {
        let c = Credentials { issuer_id: "issuer".into(), key_id: "KEY".into(), private_key: TEST_KEY.into(), vendor_number: String::new(), saved_at: "now".into() };
        *keychain.value.lock().unwrap() = Some(serde_json::to_string(&c).unwrap());
    }

    #[test]
    fn signing_never_reads_the_keychain_until_unlock_then_reads_it_once() {
        let keychain = FakeKeychain::default();
        saved(&keychain);
        let vault = Vault::new(Box::new(keychain.clone()));
        assert_eq!(vault.unlocked().err().as_deref(), Some(LOCKED));
        assert_eq!(*keychain.reads.lock().unwrap(), 0);
        vault.load().unwrap(); // Unlock
        for _ in 0..25 {
            let c = vault.unlocked().unwrap();
            sign(&c.issuer_id, &c.key_id, &c.private_key, 1_000).unwrap();
        }
        assert_eq!(*keychain.reads.lock().unwrap(), 1);
    }

    #[test]
    fn status_shows_a_saved_key_as_locked_without_the_keychain() {
        let summary = Summary { issuer_id: "issuer".into(), key_id: "KEY".into(), vendor_number: "88123456".into(), saved_at: "now".into() };
        let locked = status_of(None, Some(Some(summary.clone())), true);
        assert!(locked.configured && locked.locked);
        assert_eq!(locked.key_id.as_deref(), Some("KEY"));
        assert_eq!(status_of(None, Some(None), true), status_of(None, None, false)); // removed key / fresh install: not configured
        assert!(!status_of(None, None, false).configured);
        // A key saved by an older Peakly: only an unlock can tell.
        let unknown = status_of(None, None, true);
        assert!(unknown.configured && unknown.locked && unknown.key_id.is_none());
        let c = Credentials { issuer_id: "issuer".into(), key_id: "KEY".into(), private_key: TEST_KEY.into(), vendor_number: "88123456".into(), saved_at: "now".into() };
        let unlocked = status_of(Some(Some(c)), None, false);
        assert!(unlocked.configured && !unlocked.locked);
    }

    #[test]
    fn only_team_signed_builds_unlock_by_themselves() {
        assert!(team_signed("Identifier=com.peakly.desktop\nAuthority=Developer ID Application: Example (ABCDE12345)\nTeamIdentifier=ABCDE12345\n"));
        assert!(!team_signed("Identifier=peakly\nSignature=adhoc\nTeamIdentifier=not set\n"));
        assert!(!team_signed("code object is not signed at all"));
    }

    #[test]
    fn the_summary_file_never_holds_the_private_key() {
        let dir = std::env::temp_dir().join(format!("peakly-summary-test-{}", std::process::id()));
        let path = dir.join("connection.json");
        assert_eq!(read_summary(&path).unwrap(), None);
        let c = Credentials { issuer_id: "issuer".into(), key_id: "KEY".into(), private_key: TEST_KEY.into(), vendor_number: String::new(), saved_at: "now".into() };
        write_summary(&path, Some(Summary::from(&c))).unwrap();
        let text = fs::read_to_string(&path).unwrap();
        assert!(!text.contains("PRIVATE KEY") && !text.contains("privateKey"));
        assert_eq!(read_summary(&path).unwrap(), Some(Some(Summary::from(&c))));
        write_summary(&path, None).unwrap();
        assert_eq!(read_summary(&path).unwrap(), Some(None));
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn saving_updating_and_removing_never_re_read_the_keychain() {
        let keychain = FakeKeychain::default();
        let vault = Vault::new(Box::new(keychain.clone()));
        assert!(vault.load().unwrap().is_none());
        let c = Credentials { issuer_id: "issuer".into(), key_id: "KEY".into(), private_key: TEST_KEY.into(), vendor_number: String::new(), saved_at: "now".into() };
        vault.store(c).unwrap();
        let mut c = vault.load().unwrap().unwrap();
        c.vendor_number = "88123456".into();
        vault.store(c).unwrap();
        assert_eq!(vault.load().unwrap().unwrap().vendor_number, "88123456");
        vault.delete().unwrap();
        assert!(vault.load().unwrap().is_none());
        assert!(keychain.value.lock().unwrap().is_none());
        assert_eq!(*keychain.reads.lock().unwrap(), 1);
    }

    fn base64_url_decode(input: &str) -> Vec<u8> {
        const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
        let mut out = Vec::new();
        let (mut buffer, mut bits) = (0u32, 0u32);
        for byte in input.bytes() {
            let value = ALPHABET.iter().position(|&c| c == byte).unwrap() as u32;
            buffer = (buffer << 6) | value;
            bits += 6;
            if bits >= 8 {
                bits -= 8;
                out.push((buffer >> bits) as u8);
            }
        }
        out
    }
}
