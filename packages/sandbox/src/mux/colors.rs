//! Query and manage terminal colors from the outer terminal.
//!
//! This module provides functionality to query the outer terminal's foreground
//! and background colors via OSC 10/11 escape sequences, enabling dmux to
//! inherit the host terminal's theme.
//!
//! Theme changes are detected via SIGUSR1 signal (Unix) which triggers
//! a re-query of terminal colors.

use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::RwLock;
use std::time::Duration;
use tokio::sync::mpsc;

/// Global storage for outer terminal colors.
/// These are queried at startup and updated on theme change signals.
static OUTER_FG_COLOR: RwLock<Option<(u8, u8, u8)>> = RwLock::new(None);
static OUTER_BG_COLOR: RwLock<Option<(u8, u8, u8)>> = RwLock::new(None);
static COLORS_INITIALIZED: AtomicBool = AtomicBool::new(false);

/// Terminal colors queried from the outer terminal.
#[derive(Debug, Clone, Copy, Default)]
pub struct TerminalColors {
    pub foreground: Option<(u8, u8, u8)>,
    pub background: Option<(u8, u8, u8)>,
}

/// Get the current outer terminal colors.
/// Returns cached values if available, or default fallbacks.
pub fn get_outer_colors() -> TerminalColors {
    TerminalColors {
        foreground: OUTER_FG_COLOR.read().ok().and_then(|g| *g),
        background: OUTER_BG_COLOR.read().ok().and_then(|g| *g),
    }
}

/// Get the outer terminal's foreground color with fallback.
pub fn get_outer_fg() -> (u8, u8, u8) {
    OUTER_FG_COLOR
        .read()
        .ok()
        .and_then(|g| *g)
        .unwrap_or((255, 255, 255)) // White fallback
}

/// Get the outer terminal's background color with fallback.
pub fn get_outer_bg() -> (u8, u8, u8) {
    OUTER_BG_COLOR
        .read()
        .ok()
        .and_then(|g| *g)
        .unwrap_or((53, 55, 49)) // Dark gray fallback (matches ghostty)
}

/// Update the stored outer terminal colors.
pub fn set_outer_colors(colors: TerminalColors) {
    if let Ok(mut fg) = OUTER_FG_COLOR.write() {
        *fg = colors.foreground;
    }
    if let Ok(mut bg) = OUTER_BG_COLOR.write() {
        *bg = colors.background;
    }
    COLORS_INITIALIZED.store(true, Ordering::SeqCst);
}

/// Check if colors have been initialized.
pub fn colors_initialized() -> bool {
    COLORS_INITIALIZED.load(Ordering::SeqCst)
}

/// Query the outer terminal's colors via OSC 10/11.
///
/// This function must be called BEFORE entering the alternate screen buffer,
/// as it temporarily enables raw mode to read the terminal's response.
///
/// Returns `TerminalColors` with the queried colors, or `None` for colors
/// that couldn't be queried (e.g., terminal doesn't support OSC queries).
pub fn query_outer_terminal_colors() -> TerminalColors {
    let mut colors = TerminalColors::default();

    // We need raw mode to read terminal responses
    if crossterm::terminal::enable_raw_mode().is_err() {
        return colors;
    }

    // Query foreground (OSC 10) and background (OSC 11)
    colors.foreground = query_osc_color(10);
    colors.background = query_osc_color(11);

    // Restore normal mode
    let _ = crossterm::terminal::disable_raw_mode();

    // Store for later use
    set_outer_colors(colors);

    colors
}

/// Query a specific OSC color (10=fg, 11=bg, 12=cursor).
fn query_osc_color(code: u8) -> Option<(u8, u8, u8)> {
    let mut stdout = std::io::stdout();
    let stdin = std::io::stdin();

    // Send query: OSC code ; ? ST
    let query = format!("\x1b]{};?\x1b\\", code);
    if stdout.write_all(query.as_bytes()).is_err() {
        return None;
    }
    if stdout.flush().is_err() {
        return None;
    }

    // Read response with timeout
    // Response format: OSC code ; rgb:RRRR/GGGG/BBBB ST
    let mut response = Vec::with_capacity(64);
    let deadline = std::time::Instant::now() + Duration::from_millis(100);

    // Use non-blocking read with polling
    let mut stdin_handle = stdin.lock();

    loop {
        if std::time::Instant::now() >= deadline {
            break;
        }

        // Try to read one byte at a time
        let mut buf = [0u8; 1];

        // Use crossterm's poll to check if input is available
        if crossterm::event::poll(Duration::from_millis(10)).unwrap_or(false) {
            if let Ok(crossterm::event::Event::Key(_)) = crossterm::event::read() {
                // Ignore key events, we want raw bytes
                continue;
            }
        }

        // Try direct read with very short timeout
        match stdin_handle.read(&mut buf) {
            Ok(0) => break, // EOF
            Ok(1) => {
                response.push(buf[0]);
                // Check for ST (ESC \) or BEL terminator
                if buf[0] == b'\\' && response.len() >= 2 && response[response.len() - 2] == 0x1b {
                    break;
                }
                if buf[0] == 0x07 {
                    // BEL terminator
                    break;
                }
            }
            _ => {
                // Would block or error, wait a bit
                std::thread::sleep(Duration::from_millis(5));
            }
        }
    }

    drop(stdin_handle);

    // Parse response
    parse_osc_color_response(&response)
}

