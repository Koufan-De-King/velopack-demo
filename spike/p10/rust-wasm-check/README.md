# P10: can the Rust side compile to `wasm32-unknown-unknown`?

Each crate here depends on one piece of our Rust stack and is built for the
native host and for `wasm32-unknown-unknown`. Toolchain is pinned to rustc
1.98.0 in `rust-toolchain.toml` (cratestack 0.15.4 needs ≥ 1.98).

```bash
cd spike/p10/rust-wasm-check
for t in x86_64-apple-darwin wasm32-unknown-unknown; do
  cargo build -p check-velopack -p check-cratestack-client -p check-cratestack-client-cose \
    -p check-cratestack-client-middleware -p check-cratestack-generated --target $t
done
```

Logs of the recorded run are in `logs/`.

## Results (2026-10-20)

| Crate checked | Native | wasm32 | Notes |
|---|---|---|---|
| `velopack` 1.2.161 (via `velopack_flutter` 0.2.0) | ✅ | ❌ | blockers below |
| `cratestack-client` 0.15.4, default features | ✅ | ✅ | |
| `cratestack-client` + `cose` | ✅ | ✅ | |
| `cratestack-client` + `middleware` | ✅ | ✅ | |
| Client **generated** by `include_client_schema!` from `schema/demo.cstack`, `cdylib` | ✅ | ✅ | release `.wasm` 753 KiB before `wasm-opt`; only `__wbindgen_*` imports, so it needs `wasm-bindgen` post-processing and nothing native |

## Blockers

### Velopack (desktop updater core): not portable, and not needed on the web

1. **`ring` 0.17.14** (via `velopack → ureq 3 → rustls 0.23 → ring`): its build
   script compiles C/assembly with `clang --target=wasm32-unknown-unknown`.
   Apple's clang has no wasm32 backend (`No available targets are compatible
   with triple "wasm32-unknown-unknown"`). An LLVM clang from Homebrew could
   compile it, but…
2. **`getrandom` 0.2.17** (via `ring`): `compile_error!` on wasm32 unless the `js`
   feature is enabled somewhere in the graph.
3. **By design**: Velopack reads and writes the install directory, spawns
   `Update.exe`/the AppImage and restarts the process. None of that exists in a
   browser. Web "updates" are simply the server serving new files.

**Decision for the app:** keep Velopack out of the web build entirely. This
branch does that with a conditional import (`lib/platform/platform.dart`:
`platform_io.dart` on desktop, `platform_web.dart` on web). Before that change
both web builds compiled but showed a **blank page**: `flutter_rust_bridge` tried
to load `pkg/velopack_flutter.js` (a wasm-bindgen build of the Rust crate that
does not exist), got a 404 and `main()` never returned.

### `cratestack-client`: no compile blockers; integration work remains

- Needs **rustc ≥ 1.98** (MSRV of 0.15.4). Pin it in CI.
- On wasm32 it switches to `wasm-bindgen-futures` and drops `rustls`/`ring` and
  native `tokio` (target-specific deps in `cratestack-client-rust`), so HTTP goes
  through the browser's `fetch` (reqwest wasm backend). Consequences:
  - CORS applies: the API must send `Access-Control-Allow-Origin` for the web
    app's origin. Under COEP `credentialless`, credentialed cross-origin
    requests also need `Access-Control-Allow-Credentials`.
  - No custom TLS (pinning, client certs) in the browser.
- Not done in this spike (S11 work):
  - expose the generated client through `flutter_rust_bridge` with a **web**
    target (`flutter_rust_bridge_codegen build-web`, wasm-bindgen + `wasm-opt`),
    then call it from Dart compiled by **dart2wasm**. FRB 2.11.1 triggers a
    dart2wasm lint (`invalid_runtime_check_with_js_interop_types` in
    `platform_utils/_web.dart`) that the Wasm dry-run flagged. It is a warning,
    not an error, but it must be proven at runtime.
  - FRB on the web wants `SharedArrayBuffer` (it logs *"Buffers cannot be shared
    due to missing cross-origin headers"* otherwise), so the COOP/COEP headers
    from this spike are a prerequisite for it as well.
  - measure the size of the real API client (the demo schema is tiny) and run
    `wasm-opt -Oz`.
