// core/scraper.rs
use super::db::{
    get_evidence_by_source_url_hash, insert_evidence_item, update_source_status, DbConn,
    EvidenceItem, Source,
};
use super::intelligence;
use chrono::Utc;
use quick_xml::events::Event;
use quick_xml::Reader;
use quick_xml::XmlVersion;
use reqwest::Client;
use serde_json;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::error::Error;
use std::net::{IpAddr, SocketAddr, ToSocketAddrs};
use std::sync::LazyLock;
use std::time::{Duration, Instant};
use tokio::time::sleep;

// SSRF defense-in-depth: a source URL can arrive from manual entry OR from the
// discovery -> auto-import chain (third-party search results the user never
// typed). Without validation the scraper would fetch and store the body of
// `http://127.0.0.1:11434` (local Ollama), `http://169.254.169.254` (cloud
// metadata), or internal-LAN hosts. `validate_source_url` is the cheap,
// network-free gate used when a source is *stored* (rejects bad schemes and
// blocked IP literals); `validate_and_pin` additionally resolves DNS, validates
// the resolved IP, and returns it so the scrape-time connection is pinned to the
// exact address that was validated (defeating DNS rebinding). It is used at
// *scrape* time, where the network is in play anyway and DNS may have changed
// since the source was added.
pub fn validate_source_url(url: &str) -> Result<reqwest::Url, String> {
    let parsed = reqwest::Url::parse(url.trim()).map_err(|e| format!("Invalid URL: {}", e))?;

    match parsed.scheme() {
        "http" | "https" => {}
        other => {
            return Err(format!(
                "Unsupported URL scheme '{}': only http and https sources are allowed",
                other
            ))
        }
    }

    let host = parsed
        .host_str()
        .ok_or_else(|| "URL has no host".to_string())?;

    // If the host is a literal IP, check it now without touching DNS.
    // `host_str()` keeps the brackets on IPv6 literals (`[::1]`), so strip them
    // before parsing.
    if let Ok(ip) = host_as_ip(host) {
        if is_blocked_ip(&ip) {
            return Err(format!(
                "URL host {} is a blocked address: loopback, private, and link-local destinations are not allowed",
                ip
            ));
        }
    }

    Ok(parsed)
}

fn host_as_ip(host: &str) -> Result<IpAddr, std::net::AddrParseError> {
    host.trim_start_matches('[')
        .trim_end_matches(']')
        .parse::<IpAddr>()
}

/// Resolve `url`'s host ONCE, validate every resolved IP, and return a single
/// pinned `SocketAddr` to connect to (or `None` for a literal-IP host, which
/// reqwest will connect to directly with no further DNS).
///
/// ENG-M3 (DNS-rebinding TOCTOU): the previous design validated the host's DNS
/// in one lookup and then let reqwest perform an INDEPENDENT lookup at connect
/// time. A low-TTL attacker domain could resolve to a public IP during
/// validation and to `169.254.169.254`/RFC1918 during the connect, sailing past
/// the gate. By resolving once here and pinning the connection to the validated
/// IP (via `ClientBuilder::resolve`), the IP we checked is the IP we connect to.
/// The storage-time `validate_source_url` check remains a cheap best-effort
/// filter; THIS function is the real gate.
pub fn validate_and_pin(url: &str) -> Result<Option<SocketAddr>, String> {
    let parsed = validate_source_url(url)?;
    let host = parsed
        .host_str()
        .ok_or_else(|| "URL has no host".to_string())?;

    // Literal IPs were already vetted by validate_source_url; reqwest connects
    // to them directly, so there is no DNS step to pin.
    if host_as_ip(host).is_ok() {
        return Ok(None);
    }

    let port = parsed.port_or_known_default().unwrap_or(80);
    let addrs: Vec<SocketAddr> = (host, port)
        .to_socket_addrs()
        .map_err(|e| format!("Could not resolve host '{}': {}", host, e))?
        .collect();

    if addrs.is_empty() {
        return Err(format!("Host '{}' did not resolve to any address", host));
    }

    // Reject if ANY resolved address is blocked (so we never connect to a host
    // that round-robins between a public and an internal IP).
    for addr in &addrs {
        if is_blocked_ip(&addr.ip()) {
            return Err(format!(
                "URL host '{}' resolves to a blocked address ({}): loopback, private, and link-local destinations are not allowed",
                host, addr.ip()
            ));
        }
    }

    // Pin to the first validated address. Because we already rejected the whole
    // set if any member was blocked, this address is guaranteed safe.
    Ok(Some(addrs[0]))
}

fn is_blocked_ip(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local() // 169.254.0.0/16 — covers the 169.254.169.254 metadata IP
                || v4.is_unspecified()
                || v4.is_broadcast()
                // Carrier-grade NAT 100.64.0.0/10
                || (v4.octets()[0] == 100 && (v4.octets()[1] & 0xc0) == 64)
        }
        IpAddr::V6(v6) => {
            // Unwrap IPv4-mapped addresses (::ffff:a.b.c.d) and check as IPv4.
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_blocked_ip(&IpAddr::V4(v4));
            }
            v6.is_loopback()
                || v6.is_unspecified()
                || (v6.segments()[0] & 0xffc0) == 0xfe80 // link-local fe80::/10
                || (v6.segments()[0] & 0xfe00) == 0xfc00 // unique-local fc00::/7
        }
    }
}

// Generate content hash to deduplicate evidence items
pub fn compute_hash(text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    format!("{:x}", hasher.finalize())
}

// Pre-compiled entity-extraction regexes (ENG-Nit1). Compiling a `Regex` is
// expensive; `extract_entities` runs once per evidence chunk, so build these
// once and reuse them (mirrors the pattern used in detectors.rs).
static RE_DOLLAR: LazyLock<regex::Regex> =
    LazyLock::new(|| regex::Regex::new(r"\$[0-9,]+(?:\.[0-9]+)?").unwrap());
static RE_ORG: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r"\b[A-Z][a-zA-Z0-9&]+(?:\s+[A-Z][a-zA-Z0-9&]+)*\s+(?:Board|Council|Committee|Department|District|Commission|Agency|Association|Corp|Inc|LLC)\b").unwrap()
});

