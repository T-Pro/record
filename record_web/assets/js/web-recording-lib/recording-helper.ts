import {MediaTrackRecorderDSP} from "./track-recorder";
import {DSPAudioData, DSPSinkNode} from "./resampling-dsp";

export function copyFloatToInt16(
  dst: Int16Array,
  src: Float32Array | Float64Array,
  dstOffset: number,
  srcOffset: number,
  count: number): void {

  // Unrolling four iterations of the loop makes it 2x faster
  let i1 = srcOffset;
  let i2 = dstOffset;
  let i = 0;
  while (i < count){
    const t1 = src[i1]     * 0x7fff;
    const t2 = src[i1 + 1] * 0x7fff;
    const t3 = src[i1 + 2] * 0x7fff;
    const t4 = src[i1 + 3] * 0x7fff;

    dst[i2    ] = t1 >= 0x7fff ? 0x7fff : (t1 <= -0x8000 ? -0x8000 : t1);
    dst[i2 + 1] = t2 >= 0x7fff ? 0x7fff : (t2 <= -0x8000 ? -0x8000 : t2);
    dst[i2 + 2] = t3 >= 0x7fff ? 0x7fff : (t3 <= -0x8000 ? -0x8000 : t3);
    dst[i2 + 3] = t4 >= 0x7fff ? 0x7fff : (t4 <= -0x8000 ? -0x8000 : t4);

    i += 4; i1 += 4; i2 += 4;
  }
  while (i < count){
    dst[i + dstOffset] = Math.max(-0x8000, Math.min(0x7fff, src[i + srcOffset] * 0x7fff));
  }
}

function functionToScriptURL(fn: () => void): string{
  const fnText = fn.toString();
  const fnBody = fnText.substring(fnText.indexOf('{'));
  const blob = new Blob([fnBody], {type: 'text/javascript'});
  return URL.createObjectURL(blob);
}
let audioWorkletScriptURL: string;
function copyWorkletBody(): void {
  class CopyProcessor extends AudioWorkletProcessor {
    private samplesProcessed: number;

    constructor() {
      super();
      this.samplesProcessed = 0;
    }

    process(inputList: Float32Array[][]): boolean {
      const samples = new Float32Array(inputList[0][0]);
      this.port.postMessage({
        sampleIndex: this.samplesProcessed,
        samples
      });
      this.samplesProcessed += samples.length;
      return true;
    }
  }
  registerProcessor('audio-copy-processor', CopyProcessor);
}


enum RecordingStateEnum{
  IDLE = 'idle',
  STARTING = 'starting',
  RECORDING = 'recording',
  STOPPING = 'stopping',
}

export type DataCallback = (data: ArrayBuffer) => any;
export interface IRecordingHelper {
  _state: RecordingStateEnum;
  mimeType?: string;
  ondata: DataCallback;
  start(): Promise<void>;
  stop(): Promise<void>;
  toggle(): Promise<boolean>;
  isRecording(): boolean;
}

export type RecorderHelperOptions = {
  stream: MediaStream,
  sampleRate?: number,
  chunkDuration?: number,
  callback: DataCallback
};


export class AudioWorkletRecordingHelper implements IRecordingHelper{
  workletNode!: AudioWorkletNode;
  workletScriptUrl!: string;
  audioCtx!: AudioContext;
  ondata: DataCallback;
  chunkDuration: number;
  sampleRate: number;
  sourceNode: MediaStreamAudioSourceNode;
  _chunkAligner: DSPSinkNode;
  _workletNodePromise: Promise<AudioWorkletNode>;
  _state: RecordingStateEnum;

