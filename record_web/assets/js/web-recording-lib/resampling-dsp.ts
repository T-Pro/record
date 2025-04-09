import {gcd, toFraction} from './fractions';

export type DSPAudioData = {
  samples: Float32Array;
  sampleRate: number;
};


function reallocate(x: Float32Array | undefined, newSize: number): Float32Array {
  if (!x) {
    x = new Float32Array(0);
  }
  if (newSize > x.length){
    const x2 = new Float32Array(newSize);
    x2.set(x);
    return x2;
  }else{
    return x;
  }
}

/**
 * 0-th order modified Bessel function of the first kind
 * defined as
 *  I_0(x) = sum_{k=0}^{\inf} (x/k!)^{2k}
 * @param x: number
 */
function bessel_i0(x: number): number {
  let k = 0; // summation index
  let ps = 0; // sum ending at k-1
  let s = 1; // sum ending at k
  let t = 1; // term at k
  while (ps !== s){
    k += 1;
    t *= x / (2 * k);
    ps = s;
    s += t * t;
  }
  return s;
}

/**
 * sinc(x) = sin(pi * x) / (pi * x)
 */
function sinc(x: number): number {
  if (x === 0){
    return 1;
  }else{
    return Math.sin(Math.PI * (((x + 1) % 2) - 1))
      / (Math.PI * x);
  }
}
export type DSPNodeConfig = Partial<{
  sampleRate: number,
  inputSampleRate: number,
  outputSampleRate: number,
  chunkDuration: number,
}>;
export class DSPNode {
  sinks: DSPNode[] = [];
  ondata?: (data: DSPAudioData) => void;
  inputSampleRate!: number;
  outputSampleRate!: number;
  chunkDuration: number;
  constructor({
                sampleRate = 16000,
                inputSampleRate,
                outputSampleRate,
                chunkDuration = 0.032
  }: DSPNodeConfig = {}){
    if (sampleRate) {
      this.sampleRate = sampleRate;
    }
    if (inputSampleRate){
      this.inputSampleRate = inputSampleRate;
    }
    if (outputSampleRate){
      this.outputSampleRate = outputSampleRate;
    }
    this.chunkDuration = Math.round(chunkDuration * sampleRate) / sampleRate;
  }
  async push(samples: Float32Array): Promise<void> {
    const chunk: DSPAudioData = {samples, sampleRate: this.outputSampleRate};
    for (const sink of this.sinks){
      await sink.write(chunk);
    }
    if (this.ondata) {
      this.ondata(chunk);
    }
  }
  async write(data: DSPAudioData): Promise<void> {
    await this.push(data.samples);
  }
  connect(destination: DSPNode): void{
    this.sinks.push(destination);
  }
  get sampleRate(): number {
    if (this.inputSampleRate !== this.outputSampleRate){
      throw new Error('Use either inputSampleRate or outputSampleRate instead of sampleRate accessor');
    }
    return this.inputSampleRate;
  }
  set sampleRate(v: number) {
    if (this.inputSampleRate !== this.outputSampleRate){
      throw new Error('Use either inputSampleRate or outputSampleRate instead of sampleRate accessor');
    }
    this.inputSampleRate = v;
    this.outputSampleRate = v;
  }
  shiftData(): void {}
}
export type DSPSinkHandler = ((data: DSPAudioData) => Promise<void> | void);
export type DSPSinkOptions = Partial<
  DSPNodeConfig> & {handler: DSPSinkHandler};
export class DSPSinkNode extends DSPNode {
  private readonly handler: DSPSinkHandler;
  constructor({sampleRate = undefined, handler, chunkDuration}: DSPSinkOptions)
  {
    super({sampleRate, chunkDuration});
    this.handler = handler;
  }
  async push(samples: Float32Array): Promise<void> {
    const v = this.handler({samples, sampleRate: this.inputSampleRate});
    if (v) {
      return await v;
    }
  }
}