// Simple entity extraction using regex/keywords for our evidence entities list
pub fn extract_entities(text: &str) -> Vec<String> {
    let mut entities = Vec::new();

    // Extract dollar amounts
    for mat in RE_DOLLAR.find_iter(text) {
        entities.push(mat.as_str().to_string());
    }

    // Extract formal organizations
    for mat in RE_ORG.find_iter(text) {
        entities.push(mat.as_str().to_string());
    }

    entities.sort();
    entities.dedup();
    entities
}

/// Build the scraper HTTP client. When `pin` is supplied, the client is
/// configured to resolve `host` to that exact `SocketAddr` (ENG-M3), so the IP
/// we validated is the IP we connect to — defeating DNS rebinding. Redirect
/// following is always disabled; `fetch_validated` follows hops manually so each
/// one is re-validated and re-pinned.
fn build_scraper_client(pin: Option<(&str, SocketAddr)>) -> Result<Client, Box<dyn Error>> {
    let mut builder = Client::builder()
        .timeout(Duration::from_secs(10))
        .user_agent("CivicNewsScraper/1.0 (+https://github.com/scottconverse/CivicNewspaper)")
        // Disable reqwest's automatic redirect following. The default policy
        // follows up to 10 redirects, but it would only have validated the
        // *original* URL's resolved IP — a public feed that 302s to
        // `http://169.254.169.254/` (cloud metadata) or an internal-LAN host
        // would be followed straight past the SSRF gate. We follow redirects
        // manually in `fetch_validated`, re-running the resolved-IP check on
        // every hop.
        .redirect(reqwest::redirect::Policy::none());

    if let Some((host, addr)) = pin {
        // Override DNS for this host so reqwest connects to the pre-validated IP
        // (with the correct Host header / SNI preserved from the URL).
        builder = builder.resolve(host, addr);
    }

    Ok(builder.build()?)
}

pub async fn scrape_all_sources(db: &DbConn) -> Result<(), Box<dyn Error>> {
    let sources = {
        let conn = db.lock().map_err(|_| "Failed to lock database")?;
        super::db::list_sources(&conn)?
    };

    let mut last_fetch_by_host: HashMap<String, Instant> = HashMap::new();
    for source in sources {
        if let Ok(parsed) = validate_source_url(&source.url) {
            if let Some(host) = parsed.host_str().map(|value| value.to_ascii_lowercase()) {
                if let Some(last_fetch) = last_fetch_by_host.get(&host) {
                    let elapsed = last_fetch.elapsed();
                    let politeness_delay = Duration::from_secs(3);
                    if elapsed < politeness_delay {
                        sleep(politeness_delay - elapsed).await;
                    }
                }
                last_fetch_by_host.insert(host, Instant::now());
            }
        }

        let source_id = source.id.unwrap_or(0);
        println!("Scraping source: {} ({})", source.name, source.url);

        match scrape_source(db, &source).await {
            Ok(_) => {
                println!("Scraped source successfully: {}", source.name);
                let conn = db.lock().map_err(|_| "Failed to lock database")?;
                let _ = update_source_status(&conn, source_id, "online", true);
                let _ = intelligence::record_source_fetch(
                    &conn,
                    &source,
                    true,
                    "Source fetched successfully.",
                );
            }
            Err(e) => {
                eprintln!("Scrape failed for {}: {}", source.name, e);
                let conn = db.lock().map_err(|_| "Failed to lock database")?;
                let _ = update_source_status(&conn, source_id, "offline", false);
                let _ = intelligence::record_source_fetch(&conn, &source, false, &e.to_string());
            }
        }
    }
    Ok(())
}

// Resolve a redirect's `Location` (which may be relative) against the URL that
// produced it. Kept network-free and pure so the redirect-handling logic is
// unit-testable without a live HTTP server.
fn resolve_redirect_target(current: &str, location: &str) -> Result<String, Box<dyn Error>> {
    let base = reqwest::Url::parse(current)?;
    let next = base.join(location)?;
    Ok(next.to_string())
}

// Fetch a URL, following redirects manually so that *every* hop is re-validated
// with DNS resolution before we connect to it. The client must be built with
// `redirect::Policy::none()`; otherwise reqwest would follow redirects itself,
// having validated only the original URL — a redirect-SSRF gap (a public feed
// 302-ing to an internal/metadata address).
const MAX_REDIRECTS: usize = 10;
const MAX_SOURCE_BODY_BYTES: usize = 5 * 1024 * 1024;

fn robots_target_path(url: &str) -> Result<String, Box<dyn Error>> {
    let parsed = reqwest::Url::parse(url)?;
    let mut path = parsed.path().to_string();
    if path.is_empty() {
        path = "/".to_string();
    }
    if let Some(query) = parsed.query() {
        path.push('?');
        path.push_str(query);
    }
    Ok(path)
}

fn robots_url_for(url: &str) -> Result<String, Box<dyn Error>> {
    let parsed = reqwest::Url::parse(url)?;
    let scheme = parsed.scheme();
    let host = parsed.host_str().ok_or("URL has no host")?;
    let port = parsed
        .port()
        .map(|port| format!(":{port}"))
        .unwrap_or_default();
    Ok(format!("{scheme}://{host}{port}/robots.txt"))
}

pub(crate) fn robots_txt_allows(robots_txt: &str, user_agent: &str, target_path: &str) -> bool {
    let mut group_applies = false;
    let mut saw_rule_in_group = false;
    let mut best_allow_len: Option<usize> = None;
    let mut best_disallow_len: Option<usize> = None;
    let normalized_agent = user_agent.to_lowercase();

    for raw_line in robots_txt.lines() {
        let line = raw_line.split('#').next().unwrap_or("").trim();
        if line.is_empty() {
            if saw_rule_in_group {
                group_applies = false;
                saw_rule_in_group = false;
            }
            continue;
        }
        let Some((field, value)) = line.split_once(':') else {
            continue;
        };
        let field = field.trim().to_lowercase();
        let value = value.trim();
        if field == "user-agent" {
            if saw_rule_in_group {
                group_applies = false;
                saw_rule_in_group = false;
            }
            let agent = value.to_lowercase();
            if agent == "*" || normalized_agent.contains(&agent) {
                group_applies = true;
            }
            continue;
        }
        if !group_applies {
            continue;
        }
        if field == "allow" || field == "disallow" {
            saw_rule_in_group = true;
            if value.is_empty() {
                continue;
            }
            if target_path.starts_with(value) {
                if field == "allow" {
                    best_allow_len = Some(best_allow_len.unwrap_or(0).max(value.len()));
                } else {
                    best_disallow_len = Some(best_disallow_len.unwrap_or(0).max(value.len()));
                }
            }
        }
    }

    match (best_allow_len, best_disallow_len) {
        (Some(allow_len), Some(disallow_len)) => allow_len >= disallow_len,
        (Some(_), None) => true,
        (None, Some(_)) => false,
        (None, None) => true,
    }
}

