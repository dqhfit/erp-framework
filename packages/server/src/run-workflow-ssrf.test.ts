import { describe, expect, it } from "vitest";
import { assertPublicUrl } from "./run-workflow";

/* Guard SSRF cho node HTTP — chặn scheme lạ + IP nội bộ/link-local. */
describe("assertPublicUrl (SSRF guard)", () => {
  it("cho phép URL public http/https", async () => {
    await expect(assertPublicUrl("https://example.com/api")).resolves.toBeUndefined();
  });

  it("chặn scheme không phải http/https", async () => {
    await expect(assertPublicUrl("file:///etc/passwd")).rejects.toThrow();
    await expect(assertPublicUrl("ftp://example.com")).rejects.toThrow();
  });

  it("chặn loopback + IP literal nội bộ", async () => {
    await expect(assertPublicUrl("http://127.0.0.1/")).rejects.toThrow(/SSRF/);
    await expect(assertPublicUrl("http://10.0.0.5/")).rejects.toThrow(/SSRF/);
    await expect(assertPublicUrl("http://192.168.1.1/")).rejects.toThrow(/SSRF/);
    await expect(assertPublicUrl("http://172.16.0.1/")).rejects.toThrow(/SSRF/);
  });

  it("chặn cloud metadata 169.254.169.254 (link-local)", async () => {
    await expect(assertPublicUrl("http://169.254.169.254/latest/meta-data/")).rejects.toThrow(
      /SSRF/,
    );
  });

  it("chặn IPv6 loopback", async () => {
    await expect(assertPublicUrl("http://[::1]/")).rejects.toThrow(/SSRF/);
  });

  it("URL không hợp lệ → lỗi", async () => {
    await expect(assertPublicUrl("không-phải-url")).rejects.toThrow();
  });
});