  constructor({
                stream, callback, sampleRate=16000, chunkDuration=0.040
              }: RecorderHelperOptions) {
    this._state = RecordingStateEnum.IDLE;
    this.sampleRate = sampleRate;
    this.chunkDuration = chunkDuration;
    this.audioCtx = new AudioContext({sampleRate})
    this.sourceNode = this.audioCtx.createMediaStreamSource(stream);
    this.ondata = callback || (() => {})
    this._chunkAligner = new DSPSinkNode({
      sampleRate,
      chunkDuration,
      handler: (data: DSPAudioData) => this.handleChunk(data)
    })
    this._workletNodePromise = this.createCopyWorklet();
  }
  handleChunk(data: DSPAudioData){
    const n = data.samples.length;
    const outData = new Int16Array(n);
    copyFloatToInt16(outData, data.samples, 0, 0, n);
    this.ondata(outData.buffer);
  }
  static isSupported(): boolean {
    return !!window.AudioContext && !!window.AudioWorkletNode && !!window.Blob && !!window.URL.createObjectURL
  }
  async createCopyWorklet(): Promise<AudioWorkletNode> {
    if(!this.workletNode) {
      if (!audioWorkletScriptURL) {
        audioWorkletScriptURL = functionToScriptURL(copyWorkletBody);
      }
      this.workletScriptUrl = audioWorkletScriptURL;
      await this.audioCtx.audioWorklet.addModule(audioWorkletScriptURL);
      this.workletNode = new AudioWorkletNode(this.audioCtx, 'audio-copy-processor');
      this.sourceNode.connect(this.workletNode);

      this.workletNode.port.onmessage = (message) => {
        this._chunkAligner.push(message.data.samples);
      };
    }
    return this.workletNode;
  }
  async start(): Promise<void> {
    this._state = RecordingStateEnum.STARTING
    await this.audioCtx.resume();
    this._state = RecordingStateEnum.RECORDING
  }
  async stop(): Promise<void> {
    this._state = RecordingStateEnum.STOPPING
    await this.audioCtx.suspend();
    this._state = RecordingStateEnum.IDLE;
  }
  isRecording(): boolean {
    return this.audioCtx.state === 'running';
  }

  async toggle(): Promise<boolean> {
    if (this.isRecording()){
      await this.stop();
      return false;
    }else{
      await this.start();
      return true;
    }
  }
}


export class MediaStreamRecordingHelper implements IRecordingHelper {
  private rec!: MediaRecorder;
  private readonly sampleRate?: number;
  private readonly chunkDuration: number;
  private stream!: MediaStream;
  public mimeType?: string;
  _state!: RecordingStateEnum;

  ondata: DataCallback;
  constructor({
                stream, callback, sampleRate=16000, chunkDuration=0.040
              }: RecorderHelperOptions) {
    this._state = RecordingStateEnum.IDLE;
    this.sampleRate = sampleRate;
    this.chunkDuration = chunkDuration;
    this.rec = new MediaRecorder(stream, MediaStreamRecordingHelper.getPreferredOptions());
    this.mimeType = this.rec.mimeType;
    this.stream = stream;
    this.rec.ondataavailable = async (e: BlobEvent) => this.ondata(await e.data.arrayBuffer());
    this.ondata = callback || (() => {})
  }
  static isSupported(): boolean {
    return !!window.MediaRecorder?.isTypeSupported && !!MediaStreamRecordingHelper.getPreferredOptions();
  }
  static getPreferredOptions(): MediaRecorderOptions | undefined {
    const preferredOptionsList:  MediaRecorderOptions[]  = [
      {mimeType: 'audio/webm;codecs=opus', bitsPerSecond: 24000},
      {mimeType: 'audio/mp4;codecs=mp4a', bitsPerSecond: 56000},
    ]
    for(const opts of preferredOptionsList){
      if(MediaRecorder.isTypeSupported(opts.mimeType!)){
        return opts;
      }
    }
    for(const mimeType of MediaStreamRecordingHelper.getSomeSupportedAudioFormats()){
      if(mimeType) {
        return {mimeType};
      }
    }
  }
  static getSomeSupportedAudioFormats(): string[] {
    const supportedAudioFormats = [];
    for (const encapsulation of ['webm', 'ogg', 'mp3', 'mp4', 'x-matroska']) {
      for (const audioCodec of ['should-not-be-supported', 'opus', 'pcm', 'aac', 'mpeg', 'mp4a', 'm4a']) {
        const mimeType = `audio/${encapsulation};codecs=${audioCodec}`;
        if (MediaRecorder.isTypeSupported(mimeType)) {
          supportedAudioFormats.push(mimeType);
        }
      }
      if (MediaRecorder.isTypeSupported(`audio/${encapsulation}`)) {
        supportedAudioFormats.push(`audio/${encapsulation}`);
      }
    }
    return supportedAudioFormats;
  }
  async start(): Promise<void> {
    this.rec.start(1e3 * this.chunkDuration);
    this._state = RecordingStateEnum.RECORDING;
  }
  async stop(): Promise<void> {
    this.rec.stop();
    this.stream.getTracks().map(t => t.stop());
    this._state = RecordingStateEnum.IDLE
  }
  async toggle(): Promise<boolean> {
    if (this.isRecording()){
      await this.stop();
      return false;
    }else{
      await this.start();
      return true;
    }
  }