async fn robots_allows_source_url(initial_url: &str) -> Result<bool, Box<dyn Error>> {
    let robots_url = robots_url_for(initial_url)?;
    let target_path = robots_target_path(initial_url)?;
    let response = match fetch_validated_with(&robots_url, |url| {
        let url = url.to_string();
        Box::pin(async move {
            tokio::task::spawn_blocking(move || validate_and_pin(&url))
                .await
                .map_err(|e| -> Box<dyn Error> { e.to_string().into() })?
                .map_err(|e| -> Box<dyn Error> { e.into() })
        })
    })
    .await
    {
        Ok(response) => response,
        Err(_) => return Ok(true),
    };

    if !response.status().is_success() {
        return Ok(true);
    }
    let body_bytes = read_limited_response(response).await.unwrap_or_default();
    let body = String::from_utf8_lossy(&body_bytes);
    Ok(robots_txt_allows(&body, "CivicNewsScraper", &target_path))
}

async fn fetch_validated(initial_url: &str) -> Result<reqwest::Response, Box<dyn Error>> {
    // Production path: validate (and DNS-pin) every hop with the real
    // `validate_and_pin` gate. The loop itself lives in `fetch_validated_with` so
    // it can be driven against local axum stubs in tests with an injected
    // validator (the real gate blocks loopback, which is where stubs must live).
    if !robots_allows_source_url(initial_url).await? {
        return Err(format!("robots.txt disallows scraping {}", initial_url).into());
    }
    fetch_validated_with(initial_url, |url| {
        let url = url.to_string();
        Box::pin(async move {
            tokio::task::spawn_blocking(move || validate_and_pin(&url))
                .await
                .map_err(|e| -> Box<dyn Error> { e.to_string().into() })?
                .map_err(|e| -> Box<dyn Error> { e.into() })
        })
    })
    .await
}

