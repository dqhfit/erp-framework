/* ==========================================================
   backup-gdrive.ts — Google Drive client tối giản dùng service
   account JWT (RS256). Không phụ thuộc SDK npm — fetch + crypto.
   Hỗ trợ: lấy token, tạo thư mục con (idempotent — đã có thì
   trả id cũ), upload file mới, ghi đè content file đã có, xoá.
   ========================================================== */
import crypto from "node:crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const SCOPE = "https://www.googleapis.com/auth/drive";

export interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  // ... các trường khác bị bỏ qua.
}

function b64u(buf: string | Buffer): string {
  return Buffer.from(buf).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Đổi service account JSON → access token (1 giờ). */
export async function getAccessToken(keyJson: string): Promise<string> {
  let key: ServiceAccountKey;
  try { key = JSON.parse(keyJson) as ServiceAccountKey; }
  catch { throw new Error("Service account key không phải JSON hợp lệ."); }
  if (!key.client_email || !key.private_key) {
    throw new Error("Service account key thiếu client_email/private_key.");
  }
  const now = Math.floor(Date.now() / 1000);
  const header = b64u(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64u(JSON.stringify({
    iss: key.client_email, scope: SCOPE, aud: TOKEN_URL,
    exp: now + 3600, iat: now,
  }));
  const sig = b64u(
    crypto.createSign("RSA-SHA256").update(`${header}.${claim}`)
      .sign(key.private_key),
  );
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claim}.${sig}`,
    }),
  });
  if (!r.ok) throw new Error(`gdrive auth ${r.status}: ${await r.text()}`);
  const j = (await r.json()) as { access_token: string };
  return j.access_token;
}

/** Lấy metadata thư mục — dùng để test kết nối. */
export async function getFolder(token: string, folderId: string)
: Promise<{ id: string; name: string }> {
  const r = await fetch(
    `${DRIVE_API}/files/${folderId}?fields=id,name,mimeType`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!r.ok) throw new Error(`gdrive folder ${r.status}: ${await r.text()}`);
  return r.json() as Promise<{ id: string; name: string }>;
}

/** Tìm hoặc tạo thư mục con trong parent. Idempotent. */
export async function ensureFolder(
  token: string, parentId: string, name: string,
): Promise<string> {
  // Tìm trước (escape ' trong tên để query không vỡ).
  const safeName = name.replace(/'/g, "\\'");
  const q = `name='${safeName}' and '${parentId}' in parents`
    + ` and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const find = await fetch(
    `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id,name)`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!find.ok) throw new Error(`gdrive list ${find.status}: ${await find.text()}`);
  const list = (await find.json()) as { files?: { id: string }[] };
  if (list.files && list.files[0]) return list.files[0].id;

  // Tạo mới.
  const create = await fetch(`${DRIVE_API}/files?fields=id`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      name, parents: [parentId],
      mimeType: "application/vnd.google-apps.folder",
    }),
  });
  if (!create.ok) throw new Error(`gdrive mkdir ${create.status}: ${await create.text()}`);
  const j = (await create.json()) as { id: string };
  return j.id;
}

/** Upload file MỚI vào parent. Trả về fileId. */
export async function uploadNewFile(
  token: string,
  parentId: string,
  name: string,
  mimeType: string,
  content: Buffer,
): Promise<string> {
  const boundary = `erp${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
      `content-type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify({ name, parents: [parentId] })}\r\n` +
      `--${boundary}\r\n` +
      `content-type: ${mimeType}\r\n\r\n`,
    ),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const r = await fetch(
    `${UPLOAD_API}/files?uploadType=multipart&fields=id`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": `multipart/related; boundary=${boundary}`,
        "content-length": String(body.length),
      },
      body,
    },
  );
  if (!r.ok) throw new Error(`gdrive upload ${r.status}: ${await r.text()}`);
  const j = (await r.json()) as { id: string };
  return j.id;
}

/** Ghi đè content của file đã có (giữ id, giữ tên). */
export async function updateFileContent(
  token: string, fileId: string, content: Buffer, mimeType: string,
): Promise<void> {
  const r = await fetch(
    `${UPLOAD_API}/files/${fileId}?uploadType=media`,
    {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": mimeType,
        "content-length": String(content.length),
      },
      // Node fetch chấp nhận Buffer; TS DOM lib lệch giữa server/client,
      // cast cứng để gọn (runtime an toàn).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      body: content as any,
    },
  );
  if (!r.ok) throw new Error(`gdrive update ${r.status}: ${await r.text()}`);
}

/** Xoá file (chuyển vào trash). */
export async function deleteFile(token: string, fileId: string): Promise<void> {
  const r = await fetch(`${DRIVE_API}/files/${fileId}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  });
  if (!r.ok && r.status !== 404) {
    throw new Error(`gdrive delete ${r.status}: ${await r.text()}`);
  }
}
