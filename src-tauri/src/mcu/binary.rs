//! Firmware loading utilities for Intel HEX and raw binary formats

use super::McuError;

/// Parse Intel HEX or raw binary data into a flat memory buffer
pub fn parse_firmware_image(data: &[u8], memory_size: usize) -> Result<Vec<u8>, McuError> {
    if data.is_empty() {
        return Ok(vec![0u8; memory_size]);
    }

    // Check if the input looks like Intel HEX (starts with ':')
    let is_intel_hex = data.starts_with(b":")
        || std::str::from_utf8(data)
            .map(|s| s.trim_start().starts_with(':'))
            .unwrap_or(false);

    if is_intel_hex {
        parse_intel_hex(data, memory_size)
    } else {
        // Raw binary: copy directly up to memory_size
        let mut buffer = vec![0u8; memory_size];
        let len = data.len().min(memory_size);
        buffer[..len].copy_from_slice(&data[..len]);
        Ok(buffer)
    }
}

/// Parse Intel HEX format records into program memory
pub fn parse_intel_hex(hex_data: &[u8], memory_size: usize) -> Result<Vec<u8>, McuError> {
    let mut memory = vec![0u8; memory_size];
    let text = std::str::from_utf8(hex_data)
        .map_err(|e| McuError::InvalidFirmwareFormat(format!("UTF-8 decode error: {}", e)))?;

    let mut upper_address: u32 = 0;

    for (line_idx, line) in text.lines().enumerate() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        if !line.starts_with(':') {
            continue;
        }

        let hex_str = &line[1..];
        if hex_str.len() < 8 {
            return Err(McuError::InvalidFirmwareFormat(format!(
                "Line {} too short: {}",
                line_idx + 1,
                line
            )));
        }

        let bytes = hex_decode(hex_str).map_err(|_| {
            McuError::InvalidFirmwareFormat(format!(
                "Invalid hex characters on line {}: {}",
                line_idx + 1,
                line
            ))
        })?;

        let byte_count = bytes[0] as usize;
        if bytes.len() != byte_count + 5 {
            return Err(McuError::InvalidFirmwareFormat(format!(
                "Line {} length mismatch: declared {}, actual payload {}",
                line_idx + 1,
                byte_count,
                bytes.len().saturating_sub(5)
            )));
        }

        // Verify checksum
        let sum: u8 = bytes.iter().fold(0u8, |acc, &b| acc.wrapping_add(b));
        if sum != 0 {
            return Err(McuError::InvalidFirmwareFormat(format!(
                "Checksum error on line {}",
                line_idx + 1
            )));
        }

        let address_low = ((bytes[1] as u32) << 8) | (bytes[2] as u32);
        let record_type = bytes[3];
        let payload = &bytes[4..4 + byte_count];

        match record_type {
            0x00 => {
                // Data record
                let full_address = (upper_address | address_low) as usize;
                for (offset, &byte) in payload.iter().enumerate() {
                    let target_addr = full_address + offset;
                    if target_addr < memory_size {
                        memory[target_addr] = byte;
                    }
                }
            }
            0x01 => {
                // End of File
                break;
            }
            0x02 => {
                // Extended Segment Address
                if byte_count == 2 {
                    upper_address = (((payload[0] as u32) << 8) | (payload[1] as u32)) << 4;
                }
            }
            0x04
                // Extended Linear Address
                if byte_count == 2 => {
                    upper_address = (((payload[0] as u32) << 8) | (payload[1] as u32)) << 16;
                }
            _ => {
                // Ignore other record types (e.g. start address 0x03, 0x05)
            }
        }
    }

    Ok(memory)
}

fn hex_decode(s: &str) -> Result<Vec<u8>, ()> {
    if !s.len().is_multiple_of(2) {
        return Err(());
    }
    let mut bytes = Vec::with_capacity(s.len() / 2);
    for i in (0..s.len()).step_by(2) {
        let byte = u8::from_str_radix(&s[i..i + 2], 16).map_err(|_| ())?;
        bytes.push(byte);
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_raw_binary() {
        let raw = vec![0x12, 0x34, 0x56, 0x78];
        let mem = parse_firmware_image(&raw, 16).expect("Parse raw binary failed");
        assert_eq!(&mem[..4], &[0x12, 0x34, 0x56, 0x78]);
        assert_eq!(&mem[4..], &[0u8; 12]);
    }

    #[test]
    fn test_parse_intel_hex_valid() {
        // Sample Intel HEX with 2 data records and EOF with valid checksums
        let hex = b":0400000012345678E8\n:02000400AABB95\n:00000001FF\n";
        let mem = parse_intel_hex(hex, 16).expect("Parse hex failed");
        assert_eq!(&mem[0..4], &[0x12, 0x34, 0x56, 0x78]);
        assert_eq!(&mem[4..6], &[0xAA, 0xBB]);
    }
}