async fn read_limited_response(mut response: reqwest::Response) -> Result<Vec<u8>, Box<dyn Error>> {
    if let Some(length) = response.content_length() {
        if length > MAX_SOURCE_BODY_BYTES as u64 {
            return Err(format!(
                "Source response is too large: {} bytes exceeds {} byte limit",
                length, MAX_SOURCE_BODY_BYTES
            )
            .into());
        }
    }

    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        if body.len() + chunk.len() > MAX_SOURCE_BODY_BYTES {
            return Err(format!(
                "Source response exceeded {} byte limit while downloading",
                MAX_SOURCE_BODY_BYTES
            )
            .into());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

#[derive(Debug, Default)]
pub(crate) struct FeedEntry {
    pub(crate) title: String,
    pub(crate) description: String,
    pub(crate) url: Option<String>,
}

fn xml_local_name(name: &[u8]) -> &[u8] {
    name.rsplit(|b| *b == b':').next().unwrap_or(name)
}

fn decode_xml_text(text: quick_xml::events::BytesText<'_>) -> Result<String, Box<dyn Error>> {
    let decoded = text.decode()?;
    Ok(quick_xml::escape::unescape(&decoded)?.into_owned())
}

pub(crate) fn parse_feed_entries(body: &[u8]) -> Result<Vec<FeedEntry>, Box<dyn Error>> {
    let mut reader = Reader::from_reader(body);
    reader.config_mut().trim_text(true);

    let mut buf = Vec::new();
    let mut entries = Vec::new();
    let mut current = FeedEntry::default();
    let mut in_entry = false;
    let mut current_field: Option<Vec<u8>> = None;

    loop {
        match reader.read_event_into(&mut buf)? {
            Event::Start(start) => {
                let name = xml_local_name(start.name().as_ref()).to_vec();
                if name == b"item" || name == b"entry" {
                    in_entry = true;
                    current = FeedEntry::default();
                    current_field = None;
                } else if in_entry {
                    if name == b"link" {
                        for attr in start.attributes().with_checks(false) {
                            let attr = attr?;
                            if xml_local_name(attr.key.as_ref()) == b"href" && current.url.is_none()
                            {
                                current.url = Some(
                                    attr.decoded_and_normalized_value(
                                        XmlVersion::Implicit1_0,
                                        reader.decoder(),
                                    )?
                                    .into_owned(),
                                );
                            }
                        }
                    }
                    if matches!(
                        name.as_slice(),
                        b"title" | b"description" | b"summary" | b"content" | b"link"
                    ) {
                        current_field = Some(name);
                    }
                }
            }
            Event::Empty(empty) => {
                if in_entry
                    && xml_local_name(empty.name().as_ref()) == b"link"
                    && current.url.is_none()
                {
                    for attr in empty.attributes().with_checks(false) {
                        let attr = attr?;
                        if xml_local_name(attr.key.as_ref()) == b"href" {
                            current.url = Some(
                                attr.decoded_and_normalized_value(
                                    XmlVersion::Implicit1_0,
                                    reader.decoder(),
                                )?
                                .into_owned(),
                            );
                            break;
                        }
                    }
                }
            }
            Event::Text(text) => {
                if let (true, Some(field)) = (in_entry, current_field.as_deref()) {
                    let value = decode_xml_text(text)?;
                    match field {
                        b"title" => append_text(&mut current.title, &value),
                        b"description" | b"summary" => {
                            append_text(&mut current.description, &value)
                        }
                        b"content" if current.description.trim().is_empty() => {
                            append_text(&mut current.description, &value)
                        }
                        b"link" if current.url.is_none() => {
                            let value = value.trim();
                            if !value.is_empty() {
                                current.url = Some(value.to_string());
                            }
                        }
                        _ => {}
                    }
                }
            }
            Event::CData(data) => {
                if let (true, Some(field)) = (in_entry, current_field.as_deref()) {
                    let value = data.decode()?.into_owned();
                    match field {
                        b"title" => append_text(&mut current.title, &value),
                        b"description" | b"summary" => {
                            append_text(&mut current.description, &value)
                        }
                        b"content" if current.description.trim().is_empty() => {
                            append_text(&mut current.description, &value)
                        }
                        _ => {}
                    }
                }
            }
            Event::End(end) => {
                let name = xml_local_name(end.name().as_ref()).to_vec();
                if name == b"item" || name == b"entry" {
                    if !current.title.trim().is_empty() || !current.description.trim().is_empty() {
                        entries.push(current);
                    }
                    current = FeedEntry::default();
                    in_entry = false;
                    current_field = None;
                } else if current_field.as_deref() == Some(name.as_slice()) {
                    current_field = None;
                }
            }
            Event::Eof => break,
            _ => {}
        }
        buf.clear();
    }

    Ok(entries)
}

fn append_text(target: &mut String, value: &str) {
    let value = value.trim();
    if value.is_empty() {
        return;
    }
    if !target.is_empty() {
        target.push(' ');
    }
    target.push_str(value);
}

/// The redirect-following loop, generic over the per-hop validator so the
/// security-critical control flow (re-validate-then-connect on EVERY hop, the
/// max-redirect cap, the missing-Location branch) is testable end-to-end against
/// local stub servers without the real `validate_and_pin` (which blocks loopback).
/// TEST-M2.
///
/// `validate` is called with each hop's URL before it is fetched and returns the
/// `SocketAddr` to pin the connection to (or `None` to let reqwest resolve a
/// literal-IP host directly). Returning `Err` from `validate` aborts the fetch —
/// this is how an internal/blocked redirect target is rejected mid-loop rather
/// than followed.
async fn fetch_validated_with<F>(
    initial_url: &str,
    validate: F,
) -> Result<reqwest::Response, Box<dyn Error>>
where
    F: Fn(
        &str,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<Option<SocketAddr>, Box<dyn Error>>> + Send>,
    >,
{
    let mut current = initial_url.to_string();

    for _ in 0..=MAX_REDIRECTS {
        // Re-validate before each fetch AND capture the single resolved IP we
        // validated, so we can pin the connection to it. A stored URL may predate
        // this check, a host's DNS can change between add and scrape, and a
        // redirect target is attacker-influenced. (ENG-M3: resolve-once /
        // connect-to-pinned-IP closes the DNS-rebinding TOCTOU.)
        let pinned_addr = validate(&current).await?;

        // Build a client pinned to the validated IP for this exact host. For a
        // literal-IP host (`pinned_addr` is None) the default resolver connects
        // straight to that already-vetted literal.
        let parsed = reqwest::Url::parse(&current)?;
        let host = parsed.host_str().ok_or("URL has no host")?.to_string();
        let pin = pinned_addr.map(|addr| (host.as_str(), addr));
        let client = build_scraper_client(pin)?;

        let response = client.get(&current).send().await?;

        if response.status().is_redirection() {
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|v| v.to_str().ok())
                .ok_or("Redirect response missing a valid Location header")?;
            current = resolve_redirect_target(&current, location)?;
            continue;
        }

        return Ok(response);
    }

    Err(format!(
        "Too many redirects (>{}) while fetching {}",
        MAX_REDIRECTS, initial_url
    )
    .into())
}

async fn scrape_source(db: &DbConn, source: &Source) -> Result<(), Box<dyn Error>> {
    // Fetch through a manual redirect loop that re-validates (with DNS
    // resolution) and re-pins the connection IP on every hop. See
    // `fetch_validated` for why automatic redirect following is unsafe here.
    let response = fetch_validated(&source.url).await?;
    if !response.status().is_success() {
        return Err(format!("HTTP error status: {}", response.status()).into());
    }

    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|c| c.to_str().ok())
        .unwrap_or("")
        .to_string();

    let body_bytes = read_limited_response(response).await?;

    // Detect if RSS feed or raw HTML
    let is_feed = content_type.contains("xml")
        || content_type.contains("rss")
        || content_type.contains("atom")
        || body_bytes.starts_with(b"<?xml")
        || body_bytes.starts_with(b"<rss")
        || body_bytes.starts_with(b"<feed");

    if is_feed {
        for entry in parse_feed_entries(&body_bytes)? {
            let title = entry.title;
            let description = entry.description;
            let url = entry.url;

            // Build excerpt based on source type constraints (pure fn so the
            // media_lead headline-only privacy rule is unit-testable — TEST-M1).
            let excerpt = build_excerpt(&source.r#type, &title, &description);

            if excerpt.trim().is_empty() {
                continue;
            }

            let hash = compute_hash(&excerpt);
            let source_id = source.id.unwrap();

            // Check for duplicates
            let (is_new, previous_hash) = {
                let conn = db.lock().map_err(|_| "Failed to lock database")?;
                (
                    get_evidence_by_source_url_hash(&conn, source_id, url.as_deref(), &hash)?
                        .is_none(),
                    intelligence::previous_hash_for_source_url(
                        &conn,
                        source_id,
                        url.as_deref(),
                        &hash,
                    )?,
                )
            };

            if is_new {
                let entities = extract_entities(&excerpt);
                let entities_json =
                    serde_json::to_string(&entities).unwrap_or_else(|_| "[]".to_string());

                let item = EvidenceItem {
                    id: None,
                    source_id,
                    url,
                    fetched_at: Utc::now().to_rfc3339(),
                    excerpt,
                    content_hash: hash,
                    entities: entities_json,
                };
                let conn = db.lock().map_err(|_| "Failed to lock database")?;
                let evidence_id = insert_evidence_item(&conn, &item)?;
                intelligence::record_evidence_intelligence(
                    &conn,
                    source,
                    &item,
                    evidence_id,
                    previous_hash,
                )?;
            }
        }
    } else {
        // Raw HTML Webpage
        let html_text = String::from_utf8_lossy(&body_bytes);
        // Simple HTML text extractor (strips scripts, styles, tags)
        let text_content = clean_html(&html_text);

        let excerpt = if source.r#type == "media_lead" {
            // Store only first line/title if it's media
            let first_line = text_content.lines().next().unwrap_or("Media Headline");
            format!("Headline: {}", first_line)
        } else {
            // For agenda/public record, split into reasonable paragraphs and store as multiple items
            text_content
        };

        if !excerpt.trim().is_empty() {
            // Split large text blocks into chunks to prevent database bloating
            for chunk in chunk_text(&excerpt, 2000) {
                let hash = compute_hash(&chunk);
                let item_url = Some(source.url.clone());
                let source_id = source.id.unwrap();
                let (is_new, previous_hash) = {
                    let conn = db.lock().map_err(|_| "Failed to lock database")?;
                    (
                        get_evidence_by_source_url_hash(
                            &conn,
                            source_id,
                            item_url.as_deref(),
                            &hash,
                        )?
                        .is_none(),
                        intelligence::previous_hash_for_source_url(
                            &conn,
                            source_id,
                            item_url.as_deref(),
                            &hash,
                        )?,
                    )
                };
                if is_new {
                    let entities = extract_entities(&chunk);
                    let entities_json =
                        serde_json::to_string(&entities).unwrap_or_else(|_| "[]".to_string());

                    let item = EvidenceItem {
                        id: None,
                        source_id,
                        url: item_url,
                        fetched_at: Utc::now().to_rfc3339(),
                        excerpt: chunk,
                        content_hash: hash,
                        entities: entities_json,
                    };
                    let conn = db.lock().map_err(|_| "Failed to lock database")?;
                    let evidence_id = insert_evidence_item(&conn, &item)?;
                    intelligence::record_evidence_intelligence(
                        &conn,
                        source,
                        &item,
                        evidence_id,
                        previous_hash,
                    )?;
                }
            }
        }
    }

    Ok(())
}

/// Build a feed-entry excerpt subject to per-source-type constraints.
///
/// TEST-M1 — the `media_lead` rule is an editorial/copyright invariant: media
/// sources store the HEADLINE ONLY and NEVER the body/description text, so the app
/// cannot over-collect or republish copyrighted media body content. Every other
/// source type keeps the full title + description. Kept pure (no I/O) so this
/// invariant is directly unit-testable and a refactor that started storing body
/// text for media leads would fail a test.
pub(crate) fn build_excerpt(source_type: &str, title: &str, description: &str) -> String {
    if source_type == "media_lead" {
        // Media headlines: NEVER store body text. Title/Headline only.
        format!("Headline: {}", title)
    } else {
        format!("Title: {}\nDescription: {}", title, description)
    }
}

static RE_SCRIPT_STYLE: LazyLock<regex::Regex> =
    LazyLock::new(|| regex::Regex::new(r"(?s)<(script|style)[^>]*>.*?</(script|style)>").unwrap());
static RE_TAGS: LazyLock<regex::Regex> = LazyLock::new(|| regex::Regex::new(r"<[^>]*>").unwrap());

fn is_likely_site_boilerplate_line(line: &str) -> bool {
    let lower = line.trim().to_lowercase();
    if lower.is_empty() {
        return true;
    }
    if line.contains('\u{00a9}') && lower.contains("202") {
        return true;
    }

    let exact = [
        "facebook",
        "instagram",
        "youtube",
        "whatsapp",
        "search",
        "services",
        "back to main",
        "skip",
        "accessibility",
        "employee login",
        "terms of use",
        "privacy policy",
        "land acknowledgment",
        "insidelongmont",
        "choose your subscriptions",
        "subscribe to selections",
    ];
    if exact.iter().any(|needle| lower == *needle) {
        return true;
    }

    let contains = [
        "join whatsapp channel",
        "join whatsapp",
        "get city news in spanish",
        "select the topics and departments",
        "follow our whatsapp channel",
        "copyright ",
        "all rights reserved",
        "cookie policy",
        "site map",
        "social media",
        "newsletter signup",
    ];
    if contains.iter().any(|needle| lower.contains(needle)) {
        return true;
    }

    let footer_nav_terms = [
        "accessibility",
        "land acknowledgment",
        "insidelongmont",
        "employee login",
        "terms of use",
        "privacy policy",
    ];
    footer_nav_terms
        .iter()
        .filter(|needle| lower.contains(**needle))
        .count()
        >= 2
}

pub(crate) fn strip_public_boilerplate(text: &str) -> String {
    let mut cleaned = Vec::new();
    let mut skipping_subscription_block = false;

    for line in text.lines() {
        let trimmed = line.trim();
        let lower = trimmed.to_lowercase();
        if lower.contains("choose your subscriptions")
            || lower.contains("get city news in spanish")
            || lower.contains("follow our whatsapp channel")
        {
            skipping_subscription_block = true;
            continue;
        }
        if skipping_subscription_block {
            if lower.contains("subscribe")
                || lower.contains("skip")
                || lower.contains("select the topics")
                || lower.contains("join whatsapp")
                || lower.contains("email")
            {
                continue;
            }
            skipping_subscription_block = false;
        }
        if is_likely_site_boilerplate_line(trimmed) {
            continue;
        }
        cleaned.push(trimmed);
    }

    cleaned.join("\n")
}

pub(crate) fn clean_html(html: &str) -> String {
    let step1 = RE_SCRIPT_STYLE.replace_all(html, "");
    let step2 = RE_TAGS.replace_all(&step1, " ");

    // Normalize whitespace
    let mut cleaned = String::new();
    for line in step2.lines() {
        let trimmed = line.trim();
        if !trimmed.is_empty() {
            cleaned.push_str(trimmed);
            cleaned.push('\n');
        }
    }
    strip_public_boilerplate(&cleaned)
}

pub(crate) fn chunk_text(text: &str, chunk_size: usize) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut current_chunk = String::new();

    for paragraph in text.split("\n") {
        let p_trimmed = paragraph.trim();
        if p_trimmed.is_empty() {
            continue;
        }
        if current_chunk.len() + p_trimmed.len() > chunk_size && !current_chunk.is_empty() {
            chunks.push(current_chunk.clone());
            current_chunk.clear();
        }
        current_chunk.push_str(p_trimmed);
        current_chunk.push('\n');
    }

    if !current_chunk.is_empty() {
        chunks.push(current_chunk);
    }

    if chunks.is_empty() && !text.trim().is_empty() {
        chunks.push(text.trim().to_string());
    }

    chunks
}

