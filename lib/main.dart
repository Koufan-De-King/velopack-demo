import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:velopack_flutter/velopack_flutter.dart';

const _releaseFeed = String.fromEnvironment(
  'VELOPACK_FEED',
  defaultValue: 'http://127.0.0.1:8080',
);
const _appVersion =
    String.fromEnvironment('APP_VERSION', defaultValue: '1.0.0');

Future<void> main(List<String> args) async {
  WidgetsFlutterBinding.ensureInitialized();
  await initializeVelopack(url: _releaseFeed);

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

  runApp(const VelopackDemoApp());
}

class VelopackDemoApp extends StatelessWidget {
  const VelopackDemoApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'Velopack + Flutter',
      theme: ThemeData(
        brightness: Brightness.dark,
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xff7c5cff),
          brightness: Brightness.dark,
        ),
        scaffoldBackgroundColor: const Color(0xff0f1220),
        useMaterial3: true,
      ),
      home: const UpdateHomePage(),
    );
  }
}

class UpdateHomePage extends StatefulWidget {
  const UpdateHomePage({super.key});

  @override
  State<UpdateHomePage> createState() => _UpdateHomePageState();
}

class _UpdateHomePageState extends State<UpdateHomePage> {
  Timer? _updateTimer;
  bool _isBusy = false;
  bool _updateReady = false;
  String _status = kDebugMode
      ? 'Debug build: package this app as an AppImage to test Velopack updates.'
      : 'Checking for updates in the background…';
  String? _availableVersion;

  @override
  void initState() {
    super.initState();
    if (!kDebugMode) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        _checkForUpdate(silent: true);
      });
      _updateTimer = Timer.periodic(
        const Duration(minutes: 15),
        (_) => _checkForUpdate(silent: true),
      );
    }
  }

  @override
  void dispose() {
    _updateTimer?.cancel();
    super.dispose();
  }

  Future<void> _checkForUpdate({bool silent = false}) async {
    if (kDebugMode) return;
    if (_isBusy || _updateReady) return;
    setState(() {
      _isBusy = true;
      if (!silent) _status = 'Checking $_releaseFeed…';
      _availableVersion = null;
    });

    try {
      final update = await getLatestUpdateInfo();
      if (!mounted) return;
      if (update == null) {
        setState(() {
          _isBusy = false;
          _status = 'You are on the latest version.';
        });
        return;
      }

      final version = update.targetFullRelease.version;
      setState(() {
        _availableVersion = version;
        _isBusy = false;
        _updateReady = true;
        _status = 'Version $version is available. Install it when convenient.';
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _isBusy = false;
        _status = silent
            ? 'Background update check unavailable; will retry later.'
            : 'Update check failed. Run this from a Velopack-packaged AppImage.';
      });
    }
  }

  Future<void> _restartForUpdate() async {
    if (kDebugMode) return;
    setState(() {
      _isBusy = true;
      _status = 'Downloading the update…';
    });

    try {
      await for (final progress in checkAndDownloadUpdatesWithProgress()) {
        if (!mounted) return;
        setState(() => _status = 'Downloading the update… $progress%');
      }
      if (!mounted) return;
      setState(() => _status = 'Restarting to install the update…');

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
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _isBusy = false;
        _status = 'Update could not be applied. Please try restarting the app.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final hasUpdate = _availableVersion != null;
    return Scaffold(
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(32),
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 760),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Icon(Icons.rocket_launch_rounded, size: 56),
                const SizedBox(height: 24),
                Text(
                  'Velopack + Flutter',
                  style: Theme.of(context).textTheme.displaySmall?.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                ),
                const SizedBox(height: 12),
                Text(
                  'A desktop upgrade demo. Package this app twice, publish both releases to the same feed, and watch v1 upgrade to v2.',
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                        color: Colors.white70,
                        height: 1.45,
                      ),
                ),
                const SizedBox(height: 32),
                const _InfoCard(
                  label: 'Release feed',
                  value: _releaseFeed,
                  icon: Icons.cloud_outlined,
                ),
                const SizedBox(height: 12),
                const _InfoCard(
                  label: 'Current app version',
                  value: _appVersion,
                  icon: Icons.apps_rounded,
                ),
                const SizedBox(height: 24),
                Text(_status, style: const TextStyle(color: Colors.white70)),
                const SizedBox(height: 16),
                Wrap(
                  spacing: 12,
                  runSpacing: 12,
                  children: [
                    FilledButton.icon(
                      onPressed: _isBusy || _updateReady || kDebugMode
                          ? null
                          : () => _checkForUpdate(),
                      icon: _isBusy
                          ? const SizedBox.square(
                              dimension: 16,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.refresh_rounded),
                      label: const Text('Check for updates'),
                    ),
                    if (hasUpdate)
                      OutlinedButton.icon(
                        onPressed: _isBusy || !_updateReady || kDebugMode
                            ? null
                            : _restartForUpdate,
                        icon: const Icon(Icons.system_update_alt_rounded),
                        label: Text('Restart to install v$_availableVersion'),
                      ),
                  ],
                ),
                const SizedBox(height: 28),
                const Text(
                  'Tip: updates are checked after startup and periodically in the background. Restart when an update is ready.',
                  style: TextStyle(color: Colors.white38),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _InfoCard extends StatelessWidget {
  const _InfoCard(
      {required this.label, required this.value, required this.icon});

  final String label;
  final String value;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Card(
      color: Colors.white.withValues(alpha: 0.06),
      child: ListTile(
        leading: Icon(icon),
        title: Text(label, style: const TextStyle(color: Colors.white60)),
        subtitle: Text(value, style: const TextStyle(color: Colors.white)),
      ),
    );
  }
}
