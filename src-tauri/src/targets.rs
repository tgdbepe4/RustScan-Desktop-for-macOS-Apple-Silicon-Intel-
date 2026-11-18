use std::collections::HashSet;
use std::net::IpAddr;

use ipnet::IpNet;
use tokio::net::lookup_host;

/// Curated fast-sweep vector: 100 ports that carry most exposed services.
pub const TOP_PORTS: &[u16] = &[
    7, 9, 13, 21, 22, 23, 25, 26, 37, 53, 79, 80, 81, 88, 106, 110, 111, 113, 119, 135,
    139, 143, 144, 179, 199, 389, 427, 443, 444, 445, 465, 513, 514, 515, 543, 544, 548, 554, 587, 631,
    646, 873, 990, 993, 995, 1025, 1026, 1027, 1028, 1029, 1110, 1433, 1720, 1723, 1755, 1900, 2000, 2001, 2049, 2121,
    2717, 3000, 3128, 3306, 3389, 3986, 4899, 5000, 5009, 5051, 5060, 5101, 5190, 5357, 5432, 5631, 5666, 5800, 5900, 6000,
    6001, 6646, 7070, 8000, 8008, 8009, 8080, 8081, 8443, 8888, 9100, 9999, 10000, 32768, 49152, 49153, 49154, 49155, 49156, 49157,
];

/// Split a free-form target block into tokens. Accepts whitespace,
/// commas, semicolons and newlines so pasted nmap-style lists work.
fn tokens(input: &str) -> Vec<&str> {
    input
        .split(|c: char| c.is_whitespace() || c == ',' || c == ';')
        .map(str::trim)
        .filter(|t| !t.is_empty() && !t.starts_with('#'))
        .collect()
}

/// Expand the shorthand `192.168.1.10-20` before the generic hostname path.
fn last_octet_range(token: &str) -> Option<Result<Vec<IpAddr>, String>> {
    let (base, tail) = token.rsplit_once('.')?;
    let (start, end) = tail.split_once('-')?;
    let start: u8 = start.parse().ok()?;
    let end: u8 = end.parse().ok()?;
    if end < start {
        return Some(Err(format!("invalid octet range: {token}")));
    }
    let mut out = Vec::new();
    for octet in start..=end {
        match format!("{base}.{octet}").parse::<IpAddr>() {
            Ok(ip) => out.push(ip),
            Err(_) => return Some(Err(format!("invalid address: {base}.{octet}"))),
        }
    }
    Some(Ok(out))
}

async fn resolve_token(token: &str) -> Result<Vec<IpAddr>, String> {
    if let Ok(ip) = token.parse::<IpAddr>() {
        return Ok(vec![ip]);
    }
    if let Ok(net) = token.parse::<IpNet>() {
        // `hosts()` skips network/broadcast for normal IPv4 prefixes.
        return Ok(net.hosts().collect());
    }
    if let Some(range) = last_octet_range(token) {
        return range;
    }
    let lookup = lookup_host((token, 0))
        .await
        .map_err(|e| format!("DNS resolution failed for {token}: {e}"))?;
    let mut v4 = Vec::new();
    let mut v6 = Vec::new();
    for addr in lookup {
        match addr.ip() {
            IpAddr::V4(ip) => v4.push(IpAddr::V4(ip)),
            IpAddr::V6(ip) => v6.push(IpAddr::V6(ip)),
        }
    }
    if !v4.is_empty() {
        Ok(v4)
    } else if !v6.is_empty() {
        Ok(v6)
    } else {
        Err(format!("no address returned for {token}"))
    }
}

/// Resolve every token, deduplicate while preserving input order, and stop
/// before a CIDR can silently expand into an unbounded sweep.
pub async fn resolve_targets(input: &str, max_hosts: usize) -> Result<Vec<IpAddr>, String> {
    let max_hosts = max_hosts.clamp(1, 1_000_000);
    let mut out: Vec<IpAddr> = Vec::new();
    let mut seen: HashSet<IpAddr> = HashSet::new();
    let toks = tokens(input);
    if toks.is_empty() {
        return Err("target vector is empty".into());
    }
    if toks.len() > 512 {
        return Err("too many target tokens (max 512)".into());
    }

    for token in toks {
        let resolved = resolve_token(token).await?;
        for ip in resolved {
            if seen.insert(ip) {
                out.push(ip);
                if out.len() > max_hosts {
                    return Err(format!(
                        "target vector expands past the {max_hosts} host limit — narrow the CIDR or raise MAX HOSTS"
                    ));
                }
            }
        }
    }
    Ok(out)
}