#[cfg(test)]
mod url_validation_tests {
    use super::*;
    use std::net::{Ipv4Addr, Ipv6Addr};

    #[test]
    fn rejects_non_http_schemes() {
        for url in [
            "file:///etc/passwd",
            "ftp://example.com/feed.xml",
            "gopher://example.com",
            "data:text/html,<script>alert(1)</script>",
            "javascript:alert(1)",
        ] {
            let res = validate_source_url(url);
            assert!(res.is_err(), "scheme should be rejected: {}", url);
        }
    }

    #[test]
    fn rejects_blocked_ip_literals() {
        // loopback, RFC1918, link-local (incl. metadata), unspecified, CGNAT,
        // and IPv6 loopback / IPv4-mapped loopback.
        for url in [
            "http://127.0.0.1/feed",
            "http://127.0.0.1:11434/api/tags",
            "http://10.0.0.5/x",
            "http://172.16.4.2/x",
            "http://192.168.1.1/x",
            "http://169.254.169.254/latest/meta-data/",
            "http://0.0.0.0/x",
            "http://100.64.0.1/x",
            "http://[::1]/x",
            "http://[::ffff:127.0.0.1]/x",
        ] {
            let res = validate_source_url(url);
            assert!(
                res.is_err(),
                "blocked IP literal should be rejected: {}",
                url
            );
        }
    }

