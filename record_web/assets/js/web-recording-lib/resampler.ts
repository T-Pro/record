import {DSPNodeConfig, NodeArrayDSP, OptimizedLowPass} from './resampling-dsp';

export class ResamplerDSPNode extends NodeArrayDSP {
  constructor({
                inputSampleRate = 48000,
                outputSampleRate = 16000,
                chunkDuration = 0.040,
              }: DSPNodeConfig = {}) {
    super({sampleRate: inputSampleRate, chunkDuration});
    const stride = Math.ceil(inputSampleRate / outputSampleRate);

    const filter =
      new OptimizedLowPass({
        sampleRate: outputSampleRate * stride,
        stride,
        chunkDuration,
        // 20 dB attenuation at the Nyquist frequency
        // 45 dB at 5% above Nyquist frequency.
        numTaps: Math.floor(16 * stride) * 2 + 1,
        cutoff: 0.97 / stride,
        beta: 1.3,
      });
    this.appendNode(filter, true);
  }
}

