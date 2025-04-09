import {ResamplerDSPNode} from './resampler';

// The typescript definition for GetSettings() is not consistent
// with what is given by the browser.
type UsefulAudioTrackSettings = {
  channelCount: number,
  latency: number,
  sampleRate: number,
  sampleSize: number,
};
export class MediaTrackRecorderDSP extends ResamplerDSPNode {
  audioTrack?: MediaStreamAudioTrack;
  private trackProcessor?: MediaStreamTrackProcessor<AudioData>;
  private readonly inputBuffer: Float32Array;
  private writable?: WritableStream<AudioData>;
  static isSupported(): boolean {
    try{
      return !!(window.MediaStreamTrack && window.MediaStream && window.MediaStreamTrackProcessor && window.WritableStream);
    }catch{
      return false;
    }
  }
  constructor(
    track: MediaStreamAudioTrack,
    outputSampleRate: number = 16000,
    chunkDuration: number = 0.040
  ) {
    const trackSettings = track.getSettings() as UsefulAudioTrackSettings;
    super({chunkDuration, outputSampleRate, inputSampleRate: trackSettings.sampleRate});
    console.log(this.nodes);
    this.inputBuffer = new Float32Array(
      Math.round(this.chunkDuration * this.inputSampleRate) * (trackSettings.channelCount || 1)
    );

    this.audioTrack = track;
    this.trackProcessor = new MediaStreamTrackProcessor(
      {
        track: this.audioTrack,
        // We want this to be a generous number to avoid frames being dropped
        // Maybe this can be made something more meaningful using
        // trackSettings.frameRate, but I am not sure if the frame
        // of the MediaTrackProcessor is determined by that parameter.
        // For now, I will keep it fixed
        maxBufferSize: 1000
      }
    );
  }
  async onData(d: AudioData): Promise<void> {

    // https://w3c.github.io/webcodecs/#audio-sample-formats
    // refers to a set of values of all channels of a multichannel signal,
    // that happen at the exact same time.
    // For a single channel audio track a sample and a frame are the same thing
    const N = Math.floor(this.inputBuffer.length / d.numberOfChannels);

    for (let i = 0; i < d.numberOfFrames; i += N) {
      const numRead = Math.min(N, d.numberOfFrames - i);
      d.copyTo(this.inputBuffer, {
        frameOffset: i,
        frameCount: numRead,
        planeIndex: 0,
        format: 'f32-planar'
      });
      this.downMix(N, d.numberOfChannels);
      await this.push(this.inputBuffer.subarray(0, numRead));
    }
  }
  downMix(N: number, numChannels: number): void
  {
    if (numChannels !== 1){
      for (let c = 1; c < numChannels; ++c){
        for (let k = 2 * (N - 1) * numChannels; k >= 0; k -= numChannels)
        {
          this.inputBuffer[k] += this.inputBuffer[k + c];
        }
      }
      for (let k = 0, kc = 0; k < N; ++k, kc += numChannels){
        this.inputBuffer[k] = this.inputBuffer[kc];
      }
    }
  }
  start(): void {
    this.writable = new WritableStream<AudioData>(
    {
      write: (d: AudioData) => this.onData(d)
    });
    this.trackProcessor?.readable?.pipeTo(this.writable).then();
  }
  async stop(): Promise<void> {
    this.audioTrack?.stop();
    await this.trackProcessor?.readable?.cancel();
    delete this.trackProcessor;
    delete this.audioTrack;
  }
}

