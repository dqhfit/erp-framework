# Phân tích tính khả thi & cải tiến — Mục tiêu Sản xuất (DQHF → ERP)

> Nguồn: `bao-cao-muctieu-sanxuat.html` (DQHF · `tr_muctieu_sanxuat2`, **chỉ
> mức thưởng 1**, xuất 31/05/2026) + công thức port trong
> `packages/db/migrations/0060_mes_muctieu_sanxuat.sql` & `0061_mes_muctieu_fixes.sql`.
> Ngày phân tích: 2026-06-04. Mọi số liệu dưới đây rút trực tiếp từ báo cáo,
> không phải ước lượng.

---

## 0. Giải mã chỉ số (để đọc đúng phần sau)

Hàm `mes_muctieu_tinhtoan` (port 1:1 từ SP `TR_MUCTIEU_SANXUAT2_TINHTOAN`)
tính 25 cột `col1..col25`. Các cột then chốt:

| Cột | Tên báo cáo | Ý nghĩa |
|---|---|---|
| `col6`  | **TL MT** (tỉ lệ mục tiêu) | **Định mức**: M³ trên 8 giờ-công. User nhập tay cho mức thưởng 1. |
| `col15` | **TL thực tế** | M³ *sản xuất* / tổng giờ thực tế × 8. |
| `col17` | **TL HT** (tỉ lệ hoàn thành) | M³ *hoàn thành* / tổng giờ thực tế × 8 = **năng suất thực**. |
| `col18` | cờ **"Đạt"** | `'Dat'` khi `col17 ≥ col15` (xem Phát hiện #1). |
| `col19` | Số người TB | `col13 / so_ngay / 8`. |
| `col20` | Thưởng/người | **Nhập tay**. |
| `col21` | Tổng thưởng | `col20 × col19`. |
| `HSu%`  | Hiệu suất | Tỉ lệ giờ hữu ích / hiện diện (chỉ số phụ). |

**Kết luận khả thi (TL;DR):** cơ chế hiện tại **không tạo ra động lực năng
suất**. Bốn lỗi cộng dồn: (a) KPI "đạt mục tiêu" đo sai thứ; (b) định mức
đặt cao gấp ~2× thực tế nên bất khả thi; (c) thưởng không co giãn theo nỗ
lực; (d) thưởng dồn vào 2 bộ phận lớn. Cộng thêm dữ liệu bẩn (bộ phận ma +
trùng mã) làm méo mọi con số tổng hợp.

---

## 1. Sáu phát hiện cốt lõi

### 1.1. "Đạt mục tiêu" KHÔNG đo so với định mức

`col18 = 'Dat'` khi `col17 ≥ col15` — tức **khối hoàn thành ≥ khối sản
xuất**, KHÔNG phải `col17 ≥ col6` (đạt định mức). Bằng chứng: bộ phận DH06
năm 2025 có TL MT = 3.435 nhưng TL HT chỉ 0.522, vậy mà vẫn "3/6 ✓".

→ KPI nổi bật "**24/103 tháng-BP đạt mục tiêu**" trên đầu báo cáo **bị gán
nhãn sai**. Nó đo "phần sản xuất ra đã được hoàn thành/xuất đi" (một dạng kỷ
luật xuất hàng), chứ KHÔNG đo công nhân có đạt định mức năng suất hay không.
Lãnh đạo đọc con số này sẽ hiểu lầm hoàn toàn về hiệu quả.

### 1.2. Định mức đặt quá cao — bất khả thi triền miên

Đo khoảng cách thật = **TL HT / TL MT** (năng suất thực / định mức):

| Bộ phận | Mã | 2025 | 2026 |
|---|---|---:|---:|
| Đồng bộ định hình | DBDH | 57% | 78% |
| Đồng bộ định hình 1 | DH06 | **15%** | — |
| Định hình | DH07 | 45% | 89% |
| Bào, rong, cắt | DP01 | 33% | — |
| Nhám thùng | DP04 | 44% | — |
| Phôi 2 | DP09 | 82% | **122%** |
| Tồn kho phôi | DP99 | 48% | — |
| Lắp ráp | LR02 | 62% | 86% |
| Nguội | NHA01 | 67% | 79% |
| Phôi 1 | PHOI1 | 60% | 65% |

Năm 2025: median ~**50%** — định mức gấp đôi thực tế đạt được. DH06 tệ nhất:
định mức 3.435 trong khi thực đạt 0.522 (định mức gấp **6.5 lần**). Định mức
kiểu này không phải mục tiêu mà là con số "trên trời", công nhân biết không
thể với tới nên **buông**. Năm 2026 cải thiện rõ (45–122%) — dấu hiệu định
mức đã được hạ một phần về thực tế và/hoặc năng suất tăng; DP09 thậm chí
vượt định mức. Đây chính là bằng chứng *recalibrate định mức xuống mức khả
thi thì tỉ lệ đạt tăng ngay*.

### 1.3. Thưởng không co giãn theo nỗ lực

`col21 = col20 × col19` = (thưởng/người nhập tay) × (số người TB). **Mức
vượt định mức không xuất hiện trong công thức.** Vượt 1% hay 50% so với định
mức, trong cùng một bậc thưởng, mỗi người vẫn nhận như nhau. Biên động lực
(marginal incentive) gần như bằng 0 — không khuyến khích cố thêm.

### 1.4. Thưởng dồn vào 2 bộ phận lớn

Tổng thưởng 2025 = 603,988k. Phân bổ:

| Bộ phận | Thưởng (k) | % |
|---|---:|---:|
| Nguội (NHA01) | 344,681 | 57% |
| Phôi 2 (DP09) | 207,459 | 34% |
| Đồng bộ định hình 1 (DH06) | 45,532 | 8% |
| Định hình (DH07) | 6,316 | 1% |
| **9 bộ phận còn lại** | **0** | **0%** |

→ **91% thưởng vào 2 bộ phận** đông người / khối lượng lớn (NHA01 3,546 M³;
DP09 3,129 M³). Vì thưởng tỉ lệ số người (`col19`), bộ phận nhỏ dù đạt năng
suất cao vẫn gần như không có thưởng. Cơ chế thưởng theo **khối lượng tuyệt
đối**, không theo **hiệu quả tương đối** → bất công và lệch động lực.

### 1.5. Bậc thưởng 2–4 gần như chết

Báo cáo chỉ trình mức thưởng 1 (định mức thấp nhất) mà tỉ lệ "đạt" đã chỉ
23%. Các mức 2–4 cộng dồn `phantram_tang` (định mức cao hơn nữa) trên thực
tế **không bao giờ với tới**. Thang thưởng nhiều bậc trở thành trang trí.

### 1.6. Dữ liệu bẩn — bộ phận "ma" + trùng mã

**Bộ phận ma** (1 dòng, M³ rỗng, tên có đuôi "-"): `DH00` (Định hình -),
`LRAP` (Lắp ráp -), `PHOI2` (Phôi 2 -). Đây là rác do đổi mã.

**Trùng mã do đổi mã giữa kỳ** (cùng tên bộ phận, 2 mã khác nhau):

| Tên | Mã cũ | Mã mới |
|---|---|---|
| Đồng bộ định hình | DBDH | DH06 |
| Định hình | DH00 | DH07 |
| Phôi 2 | PHOI2 | DP09 |
| Lắp ráp | LRAP | LR02 |

→ "13 bộ phận" thực chất chỉ **~9–10**. Khi mã đổi, lịch sử bị **gãy làm
đôi**, đường xu hướng và trung bình tổng hợp đều sai. Mọi KPI tổng (số bộ
phận, tỉ lệ đạt) đều cần đọc với cảnh báo này.

**Kỷ luật nhập liệu lệch:** số tháng nhập (T.nhập) dao động 1–11; số
người-ngày TB từ 8 (DP99) tới 70 (NHA01). Nhiều bộ phận thiếu tháng → heatmap
rỗng và trung bình bị méo.

---

## 2. Đề xuất điều chỉnh vận hành (đòn bẩy năng suất)

Sáu đòn bẩy, ưu tiên từ trên xuống:

1. **Recalibrate định mức theo thực tế lăn.** Đặt định mức mới mỗi bộ phận =
   **phân vị p60–p75 của TL HT 6 tháng gần nhất** (stretch nhưng với tới),
   thay con số tham vọng tĩnh. Mục tiêu: tỉ lệ đạt định mức thật về vùng
   40–60% (đủ thách thức, đủ khả thi). 2026 đã cho thấy hạ định mức → đạt
   tăng.

2. **Sửa định nghĩa "Đạt".** Đạt mục tiêu = `TL HT ≥ định mức` (`col17 ≥
   col6`). Tách "hoàn thành/xuất khối" (`col17` vs `col15`) thành một **chỉ
   số chất lượng riêng**, không gộp vào KPI năng suất. Báo cáo phải hiển thị
   2 chỉ số khác nhau, không trộn.

3. **Thưởng biên co giãn.** Thưởng theo **M³ vượt định mức** (đơn giá ×
   khối lượng vượt), thay flat `col20 × col19`. Giữ một **mức sàn** cho bộ
   phận vừa chạm định mức để bộ phận nhỏ không bị bỏ rơi. Công thức gợi ý:
   `thưởng = sàn×đạt_định_mức + đơn_giá_vượt × max(0, M³HT − M³định_mức)`.

4. **Thiết kế lại bậc thưởng cho "với tới".** `phantram_tang` nên là bước
   nhỏ (+10/+20/+30%) gắn với band đạt-tỉ-lệ thực tế, để mức 2–4 thực sự đạt
   được và tạo lộ trình leo bậc.

5. **Surface chỉ số dẫn (leading).** TL HT là chỉ số trễ (cuối tháng mới
   biết). Đưa `gio_canbu` (giờ cần bù lũy kế) và `so_nguoi_hiendien` (hiện
   diện HC/TC) lên làm **cảnh báo sớm trong tháng**, để quản đốc can thiệp
   kịp thay vì biết kết quả khi đã muộn.

6. **Vệ sinh dữ liệu.** (a) Bảng ánh xạ mã cũ→mới để gộp lịch sử (DBDH→DH06…);
   (b) loại/đánh dấu bộ phận ma (DH00/LRAP/PHOI2); (c) **completeness check**
   ép nhập đủ ngày làm việc, cảnh báo bộ phận thiếu tháng.

---

## 3. Hàm ý thiết kế module ERP (`mes_muctieu_sanxuat*`)

Tận dụng đợt port DQHF để sửa nợ kỹ thuật gốc, đừng bê nguyên lỗi WinForm:

1. **Bỏ `col1..col25` mờ nghĩa → cột đặt tên + tài liệu hoá.** 25 cột số thứ
   tự là cơn ác mộng bảo trì (đã có bug `col3` đọc `col1` cũ, fix ở `0061`).
   Đặt tên ngữ nghĩa: `dinhmuc_m3_8h`, `nangsuat_thuc`, `dat_dinhmuc` (bool)…

2. **Bảng định mức có version.** `mes_muctieu_dinhmuc(company_id, ma_bo_phan,
   effective_from, effective_to, dinhmuc, nguon)` với `nguon` ∈
   `manual | auto_calib`. Recalibrate trở thành thêm 1 dòng version, có
   audit — không ghi đè mất lịch sử. Hàm tính đọc định mức **theo hiệu lực
   ngày** thay vì 1 con số cứng trong header.

3. **Engine quy tắc thưởng cấu hình.** Thay hardcode `col20×col19` bằng công
   thức cấu hình được (sàn + biên vượt + bậc). Số thưởng là dữ liệu nhạy cảm
   → áp **field-level RBAC** (`fieldCan`, xem CLAUDE.md §4) để chỉ vai trò
   phù hợp xem/sửa.

4. **Master bộ phận + ánh xạ/gộp mã.** Một bảng bộ phận chuẩn, đổi mã = thêm
   alias trỏ về cùng entity, chặn bộ phận ma từ gốc (validate khi nhập).

5. **Endpoint analytics + dashboard động** thay HTML tĩnh. Tái dùng
   **DataSource ORM** (join nhiều entity, chart groupBy — xem
   `project_datasource_orm` trong memory) để báo cáo tự cập nhật; phần "nhận
   định tự động" dùng pattern enrich AI **fail-safe** (CLAUDE.md §6 — LLM
   lỗi không vỡ báo cáo).

