#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{WebviewUrl, WebviewWindowBuilder};

const START_URL: &str = "https://www.tiktok.com/foryou";

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let url = WebviewUrl::External(START_URL.parse().expect("valid start url"));
            WebviewWindowBuilder::new(app, "main", url)
                .title("tok")
                .inner_size(1100.0, 900.0)
                .initialization_script(include_str!("inject.js"))
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to start tok");
}
