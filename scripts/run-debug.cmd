@echo off
set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223
start "" "%~dp0..\src-tauri\target\release\rustscan-neon.exe"
