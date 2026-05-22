# So sánh chức năng — ERP Framework vs Activepieces vs Paperclip

Rà soát sau khi hoàn tất P1–P6 + R1–R9. So với hai sản phẩm mã nguồn mở
cùng "họ low-code / AI orchestration".

## 1. Định vị — ba sản phẩm khác hạng mục

| Sản phẩm | Là gì | Lõi |
|----------|-------|-----|
| **ERP Framework** (dự án này) | Bộ dựng ứng dụng ERP low-code | Dữ liệu (Entity) + Giao diện (Page) + Tự động hoá (Workflow) + Agent |
| **Activepieces** | Công cụ tự động hoá no-code (kiểu Zapier) | Flow: trigger → action, hệ "pieces" |
| **Paperclip** | Điều phối "công ty AI" — quản lý đội agent | Org chart + goal + budget + governance + heartbeat |

Khác hạng mục: Activepieces **chỉ** tự động hoá; Paperclip **chỉ** điều phối
agent; ERP Framework là **bộ dựng app** (có cả tầng dữ liệu + UI) — phủ rộng
hơn nhưng nông hơn ở mỗi mảng chuyên biệt.

## 2. Bảng đối chiếu

| Chức năng | ERP Framework | Activepieces | Paperclip |
|-----------|:---:|:---:|:---:|
| Mô hình dữ liệu / entity + record | ✅ | ❌ | ⚪ (issue/ticket) |
| Trình dựng giao diện (page/widget) | ✅ | ❌ | ❌ |
| Workflow trực quan (kéo-thả) | ✅ | ✅ | ❌ (không phải workflow builder) |
| Thực thi workflow + lịch sử run | ✅ | ✅ | ✅ (heartbeat run) |
| Lịch cron / routine | ✅ pg-boss | ✅ | ✅ |
| Agent AI + gọi tool | ✅ (chat + MCP) | ✅ (AI pieces/agents) | ✅ (đội agent tự chạy) |
| Plugin / mở rộng | ✅ SDK 5 loại | ✅ "pieces" (npm) | ✅ plugin out-of-process |
| Self-host / Docker | ✅ 4 service | ✅ | ✅ embedded PG |
| RBAC / phân quyền | ✅ | ✅ enterprise | ✅ governance |
| Nhật ký hoạt động | ✅ activity_log | ✅ debugging runs | ✅ activity & events |
| CI + e2e | ✅ | ✅ | ✅ |
| **Hệ sinh thái tích hợp publish sẵn** | ❌ | ✅ (npm, 60% cộng đồng) | ⚪ awesome-list |
| **Versioning / publish bản workflow** | ❌ | ✅ | ⚪ config revision |
| **Nhúng builder vào sản phẩm khác** | ❌ | ✅ embedding | ❌ |
| **Org chart / phân cấp agent** | ❌ | ❌ | ✅ |
| **Ngân sách + chặn cứng chi phí agent** | ⚪ chỉ đếm token | ❌ | ✅ hard-stop |
| **Heartbeat — agent tự thức dậy 24/7** | ❌ | ❌ | ✅ |
| **Cổng phê duyệt / governance nhiều tầng** | ⚪ node "approval" | ⚪ human-in-loop piece | ✅ board approval |
| **Đa công ty / multi-tenant** | ❌ single-tenant | ✅ projects | ✅ multi-company |
| **Xuất/nhập trọn tổ chức (portability)** | ❌ | ✅ template flows | ✅ company export/import |

(✅ có · ⚪ một phần · ❌ chưa)

## 3. ERP Framework — hơn & thiếu

**Hơn Activepieces:** có tầng **dữ liệu** (entity + record + validate-on-write)
và **trình dựng giao diện** — Activepieces không phải app builder, chỉ nối
API. Dự án này dựng được cả một ứng dụng nghiệp vụ, không chỉ luồng tự động.

**Hơn Paperclip:** có workflow builder trực quan và mô hình dữ liệu/UI —
Paperclip cố tình KHÔNG làm hai thứ này (chỉ điều phối agent).

**Thiếu so với Activepieces:** hệ sinh thái tích hợp publish sẵn (pieces trên
npm, cộng đồng đóng góp), versioning + publish bản workflow, UI debug từng
run chi tiết, khả năng **nhúng** builder vào sản phẩm khác, hot-reload khi
phát triển plugin.

**Thiếu so với Paperclip:** org chart / phân cấp agent, ngân sách agent có
**chặn cứng** (hiện chỉ đếm token, không dừng), **heartbeat** (agent tự chạy
nền theo lịch, không cần người kích), governance nhiều tầng (mới có node
approval trong workflow, chưa có phê duyệt cấp tổ chức), **đa công ty**, và
xuất/nhập trọn tổ chức.

## 4. Ý tưởng đáng học (ưu tiên)

Từ **Activepieces:**
- **Versioning + publish workflow** — tách bản nháp / bản đang chạy; rollback.
- **UI debug run** — xem dữ liệu vào/ra từng node của một lần chạy (hiện
  WorkflowRunPanel chỉ liệt kê step, chưa soi được payload).
- **Plugin loader hot-reload + publish lên npm** — nâng hệ plugin hiện tại
  (đang import tĩnh trong `src/plugins/`) thành nạp gói ngoài.

Từ **Paperclip:**
- **Ngân sách có hard-stop** — đã đếm token ở `activity_log`; thêm hạn mức +
  tự dừng workflow/agent khi vượt là bước ngắn, giá trị cao.
- **Heartbeat** — agent tự thức dậy theo lịch và hành động (khác cron chạy
  workflow): hợp với hướng "agent nền".
- **Đa công ty / multi-tenant** — hiện single-tenant; thêm `companyId` vào
  các bảng + scope RBAC là thay đổi lớn nhưng mở ra dùng nhiều khách.
- **Xuất/nhập trọn cấu hình** (entity + page + workflow + agent + plugin) —
  giống "company template" của Paperclip; hữu ích để chia sẻ "ERP mẫu".

## 5. Kết luận

ERP Framework đang ở vị trí **bộ dựng app low-code** hoàn chỉnh đúng nghĩa:
dữ liệu + UI + tự động hoá + agent, self-host, plugin, CI/e2e. So với hai
sản phẩm tham chiếu, nó **rộng hơn** (cả hai kia đều chuyên một mảng) nhưng
**nông hơn** ở mảng chuyên biệt của mỗi bên. Khoảng cách đáng kể nhất, theo
thứ tự giá trị/chi phí: (1) ngân sách hard-stop, (2) versioning workflow +
debug run, (3) xuất/nhập cấu hình, (4) multi-tenant (lớn, làm khi cần bán
nhiều khách).
