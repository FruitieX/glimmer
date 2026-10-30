//! Realtime frames over UDP port 7777, protocol version 3 (Gen II firmware
//! 2.4.14 and later): `0x03`, the 8-byte token, two zero bytes, the fragment
//! number, then up to 900 bytes of frame data.

use std::net::{SocketAddr, UdpSocket};

pub const PORT: u16 = 7777;
pub const FRAGMENT: usize = 900;

/// Splits a frame into v3 datagrams.
pub fn packets(token: &[u8; 8], frame: &[u8]) -> Vec<Vec<u8>> {
    frame
        .chunks(FRAGMENT)
        .enumerate()
        .map(|(i, chunk)| {
            let mut packet = Vec::with_capacity(12 + chunk.len());
            packet.push(0x03);
            packet.extend_from_slice(token);
            packet.extend_from_slice(&[0, 0, i as u8]);
            packet.extend_from_slice(chunk);
            packet
        })
        .collect()
}

pub struct Sender {
    socket: UdpSocket,
}

impl Sender {
    /// `ip` may carry an HTTP port (`host:port`, used by test doubles); UDP always goes to 7777.
    pub fn new(ip: &str) -> std::io::Result<Self> {
        let host = match ip.rsplit_once(':') {
            Some((h, port)) if !h.contains(':') && port.parse::<u16>().is_ok() => h,
            _ => ip,
        };
        let addr: SocketAddr = format!("{host}:{PORT}")
            .parse()
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidInput, e))?;
        let socket = UdpSocket::bind(if addr.is_ipv4() {
            "0.0.0.0:0"
        } else {
            "[::]:0"
        })?;
        socket.connect(addr)?;
        Ok(Self { socket })
    }

    pub fn send(&self, token: &[u8; 8], frame: &[u8]) -> std::io::Result<()> {
        for packet in packets(token, frame) {
            self.socket.send(&packet)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fragments_large_frames() {
        let token = [1, 2, 3, 4, 5, 6, 7, 8];
        let frame: Vec<u8> = (0..2250).map(|i| i as u8).collect();
        let packets = packets(&token, &frame);
        assert_eq!(
            packets.iter().map(Vec::len).collect::<Vec<_>>(),
            [912, 912, 462]
        );
        assert_eq!(&packets[1][..12], &[3, 1, 2, 3, 4, 5, 6, 7, 8, 0, 0, 1]);
        assert_eq!(packets[2][12], frame[1800]);
    }
}
