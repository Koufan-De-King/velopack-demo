import 'dart:js_interop';

const bool updatesSupported = false;

// dart2wasm defines this constant; dart2js does not. Shown in the UI so the
// spike can confirm the Wasm build is not silently falling back to JS.
const bool _isWasm = bool.fromEnvironment('dart.tool.dart2wasm');
const String runtimeLabel =
    _isWasm ? 'Web (WebAssembly / dart2wasm)' : 'Web (JavaScript / dart2js)';

@JS('performance.mark')
external void _performanceMark(String name);

@JS('console.info')
external void _consoleInfo(String message);

Future<bool> initPlatform(List<String> args, String releaseFeed) async {
  _consoleInfo('p10-runtime: $runtimeLabel');
  return true;
}

/// Records a `flutter-first-frame` User Timing mark for the load benchmarks.
void markFirstFrame() => _performanceMark('flutter-first-frame');

Future<String?> latestUpdateVersion() =>
    throw UnsupportedError('Velopack updates are not available on the web.');

Stream<int> downloadUpdateWithProgress() =>
    throw UnsupportedError('Velopack updates are not available on the web.');

Future<void> applyUpdateAndRestart() =>
    throw UnsupportedError('Velopack updates are not available on the web.');
