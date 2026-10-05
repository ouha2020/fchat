import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startRecording } from "@/lib/recordingService";

class Recorder extends EventTarget {
  static instances: Recorder[] = [];
  static isTypeSupported = () => true;
  state = "inactive";
  mimeType = "audio/webm";
  start = vi.fn(() => { this.state = "recording"; });
  stop = vi.fn(() => {
    this.state = "inactive";
    queueMicrotask(() => {
      const event = new Event("dataavailable");
      Object.assign(event, { data: new Blob(["synthetic-audio"]) });
      this.dispatchEvent(event);
      this.dispatchEvent(new Event("stop"));
    });
  });
  constructor() { super(); Recorder.instances.push(this); }
}

describe("recording lifecycle", () => {
  const stopTrack = vi.fn();
  const stream = { getTracks: () => [{ stop: stopTrack }] };
  const getUserMedia = vi.fn();
  beforeEach(() => {
    stopTrack.mockReset(); getUserMedia.mockReset().mockResolvedValue(stream);
    Recorder.instances = [];
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
    vi.stubGlobal("MediaRecorder", Recorder);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("does not request a microphone after cancellation", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(startRecording(controller.signal)).rejects.toThrow("recording_cancelled");
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("releases a permission response arriving after cancellation without starting a recorder", async () => {
    let allow!: (value: typeof stream) => void;
    getUserMedia.mockImplementation(() => new Promise((resolve) => { allow = resolve; }));
    const controller = new AbortController();
    const pending = startRecording(controller.signal);
    const rejected = expect(pending).rejects.toThrow("recording_cancelled");
    controller.abort(); allow(stream); await rejected;
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(Recorder.instances).toHaveLength(0);
  });

  it("aborts active recording and prevents obtaining a sendable result", async () => {
    const controller = new AbortController();
    const handle = await startRecording(controller.signal);
    controller.abort(); handle.cancel();
    await expect(handle.stop()).rejects.toThrow("recording_cancelled");
    expect(stopTrack).toHaveBeenCalled();
    expect(Recorder.instances[0].stop).toHaveBeenCalledOnce();
  });

  it("shares stop completion and detaches cancellation after normal completion", async () => {
    const controller = new AbortController();
    const handle = await startRecording(controller.signal);
    const first = handle.stop();
    expect(handle.stop()).toBe(first);
    const result = await first;
    expect(result.blob.size).toBeGreaterThan(0);
    expect(result.mimeType).toBe("audio/webm");
    expect(stopTrack).toHaveBeenCalledOnce();
    controller.abort(); handle.cancel();
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(await handle.stop()).toBe(result);
  });

  it("does not mask permission denial or construct a recorder", async () => {
    getUserMedia.mockRejectedValue(new DOMException("Permission denied", "NotAllowedError"));
    await expect(startRecording()).rejects.toMatchObject({ name: "NotAllowedError" });
    expect(Recorder.instances).toHaveLength(0);
  });

  it("releases the stream when recorder construction fails", async () => {
    class FailingRecorder {
      static isTypeSupported = () => true;
      constructor() { throw new Error("constructor_failed"); }
    }
    vi.stubGlobal("MediaRecorder", FailingRecorder);
    await expect(startRecording()).rejects.toThrow("constructor_failed");
    expect(stopTrack).toHaveBeenCalledOnce();
  });
});
