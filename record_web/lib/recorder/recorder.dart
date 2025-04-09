// File: lib/recorder/recorder.dart
import 'dart:async';
import 'dart:js_interop';
import 'package:web/web.dart' as web;

import 'package:flutter/foundation.dart';
import 'package:record_platform_interface/record_platform_interface.dart';
import 'package:record_web/js/js_audio_recorder.dart';
import 'package:record_web/mime_types.dart';
import 'package:record_web/recorder/delegate/js_recorder_delegate.dart';
import 'package:record_web/recorder/delegate/media_recorder_delegate.dart';
import 'package:record_web/recorder/delegate/mic_recorder_delegate.dart';
import 'package:record_web/recorder/delegate/recorder_delegate.dart';

const kMaxAmplitude = 0.0;
const kMinAmplitude = -160.0;

class Recorder {
  RecorderDelegate? _delegate;
  StreamController<RecordState>? _stateStreamCtrl;

  Future<bool> hasPermission() async {
    final mediaDevices = web.window.navigator.mediaDevices;

    try {
      final constraints = web.MediaStreamConstraints(audio: {true}.toJSBox);
      final ms = await mediaDevices.getUserMedia(constraints).toDart;

      // Clean-up
      final tracks = ms.getAudioTracks().toDart;
      for (var track in tracks) {
        track.stop();
      }

      return true;
    } catch (_) {
      return false;
    }
  }

  Future<List<InputDevice>> listInputDevices() async {
    return JSAudioRecorder.listInputDevices();
  }

  Future<bool> isEncoderSupported(AudioEncoder encoder) {
    return Future.value(JSAudioRecorder.isEncoderSupported(encoder));
  }

  Future<void> dispose() async {
    await _stateStreamCtrl?.close();
    return _delegate?.dispose();
  }

  Future<Amplitude> getAmplitude() async {
    final delegate = _delegate;

    if (delegate == null) {
      return Amplitude(current: -160.0, max: -160.0);
    }

    return delegate.getAmplitude();
  }

  Future<bool> isPaused() async {
    final delegate = _delegate;

    if (delegate == null) {
      return false;
    }

    return delegate.isPaused();
  }

  Future<bool> isRecording() async {
    final delegate = _delegate;

    if (delegate == null) {
      return false;
    }

    return delegate.isRecording();
  }

  Future<void> pause() async {
    final delegate = _delegate;

    if (delegate == null) {
      return;
    }

    return delegate.pause();
  }

  Future<void> resume() async {
    final delegate = _delegate;

    if (delegate == null) {
      return;
    }

    return delegate.resume();
  }

  Future<void> start(RecordConfig config, {required String path}) async {
    // Use our custom JS recorder delegate for all formats
    await _delegate?.dispose();
    _delegate = JSRecorderDelegate(onStateChanged: _updateState);
    
    try {
      return _delegate!.start(config, path: path);
    } catch (e) {
      // If our custom implementation fails, fall back to the original implementations
      debugPrint('JS recorder failed, falling back to default: $e');
      await _delegate?.dispose();
      
      // Original implementation follows
      switch (config.encoder) {
        case AudioEncoder.wav:
        case AudioEncoder.pcm16bits:
          _delegate = MicRecorderDelegate(onStateChanged: _updateState);
          return _delegate!.start(config, path: path);
        default:
          final supported = await isEncoderSupported(config.encoder);
          if (!supported) {
            throw Exception('Encoder ${config.encoder} not supported.');
          }

          _delegate = MediaRecorderDelegate(onStateChanged: _updateState);
          return _delegate!.start(config, path: path);
      }
    }
  }

  Future<Stream<Uint8List>> startStream(
    RecordConfig config,
  ) async {
    // Try our JS implementation first
    try {
      await _delegate?.dispose();
      _delegate = JSRecorderDelegate(onStateChanged: _updateState);
      return _delegate!.startStream(config);
    } catch (e) {
      // Fall back to original implementation
      debugPrint('JS streaming failed, falling back to default: $e');
      await _delegate?.dispose();
      
      switch (config.encoder) {
        case AudioEncoder.pcm16bits:
          _delegate = MicRecorderDelegate(onStateChanged: _updateState);
          return _delegate!.startStream(config);
        default:
          throw Exception('Stream not supported.');
      }
    }
  }

  Future<String?> stop() async {
    final delegate = _delegate;

    if (delegate == null) {
      return null;
    }

    return delegate.stop();
  }

  Future<void> cancel() async {
    final url = await stop();

    if (url != null) {
      web.URL.revokeObjectURL(url);
    }
  }

  Stream<RecordState> onStateChanged() {
    _stateStreamCtrl ??= StreamController(
      onCancel: () {
        _stateStreamCtrl?.close();
        _stateStreamCtrl = null;
      },
    );

    return _stateStreamCtrl!.stream;
  }

  void _updateState(RecordState state) {
    final ctrl = _stateStreamCtrl;
    if (ctrl == null) return;

    if (ctrl.hasListener && !ctrl.isClosed) {
      ctrl.add(state);
    }
  }
}