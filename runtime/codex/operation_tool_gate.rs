//! Controller-owned tool reservation channel for the admitted factory runtime.
//! Ordinary upstream use remains unchanged when the channel is not requested.
use crate::function_tool::FunctionCallError;
use crate::tools::context::ToolInvocation;

const CHANNEL_ENV: &str = "CODEX_DELIVERY_TOOL_GATE_FD";
const HOLD: &str = "Operation tool reservation is unavailable or denied; execution held.";

/// # Safety
/// Call only at CLI startup, before creating threads or child processes.
pub unsafe fn initialize_operation_tool_gate() -> std::io::Result<()> {
    if std::env::var_os(CHANNEL_ENV).is_none() {
        return Ok(());
    }
    #[cfg(unix)]
    {
        unix::initialize()?;
        // SAFETY: the caller guarantees single-threaded process startup. Children
        // must not interpret the parent-only descriptor after close-on-exec.
        unsafe { std::env::remove_var(CHANNEL_ENV) };
        Ok(())
    }
    #[cfg(not(unix))]
    {
        Err(std::io::Error::other("Operation tool gate requires Unix."))
    }
}

pub(crate) async fn authorize(invocation: &ToolInvocation) -> Result<(), FunctionCallError> {
    #[cfg(unix)]
    {
        unix::authorize(invocation).await
    }
    #[cfg(not(unix))]
    {
        let _ = invocation;
        if std::env::var_os(CHANNEL_ENV).is_none() {
            Ok(())
        } else {
            Err(FunctionCallError::Fatal(HOLD.to_string()))
        }
    }
}

#[cfg(unix)]
mod unix {
    use super::CHANNEL_ENV;
    use super::HOLD;
    use super::ToolInvocation;
    use crate::function_tool::FunctionCallError;
    use serde::Deserialize;
    use serde::Serialize;
    use std::io::BufRead;
    use std::io::BufReader;
    use std::io::Read;
    use std::io::Write;
    use std::os::fd::FromRawFd;
    use std::os::unix::net::UnixStream;
    use std::sync::Mutex;
    use std::sync::OnceLock;
    use std::time::Duration;
    use uuid::Uuid;