type LocalStreamingDSPNodeConfig = Partial<{
  inputSampleRate: number,
  outputSampleRate: number,
  chunkDuration: number,
  inputMemorySamples: number,
  outputMemorySamples: number,
}>;
class LocalStreamingDSPNode extends DSPNode {
  protected inputBuffer!: Float32Array;
  protected outputBuffer!: Float32Array;
  protected inputReadPosition!: number;
  protected inputWritePosition!: number;
  protected outputWritePosition!: number;
  protected inputChunkSize: number;
  protected outputChunkSize: number;
  protected inputMemorySize: number;
  protected outputMemorySize: number;
  constructor(
    {
      inputMemorySamples = 0,
      outputMemorySamples = 0,
      inputSampleRate = 16000,
      outputSampleRate = 16000,
      chunkDuration = 0.032
    }: LocalStreamingDSPNodeConfig = {}
  ) {
    // s is the frequency that input and output sample rate match
    const s = gcd(inputSampleRate, outputSampleRate);
    chunkDuration = Math.max(Math.round(s * chunkDuration), 1) / s;
    super({sampleRate: inputSampleRate, chunkDuration});
    this.inputMemorySize = inputMemorySamples;
    this.outputMemorySize = outputMemorySamples;
    this.inputChunkSize = Math.round(chunkDuration * inputSampleRate);
    this.outputChunkSize = Math.round(chunkDuration * outputSampleRate);
    this.inputSampleRate = inputSampleRate;
    this.outputSampleRate = outputSampleRate;
    this.prepareBuffers();
  }
  prepareBuffers(): void {
    const newInputSize = this.inputChunkSize + this.inputMemorySize - 1;
    this.inputBuffer = reallocate(this.inputBuffer, newInputSize);
    this.outputBuffer = reallocate(this.outputBuffer, this.outputChunkSize + this.outputMemorySize);
    // This will pad the input
    this.inputReadPosition = this.inputReadPosition || this.inputMemorySize;
    this.inputWritePosition = this.inputWritePosition || this.inputMemorySize;
    this.outputWritePosition = this.outputWritePosition || this.outputMemorySize;
  }
  async write(data: DSPAudioData): Promise<void> {
    // fill input transfers a slice from data.samples to the internal buffer
    // advance output compute the output samples and pushes the data to the
    // next stage if necessary.
    for (let i = this.fillInput(data.samples, 0);
         i < data.samples.length;
         i = this.fillInput(data.samples, i)
    ){
      await this.advanceOutput();
    }
  }
  /** Fills the input buffer with samples of the given array */
  private fillInput(samples: Float32Array, pos: number): number {
    const count = Math.min(
      samples.length - pos,
      this.inputBuffer.length - this.inputWritePosition
    );
    this.inputBuffer.set(samples.subarray(pos, pos + count), this.inputWritePosition);
    this.inputWritePosition += count;
    return pos + count;
  }

  private async advanceOutput(): Promise<boolean> {

    while (
      (this.inputReadPosition < this.inputWritePosition) &&
      (this.outputWritePosition < this.outputBuffer.length)
      ) {
      this.computeOutputSample();
    }
    if (this.outputWritePosition === this.outputBuffer.length
      || this.inputReadPosition === this.inputBuffer.length
    ){
      await this.shiftData();
      return true;
    }else{
      return false;
    }
  }
  async shiftData(): Promise<void> {
    await this.push(
      this.outputBuffer.subarray(this.outputMemorySize, this.outputWritePosition)
    );
    // compute the free space at the start of the arrays
    const inputShift = this.inputReadPosition - this.inputMemorySize;
    const outputShift = this.outputWritePosition - this.outputMemorySize;
    // shift input data
    this.inputBuffer.set(
      this.inputBuffer.subarray(inputShift, this.inputWritePosition)
    );
    // shift output data
    this.outputBuffer.set(
      this.outputBuffer.subarray(outputShift, this.outputWritePosition)
    );
    // update indices.
    this.outputWritePosition -= outputShift;
    this.inputWritePosition -= inputShift;
    this.inputReadPosition -= inputShift;
  }

