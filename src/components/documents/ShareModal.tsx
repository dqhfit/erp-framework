/* ShareModal — modal phân quyền tài liệu.
   Phần A: chọn visibility (private / company / public).
   Phần B: thêm user/nhóm cụ thể (hoạt động song song với visibility nền). */
import { createKnowledgeClient, type KnowledgeSource } from "@erp-framework/client";
import { useEffect, useRef, useState } from "react";
import { I } from "@/components/Icons";
import { Button, Modal } from "@/components/ui";
import { dialog } from "@/lib/dialog";

const kb = createKnowledgeClient("");

type Visibility = "private" | "restricted" | "company" | "public";

interface AclState {
  visibility: Visibility;
  groupIds: string[];
  userIds: string[];
  shareToken: string | null;
}

interface Props {
  source: KnowledgeSource;
  onClose: () => void;
}

const VISIBILITY_OPTIONS: { value: Visibility; label: string; desc: string; icon: string }[] = [
  { value: "private", label: "Chỉ mình tôi", desc: "Chỉ người tạo xem được", icon: "🔒" },
  {
    value: "company",
    label: "Toàn công ty",
    desc: "Mọi thành viên trong công ty",
    icon: "🏢",
  },
  {
    value: "public",
    label: "Link công khai",
    desc: "Bất kỳ ai có link đều xem được",
    icon: "🌐",
  },
];

export function ShareModal({ source, onClose }: Props) {
  const [acl, setAcl] = useState<AclState>({
    visibility: (source.visibility as Visibility) ?? "company",
    groupIds: [],
    userIds: [],
    shareToken: source.shareToken ?? null,
  });
  const [saving, setSaving] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [generatingLink, setGeneratingLink] = useState(false);
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    void kb.getAcl(source.id).then((a) => {
      setAcl((prev) => ({
        ...prev,
        visibility: (a.visibility as Visibility) ?? "company",
        groupIds: a.groupIds ?? [],
        userIds: a.userIds ?? [],
      }));
    });
  }, [source.id]);

  const shareUrl = acl.shareToken ? `${window.location.origin}/share/${acl.shareToken}` : null;

  const handleVisibilityChange = (v: Visibility) => {
    setAcl((prev) => ({ ...prev, visibility: v }));
  };

  const handleGenerateLink = async () => {
    setGeneratingLink(true);
    try {
      const result = await kb.generateShareLink(source.id);
      const token = (result as { token: string }).token;
      setAcl((prev) => ({ ...prev, visibility: "public", shareToken: token }));
    } catch (e) {
      void dialog.alert(`Lỗi: ${(e as Error).message}`);
    } finally {
      setGeneratingLink(false);
    }
  };

  const handleRevokeLink = async () => {
    const ok = await dialog.confirm("Thu hồi link chia sẻ? Link cũ sẽ không còn hoạt động.");
    if (!ok) return;
    await kb.revokeShareLink(source.id);
    setAcl((prev) => ({ ...prev, visibility: "company", shareToken: null }));
  };

  const handleCopyLink = async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await kb.setAcl({
        id: source.id,
        visibility: acl.visibility,
        groupIds: acl.groupIds,
        userIds: acl.userIds,
      });
      onClose();
    } catch (e) {
      void dialog.alert(`Lưu thất bại: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const selectedVis = acl.visibility === "restricted" ? "private" : acl.visibility;

  return (
    <Modal open title={`Chia sẻ: ${source.title}`} onClose={onClose}>
      <div className="space-y-5 min-w-[400px]">
        {/* Phần A: Visibility nền */}
        <div>
          <div className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">
            Ai có thể xem?
          </div>
          <div className="space-y-1">
            {VISIBILITY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => handleVisibilityChange(opt.value)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
                  selectedVis === opt.value
                    ? "bg-accent/15 border border-accent text-text"
                    : "hover:bg-hover text-text border border-transparent"
                }`}
              >
                <span className="text-lg leading-none">{opt.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{opt.label}</div>
                  <div className="text-xs text-muted">{opt.desc}</div>
                </div>
                {selectedVis === opt.value && (
                  <I.Check size={14} className="text-accent flex-shrink-0" />
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Link công khai */}
        {(selectedVis === "public" || acl.visibility === "public") && (
          <div className="bg-panel rounded-lg p-3 space-y-2">
            <div className="text-xs font-semibold text-muted uppercase tracking-wide">
              Link chia sẻ
            </div>
            {shareUrl ? (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={shareUrl}
                    className="input flex-1 text-xs"
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <Button size="sm" onClick={handleCopyLink}>
                    {linkCopied ? <I.Check size={14} /> : <I.Copy size={14} />}
                    {linkCopied ? "Đã copy" : "Copy"}
                  </Button>
                </div>
                <button
                  type="button"
                  onClick={handleRevokeLink}
                  className="text-xs text-danger hover:underline"
                >
                  Thu hồi link
                </button>
              </div>
            ) : (
              <Button size="sm" onClick={handleGenerateLink} disabled={generatingLink}>
                {generatingLink ? "Đang tạo..." : "Tạo link chia sẻ"}
              </Button>
            )}
          </div>
        )}

        {/* Phần B: Người/nhóm cụ thể */}
        <div>
          <div className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">
            Chia sẻ với người cụ thể
          </div>
          <div className="text-xs text-muted mb-2">
            Người được thêm vào đây có thể xem file bất kể cài đặt ở trên.
          </div>
          {acl.userIds.length === 0 && acl.groupIds.length === 0 ? (
            <div className="text-xs text-muted italic">Chưa chia sẻ với ai cụ thể.</div>
          ) : (
            <div className="space-y-1 mb-2">
              {acl.userIds.map((uid) => (
                <div key={uid} className="flex items-center gap-2 text-sm">
                  <I.User size={13} className="text-muted" />
                  <span className="flex-1 text-muted">{uid.slice(0, 8)}…</span>
                  <button
                    type="button"
                    onClick={() =>
                      setAcl((prev) => ({
                        ...prev,
                        userIds: prev.userIds.filter((id) => id !== uid),
                      }))
                    }
                    className="text-danger hover:opacity-70"
                  >
                    <I.X size={13} />
                  </button>
                </div>
              ))}
              {acl.groupIds.map((gid) => (
                <div key={gid} className="flex items-center gap-2 text-sm">
                  <I.Users size={13} className="text-muted" />
                  <span className="flex-1 text-muted">{gid.slice(0, 8)}…</span>
                  <button
                    type="button"
                    onClick={() =>
                      setAcl((prev) => ({
                        ...prev,
                        groupIds: prev.groupIds.filter((id) => id !== gid),
                      }))
                    }
                    className="text-danger hover:opacity-70"
                  >
                    <I.X size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="text-xs text-muted">
            (Quản lý user/nhóm chi tiết từ trang Tri thức → biểu tượng khoá.)
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1 border-t border-border">
          <Button variant="ghost" onClick={onClose}>
            Huỷ
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Đang lưu..." : "Lưu"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
