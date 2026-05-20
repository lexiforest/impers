import {
  curl_mime_addpart,
  curl_mime_data,
  curl_mime_filedata,
  curl_mime_filename,
  curl_mime_free,
  curl_mime_init,
  curl_mime_name,
  curl_mime_type,
  type CurlMime as CurlMimeHandle,
} from "../ffi/libcurl.js";
import { CurlOpt } from "../ffi/constants.js";
import { raiseIfError } from "../utils/errors.js";
import { Curl } from "./easy.js";

export interface CurlMimePartOptions {
  name: string;
  data?: string | Buffer;
  filename?: string;
  filepath?: string;
  contentType?: string;
}

export class CurlMime {
  private handle: CurlMimeHandle | null;
  private buffers: Buffer[] = [];

  constructor(curl: Curl) {
    const curlHandle = curl.getHandle();
    if (!curlHandle) {
      throw new Error("Curl handle is null");
    }

    this.handle = curl_mime_init(curlHandle);
    if (!this.handle) {
      throw new Error("curl_mime_init failed");
    }
  }

  get pointer(): CurlMimeHandle {
    if (!this.handle) {
      throw new Error("CurlMime handle is null");
    }
    return this.handle;
  }

  addPart(options: CurlMimePartOptions): void {
    const { name, data, filename, filepath, contentType } = options;

    if (!name) {
      throw new Error("Multipart field name is required");
    }
    if (data !== undefined && filepath !== undefined) {
      throw new Error("Multipart field cannot use both data and filepath");
    }

    const part = curl_mime_addpart(this.pointer);
    if (!part) {
      throw new Error("curl_mime_addpart failed");
    }

    raiseIfError(curl_mime_name(part, name) as number);

    if (contentType !== undefined) {
      raiseIfError(curl_mime_type(part, contentType) as number);
    }
    if (filepath !== undefined) {
      raiseIfError(curl_mime_filedata(part, filepath) as number);
    }
    if (filename !== undefined) {
      raiseIfError(curl_mime_filename(part, filename) as number);
    }
    if (data !== undefined) {
      const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf-8");
      this.buffers.push(buffer);
      raiseIfError(curl_mime_data(part, buffer, buffer.length) as number);
    } else if (filepath === undefined) {
      const buffer = Buffer.alloc(0);
      this.buffers.push(buffer);
      raiseIfError(curl_mime_data(part, buffer, 0) as number);
    }
  }

  attach(curl: Curl): void {
    curl.setOpt(CurlOpt.MIMEPOST, this.pointer);
  }

  free(): void {
    if (this.handle) {
      curl_mime_free(this.handle);
      this.handle = null;
    }
    this.buffers = [];
  }
}