  /**
   * Compute one output sample based on the input memory
   *
   * This function must be overridden in the inheriting classes
   */
  computeOutputSample(): void {
    console.log({
      visibleInput: this.getLocalInput(),
      visibleOutput: this.getLocalOutput()
    });
    throw new Error('This function must be overridden');
  }

  // The next methods and properties may be useful to write
  // more readable code, or they could be used as a reference
  // by simply inlining (possibly simplifying) their computation.
  /**
   * This gets a subarray of the input buffer containing the
   * input samples expected to be used when computing the
   * next output sample.
   *
   * This may serve as a reference, or be used to make the
   * computeOutputSamples more readable.
   */
  public getLocalInput(): Float32Array {
    // notice that inputBufferPos indicates the first unset position in the
    // input buffer, here we are interested in an index
    return this.inputBuffer.subarray(this.visibleInputStart, this.visibleInputEnd);
  }

  /**
   * This gets a subarray of the output buffer that containing
   * the output samples expected to be used when computing the
   * next output sample.
   *
   * This may serve as a reference, or be used to make the
   * computeOutputSamples more readable.
   */
  public getLocalOutput(): Float32Array {
    return this.outputBuffer.subarray(this.visibleOutputStart, this.visibleOutputEnd);
  }

  /**
   * The index of the first input sample in the current context
   */
  get visibleInputStart(): number {
    return this.inputReadPosition - this.inputMemorySize;
  }
  /**
   * The index of the end (last + 1) sample of the current context
   */
  get visibleInputEnd(): number {
    return this.inputReadPosition;
  }

  /**
   * Start of the first output sample in the current context
   */
  get visibleOutputStart(): number {
    return this.outputWritePosition - this.outputMemorySize;
  }
  /**
   * End (last + 1) of the output in the current context
   */
  get visibleOutputEnd(): number {
    return this.outputWritePosition;
  }

}

type OptimizedLowPassFilterConfig = Partial<{
  cutoff: number,
  numTaps: number,
  stride: number,
  beta: number,
  chunkDuration: number,
  sampleRate: number,
}>;

export class OptimizedLowPass extends LocalStreamingDSPNode {
  public center!: number;
  public numTaps: number;
  public cutoff: number;
  public beta: number;
  private impulseResponse!: Float32Array;
  public numBands!: number;
  readonly stride: number;

  constructor(
    {
      cutoff = 1 / 2,
      numTaps = 49,
      stride = 1,
      beta = 2,
      chunkDuration = 0.032,
      sampleRate = 48000
    }: OptimizedLowPassFilterConfig = {}){
    super({
      inputSampleRate: sampleRate,
      outputSampleRate: sampleRate / stride,
      inputMemorySamples: numTaps,
      outputMemorySamples: 0,
      chunkDuration
    });
    this.beta = beta;
    this.numTaps = numTaps;
    this.cutoff = cutoff;
    this.stride = stride;
    this.updateFilter();
  }
  updateFilter(): void {
    this.numBands = this.selectNumberOfBands();
    this.impulseResponse = this.computeImpulseResponse();
    this.center = (this.numTaps - 1) / 2;
  }

  /**
   * Select a number of bands that takes advantage of sparsity
   * of the impulse response if possible.
   */
  selectNumberOfBands(): number {
    const [p, q] = toFraction(this.cutoff, 1e-6, Math.sqrt(this.numTaps));
    if (
      Math.abs(this.cutoff * q - p) > 1e-6 ||
      q === 0 || q > (this.numTaps / (4 * q))) {
      // if q <= 1 it means that the approximation failed
      // if q is too high maybe it is the overhead might not be worth
      return 1;
    }else{
      // if the filter is p / q, it means that every
      // h[center + n * q] = 0 and we can save computation
      // resources by skipping those
      return q;
    }
  }