6. **Completeness/quality check** ngay trong luồng nhập liệu hằng ngày
   (cảnh báo bộ phận thiếu ngày, số liệu bất thường).

---

## 4. Phạm vi triển khai

| Đợt | Nội dung | Trạng thái |
|---|---|---|
| **Ngay** | Tài liệu này (D1) + nâng cấp `bao-cao-muctieu-sanxuat.html` (D2: section nhận định, cột "Đạt ĐM thật", badge cảnh báo, đánh dấu BP ma, sửa nhãn KPI/legend) | An toàn, không đụng schema/runtime |
| **Sau** | Code module (D3: bảng định mức version, engine thưởng, master bộ phận, dashboard động) | Chờ chốt hướng |

---

## Phụ lục — Số liệu tổng hợp đầy đủ (13 bộ phận × 2025–2026)

`TL MT` = định mức M³/8h · `TL HT` = năng suất thực · `Đạt ĐM` = TL HT/TL MT.
Dòng *in nghiêng* = bộ phận ma (dữ liệu rác).

| Bộ phận | Mã | Năm | T.nhập | TL MT | TL HT | Đạt ĐM | M³ HT | Giờ TT | Đạt (cũ) | Thưởng (k) |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Đồng bộ định hình | DBDH | 2025 | 2 | 0.127 | 0.072 | 57% | 239 | 26.5k | 0/2 | — |
| Đồng bộ định hình | DBDH | 2026 | 5 | 0.130 | 0.101 | 78% | 834 | 65.7k | 1/5 | — |
| *Định hình -* | *DH00* | *2025* | *1* | *0.450* | *—* | *—* | *—* | *0.4k* | *0/1* | *—* |
| Đồng bộ định hình 1 | DH06 | 2025 | 6 | 3.435 | 0.522 | 15% | 1549 | 26.9k | 3/6 | 45,532 |
| Định hình | DH07 | 2025 | 11 | 0.406 | 0.183 | 45% | 1321 | 52.8k | 2/11 | 6,316 |
| Định hình | DH07 | 2026 | 5 | 0.300 | 0.266 | 89% | 701 | 21.6k | 1/5 | — |
| Bào, rong, cắt | DP01 | 2025 | 7 | 0.957 | 0.311 | 33% | 800 | 28.4k | 2/7 | — |
| Nhám thùng | DP04 | 2025 | 6 | 1.267 | 0.559 | 44% | 1147 | 19.1k | 1/6 | — |
| Phôi 2 | DP09 | 2025 | 10 | 0.312 | 0.255 | 82% | 3129 | 107.8k | 1/10 | 207,459 |
| Phôi 2 | DP09 | 2026 | 5 | 0.330 | 0.402 | 122% | 745 | 14.5k | 4/5 | — |
| Tồn kho phôi | DP99 | 2025 | 6 | 2.738 | 1.306 | 48% | 1550 | 9.5k | 0/6 | — |
| Lắp ráp | LR02 | 2025 | 7 | 0.363 | 0.225 | 62% | 978 | 36.9k | 2/7 | — |
| Lắp ráp | LR02 | 2026 | 5 | 0.290 | 0.248 | 86% | 761 | 23.9k | 2/5 | — |
| *Lắp ráp -* | *LRAP* | *2025* | *1* | *—* | *—* | *—* | *—* | *0.2k* | *0/1* | *—* |
| Nguội | NHA01 | 2025 | 11 | 0.376 | 0.253 | 67% | 3546 | 159.6k | 3/11 | 344,681 |
| Nguội | NHA01 | 2026 | 5 | 0.600 | 0.474 | 79% | 770 | 12.7k | 1/5 | — |
| Phôi 1 | PHOI1 | 2025 | 4 | 0.392 | 0.236 | 60% | 378 | 12.9k | 1/4 | — |
| Phôi 1 | PHOI1 | 2026 | 5 | 0.380 | 0.248 | 65% | 311 | 10.0k | 0/5 | — |
| *Phôi 2 -* | *PHOI2* | *2025* | *1* | *0.400* | *—* | *—* | *—* | *0.3k* | *0/1* | *—* |
