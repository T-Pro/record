// record.bridge.js - Bridge between Dart and the audio recording library

// Import the core functionality from the provided library
// Note: You'd need to adjust the import path based on your actual project structure
import { 
    selectAudioCapture, 
    AudioWorkletRecordingHelper, 
    MediaStreamRecordingHelper, 
    MediaTrackRecorderHelper 
  } from 'web-recording-lib';

// Create a global reference to store recorders by ID
window.recorderInstances = {};

// Function to create a recorder instance
window.createRecorder = async function(recorderId, config) {
  try {
    // Get microphone access
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    
    // Create recorder with callback function that will be called with audio data
    const recorder = selectAudioCapture({
      stream: stream,
      sampleRate: config.sampleRate || 16000,
      chunkDuration: config.chunkDuration || 0.040,
      callback: function(audioBuffer) {
        // Convert ArrayBuffer to Uint8Array for Dart interop
        const data = new Uint8Array(audioBuffer);
        // Call the Dart callback if it exists
        if (window.dartCallbacks && window.dartCallbacks[recorderId]) {
          window.dartCallbacks[recorderId](data);
        }
      }
    });
    
    if (!recorder) {
      throw new Error("No suitable recording method found for this browser");
    }
    
    // Store the recorder instance
    window.recorderInstances[recorderId] = {
      recorder: recorder,
      stream: stream
    };
    
    return true;
  } catch (error) {
    console.error("Error creating recorder:", error);
    return false;
  }
};

// Register Dart callback for streaming audio data
window.registerDartCallback = function(recorderId, callback) {
  if (!window.dartCallbacks) {
    window.dartCallbacks = {};
  }
  window.dartCallbacks[recorderId] = callback;
};

// Start recording
window.startRecording = async function(recorderId) {
  const instance = window.recorderInstances[recorderId];
  if (instance && instance.recorder) {
    await instance.recorder.start();
    return true;
  }
  return false;
};

// Stop recording
window.stopRecording = async function(recorderId) {
  const instance = window.recorderInstances[recorderId];
  if (instance && instance.recorder) {
    await instance.recorder.stop();
    
    // Clean up stream tracks
    if (instance.stream) {
      instance.stream.getTracks().forEach(track => track.stop());
    }
    
    return true;
  }
  return false;
};

// Pause recording
window.pauseRecording = async function(recorderId) {
  const instance = window.recorderInstances[recorderId];
  if (instance && instance.recorder) {
    // The library might not have built-in pause functionality
    // Using AudioContext suspend as a workaround for AudioWorkletRecordingHelper
    if (instance.recorder instanceof AudioWorkletRecordingHelper) {
      await instance.recorder.audioCtx.suspend();
      return true;
    }
    return false;
  }
  return false;
};

// Resume recording
window.resumeRecording = async function(recorderId) {
  const instance = window.recorderInstances[recorderId];
  if (instance && instance.recorder) {
    // Using AudioContext resume as a workaround for AudioWorkletRecordingHelper
    if (instance.recorder instanceof AudioWorkletRecordingHelper) {
      await instance.recorder.audioCtx.resume();
      return true;
    }
    return false;
  }
  return false;
};

// Check if recording
window.isRecording = function(recorderId) {
  const instance = window.recorderInstances[recorderId];
  if (instance && instance.recorder) {
    return instance.recorder.isRecording();
  }
  return false;
};

// Check if paused (only for AudioWorkletRecordingHelper)
window.isPaused = function(recorderId) {
  const instance = window.recorderInstances[recorderId];
  if (instance && instance.recorder instanceof AudioWorkletRecordingHelper) {
    return instance.recorder.audioCtx.state === 'suspended';
  }
  return false;
};

// Dispose recorder
window.disposeRecorder = function(recorderId) {
  const instance = window.recorderInstances[recorderId];
  if (instance) {
    if (instance.recorder) {
      // Stop recording if still active
      try {
        instance.recorder.stop();
      } catch (e) {
        console.error("Error stopping recorder:", e);
      }
    }
    
    // Stop all tracks
    if (instance.stream) {
      instance.stream.getTracks().forEach(track => track.stop());
    }
    
    // Remove callback
    if (window.dartCallbacks && window.dartCallbacks[recorderId]) {
      delete window.dartCallbacks[recorderId];
    }
    
    // Delete instance
    delete window.recorderInstances[recorderId];
    return true;
  }
  return false;
};

// Get amplitude (not directly supported in the library, so this is a stub)
// You would need to implement this using AudioWorklet's analyzer or a custom solution
window.getAmplitude = function(recorderId) {
  // Return dummy amplitude for now
  return {
    current: -50,
    max: -30
  };
};

// List input devices
window.listInputDevices = async function() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter(device => device.kind === 'audioinput')
      .map(device => ({
        id: device.deviceId,
        label: device.label || `Microphone ${device.deviceId.slice(0, 5)}`
      }));
  } catch (error) {
    console.error("Error listing devices:", error);
    return [];
  }
};

// Check encoder support (stub)
window.isEncoderSupported = function(encoder) {
  // The library supports PCM, but for other formats we need to check MediaRecorder
  if (encoder === 'pcm16bits') {
    return true;
  }
  
  // For other formats, check MediaRecorder support
  if (window.MediaRecorder && window.MediaRecorder.isTypeSupported) {
    switch (encoder) {
      case 'aacLc':
      case 'aacEld':
      case 'aacHe':
        return MediaRecorder.isTypeSupported('audio/mp4;codecs=mp4a');
      case 'opus':
        return MediaRecorder.isTypeSupported('audio/webm;codecs=opus');
      case 'wav':
        return true; // We can always convert PCM to WAV
      default:
        return false;
    }
  }
  
  return false;
};