  /**
   * Compute a single sample, update pointers and leave
   */
  computeOutputSample(): void {
    const ti = this.stride * this.outputWritePosition;
    let s = this.impulseResponse[this.center] * this.inputBuffer[ti + this.center];
    s += this.computeSubBand(ti, 0, this.numBands);
    if (this.numBands > 2) {
      for (let b = 1; b < this.numBands - 1; ++b) {
        s += this.computeSubBand(ti, b, this.numBands);
      }
    }
    if (this.numTaps % 2 === 1){
      s += this.inputBuffer[ti + this.center] * this.impulseResponse[this.center];
    }
    this.outputBuffer[this.outputWritePosition++] = s;
    this.inputReadPosition += this.stride;
  }
  computeSubBand(ti: number, b: number, nb: number): number {
    const c = this.center;
    const ct = c + ti;
    let s = 0;
    for (let i = b + 1; i < this.center; i += nb){
      s += (this.inputBuffer[ct + i] + this.inputBuffer[ct - i]) * this.impulseResponse[c + i];
    }
    return s;
  }

  /**
   * Compute the frequency response assuming symmetric impulse response
   * @param f frequency in Hertz
   */
  computeFrequencyResponse(f: number): number {
    let H = 0;
    let i = 0;
    const omega = 2 * Math.PI * (f / this.inputSampleRate);
    while (i < this.center) {
      H += this.impulseResponse[i] * Math.cos(omega * (i - this.center));
      ++i;
    }
    H = 2 * H + this.impulseResponse[i];
    return H;
  }
  /**
   * compute the impulse response
   */
  computeImpulseResponse(): Float32Array {
    const h = new Float32Array(this.numTaps);
    const center = (this.numTaps - 1) / 2;
    // Normalize energy per sample
    const c = this.cutoff / bessel_i0(this.beta);
    let weight = 0;
    for (let i = 0; i < this.numTaps; ++i){
      const x = (i - center) * this.cutoff;
      const w = 2 * (i - center) / this.numTaps;
      const z = Math.sqrt(Math.max(1 - w * w, 0));
      h[i] = c * sinc(x) * bessel_i0(this.beta * z);
      weight += h[i];
    }
    // make H(0) = 1, keep the te amplitude of the pass band frequencies
    for (let i = 0; i < this.numTaps; ++i){
      h[i] /= weight;
    }
    return h;
  }
}

export type InterpolatorConfig = Partial<{
  inputSampleRate: number,
  outputSampleRate: number,
  chunkDuration: number,
}>;

export class CubicInterpolator extends LocalStreamingDSPNode {
  farrowFilters: Float32Array;
  farrowIndex: number;
  constructor({
      inputSampleRate = 16000,
      outputSampleRate = 16000,
      chunkDuration = 0.032
  }: InterpolatorConfig = {}
  ) {
    super({
      inputSampleRate,
      outputSampleRate,
      chunkDuration,
      inputMemorySamples: 4,
      outputMemorySamples: 0,
    });
    this.farrowIndex = 0;
    this.farrowFilters = new Float32Array([]);
    this.inputMemorySize = 4;
    this.outputMemorySize = 0;
    this.initializeFarrow();
  }

  initializeFarrow(): void {
    const [p, q] = [this.inputSampleRate, this.outputSampleRate];
    this.farrowFilters = new Float32Array(5 * q);
    let k = 0;
    for (let i = 0; i < q; ++i){
      const t = ((i * p) % q) / q;
      const nextIndex = Math.floor((i * p + p) / q);
      // (
      //   + (3*t**2 - 2*t**3) * fp[k-1] # value at t=1
      this.farrowFilters[5 * i + 1] = t * t * (3 - 2 * t);
      //   + (3*(t-1)**2 + 2*(t-1)**3) * fp[k-2] # value at t=0
      this.farrowFilters[5 * i + 2] = (t - 1) * (t - 1) * (3 + 2 * (t - 1));
      //   + (t * (t - 1)**2) * (fp[k-1] - fp[k-3]) / 2 # derivative at t=0
      this.farrowFilters[5 * i + 3] = -(t - 1) * (t - 1) * t;
      this.farrowFilters[5 * i + 1] += (t - 1) * (t - 1) * t;
      //   + (t**2 * (t - 1)) * (fp[k] - fp[k-2]) / 2 # derivative at t=1
      this.farrowFilters[5 * i] = t * t * (t - 1);
      this.farrowFilters[5 * i + 2] -= t * t * (t - 1);
      // also save the input memory step from the current to the next sample
      this.farrowFilters[5 * i + 4] = nextIndex - k;
      k = nextIndex;
      // )
    }
    this.farrowIndex = 0;
  }