/// Parse an OSC color response.
/// Expected format: ESC ] code ; rgb:RRRR/GGGG/BBBB ESC \
///                  or ESC ] code ; rgb:RR/GG/BB ESC \
fn parse_osc_color_response(response: &[u8]) -> Option<(u8, u8, u8)> {
    let s = std::str::from_utf8(response).ok()?;

    // Find "rgb:" in the response
    let rgb_start = s.find("rgb:")?;
    let rgb_part = &s[rgb_start + 4..];

    // Find the terminator (ESC \ or just the end before ESC)
    let rgb_end = rgb_part.find('\x1b').unwrap_or(rgb_part.len());
    let rgb_str = &rgb_part[..rgb_end];

    // Parse RRRR/GGGG/BBBB or RR/GG/BB format
    let parts: Vec<&str> = rgb_str.split('/').collect();
    if parts.len() != 3 {
        return None;
    }

    let r = parse_hex_component(parts[0])?;
    let g = parse_hex_component(parts[1])?;
    let b = parse_hex_component(parts[2])?;

    Some((r, g, b))
}

/// Parse a hex color component, handling both 2-digit and 4-digit formats.
fn parse_hex_component(s: &str) -> Option<u8> {
    let val = u16::from_str_radix(s, 16).ok()?;
    if s.len() <= 2 {
        // 8-bit value
        Some(val as u8)
    } else {
        // 16-bit value, convert to 8-bit
        Some((val >> 8) as u8)
    }
}

/// Message sent when theme colors change.
#[derive(Debug, Clone)]
pub struct ThemeChangeEvent {
    pub colors: TerminalColors,
}

/// Spawn a background task that listens for theme change signals (SIGUSR1 on Unix).
///
/// When a signal is received, it sends a `ThemeChangeEvent` through the provided channel.
/// This allows the application to re-query terminal colors and update accordingly.
///
/// Note: The actual re-query of colors must be done from the main thread after
/// temporarily exiting the alternate screen buffer.
#[cfg(unix)]
pub fn spawn_theme_change_listener(tx: mpsc::UnboundedSender<ThemeChangeEvent>) {
    tokio::spawn(async move {
        let mut sigusr1 =
            match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::user_defined1()) {
                Ok(sig) => sig,
                Err(e) => {
                    eprintln!("Warning: Failed to register SIGUSR1 handler for theme changes: {e}");
                    return;
                }
            };

        loop {
            sigusr1.recv().await;

            // Signal received - notify that theme may have changed
            // The actual color re-query happens in the main event loop
            // because we need to temporarily exit the alternate screen
            let colors = get_outer_colors();
            if tx.send(ThemeChangeEvent { colors }).is_err() {
                // Channel closed, exit the task
                break;
            }
        }
    });
}

/// Non-Unix platforms: no-op signal listener.
#[cfg(not(unix))]
pub fn spawn_theme_change_listener(_tx: mpsc::UnboundedSender<ThemeChangeEvent>) {
    // Signal-based theme change detection not supported on this platform
}

/// Re-query terminal colors. This should be called from the main thread
/// after receiving a ThemeChangeEvent, temporarily exiting the alternate screen.
///
/// Returns the new colors and updates the global state.
pub fn refresh_outer_colors() -> TerminalColors {
    query_outer_terminal_colors()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_osc_color_response_16bit() {
        // Typical response: ESC ] 11 ; rgb:3535/3737/3131 ESC \
        let response = b"\x1b]11;rgb:3535/3737/3131\x1b\\";
        let result = parse_osc_color_response(response);
        assert_eq!(result, Some((0x35, 0x37, 0x31))); // (53, 55, 49)
    }

    #[test]
    fn test_parse_osc_color_response_8bit() {
        let response = b"\x1b]11;rgb:35/37/31\x1b\\";
        let result = parse_osc_color_response(response);
        assert_eq!(result, Some((0x35, 0x37, 0x31)));
    }

    #[test]
    fn test_parse_osc_color_response_black() {
        let response = b"\x1b]11;rgb:0000/0000/0000\x1b\\";
        let result = parse_osc_color_response(response);
        assert_eq!(result, Some((0, 0, 0)));
    }

    #[test]
    fn test_parse_osc_color_response_white() {
        let response = b"\x1b]10;rgb:ffff/ffff/ffff\x1b\\";
        let result = parse_osc_color_response(response);
        assert_eq!(result, Some((255, 255, 255)));
    }

    #[test]
    fn test_parse_hex_component() {
        assert_eq!(parse_hex_component("ff"), Some(255));
        assert_eq!(parse_hex_component("00"), Some(0));
        assert_eq!(parse_hex_component("ffff"), Some(255));
        assert_eq!(parse_hex_component("0000"), Some(0));
        assert_eq!(parse_hex_component("3535"), Some(0x35)); // 53
        assert_eq!(parse_hex_component("8080"), Some(0x80)); // 128
    }
}
