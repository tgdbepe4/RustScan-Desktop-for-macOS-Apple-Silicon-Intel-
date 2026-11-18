# RustScan Desktop for macOS (Apple Silicon & Intel)

A native macOS build of the graphical desktop interface for **RustScan 2.4.1**, based on the Windows project [`badarch47/rustscan-for-windows`](https://github.com) and the **Tauri 2** framework.

Since the upstream repository only provides pre-compiled binaries for Windows 10/11 and has app bundling disabled by default, this guide covers how to compile the application natively on macOS and package it as a standalone `.app` bundle.

---

## ✨ Features

* **Native macOS Support:** Uses Apple's built-in WebKit via Tauri 2 (no Electron overhead, no WebView2 required).
* **Embedded Engine:** Includes the RustScan 2.4.1 core engine directly as a Rust library (`engine/`).
* **No Nmap Dependency:** Service detection (banner grabbing) is implemented natively in Rust.
* **Apple Silicon & Intel:** Compiles natively for your Mac's architecture (`aarch64` or `x86_64`).

---

## 📋 Prerequisites

To compile the project on macOS, you need the following tools installed:

1. **Xcode Command Line Tools**
   ```bash
   xcode-select --install
   ```

2. **Rust & Cargo**
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://rustup.rs | sh
   source "\$HOME/.cargo/env"
   ```

3. **Tauri CLI (Version 2)**
   ```bash
   cargo install tauri-cli --version "^2.0.0"
   ```

---

## 🛠️ Build Instructions (macOS)

### 1. Clone the repository
```bash
git clone https://github.com.git
cd rustscan-for-windows
```

### 2. Compile and bundle as `.app`
Because bundling is disabled in `tauri.conf.json` (`"active": false`), you must explicitly pass the `--bundles app` flag during the build process:

```bash
cargo tauri build --bundles app
```

*(Note: If you only want the raw executable without a `.app` wrapper, run `cargo tauri build`. The standalone binary will be located at `src-tauri/target/release/rustscan-neon`.)*

---

## 📦 Installation

1. Once the build completes, open the output folder in Finder:
   ```bash
   open src-tauri/target/release/bundle/macos/
   ```
2. Drag and drop the generated `.app` bundle into your **`/Applications`** folder.
3. **First Launch:** Since this self-compiled app is not signed with an Apple Developer certificate, bypass Gatekeeper on the first launch by **Right-clicking → Open** (or allow it under *System Settings → Privacy & Security*).

---

## ⚡ Recommended Settings for macOS

macOS enforces significantly stricter default limits on open file descriptors and network sockets (`ulimit`) compared to Linux or Windows (typically `256` to `1024`).

* **Batch Size:** Set the **Batch Size between `500` and `1000`** in the UI. Higher values may cause macOS to drop packets or throw socket errors during fast scans.

---

## 🙏 Credits & License

* **GUI & Tauri Wrapper:** [`badarch47/rustscan-for-windows`](https://github.com)
* **RustScan Core Engine:** [`bee-san/RustScan`](https://github.com)
* # RustScan Desktop für macOS (Apple Silicon & Intel)

Eine native macOS-Portierung der grafischen Desktop-Oberfläche für **RustScan 2.4.1**, basierend auf dem Windows-Projekt [`badarch47/rustscan-for-windows`](https://github.com) und dem **Tauri 2** Framework.

Da das ursprüngliche Repository nur vorkompilierte Binaries für Windows 10/11 bereitstellt und das App-Bundling deaktiviert hat, beschreibt diese Anleitung, wie sich die Anwendung nativ für macOS kompilieren und als eigenständige `.app` verpacken lässt.

---

## ✨ Features

* **Nativ unter macOS:** Nutzt Apples integriertes WebKit über Tauri 2 (kein Electron-Overhead, kein WebView2 nötig).
* **Integrierte Engine:** Enthält die RustScan 2.4.1 Engine direkt als Rust-Bibliothek (`engine/`).
* **Keine Nmap-Abhängigkeit:** Service-Erkennung (Banner Grabbing) ist nativ in Rust implementiert.
* **Apple Silicon & Intel:** Kompiliert direkt für die jeweilige Mac-Architektur (`aarch64` oder `x86_64`).

---

## 📋 Voraussetzungen

Um das Projekt unter macOS zu kompilieren, werden folgende Werkzeuge benötigt:

1. **Xcode Command Line Tools**
   ```bash
   xcode-select --install
   ```

2. **Rust & Cargo**
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://rustup.rs | sh
   source "\$HOME/.cargo/env"
   ```

3. **Tauri CLI (Version 2)**
   ```bash
   cargo install tauri-cli --version "^2.0.0"
   ```

---

## 🛠️ Build-Anleitung (macOS)

### 1. Repository klonen
```bash
git clone https://github.com.git
cd rustscan-for-windows
```

### 2. Kompilieren und als `.app` verpacken
Da in der `tauri.conf.json` das Bundling standardmässig deaktiviert ist (`"active": false`), muss beim Build-Befehl explizit das Flag `--bundles app` mitgegeben werden:

```bash
cargo tauri build --bundles app
```

*(Hinweis: Wenn du nur die reine Kommandozeilen-Binary ohne `.app`-Container bauen möchtest, reicht `cargo tauri build`. Die Datei liegt dann unter `src-tauri/target/release/rustscan-neon`.)*

---

## 📦 Installation

1. Öffne nach erfolgreichem Build den Ausgabeordner im Finder:
   ```bash
   open src-tauri/target/release/bundle/macos/
   ```
2. Ziehe die erstellte `.app`-Datei in deinen regulären **`/Applications` (Programme)**-Ordner.
3. **Erster Start:** Da die selbst kompilierte App nicht über ein Apple-Entwicklerzertifikat signiert ist, öffne sie beim ersten Mal per **Rechtsklick → Öffnen** (oder erlaube den Start unter *Systemeinstellungen → Datenschutz & Sicherheit*).

---

## ⚡ Empfohlene Einstellungen für macOS

macOS begrenzt die Anzahl gleichzeitig offener Netzwerk-Sockets (`ulimit`) standardmässig deutlich strenger als Linux oder Windows (oft auf `256` bis `1024`). 

* **Batch Size:** Stelle in der Oberfläche eine **Batch Size zwischen `500` und `1000`** ein. Höhere Werte können unter macOS dazu führen, dass offene Ports übersehen werden oder Socket-Fehler auftreten.

---

## 🙏 Credits & Lizenz

* **GUI & Tauri-Wrapper:** [`badarch47/rustscan-for-windows`](https://github.com)
* **RustScan Core Engine:** [`bee-san/RustScan`](https://github.com)
