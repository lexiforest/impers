import { jest } from "@jest/globals";
import { CurlOpt } from "../src/ffi/constants.js";

const setStringList = jest.fn();

jest.unstable_mockModule("../src/core/easy.js", () => ({
  Curl: class {
    setOpt = jest.fn();
    setStringList = setStringList;
    cleanup = jest.fn();

    getHandle(): object {
      return {};
    }
  },
}));

jest.unstable_mockModule("../src/ffi/libcurl.js", () => ({
  curl_easy_perform_async: jest.fn(async () => 0),
  curl_easy_strerror: jest.fn(() => "mock curl error"),
  curl_ws_recv: jest.fn(),
  curl_ws_send: jest.fn(),
}));

const { AsyncWebSocket } = await import("../src/websocket/websocket.js");

describe("AsyncWebSocket options", () => {
  beforeEach(() => {
    setStringList.mockClear();
  });

  it("sets custom handshake headers on the curl handle", async () => {
    await AsyncWebSocket.connect("wss://example.com/socket", {
      headers: {
        Authorization: "Bearer token",
        "X-Custom-Header": "websocket-value",
      },
    });

    expect(setStringList).toHaveBeenCalledWith(CurlOpt.HTTPHEADER, [
      "Authorization: Bearer token",
      "X-Custom-Header: websocket-value",
    ]);
  });
});
