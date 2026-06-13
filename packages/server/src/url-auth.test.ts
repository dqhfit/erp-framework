import { describe, expect, it } from "vitest";
import { splitUrlAuth } from "./url-auth";

describe("splitUrlAuth", () => {
  it("URL không có userinfo → headers rỗng, bỏ trailing slash", () => {
    const r = splitUrlAuth("http://tika.vfmgroup.vn:59998/");
    expect(r.url).toBe("http://tika.vfmgroup.vn:59998");
    expect(r.headers).toEqual({});
  });

  it("URL có user:pass → tách thành Authorization Basic + gỡ userinfo", () => {
    const r = splitUrlAuth("http://dev:s3cret@tika.vfmgroup.vn:59998");
    expect(r.url).toBe("http://tika.vfmgroup.vn:59998");
    expect(r.headers.authorization).toBe(`Basic ${Buffer.from("dev:s3cret").toString("base64")}`);
  });

  it("giữ nguyên path khi tách auth", () => {
    const r = splitUrlAuth("http://u:p@host:11434/base");
    expect(r.url).toBe("http://host:11434/base");
    expect(r.headers.authorization).toContain("Basic ");
  });

  it("decode mật khẩu percent-encoded", () => {
    const r = splitUrlAuth("http://dev:a%40b@host:9998");
    expect(r.headers.authorization).toBe(`Basic ${Buffer.from("dev:a@b").toString("base64")}`);
  });

  it("URL không hợp lệ → trả nguyên trạng, headers rỗng", () => {
    const r = splitUrlAuth("not-a-url");
    expect(r.url).toBe("not-a-url");
    expect(r.headers).toEqual({});
  });
});