/// Parse `1-1024,3306,8000-8100`; every value is validated before any socket
/// is opened so a typo never turns into a half-finished sweep.
pub fn parse_port_spec(spec: &str) -> Result<Vec<u16>, String> {
    let mut seen = vec![false; 65536];
    let mut out = Vec::new();
    for part in spec.split(',') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        if let Some((a, b)) = part.split_once('-') {
            let start: u32 = a.trim().parse().map_err(|_| format!("invalid port range: {part}"))?;
            let end: u32 = b.trim().parse().map_err(|_| format!("invalid port range: {part}"))?;
            if start == 0 || end > 65535 || start > end {
                return Err(format!("invalid port range: {part}"));
            }
            for p in start..=end {
                let p = p as usize;
                if !seen[p] {
                    seen[p] = true;
                    out.push(p as u16);
                }
            }
        } else {
            let p: u32 = part.parse().map_err(|_| format!("invalid port: {part}"))?;
            if p == 0 || p > 65535 {
                return Err(format!("invalid port: {part}"));
            }
            let p = p as usize;
            if !seen[p] {
                seen[p] = true;
                out.push(p as u16);
            }
        }
    }
    Ok(out)
}

pub fn parse_ports(mode: &str, spec: &str) -> Result<Vec<u16>, String> {
    match mode {
        "top200" | "top100" => Ok(TOP_PORTS.to_vec()),
        "full" => Ok((1..=65535).collect()),
        "range" | "list" => {
            if spec.trim().is_empty() {
                return Err("port vector is empty".into());
            }
            let ports = parse_port_spec(spec)?;
            if ports.is_empty() {
                return Err("port vector is empty".into());
            }
            Ok(ports)
        }
        other => Err(format!("unknown port mode: {other}")),
    }
}

#[derive(Debug, Clone)]
pub struct TargetPreview {
    pub hosts: u64,
    pub ips: Vec<String>,
    pub truncated: bool,
}

fn cidr_host_count(net: &IpNet) -> u64 {
    let prefix = net.prefix_len();
    match net {
        IpNet::V4(_) => {
            let bits = 32 - prefix;
            if bits == 0 {
                1
            } else if bits == 1 {
                2
            } else if bits >= 32 {
                u64::MAX
            } else {
                (1u64 << bits) - 2
            }
        }
        IpNet::V6(_) => {
            let bits = 128 - prefix;
            if bits >= 63 {
                u64::MAX
            } else {
                1u64 << bits
            }
        }
    }
}

/// Cheap preview used while the operator types. It counts CIDRs
/// mathematically instead of expanding them and never performs DNS.
pub fn preview(text: &str) -> TargetPreview {
    let mut hosts: u64 = 0;
    let mut ips: Vec<String> = Vec::new();
    let mut truncated = false;
    for token in tokens(text).into_iter().take(512) {
        if let Ok(net) = token.parse::<IpNet>() {
            hosts = hosts.saturating_add(cidr_host_count(&net));
            if ips.len() < 12 {
                for ip in net.hosts().take(12 - ips.len()) {
                    ips.push(ip.to_string());
                }
            }
            if net.prefix_len() < 24 {
                truncated = true;
            }
        } else if let Ok(ip) = token.parse::<IpAddr>() {
            hosts = hosts.saturating_add(1);
            if ips.len() < 12 {
                ips.push(ip.to_string());
            }
        } else if let Some(range) = last_octet_range(token) {
            match range {
                Ok(list) => {
                    hosts = hosts.saturating_add(list.len() as u64);
                    for ip in list.into_iter().take(12 - ips.len().min(12)) {
                        if ips.len() < 12 {
                            ips.push(ip.to_string());
                        }
                    }
                }
                Err(_) => {}
            }
        } else {
            hosts = hosts.saturating_add(1);
            if ips.len() < 12 {
                ips.push(token.to_string());
            }
        }
    }
    TargetPreview { hosts, ips, truncated }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn top_list_has_expected_size() {
        assert_eq!(TOP_PORTS.len(), 100);
    }

    #[test]
    fn port_spec_dedupes_and_validates() {
        let p = parse_port_spec("80,80,1-3,3").unwrap();
        assert_eq!(p, vec![80, 1, 2, 3]);
        assert!(parse_port_spec("0-2").is_err());
        assert!(parse_port_spec("20-10").is_err());
        assert!(parse_port_spec("70000").is_err());
    }
}
