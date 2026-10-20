import 'dart:io';

import 'package:velopack_flutter/velopack_flutter.dart';

const bool updatesSupported = true;
const String runtimeLabel = 'Native (dart:ffi)';

/// Initialises Velopack and handles its lifecycle hook arguments. Returns
/// false when the process should exit without creating a UI.
Future<bool> initPlatform(List<String> args, String releaseFeed) async {
  await initializeVelopack(url: releaseFeed);

  // Velopack invokes the main executable with these short-lived lifecycle
  // hooks during install/update/uninstall. They must not create a UI.
  const hookArguments = [
    '--veloapp-install',
    '--veloapp-obsolete',
    '--veloapp-updated',
    '--veloapp-uninstall',
  ];
  if (hookArguments.any(args.contains)) {
    stderr.writeln('Velopack lifecycle hook handled: ${args.join(' ')}');
    exit(0);
  }
  return true;
}

void markFirstFrame() {}

Future<String?> latestUpdateVersion() async {
  final update = await getLatestUpdateInfo();
  return update?.targetFullRelease.version;
}

Stream<int> downloadUpdateWithProgress() =>
    checkAndDownloadUpdatesWithProgress();

Future<void> applyUpdateAndRestart() async {
  // The Linux Flutter binding applies the package correctly, but its
  // native restart callback is not reliable on AppImage. Start a tiny
  // detached relauncher before asking Velopack to apply-and-exit.
  final appImage = Platform.environment['APPIMAGE'];
  if (appImage != null && appImage.isNotEmpty) {
    await Process.start(
      '/bin/sh',
      ['-c', 'sleep 5; exec "\$1"', 'velopack-relauncher', appImage],
      mode: ProcessStartMode.detached,
    );
    await updateAndExit();
  } else {
    // Keep the normal behavior for non-AppImage packaged environments.
    await updateAndRestart();
  }
}
