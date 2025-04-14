// File: record/record_web/tool/build_js.dart
import 'dart:io';

void main() {
  print('Building JavaScript dependencies for record_web...');

  // Change to the record_web directory
  final currentDir = Directory.current;
  final recordWebDir = Directory('${currentDir.path}/record_web');
  if (!recordWebDir.existsSync()) {
    // If already in record_web directory
    Directory('${currentDir.path}/package.json').existsSync()
        ? print('Already in record_web directory')
        : print('Error: record_web directory not found');
  } else {
    Directory.current = recordWebDir.path;
  }

  // Check if npm is installed
  final npmResult = Process.runSync('which', ['npm']);
  if (npmResult.exitCode != 0) {
    print('Error: npm not found. Please install Node.js and npm.');
    exit(1);
  }

  // Make sure package.json exists
  final packageJson = File('package.json');
  if (!packageJson.existsSync()) {
    print('Error: package.json not found in ${Directory.current.path}');
    exit(1);
  }

  // Install dependencies
  print('Installing npm dependencies...');
  final installResult = Process.runSync('npm', ['install']);
  if (installResult.exitCode != 0) {
    print('Error installing dependencies: ${installResult.stderr}');
    exit(1);
  }

  // Build the bridge
  print('Building JavaScript bridge...');
  final buildResult = Process.runSync('npm', ['run', 'build-js']);
  if (buildResult.exitCode != 0) {
    print('Error building JavaScript bridge: ${buildResult.stderr}');
    exit(1);
  }

  print('JavaScript build completed successfully.');

  // Return to original directory
  Directory.current = currentDir.path;
}