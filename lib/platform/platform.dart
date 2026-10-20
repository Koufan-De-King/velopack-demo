// Desktop builds use Velopack (Rust over dart:ffi) for updates. Web builds
// cannot load that native core, so they get a stub that disables updates.
export 'platform_io.dart' if (dart.library.js_interop) 'platform_web.dart';
