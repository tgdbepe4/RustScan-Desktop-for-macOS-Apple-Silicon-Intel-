use std::net::{IpAddr, SocketAddr};
use std::time::{Duration, Instant};

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::time::timeout;

#[derive(Debug, Clone)]
pub struct ProbeInfo {
    pub service: String,
    pub banner: String,
    pub latency_ms: u64,
}

/// Port → service labels for the ports RustScan is most likely to report.
pub fn service_name(port: u16, udp: bool) -> &'static str {
    if udp {
        return match port {
            53 => "DNS",
            67 | 68 => "DHCP",
            69 => "TFTP",
            111 => "RPCBIND",
            123 => "NTP",
            137 | 138 => "NETBIOS",
            161 | 162 => "SNMP",
            500 => "IKE",
            514 => "SYSLOG",
            520 => "RIP",
            1900 => "SSDP",
            4500 => "IPSEC-NAT",
            5353 => "MDNS",
            5355 => "LLMNR",
            11211 => "MEMCACHED",
            _ => "UDP",
        };
    }
    match port {
        7 => "ECHO",
        9 => "DISCARD",
        13 => "DAYTIME",
        20 | 21 => "FTP",
        22 => "SSH",
        23 => "TELNET",
        25 | 587 | 465 => "SMTP",
        37 => "TIME",
        53 => "DNS",
        67 | 68 => "DHCP",
        69 => "TFTP",
        79 => "FINGER",
        80 | 8000 | 8008 | 8080 | 8081 | 8888 => "HTTP",
        81 => "HTTP-ALT",
        88 => "KERBEROS",
        110 => "POP3",
        111 => "RPCBIND",
        113 => "IDENT",
        119 => "NNTP",
        123 => "NTP",
        135 => "MSRPC",
        137 | 138 | 139 => "NETBIOS",
        143 => "IMAP",
        161 | 162 => "SNMP",
        179 => "BGP",
        389 | 636 => "LDAP",
        443 | 8443 | 9443 => "HTTPS",
        445 => "SMB",
        500 => "IKE",
        512 | 513 | 514 => "R-SERVICES",
        515 => "LPD",
        548 => "AFP",
        554 => "RTSP",
        631 => "IPP",
        646 => "LDP",
        853 => "DNS-TLS",
        873 => "RSYNC",
        990 => "FTPS",
        993 => "IMAPS",
        995 => "POP3S",
        1025 | 1026 | 1027 | 1028 | 1029 => "MSRPC",
        1080 => "SOCKS",
        1110 => "NFS-ALT",
        1433 | 1434 => "MSSQL",
        1521 => "ORACLE",
        1720 => "H323",
        1723 => "PPTP",
        1755 => "MMS",
        1883 | 8883 => "MQTT",
        1900 => "SSDP",
        2049 => "NFS",
        2121 => "FTP-ALT",
        2181 => "ZOOKEEPER",
        2375 | 2376 => "DOCKER",
        3000 => "GRAFANA",
        3128 => "SQUID",
        3268 | 3269 => "LDAP-GC",
        3306 => "MYSQL",
        3389 => "RDP",
        4444 => "METASPLOIT",
        4500 => "IPSEC-NAT",
        5000 => "HTTP-ALT",
        5060 | 5061 => "SIP",
        5222 => "XMPP",
        5353 => "MDNS",
        5432 => "POSTGRESQL",
        5555 => "ADB",
        5601 => "KIBANA",
        5672 => "AMQP",
        5900 | 5901 => "VNC",
        5984 => "COUCHDB",
        6379 => "REDIS",
        6443 => "KUBE-API",
        7001 | 7002 => "WEBLOGIC",
        7070 => "REALSERVER",
        8009 => "AJP",
        8086 => "INFLUXDB",
        8088 => "YARN",
        9000 | 9001 => "PHP-FPM",
        9042 => "CASSANDRA",
        9090 => "PROMETHEUS",
        9092 => "KAFKA",
        9100 => "PRINTER",
        9200 | 9300 => "ELASTICSEARCH",
        9999 => "HTTP-ALT",
        10000 => "WEBMIN",
        11211 => "MEMCACHED",
        15672 => "RABBITMQ",
        27017 | 27018 | 27019 => "MONGODB",
        32768 => "RPC",
        49152..=49157 => "RPC",
        _ => "UNKNOWN",
    }
}

fn is_tls_port(port: u16) -> bool {
    matches!(port, 443 | 465 | 636 | 853 | 993 | 995 | 5061 | 8443 | 8883 | 9443)
}

fn server_speaks_first(port: u16) -> bool {
    matches!(port, 21 | 22 | 23 | 25 | 110 | 143 | 3306 | 5900 | 5901 | 27017 | 27018 | 27019)
}

fn probe_payload(port: u16, host: &str) -> Vec<u8> {
    match port {
        80 | 81 | 443 | 3000 | 5000 | 5601 | 8000 | 8008 | 8080 | 8081 | 8443 | 8888 | 9000 | 9090 | 9200 | 10000 | 15672 => {
            format!("HEAD / HTTP/1.1\r\nHost: {host}\r\nUser-Agent: RustScan-Neon/2.4\r\nAccept: */*\r\nConnection: close\r\n\r\n")
                .into_bytes()
        }
        6379 => b"PING\r\n".to_vec(),
        11211 => b"version\r\n".to_vec(),
        2375 | 2376 => b"GET /version HTTP/1.1\r\nHost: docker\r\nConnection: close\r\n\r\n".to_vec(),
        5672 => b"AMQP\x00\x00\x09\x01".to_vec(),
        _ => b"\r\n".to_vec(),
    }
}

