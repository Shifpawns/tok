# tok

Small Rust (Tauri 2) desktop client for TikTok on Windows.

It opens tiktok.com in a WebView2 window and puts its own minimal player on top.
The site keeps running underneath and does the login and the feed loading; tok only
reads what the site loads and plays the H.264 version of each video in a plain
`<video>` element.

## Build

Needs Rust (https://rustup.rs) with the MSVC toolchain. WebView2 ships with Windows 10/11.

    cd src-tauri
    cargo run --release

The exe ends up in `src-tauri/target/release/tok.exe`.

## Keys

| Key | Action |
| --- | --- |
| Down / J / scroll | next video |
| Up / K | previous video |
| Space / click | pause |
| Left / Right | seek 5s |
| M | mute |
| L | like |
| C | comments |
| R | retry comments |
| F2 | switch between tok and the normal site (login, search, profiles) |

First start: press F2, log in on the normal site, press F2 again.

## Notes

- Everything that depends on TikTok lives in `src-tauri/src/inject.js`. If TikTok
  changes its page, that is the file to fix (selectors use their `data-e2e` attributes).
- Comments are taken from the site's own comment requests, so if the site does not
  load them, tok has nothing to show.