  /**
   * Compute a single sample, update pointers and leave
   */
  computeOutputSample(): void {
    const i1 = this.inputReadPosition;
    const i2 = this.farrowIndex;
    this.outputBuffer[this.outputWritePosition++] = (
      this.inputBuffer[i1] * this.farrowFilters[i2] +
      this.inputBuffer[i1 - 1] * this.farrowFilters[i2 + 1] +
      this.inputBuffer[i1 - 2] * this.farrowFilters[i2 + 2] +
      this.inputBuffer[i1 - 3] * this.farrowFilters[i2 + 3]
    );
    this.inputReadPosition += this.farrowFilters[i2 + 4];
    this.farrowIndex += 5;
    if (this.farrowIndex >= this.farrowFilters.length){
      this.farrowIndex = 0;
    }
  }
}

export class NodeArrayDSP extends DSPNode {
  nodes: DSPNode[];
  constructor({
                sampleRate,
                chunkDuration = 0.032
  }: DSPNodeConfig = {}){
    super({
      sampleRate,
      chunkDuration
    });
    this.nodes = [this];
  }
  get input(): DSPNode {
    return this.nodes[0];
  }
  get output(): DSPNode {
    return this.nodes[this.nodes.length - 1];
  }

  /**
   * Make sure to connect to the output preventing infinite recursion
   */
  connect(destination: DSPNode): void {
    if (this.nodes.length !== 1){
      console.warn('Connecting to a Node array head, did you mean ".output.connect(...)"');
    }
    super.connect(destination);
  }

  /**
   * Compose the current transformation with the given node
   * i.e. passes the current output as the input of the given node
   * and use that node as output.
   * @param nextNode the node to be appended to this system.
   * @param resample whether to automatically resample if necessary
   */
  appendNode(nextNode: DSPNode, resample: boolean = false): void {
    let currentOutput = this.output;
    if (!currentOutput.outputSampleRate && nextNode.inputSampleRate){
      currentOutput.sampleRate = nextNode.inputSampleRate;
    }
    if (!nextNode.inputSampleRate && currentOutput.outputSampleRate){
      nextNode.sampleRate = currentOutput.outputSampleRate;
    }
    if (currentOutput.outputSampleRate !== nextNode.inputSampleRate){
      if (resample && currentOutput.outputSampleRate && nextNode.inputSampleRate){
        this.appendNode(new CubicInterpolator({
            inputSampleRate: currentOutput.outputSampleRate,
            outputSampleRate: nextNode.inputSampleRate,
            chunkDuration: currentOutput.chunkDuration || nextNode.chunkDuration || 0.032
          }));
        currentOutput = this.output;
      }else{
        throw new Error(
          `Failed to connect ${currentOutput.outputSampleRate} Hz output ` +
          `to ${nextNode.inputSampleRate} Hz input`
        );
      }
    }
    currentOutput.connect(nextNode);
    this.outputSampleRate = nextNode.outputSampleRate;
    this.nodes.push(nextNode);
  }
  shiftData(): void {
    super.shiftData();
    for (const node of this.nodes){
      if (node !== this) {
        node.shiftData();
      }
    }
  }
  /**
   * Compute the frequency response relative to the input,
   * notice that the output might be wrapped if it is above
   * the Nyquist frequency of one of the nodes.
   * @param f frequency in Hertz
   */
  computeFrequencyResponse(f: number): number {
    let H = 1;
    for (const node of this.nodes){
      if (node !== this && typeof (node as any).computeFrequencyResponse === 'function'){
        H *= (node as any).computeFrequencyResponse(f);
      }
    }
    return H;
  }
}
