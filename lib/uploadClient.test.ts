import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MEDIA_UPLOAD_TIMEOUT_MS, uploadMediaViaApi } from "@/lib/uploadClient";

class UploadRequest {
  static instances: UploadRequest[] = [];
  status = 200;
  response: unknown = { url: "storage://chat-images/fam/a.jpg" };
  timeout = 0;
  responseType = "";
  upload = { onprogress: null as ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  open = vi.fn();
  send = vi.fn();
  abort = vi.fn(() => this.onabort?.());
  constructor() { UploadRequest.instances.push(this); }
}

beforeEach(() => {
  UploadRequest.instances = [];
  vi.stubGlobal("XMLHttpRequest", UploadRequest);
});
afterEach(() => vi.unstubAllGlobals());

describe("bounded media uploads", () => {
  it("sets a finite timeout and preserves real progress and storage references", async () => {
    const onProgress = vi.fn();
    const upload = uploadMediaViaApi("/api/upload/image", new FormData(), { onProgress });
    const request = UploadRequest.instances[0];
    expect(request.timeout).toBe(MEDIA_UPLOAD_TIMEOUT_MS);
    request.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 2 });
    expect(onProgress).toHaveBeenCalledWith(0.5);
    request.onload?.();
    await expect(upload).resolves.toBe("storage://chat-images/fam/a.jpg");
    expect(request.upload.onprogress).toBeNull();
  });

  it("releases a stalled upload as a retriable failure", async () => {
    const upload = uploadMediaViaApi("/api/upload/audio", new FormData());
    UploadRequest.instances[0].ontimeout?.();
    await expect(upload).rejects.toThrow("upload_timeout");
    expect(UploadRequest.instances[0].send).toHaveBeenCalledTimes(1);
  });

  it("cancels active uploads on navigation and detaches abort listeners after success", async () => {
    const controller = new AbortController();
    const upload = uploadMediaViaApi("/api/upload/image", new FormData(), { signal: controller.signal });
    controller.abort();
    await expect(upload).rejects.toThrow("upload_cancelled");
    expect(UploadRequest.instances[0].abort).toHaveBeenCalledOnce();
    const finishedController = new AbortController();
    const finished = uploadMediaViaApi("/api/upload/image", new FormData(), { signal: finishedController.signal });
    const request = UploadRequest.instances[1];
    request.onload?.();
    await finished;
    finishedController.abort();
    expect(request.abort).not.toHaveBeenCalled();
  });

  it("does not start an already cancelled request", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(uploadMediaViaApi("/api/upload/image", new FormData(), { signal: controller.signal }))
      .rejects.toThrow("upload_cancelled");
    expect(UploadRequest.instances).toHaveLength(0);
  });

  it("rejects unexpected media URLs and preserves HTTP upload errors", async () => {
    const invalid = uploadMediaViaApi("/api/upload/image", new FormData());
    UploadRequest.instances[0].response = { url: "https://untrusted.example/image.jpg" };
    UploadRequest.instances[0].onload?.();
    await expect(invalid).rejects.toThrow("upload_failed");
    const unauthorized = uploadMediaViaApi("/api/upload/image", new FormData());
    UploadRequest.instances[1].status = 401;
    UploadRequest.instances[1].response = { error: "unauthorized" };
    UploadRequest.instances[1].onload?.();
    await expect(unauthorized).rejects.toThrow("unauthorized");
  });
});