    #[test]
    fn accepts_public_http_and_https() {
        // Public hostnames pass the network-free storage check (no DNS performed
        // here); a literal public IP also passes.
        for url in [
            "http://example.com/feed.xml",
            "https://www.brightoncolorado.gov/rss",
            "https://203.0.113.10/feed", // TEST-NET-3, a routable-looking literal
        ] {
            assert!(
                validate_source_url(url).is_ok(),
                "should be accepted: {}",
                url
            );
        }
    }

    #[test]
    fn robots_txt_blocks_disallowed_paths_for_civic_scraper() {
        let robots = r#"
User-agent: *
Disallow: /private

User-agent: CivicNewsScraper
Disallow: /blocked
Allow: /blocked/public
"#;
        assert!(!robots_txt_allows(
            robots,
            "CivicNewsScraper",
            "/private/agenda"
        ));
        assert!(!robots_txt_allows(
            robots,
            "CivicNewsScraper",
            "/blocked/minutes"
        ));
        assert!(robots_txt_allows(
            robots,
            "CivicNewsScraper",
            "/blocked/public/minutes"
        ));
        assert!(robots_txt_allows(
            robots,
            "CivicNewsScraper",
            "/open/minutes"
        ));
    }

    #[test]
    fn resolved_check_rejects_blocked_literal_without_dns() {
        // The resolving variant must still reject IP literals (it short-circuits
        // before DNS for literals) — no network required for this assertion.
        assert!(validate_and_pin("http://127.0.0.1/feed").is_err());
        assert!(validate_and_pin("http://169.254.169.254/").is_err());
    }