  isRecording(): boolean {
    return this.rec?.state === 'recording';
  }
}


export class MediaTrackRecorderHelper implements IRecordingHelper {
  _state!: RecordingStateEnum;
  private readonly sampleRate?: number;
  private stream!: MediaStream;
  private dsp: MediaTrackRecorderDSP;
  public ondata: DataCallback;
  public mimeType?: string;
  private readonly track: MediaStreamAudioTrack;
  constructor({
                stream, callback, sampleRate=16000, chunkDuration=0.040
              }: RecorderHelperOptions) {
    this.state = RecordingStateEnum.IDLE;
    this.sampleRate = sampleRate;
    this.mimeType = 's16le';
    this.stream = stream;
    console.log(stream.getTracks());
    this.track = stream.getAudioTracks()[0] as MediaStreamAudioTrack;
    this.dsp = new MediaTrackRecorderDSP(this.track, this.sampleRate);
    this.dsp.output.ondata = async (e: DSPAudioData) => {
      if (this.state === RecordingStateEnum.STARTING){
        this.state = RecordingStateEnum.RECORDING;
      }
      const outData = new Int16Array(e.samples.length)
      copyFloatToInt16(outData, e.samples, 0, 0, e.samples.length);
      this.ondata(outData.buffer);
    };
    this.ondata = callback || (() => {})
  }

  static isSupported(): boolean {
    return MediaTrackRecorderDSP.isSupported()
  }

  get state(): RecordingStateEnum{
    return this._state;
  }
  set state(v: RecordingStateEnum){
    this._state = v;
  }
  async start(): Promise<void> {
    if (this.state === RecordingStateEnum.IDLE) {
      this.state = RecordingStateEnum.STARTING;
      this.dsp.start();
    }
  }
  async stop(): Promise<void> {
    if (this.state === RecordingStateEnum.RECORDING) {
      this.state = RecordingStateEnum.STOPPING;
      this.stream.getTracks().map(t => t.stop());
      this.state = RecordingStateEnum.IDLE;
    }
  }
  async toggle(): Promise<boolean> {
    if (this.state === RecordingStateEnum.RECORDING){
      await this.stop();
      return false;
    }else if (this.state === RecordingStateEnum.IDLE) {
      await this.start();
      return true;
    }
    return false;
  }
  isRecording(): boolean {
    return this.state !== RecordingStateEnum.IDLE;
  }
}

export function selectAudioCapture(options: RecorderHelperOptions): IRecordingHelper | undefined {
  for(const C of [
    MediaTrackRecorderHelper,
    MediaStreamRecordingHelper,
    AudioWorkletRecordingHelper
  ]) {
    if(C.isSupported()){
      return new C(options)
    }
  }
}
