export { AudioWorkletRecordingHelper, IRecordingHelper, MediaTrackRecorderHelper, RecorderHelperOptions, DataCallback, selectAudioCapture, } from "./recording-helper";
export declare function gcd(a: number, b: number): number;
export declare function minimalFraction(p: number, q: number): [number, number];
export declare function getFarrowStructurePair(f1: number, fc: number, f2: number, rTol: number): [[number, number], [number, number]] | undefined;
export declare function toFraction(s: number, r?: number, maxDenominator?: number): [number, number];
export declare function copyFloatToInt16(dst: Int16Array, src: Float32Array | Float64Array, dstOffset: number, srcOffset: number, count: number): void;
declare enum RecordingStateEnum {
    IDLE = "idle",
    STARTING = "starting",
    RECORDING = "recording",
    STOPPING = "stopping"
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
    stream: MediaStream;
    sampleRate?: number;
    chunkDuration?: number;
    callback: DataCallback;
};
export declare class AudioWorkletRecordingHelper implements IRecordingHelper {
    workletNode: AudioWorkletNode;
    workletScriptUrl: string;
    audioCtx: AudioContext;
    ondata: DataCallback;
    chunkDuration: number;
    sampleRate: number;
    sourceNode: MediaStreamAudioSourceNode;
    _chunkAligner: DSPSinkNode;
    _workletNodePromise: Promise<AudioWorkletNode>;
    _state: RecordingStateEnum;
    constructor({ stream, callback, sampleRate, chunkDuration }: RecorderHelperOptions);
    handleChunk(data: DSPAudioData): void;
    static isSupported(): boolean;
    createCopyWorklet(): Promise<AudioWorkletNode>;
    start(): Promise<void>;
    stop(): Promise<void>;
    isRecording(): boolean;
    toggle(): Promise<boolean>;
}
export declare class MediaStreamRecordingHelper implements IRecordingHelper {
    private rec;
    private readonly sampleRate?;
    private readonly chunkDuration;
    private stream;
    mimeType?: string;
    _state: RecordingStateEnum;
    ondata: DataCallback;
    constructor({ stream, callback, sampleRate, chunkDuration }: RecorderHelperOptions);
    static isSupported(): boolean;
    static getPreferredOptions(): MediaRecorderOptions | undefined;
    static getSomeSupportedAudioFormats(): string[];
    start(): Promise<void>;
    stop(): Promise<void>;
    toggle(): Promise<boolean>;
    isRecording(): boolean;
}
export declare class MediaTrackRecorderHelper implements IRecordingHelper {
    _state: RecordingStateEnum;
    private readonly sampleRate?;
    private stream;
    private dsp;
    ondata: DataCallback;
    mimeType?: string;
    private readonly track;
    constructor({ stream, callback, sampleRate, chunkDuration }: RecorderHelperOptions);
    static isSupported(): boolean;
    get state(): RecordingStateEnum;
    set state(v: RecordingStateEnum);
    start(): Promise<void>;
    stop(): Promise<void>;
    toggle(): Promise<boolean>;
    isRecording(): boolean;
}
export declare function selectAudioCapture(options: RecorderHelperOptions): IRecordingHelper | undefined;
export declare class ResamplerDSPNode extends NodeArrayDSP {
    constructor({ inputSampleRate, outputSampleRate, chunkDuration, }?: DSPNodeConfig);
}
export type DSPAudioData = {
    samples: Float32Array;
    sampleRate: number;
};
export type DSPNodeConfig = Partial<{
    sampleRate: number;
    inputSampleRate: number;
    outputSampleRate: number;
    chunkDuration: number;
}>;
export declare class DSPNode {
    sinks: DSPNode[];
    ondata?: (data: DSPAudioData) => void;
    inputSampleRate: number;
    outputSampleRate: number;
    chunkDuration: number;
    constructor({ sampleRate, inputSampleRate, outputSampleRate, chunkDuration }?: DSPNodeConfig);
    push(samples: Float32Array): Promise<void>;
    write(data: DSPAudioData): Promise<void>;
    connect(destination: DSPNode): void;
    get sampleRate(): number;
    set sampleRate(v: number);
    shiftData(): void;
}
export type DSPSinkHandler = ((data: DSPAudioData) => Promise<void> | void);
export type DSPSinkOptions = Partial<DSPNodeConfig> & {
    handler: DSPSinkHandler;
};
export declare class DSPSinkNode extends DSPNode {
    private readonly handler;
    constructor({ sampleRate, handler, chunkDuration }: DSPSinkOptions);
    push(samples: Float32Array): Promise<void>;
}
type LocalStreamingDSPNodeConfig = Partial<{
    inputSampleRate: number;
    outputSampleRate: number;
    chunkDuration: number;
    inputMemorySamples: number;
    outputMemorySamples: number;
}>;
declare class LocalStreamingDSPNode extends DSPNode {
    protected inputBuffer: Float32Array;
    protected outputBuffer: Float32Array;
    protected inputReadPosition: number;
    protected inputWritePosition: number;
    protected outputWritePosition: number;
    protected inputChunkSize: number;
    protected outputChunkSize: number;
    protected inputMemorySize: number;
    protected outputMemorySize: number;
    constructor({ inputMemorySamples, outputMemorySamples, inputSampleRate, outputSampleRate, chunkDuration }?: LocalStreamingDSPNodeConfig);
    prepareBuffers(): void;
    write(data: DSPAudioData): Promise<void>;
    computeOutputSample(): void;
    getLocalInput(): Float32Array;
    getLocalOutput(): Float32Array;
    get visibleInputStart(): number;
    get visibleInputEnd(): number;
    get visibleOutputStart(): number;
    get visibleOutputEnd(): number;
}
type OptimizedLowPassFilterConfig = Partial<{
    cutoff: number;
    numTaps: number;
    stride: number;
    beta: number;
    chunkDuration: number;
    sampleRate: number;
}>;
export declare class OptimizedLowPass extends LocalStreamingDSPNode {
    center: number;
    numTaps: number;
    cutoff: number;
    beta: number;
    private impulseResponse;
    numBands: number;
    readonly stride: number;
    constructor({ cutoff, numTaps, stride, beta, chunkDuration, sampleRate }?: OptimizedLowPassFilterConfig);
    updateFilter(): void;
    selectNumberOfBands(): number;
    computeOutputSample(): void;
    computeSubBand(ti: number, b: number, nb: number): number;
    computeFrequencyResponse(f: number): number;
    computeImpulseResponse(): Float32Array;
}
export type InterpolatorConfig = Partial<{
    inputSampleRate: number;
    outputSampleRate: number;
    chunkDuration: number;
}>;
export declare class CubicInterpolator extends LocalStreamingDSPNode {
    farrowFilters: Float32Array;
    farrowIndex: number;
    constructor({ inputSampleRate, outputSampleRate, chunkDuration }?: InterpolatorConfig);
    initializeFarrow(): void;
    computeOutputSample(): void;
}
export declare class NodeArrayDSP extends DSPNode {
    nodes: DSPNode[];
    constructor({ sampleRate, chunkDuration }?: DSPNodeConfig);
    get input(): DSPNode;
    get output(): DSPNode;
    connect(destination: DSPNode): void;
    appendNode(nextNode: DSPNode, resample?: boolean): void;
    shiftData(): void;
    computeFrequencyResponse(f: number): number;
}
export declare class MediaTrackRecorderDSP extends ResamplerDSPNode {
    audioTrack?: MediaStreamAudioTrack;
    private trackProcessor?;
    private readonly inputBuffer;
    private writable?;
    static isSupported(): boolean;
    constructor(track: MediaStreamAudioTrack, outputSampleRate?: number, chunkDuration?: number);
    onData(d: AudioData): Promise<void>;
    downMix(N: number, numChannels: number): void;
    start(): void;
    stop(): Promise<void>;
}