    const FRAME_LIMIT: u64 = 4096;
    static CHANNEL: OnceLock<Result<Mutex<Channel>, &'static str>> = OnceLock::new();

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Request {
        version: u8,
        request_id: String,
        thread_id: String,
        turn_id: String,
        call_id: String,
        tool_name: String,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct Grant {
        version: u8,
        request_id: String,
        allow: bool,
    }

    struct Channel {
        reader: BufReader<UnixStream>,
        held: bool,
    }

    impl Channel {
        fn new(mut stream: UnixStream, timeout: Duration) -> std::io::Result<Self> {
            stream.set_nonblocking(false)?;
            stream.set_read_timeout(Some(timeout))?;
            stream.set_write_timeout(Some(timeout))?;
            stream.write_all(b"{\"version\":1,\"type\":\"ready\",\"sourceCommit\":\"01fc69f4026735edfdf6789820549727a4867b11\"}\n")?;
            Ok(Self { reader: BufReader::new(stream), held: false })
        }

        fn reserve(&mut self, request: &Request) -> Result<(), ()> {
            if self.held {
                return Err(());
            }
            let result = self.exchange(request);
            if result.is_err() {
                // Never consume another response or run another handler after uncertainty.
                self.held = true;
            }
            result
        }

        fn exchange(&mut self, request: &Request) -> Result<(), ()> {
            let encoded = serde_json::to_vec(request).map_err(|_| ())?;
            if encoded.len() as u64 >= FRAME_LIMIT {
                return Err(());
            }
            self.reader.get_mut().write_all(&encoded).map_err(|_| ())?;
            self.reader.get_mut().write_all(b"\n").map_err(|_| ())?;
            let mut bytes = Vec::new();
            Read::by_ref(&mut self.reader).take(FRAME_LIMIT + 1).read_until(b'\n', &mut bytes).map_err(|_| ())?;
            if bytes.len() as u64 > FRAME_LIMIT || bytes.last() != Some(&b'\n') {
                return Err(());
            }
            let grant: Grant = serde_json::from_slice(&bytes).map_err(|_| ())?;
            if grant.version != 1 || grant.request_id != request.request_id || !grant.allow {
                return Err(());
            }
            Ok(())
        }
    }

    pub(super) fn initialize() -> std::io::Result<()> {
        if std::env::var_os(CHANNEL_ENV).as_deref() != Some(std::ffi::OsStr::new("3")) {
            return Err(std::io::Error::other("Operation tool gate requires inherited descriptor 3."));
        }
        match CHANNEL.get_or_init(|| {
            // SAFETY: descriptor 3 is supplied exclusively by the controller. Set
            // close-on-exec before the CLI can launch any child, then own it once.
            let flags = unsafe { libc::fcntl(3, libc::F_GETFD) };
            if flags < 0 || unsafe { libc::fcntl(3, libc::F_SETFD, flags | libc::FD_CLOEXEC) } < 0 {
                return Err(HOLD);
            }
            let stream = unsafe { UnixStream::from_raw_fd(3) };
            Channel::new(stream, Duration::from_secs(5)).map(Mutex::new).map_err(|_| HOLD)
        }) {
            Ok(_) => Ok(()),
            Err(_) => Err(std::io::Error::other(HOLD)),
        }
    }

    pub(super) async fn authorize(invocation: &ToolInvocation) -> Result<(), FunctionCallError> {
        let Some(channel) = CHANNEL.get() else {
            return if std::env::var_os(CHANNEL_ENV).is_none() {
                Ok(())
            } else {
                Err(FunctionCallError::Fatal(HOLD.to_string()))
            };
        };
        let request = Request {
            version: 1,
            request_id: Uuid::new_v4().to_string(),
            thread_id: invocation.session.thread_id.to_string(),
            turn_id: invocation.turn.sub_id.clone(),
            call_id: invocation.call_id.clone(),
            tool_name: invocation.tool_name.to_string(),
        };
        tokio::task::spawn_blocking(move || {
            channel.as_ref().map_err(|_| ())?.lock().map_err(|_| ())?.reserve(&request)
        }).await.map_err(|_| FunctionCallError::Fatal(HOLD.to_string()))?
            .map_err(|_| FunctionCallError::Fatal(HOLD.to_string()))
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use pretty_assertions::assert_eq;

        fn request() -> Request {
            Request { version: 1, request_id: Uuid::new_v4().to_string(), thread_id: "thread".into(), turn_id: "turn".into(), call_id: "call".into(), tool_name: "functions.exec_command".into() }
        }

        #[test]
        fn grants_require_matching_identity_and_denial_is_sticky() {
            for response in ["deny", "wrong-id", "extra-field", "oversize", "disconnect"] {
                let (client, server) = UnixStream::pair().unwrap();
                let peer = std::thread::spawn(move || {
                    let mut reader = BufReader::new(server);
                    let mut line = String::new();
                    reader.read_line(&mut line).unwrap();
                    assert_eq!(serde_json::from_str::<serde_json::Value>(&line).unwrap()["type"], "ready");
                    line.clear(); reader.read_line(&mut line).unwrap();
                    let input: serde_json::Value = serde_json::from_str(&line).unwrap();
                    let output = match response {
                        "deny" => serde_json::json!({"version":1,"requestId":input["requestId"],"allow":false}).to_string(),
                        "wrong-id" => serde_json::json!({"version":1,"requestId":"wrong","allow":true}).to_string(),
                        "extra-field" => serde_json::json!({"version":1,"requestId":input["requestId"],"allow":true,"extra":true}).to_string(),
                        "oversize" => "x".repeat(4097),
                        _ => return,
                    };
                    let _ = reader.get_mut().write_all(format!("{output}\n").as_bytes());
                });
                let mut channel = Channel::new(client, Duration::from_secs(1)).unwrap();
                assert_eq!(channel.reserve(&request()), Err(()));
                assert_eq!(channel.reserve(&request()), Err(()));
                peer.join().unwrap();
            }
        }

        #[test]
        fn repeated_grants_stop_on_the_first_denial() {
            let (client, server) = UnixStream::pair().unwrap();
            let peer = std::thread::spawn(move || {
                let mut reader = BufReader::new(server);
                let mut line = String::new(); reader.read_line(&mut line).unwrap();
                for index in 0..4 {
                    line.clear(); reader.read_line(&mut line).unwrap();
                    let input: serde_json::Value = serde_json::from_str(&line).unwrap();
                    let output = serde_json::json!({"version":1,"requestId":input["requestId"],"allow":index < 3});
                    writeln!(reader.get_mut(), "{output}").unwrap();
                }
            });
            let mut channel = Channel::new(client, Duration::from_secs(1)).unwrap();
            let mut grants = 0;
            for _ in 0..4 {
                if channel.reserve(&request()).is_ok() { grants += 1; }
            }
            assert_eq!(grants, 3);
            assert_eq!(channel.reserve(&request()), Err(()));
            peer.join().unwrap();
        }
    }
}
