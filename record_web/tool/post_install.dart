// File: record/record_web/tool/post_install.dart
import 'dart:io';

void main() {
  print('Running post-install setup for record_web...');

  // Change to the record_web directory
  final currentDir = Directory.current;
  final recordWebDir = Directory('${currentDir.path}/record_web');
  if (!recordWebDir.existsSync()) {
    // If already in record_web directory
    if (Directory('${currentDir.path}/package.json').existsSync()) {
      print('Already in record_web directory');
    } else {
      print('Error: record_web directory not found');
      return;
    }
  } else {
    Directory.current = recordWebDir.path;
  }

  // Check if npm is installed
  final npmResult = Process.runSync('which', ['npm']);
  if (npmResult.exitCode != 0) {
    print('Warning: npm not found. JavaScript functionality may not work.');
    return;
  }

  // Install the web-recording-lib
  print('Installing web-recording-lib from GitHub...');
  final installResult = Process.runSync('npm', [
    'install',
    'git+ssh://git@github.com:T-Pro/web-recording-lib.git#fix/npm-package'
  ]);

  if (installResult.exitCode != 0) {
    print('Warning: Failed to install web-recording-lib: ${installResult
        .stderr}');
    return;
  }

  // Build the bridge
  print('Building JavaScript bridge...');
  final buildResult = Process.runSync('npm', ['run', 'build-js']);
  if (buildResult.exitCode != 0) {
    print('Warning: Failed to build JavaScript bridge: ${buildResult.stderr}');
    return;
  }

  print('Setup completed successfully!');

  // Return to original directory
  Directory.current = currentDir.path;
}