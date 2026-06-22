import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { webSearchRaw } from "./web-search";

/* ─── Helper: tạo mock Response ─────────────────────────────── */

function mockOkJson(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => data,
    text: async () => JSON.stringify(data),
  } as unknown as Response;
}

function mockErrorResponse(status: number, body: string): Response {
  return {
    ok: false,
    status,
    text: async () => body,
  } as unknown as Response;
}

/* ─── Setup / teardown ───────────────────────────────────────── */

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

/* ─── Tests ──────────────────────────────────────────────────── */

describe("webSearchRaw", () => {
  it("1. chuẩn hóa kết quả + score giảm dần theo thứ hạng", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockOkJson({
        results: [
          { title: "A", url: "http://a", content: "ca" },
          { title: "B", url: "http://b", content: "cb" },
        ],
      }),
    );

    const results = await webSearchRaw("http://127.0.0.1:8080", "q");

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ title: "A", url: "http://a", content: "ca", score: 1 });
    expect(results[1]).toEqual({ title: "B", url: "http://b", content: "cb", score: 0.5 });
  });

  it("2. URL fetch chứa /search?, q= và format=json", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockOkJson({ results: [] }),
    );

    await webSearchRaw("http://127.0.0.1:8080", "q");

    const calledUrl: string = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(calledUrl).toContain("/search?");
    expect(calledUrl).toContain("q=q");
    expect(calledUrl).toContain("format=json");
  });

  it("3. limit cắt số phần tử trả về", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockOkJson({
        results: [
          { title: "1", url: "u1", content: "c1" },
          { title: "2", url: "u2", content: "c2" },
          { title: "3", url: "u3", content: "c3" },
          { title: "4", url: "u4", content: "c4" },
          { title: "5", url: "u5", content: "c5" },
        ],
      }),
    );

    const results = await webSearchRaw("http://127.0.0.1:8080", "q", { limit: 2 });
    expect(results).toHaveLength(2);
  });

  it("4. basic-auth tách userinfo: URL fetch không còn user:pass@, headers có authorization Basic", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockOkJson({ results: [] }),
    );

    await webSearchRaw("http://user:pass@host:8080", "q");

    const mockFn = globalThis.fetch as ReturnType<typeof vi.fn>;
    const calledUrl: string = mockFn.mock.calls[0][0];
    const calledInit = mockFn.mock.calls[0][1] as RequestInit & {
      headers: Record<string, string>;
    };

    expect(calledUrl).not.toContain("user:pass@");
    expect(calledInit.headers.authorization).toMatch(/^Basic /);
  });

  it("5. lỗi HTTP (status 403) → ném Error chứa 403", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockErrorResponse(403, "forbidden"),
    );

    await expect(webSearchRaw("http://127.0.0.1:8080", "q")).rejects.toThrow("403");
  });

  it("6. fetch ném → ném Error chứa 'SearXNG'", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("network error"),
    );

    await expect(webSearchRaw("http://127.0.0.1:8080", "q")).rejects.toThrow("SearXNG");
  });

  it("7. results rỗng hoặc thiếu key → trả mảng rỗng", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockOkJson({}));

    const results = await webSearchRaw("http://127.0.0.1:8080", "q");
    expect(results).toEqual([]);
  });
});