fn clean_banner(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().min(180));
    let mut last_space = false;
    for &b in bytes.iter().take(512) {
        let c = match b {
            b'\r' | b'\n' | b'\t' => ' ',
            0x20..=0x7e => b as char,
            _ => '.',
        };
        if c == ' ' {
            if last_space {
                continue;
            }
            last_space = true;
        } else {
            last_space = false;
        }
        out.push(c);
        if out.chars().count() >= 160 {
            break;
        }
    }
    let trimmed = out.trim();
    if trimmed.chars().filter(|c| c.is_ascii_alphanumeric()).count() < 3 {
        return String::new();
    }
    trimmed.to_string()
}

fn signature_service(banner: &str) -> Option<&'static str> {
    let b = banner.to_ascii_lowercase();
    if b.starts_with("ssh-") || b.contains("openssh") { return Some("SSH"); }
    if b.starts_with("http/") { return Some("HTTP"); }
    if b.contains("nginx") || b.contains("apache") || b.contains("caddy") { return Some("HTTP"); }
    if b.contains("+pong") || b.contains("noauth authentication") || b.contains("-err unknown command") { return Some("REDIS"); }
    if b.contains("mysql") || b.contains("mariadb") { return Some("MYSQL"); }
    if b.contains("postgresql") { return Some("POSTGRESQL"); }
    if b.contains("mongodb") { return Some("MONGODB"); }
    if b.starts_with("220 ") && b.contains("smtp") { return Some("SMTP"); }
    if b.starts_with("220 ") { return Some("FTP"); }
    if b.starts_with("+ok") { return Some("POP3"); }
    if b.starts_with("* ok") { return Some("IMAP"); }
    if b.contains("rfb ") { return Some("VNC"); }
    if b.contains("version ") && b.contains("memcached") { return Some("MEMCACHED"); }
    if b.contains("amqp") { return Some("AMQP"); }
    if b.contains("rtsp/") { return Some("RTSP"); }
    if b.contains("elasticsearch") || b.contains("cluster_name") { return Some("ELASTICSEARCH"); }
    None
}

/// Grab a lightweight fingerprint. This is not an nmap version probe: it
/// performs one connect, one short read/send cycle, and classifies the reply.
/// Concurrency is bounded by the caller's semaphore.
pub async fn probe(ip: IpAddr, port: u16, timeout_ms: u64) -> ProbeInfo {
    let addr = SocketAddr::new(ip, port);
    let connect_timeout = Duration::from_millis(timeout_ms.clamp(120, 5000));
    let started = Instant::now();
    let mut stream = match timeout(connect_timeout, TcpStream::connect(addr)).await {
        Ok(Ok(s)) => s,
        _ => return ProbeInfo { service: service_name(port, false).to_string(), banner: "connection lost during probe".into(), latency_ms: 0 },
    };
    let latency_ms = started.elapsed().as_millis() as u64;
    let _ = stream.set_nodelay(true);

    let mut buf = [0u8; 768];
    let mut data: Vec<u8> = Vec::new();
    let host = ip.to_string();

    if is_tls_port(port) {
        if let Ok(Ok(n)) = timeout(Duration::from_millis(420), stream.read(&mut buf)).await {
            data.extend_from_slice(&buf[..n]);
        }
    } else if server_speaks_first(port) {
        if let Ok(Ok(n)) = timeout(Duration::from_millis(340), stream.read(&mut buf)).await {
            data.extend_from_slice(&buf[..n]);
        }
        if data.is_empty() {
            let payload = probe_payload(port, &host);
            let _ = timeout(Duration::from_millis(160), stream.write_all(&payload)).await;
            if let Ok(Ok(n)) = timeout(Duration::from_millis(260), stream.read(&mut buf)).await {
                data.extend_from_slice(&buf[..n]);
            }
        }
    } else {
        let payload = probe_payload(port, &host);
        let _ = timeout(Duration::from_millis(220), stream.write_all(&payload)).await;
        if let Ok(Ok(n)) = timeout(Duration::from_millis(460), stream.read(&mut buf)).await {
            data.extend_from_slice(&buf[..n]);
        }
        // Some services answer only after the peer half-closes.
        if data.is_empty() {
            let _ = stream.shutdown().await;
            if let Ok(Ok(n)) = timeout(Duration::from_millis(220), stream.read(&mut buf)).await {
                data.extend_from_slice(&buf[..n]);
            }
        }
    }

    let banner = clean_banner(&data);
    let port_service = service_name(port, false);
    let service = if is_tls_port(port) {
        port_service.to_string()
    } else {
        signature_service(&banner)
            .map(str::to_string)
            .unwrap_or_else(|| port_service.to_string())
    };
    ProbeInfo { service, banner, latency_ms }
}

pub fn udp_service(port: u16) -> String {
    service_name(port, true).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_services() {
        assert_eq!(service_name(22, false), "SSH");
        assert_eq!(service_name(6379, false), "REDIS");
        assert_eq!(service_name(53, true), "DNS");
    }

    #[test]
    fn banner_is_sanitized() {
        let b = clean_banner(b"HTTP/1.1 200 OK\r\nServer: nginx\x00\x01");
        assert!(b.starts_with("HTTP/1.1 200 OK"));
        assert!(!b.contains('\n'));
    }
}