    #[test]
    fn is_blocked_ip_classifies_ranges() {
        let blocked = [
            IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1)),
            IpAddr::V4(Ipv4Addr::new(10, 1, 2, 3)),
            IpAddr::V4(Ipv4Addr::new(172, 31, 255, 255)),
            IpAddr::V4(Ipv4Addr::new(192, 168, 0, 1)),
            IpAddr::V4(Ipv4Addr::new(169, 254, 169, 254)),
            IpAddr::V4(Ipv4Addr::UNSPECIFIED),
            IpAddr::V4(Ipv4Addr::new(100, 64, 0, 1)),
            IpAddr::V6(Ipv6Addr::LOCALHOST),
            IpAddr::V6(Ipv6Addr::UNSPECIFIED),
            IpAddr::V6("fe80::1".parse().unwrap()),
            IpAddr::V6("fc00::1".parse().unwrap()),
        ];
        for ip in blocked {
            assert!(is_blocked_ip(&ip), "{} should be blocked", ip);
        }

        let allowed = [
            IpAddr::V4(Ipv4Addr::new(8, 8, 8, 8)),
            IpAddr::V4(Ipv4Addr::new(203, 0, 113, 10)),
            IpAddr::V6("2606:4700:4700::1111".parse().unwrap()),
        ];
        for ip in allowed {
            assert!(!is_blocked_ip(&ip), "{} should be allowed", ip);
        }
    }

    #[test]
    fn resolve_redirect_target_handles_absolute_and_relative() {
        // Absolute Location replaces the URL entirely.
        assert_eq!(
            resolve_redirect_target("http://example.com/feed", "https://other.org/x").unwrap(),
            "https://other.org/x"
        );
        // Root-relative Location is joined against the origin.
        assert_eq!(
            resolve_redirect_target("http://example.com/a/b", "/c").unwrap(),
            "http://example.com/c"
        );
        // Path-relative Location is joined against the current directory.
        assert_eq!(
            resolve_redirect_target("http://example.com/a/b", "c").unwrap(),
            "http://example.com/a/c"
        );
    }

    #[test]
    fn redirect_target_to_internal_address_is_rejected_by_validator() {
        // The redirect loop validates and pins every hop via validate_and_pin.
        // A public feed that redirects to the cloud-metadata IP (literal, so no
        // DNS needed) must be rejected — this is the redirect-SSRF gap the manual
        // redirect loop closes.
        let next =
            resolve_redirect_target("http://example.com/feed", "http://169.254.169.254/latest/")
                .unwrap();
        assert_eq!(next, "http://169.254.169.254/latest/");
        assert!(
            validate_and_pin(&next).is_err(),
            "redirect to metadata IP must be rejected"
        );
    }

    // ===== TEST-M1: pure scrape-execution helpers =====

    #[test]
    fn build_excerpt_media_lead_is_headline_only_never_body() {
        // The privacy/copyright invariant: media_lead sources store the headline
        // ONLY and NEVER the description/body text.
        let excerpt = build_excerpt(
            "media_lead",
            "City approves new budget",
            "The full body text of the article that must never be stored.",
        );
        assert_eq!(excerpt, "Headline: City approves new budget");
        assert!(
            !excerpt.contains("body text"),
            "media_lead excerpt must NOT contain the description/body: {}",
            excerpt
        );
    }

    #[test]
    fn build_excerpt_primary_record_keeps_title_and_description() {
        // Non-media sources retain the full title + description (the body IS the
        // public record we are collecting).
        let excerpt = build_excerpt(
            "primary_record",
            "Agenda item 4",
            "Council will vote on the road contract.",
        );
        assert_eq!(
            excerpt,
            "Title: Agenda item 4\nDescription: Council will vote on the road contract."
        );
        assert!(excerpt.contains("Council will vote"));
    }

    #[test]
    fn build_excerpt_official_comm_also_keeps_body() {
        let excerpt = build_excerpt("official_comm", "Notice", "Public hearing scheduled.");
        assert!(excerpt.contains("Public hearing scheduled."));
    }

    #[test]
    fn parse_feed_entries_reads_rss_and_atom_fields() {
        let rss = br#"<?xml version="1.0"?>
        <rss version="2.0"><channel>
          <item>
            <title>Budget hearing scheduled</title>
            <description>Residents can comment Tuesday.</description>
            <link>https://city.example/hearing</link>
          </item>
        </channel></rss>"#;
        let rss_entries = parse_feed_entries(rss).unwrap();
        assert_eq!(rss_entries.len(), 1);
        assert_eq!(rss_entries[0].title, "Budget hearing scheduled");
        assert_eq!(rss_entries[0].description, "Residents can comment Tuesday.");
        assert_eq!(
            rss_entries[0].url.as_deref(),
            Some("https://city.example/hearing")
        );

        let atom = br#"<?xml version="1.0"?>
        <feed xmlns="http://www.w3.org/2005/Atom">
          <entry>
            <title>Planning packet posted</title>
            <summary>New packet includes public hearing materials.</summary>
            <link href="https://city.example/packet"/>
          </entry>
        </feed>"#;
        let atom_entries = parse_feed_entries(atom).unwrap();
        assert_eq!(atom_entries.len(), 1);
        assert_eq!(atom_entries[0].title, "Planning packet posted");
        assert_eq!(
            atom_entries[0].description,
            "New packet includes public hearing materials."
        );
        assert_eq!(
            atom_entries[0].url.as_deref(),
            Some("https://city.example/packet")
        );
    }

    #[test]
    fn clean_html_strips_scripts_styles_and_tags() {
        let html = "<html><head><style>body{color:red}</style></head>\
            <body><script>alert('x')</script><h1>Headline</h1><p>Body paragraph.</p></body></html>";
        let cleaned = clean_html(html);
        assert!(!cleaned.contains("alert"), "script body must be removed");
        assert!(!cleaned.contains("color:red"), "style body must be removed");
        assert!(!cleaned.contains('<'), "all tags must be stripped");
        assert!(cleaned.contains("Headline"));
        assert!(cleaned.contains("Body paragraph."));
    }

    #[test]
    fn clean_html_collapses_blank_lines() {
        let html = "<div>  </div>\n<p>Real content</p>\n<div>   </div>";
        let cleaned = clean_html(html);
        // No empty lines should survive.
        for line in cleaned.lines() {
            assert!(!line.trim().is_empty(), "no blank lines: {:?}", cleaned);
        }
        assert!(cleaned.contains("Real content"));
    }

    #[test]
    fn chunk_text_splits_on_size_boundary() {
        // Each "paragraph" is ~50 chars; chunk_size 120 should pack 2 per chunk.
        let para = "x".repeat(50);
        let text = format!("{para}\n{para}\n{para}\n{para}");
        let chunks = chunk_text(&text, 120);
        assert!(chunks.len() >= 2, "expected multiple chunks: {:?}", chunks);
        for chunk in &chunks {
            // No single chunk should wildly exceed the size (allow one paragraph
            // of overshoot, which is the documented packing behavior).
            assert!(
                chunk.len() <= 120 + 51,
                "chunk too large ({}): {:?}",
                chunk.len(),
                chunk
            );
        }
        // Round-trip: all original content survives across the chunks.
        let joined: String = chunks.join("");
        assert_eq!(joined.matches(&para).count(), 4);
    }

    #[test]
    fn chunk_text_single_small_text_is_one_chunk() {
        let chunks = chunk_text("Just a little text.", 2000);
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].trim(), "Just a little text.");
    }

    #[test]
    fn chunk_text_empty_input_yields_no_chunks() {
        assert!(chunk_text("   \n  \n", 2000).is_empty());
    }

    // ===== TEST-M2: fetch_validated redirect-SSRF loop =====
    //
    // The real validator (validate_and_pin) blocks loopback, but the stub servers
    // these tests drive must run on 127.0.0.1. We exercise the actual redirect
    // loop (fetch_validated_with) with an INJECTED validator that mirrors the real
    // gate's contract: it permits one explicitly-allowed benign loopback authority
    // (the external stub) and REJECTS everything else (standing in for an
    // internal/blocked target). This proves the loop re-validates and aborts on
    // every hop, honors the redirect cap, and errors on a missing Location — the
    // wiring the two separately-tested halves (join logic + validator) cannot prove.

    use std::future::Future;
    use std::net::SocketAddr;
    use std::pin::Pin;

    // The future returned by an injected per-hop validator (mirrors the bound on
    // `fetch_validated_with`'s `validate` param). Aliased to keep clippy's
    // type-complexity lint happy in the test helpers.
    type ValidatorFut =
        Pin<Box<dyn Future<Output = Result<Option<SocketAddr>, Box<dyn Error>>> + Send>>;

    // Build an injected validator that allows ONLY `allowed_authority` (host:port)
    // and pins it to `pin_addr`; any other URL is rejected (Err), modeling the
    // real gate blocking an internal/metadata target mid-loop.
    fn allow_only_validator(
        allowed_authority: String,
        pin_addr: SocketAddr,
    ) -> impl Fn(&str) -> ValidatorFut {
        move |url: &str| {
            let parsed = reqwest::Url::parse(url);
            let allowed = allowed_authority.clone();
            Box::pin(async move {
                let parsed = parsed.map_err(|e| -> Box<dyn Error> { e.to_string().into() })?;
                let authority = format!(
                    "{}:{}",
                    parsed.host_str().unwrap_or(""),
                    parsed.port_or_known_default().unwrap_or(0)
                );
                if authority == allowed {
                    Ok(Some(pin_addr))
                } else {
                    Err(format!("blocked by injected validator: {}", authority).into())
                }
            })
        }
    }

    #[tokio::test]
    async fn fetch_validated_blocks_redirect_to_internal_target() {
        // Stub A 302-redirects to an "internal" authority that the validator
        // rejects. The fetch must Err (the internal target is never fetched),
        // proving the loop re-validates the REDIRECT target, not just the original.
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr_a = listener.local_addr().unwrap();
        let app = axum::Router::new().route(
            "/feed",
            axum::routing::get(|| async {
                axum::response::Response::builder()
                    .status(302)
                    // A different (unallowed) authority stands in for an internal host.
                    .header("Location", "http://10.0.0.5/internal")
                    .body(axum::body::Body::empty())
                    .unwrap()
            }),
        );
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        let allowed = format!("{}:{}", addr_a.ip(), addr_a.port());
        let url = format!("http://{}/feed", allowed);
        let res = fetch_validated_with(&url, allow_only_validator(allowed, addr_a)).await;
        assert!(
            res.is_err(),
            "a redirect to an internal/blocked target must be rejected, not followed"
        );
        assert!(
            res.unwrap_err()
                .to_string()
                .contains("blocked by injected validator"),
            "the rejection must come from the per-hop validator on the redirect target"
        );
    }

    #[tokio::test]
    async fn fetch_validated_follows_benign_external_redirect() {
        // Stub A 302-redirects to stub B; both are "allowed" by the validator
        // (benign external redirect). The final 200 from B must be returned Ok.
        let listener_b = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr_b = listener_b.local_addr().unwrap();
        let app_b = axum::Router::new().route(
            "/final",
            axum::routing::get(|| async { (axum::http::StatusCode::OK, "destination body") }),
        );
        tokio::spawn(async move {
            axum::serve(listener_b, app_b).await.unwrap();
        });

        let auth_b = format!("{}:{}", addr_b.ip(), addr_b.port());
        let final_url = format!("http://{}/final", auth_b);

        let listener_a = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr_a = listener_a.local_addr().unwrap();
        let redirect_to = final_url.clone();
        let app_a = axum::Router::new().route(
            "/start",
            axum::routing::get(move || {
                let loc = redirect_to.clone();
                async move {
                    axum::response::Response::builder()
                        .status(302)
                        .header("Location", loc)
                        .body(axum::body::Body::empty())
                        .unwrap()
                }
            }),
        );
        tokio::spawn(async move {
            axum::serve(listener_a, app_a).await.unwrap();
        });

        let auth_a = format!("{}:{}", addr_a.ip(), addr_a.port());
        let start_url = format!("http://{}/start", auth_a);

        // A validator that allows BOTH stub authorities and pins each to itself.
        let allowed_a = auth_a.clone();
        let allowed_b = auth_b.clone();
        let validator = move |url: &str| -> ValidatorFut {
            let parsed = reqwest::Url::parse(url);
            let (a, b) = (allowed_a.clone(), allowed_b.clone());
            let (pa, pb) = (addr_a, addr_b);
            Box::pin(async move {
                let parsed = parsed.map_err(|e| -> Box<dyn Error> { e.to_string().into() })?;
                let authority = format!(
                    "{}:{}",
                    parsed.host_str().unwrap_or(""),
                    parsed.port_or_known_default().unwrap_or(0)
                );
                if authority == a {
                    Ok(Some(pa))
                } else if authority == b {
                    Ok(Some(pb))
                } else {
                    Err("unexpected authority".into())
                }
            })
        };

        let res = fetch_validated_with(&start_url, validator).await;
        assert!(
            res.is_ok(),
            "a benign external redirect should be followed: {:?}",
            res.err()
        );
        let body = res.unwrap().text().await.unwrap();
        assert_eq!(body, "destination body");
    }

    #[tokio::test]
    async fn fetch_validated_enforces_max_redirect_cap() {
        // A stub that always 302s back to itself must hit the redirect cap and
        // error, rather than looping forever.
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let auth = format!("{}:{}", addr.ip(), addr.port());
        let self_loc = format!("http://{}/loop", auth);
        let loc_for_handler = self_loc.clone();
        let app = axum::Router::new().route(
            "/loop",
            axum::routing::get(move || {
                let loc = loc_for_handler.clone();
                async move {
                    axum::response::Response::builder()
                        .status(302)
                        .header("Location", loc)
                        .body(axum::body::Body::empty())
                        .unwrap()
                }
            }),
        );
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        let res = fetch_validated_with(&self_loc, allow_only_validator(auth, addr)).await;
        assert!(res.is_err(), "an infinite redirect loop must be capped");
        assert!(
            res.unwrap_err().to_string().contains("Too many redirects"),
            "the cap error should mention too many redirects"
        );
    }

    #[tokio::test]
    async fn fetch_validated_errors_on_redirect_missing_location() {
        // A 302 with no Location header is malformed; the loop must error rather
        // than silently treat it as a terminal response.
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let app = axum::Router::new().route(
            "/noloc",
            axum::routing::get(|| async {
                axum::response::Response::builder()
                    .status(302)
                    .body(axum::body::Body::empty())
                    .unwrap()
            }),
        );
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        let auth = format!("{}:{}", addr.ip(), addr.port());
        let url = format!("http://{}/noloc", auth);
        let res = fetch_validated_with(&url, allow_only_validator(auth, addr)).await;
        assert!(res.is_err(), "a redirect missing Location must error");
        assert!(
            res.unwrap_err()
                .to_string()
                .contains("missing a valid Location"),
            "the error should explain the missing Location header"
        );
    }

    #[tokio::test]
    async fn read_limited_response_rejects_oversized_content_length_before_body_read() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let app = axum::Router::new().route(
            "/huge",
            axum::routing::get(|| async {
                axum::response::Response::builder()
                    .status(200)
                    .body(axum::body::Body::from(vec![
                        b'x';
                        MAX_SOURCE_BODY_BYTES + 1
                    ]))
                    .unwrap()
            }),
        );
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        let auth = format!("{}:{}", addr.ip(), addr.port());
        let url = format!("http://{}/huge", auth);
        let response = fetch_validated_with(&url, allow_only_validator(auth, addr))
            .await
            .unwrap();
        let err = read_limited_response(response).await.unwrap_err();
        assert!(
            err.to_string().contains("too large"),
            "oversized Content-Length must be rejected before buffering: {}",
            err
        );
    }

    #[tokio::test]
    async fn read_limited_response_aborts_chunked_body_over_limit() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let app = axum::Router::new().route(
            "/chunked",
            axum::routing::get(|| async {
                let chunks = futures_util::stream::iter((0..6).map(|_| {
                    Ok::<_, std::convert::Infallible>(bytes::Bytes::from(vec![b'x'; 1024 * 1024]))
                }));
                axum::response::Response::builder()
                    .status(200)
                    .body(axum::body::Body::from_stream(chunks))
                    .unwrap()
            }),
        );
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        let auth = format!("{}:{}", addr.ip(), addr.port());
        let url = format!("http://{}/chunked", auth);
        let response = fetch_validated_with(&url, allow_only_validator(auth, addr))
            .await
            .unwrap();
        let err = read_limited_response(response).await.unwrap_err();
        assert!(
            err.to_string().contains("exceeded"),
            "streaming body must abort once it crosses the cap: {}",
            err
        );
    }
}
