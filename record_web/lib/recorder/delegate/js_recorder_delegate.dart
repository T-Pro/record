// File: lib/recorder/delegate/js_recorder_delegate.dart
import 'dart:async';
import 'dart:typed_data';
import 'package:web/web.dart' as web;

import 'package:flutter/foundation.dart';
import 'package:record_platform_interface/record_platform_interface.dart';
import 'package:record_web/js/js_audio_recorder.dart';
import 'package:record_web/recorder/delegate/recorder_delegate.dart';

/// A recorder delegate that uses our custom JavaScript audio recording library
class JSRecorderDelegate extends RecorderDelegate {
  final OnStateChanged onStateChanged;
  
  JSAudioRecorder? _recorder;
  StreamController<Uint8List>? _streamController;
  String? _recordPath;
  web.Blob? _recordedBlob;
  
  JSRecorderDelegate({required this.onStateChanged});
  
  @override
  Future<void> dispose() async {
    _recorder?.dispose();
    _recorder = null;
    await _streamController?.close();
    _streamController = null;
    _recordPath = null;
    _recordedBlob = null;
  }
  
  @override
  Future<Amplitude> getAmplitude() async {
    return _recorder?.getAmplitude() ?? Amplitude(current: kMinAmplitude, max: kMinAmplitude);
  }
  
  @override
  Future<bool> isPaused() async {
    return _recorder?.isPaused() ?? false;
  }
  
  @override
  Future<bool> isRecording() async {
    return _recorder?.isRecording() ?? false;
  }
  
  @override
  Future<void> pause() async {
    if (_recorder != null) {
      await _recorder!.pause();
    }
  }
  
  @override
  Future<void> resume() async {
    if (_recorder != null) {
      await _recorder!.resume();
    }
  }
  
  @override
  Future<void> start(RecordConfig config, {required String path}) async {
    _recordPath = path;
    
    // Create a new recorder instance
    final recorderId = 'recorder_${DateTime.now().millisecondsSinceEpoch}';
    _recorder = JSAudioRecorder(
      recorderId: recorderId,
      onStateChanged: onStateChanged,
    );
    
    final success = await _recorder!.create(config);
    if (!success) {
      throw Exception('Failed to create recorder');
    }
    
    // Start recording
    final startSuccess = await _recorder!.start();
    if (!startSuccess) {
      throw Exception('Failed to start recording');
    }
  }
  
  @override
  Future<Stream<Uint8List>> startStream(RecordConfig config) async {
    // Create a stream controller
    _streamController = StreamController<Uint8List>();
    
    // Create a new recorder instance with the stream controller
    final recorderId = 'stream_${DateTime.now().millisecondsSinceEpoch}';
    _recorder = JSAudioRecorder(
      recorderId: recorderId,
      onStateChanged: onStateChanged,
      streamController: _streamController,
    );
    
    final success = await _recorder!.create(config);
    if (!success) {
      await _streamController?.close();
      throw Exception('Failed to create streaming recorder');
    }
    
    // Start recording
    final startSuccess = await _recorder!.start();
    if (!startSuccess) {
      await _streamController?.close();
      throw Exception('Failed to start streaming');
    }
    
    return _streamController!.stream;
  }
  
  @override
  Future<String?> stop() async {
    if (_recorder == null) {
      return null;
    }
    
    final success = await _recorder!.stop();
    if (!success) {
      return null;
    }
    
    // For a regular recording (not streaming), we'd need to handle
    // the recorded data here.
    // Since our JS bridge doesn't yet support getting the blob directly,
    // we'll need to implement this part in the future.
    
    // For now, let's return null or a dummy URL
    // In a complete implementation, you would:
    // 1. Get the blob from the recorder
    // 2. Create an object URL
    // 3. Return the URL
    
    return null; // Replace with actual URL when implemented
  }
  
  @override
  Future<web.MediaStream> initMediaStream(RecordConfig config) async {
    // This is handled internally by our JS library,
    // so we'll just return a dummy MediaStream
    throw UnimplementedError('This method is not used with JSRecorderDelegate');
  }
}