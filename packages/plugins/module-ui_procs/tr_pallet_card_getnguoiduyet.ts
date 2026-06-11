/* Port TR_PALLET_CARD_GETNGUOIDUYET — lấy thông tin người duyệt/người tạo
   + chi tiết hàng lỗi của thẻ pallet (chỉ áp dụng card_type = 'D').
   Nguồn: migration-plan/ui/proc-bodies/tr_pallet_card_getnguoiduyet.sql

   Đọc qua procTable (mapping cột vật lý từ meta.storage lúc runtime):
   - tr_pallet_card      → card_type theo card_no (CÓ trên prod).
   - tr_baocao_hangloi   → nguoiduyet/nguoitao/tinhtrang/nguyennhan/
                           huongxuly/bophanlamloi theo card_no (CÓ field-map).
   - trtb_m_location     → n_location theo c_location = bophanlamloi,
                           bỏ chuỗi "[Hoàn thành]" (CÓ field-map).
   - tr_tieuchuan_nguyennhan CHƯA migrate — proc gốc LEFT JOIN, không match
     thì rơi về nguyennhan (nhánh COALESCE 'Khác'); ở đây thử lookup, lỗi
     entity không tồn tại thì fallback nguyennhan y hệt nhánh đó.
   - tr_hinhanh + SYS_USER CHƯA migrate (SYS_USER.UserName không map sang
     bảng users framework) → tennguoiduyet/tennguoitao/chuky_* tạm trả null;
     bổ sung khi 2 bảng vào scope migrate. */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trPalletCardGetnguoiduyet(
  db: DB,
  companyId: string,
  args: {
    card_no: string;
  },
): Promise<
  Array<{
    card_type: string | null;
    tinhtrangloi: string | null;
    nguyennhanloi: string | null;
    tennguoitao: string | null;
    nguoitao: string | null;
    chuky_nguoitao: string | null;
    tennguoiduyet: string | null;
    nguoiduyet: string | null;
    chuky_nguoiduyet: string | null;
    huongxuly: string | null;
    bophanlamloi: string | null;
  }>
> {
  if (!args.card_no) throw new Error("Thiếu card_no");

  const asText = (v: unknown): string | null => (v == null ? null : String(v));

  // Bước 1: lấy card_type từ tr_pallet_card theo card_no
  const card = await procTable(db, companyId, "tr_pallet_card");
  const [cardRow] = await card.listWhere(sql`${card.text("card_no")} = ${args.card_no}`, {
    limit: 1,
  });
  const cardType = asText(cardRow?.card_type);

  // card_type != 'D' (kể cả không tìm thấy thẻ): proc gốc chỉ set
  // tennguoiduyet = NULL rồi SELECT các biến chưa gán → toàn null.
  if (cardType !== "D") {
    return [
      {
        card_type: cardType,
        tinhtrangloi: null,
        nguyennhanloi: null,
        tennguoitao: null,
        nguoitao: null,
        chuky_nguoitao: null,
        tennguoiduyet: null,
        nguoiduyet: null,
        chuky_nguoiduyet: null,
        huongxuly: null,
        bophanlamloi: null,
      },
    ];
  }

  // Bước 2 (card_type = 'D'): báo cáo hàng lỗi theo card_no
  const hangloi = await procTable(db, companyId, "tr_baocao_hangloi");
  const [loi] = await hangloi.listWhere(sql`${hangloi.text("card_no")} = ${args.card_no}`, {
    limit: 1,
  });

  // 2a. nguyennhanloi: proc gốc LEFT JOIN tr_tieuchuan_nguyennhan B ON
  //     nguyennhanloi = B.Id, rồi IIF(COALESCE(B.Name,'Khác')='Khác',
  //     nguyennhan, B.Name). Bảng chuẩn nguyên nhân chưa migrate → mọi
  //     lỗi lookup rơi về nguyennhan (đúng ngữ nghĩa nhánh 'Khác').
  let nguyennhanloi = asText(loi?.nguyennhan);
  if (loi?.nguyennhanloi != null) {
    try {
      const tieuchuan = await procTable(db, companyId, "tr_tieuchuan_nguyennhan");
      const [tc] = await tieuchuan.listWhere(
        sql`${tieuchuan.text("Id")} = ${String(loi.nguyennhanloi)}`,
        { limit: 1 },
      );
      const name = asText(tc?.Name);
      if (name && name !== "Khác") nguyennhanloi = name;
    } catch {
      // entity chưa tồn tại hoặc field "Id"/"Name" khác case — giữ fallback nguyennhan
    }
  }

  // 2b. bophanlamloi: LEFT JOIN trtb_m_location ON c_location = bophanlamloi
  //     → REPLACE(n_location, '[Hoàn thành]', ''). Không match → NULL
  //     (proc gốc lấy từ loc1.n_location, không phải mã thô).
  let bophanlamloi: string | null = null;
  if (loi?.bophanlamloi != null) {
    const loc = await procTable(db, companyId, "trtb_m_location");
    const [locRow] = await loc.listWhere(
      sql`${loc.text("c_location")} = ${String(loi.bophanlamloi)}`,
      { limit: 1 },
    );
    const nLocation = asText(locRow?.n_location);
    if (nLocation != null) bophanlamloi = nLocation.replaceAll("[Hoàn thành]", "");
  }

  return [
    {
      card_type: "D",
      tinhtrangloi: asText(loi?.tinhtrang),
      nguyennhanloi,
      // TODO: FullName từ SYS_USER + ảnh chữ ký từ tr_hinhanh (phanloai='USER',
      // name = UserName) — 2 bảng chưa migrate, bổ sung khi vào scope.
      tennguoitao: null,
      nguoitao: asText(loi?.nguoitao),
      chuky_nguoitao: null,
      tennguoiduyet: null,
      nguoiduyet: asText(loi?.nguoiduyet),
      chuky_nguoiduyet: null,
      huongxuly: asText(loi?.huongxuly),
      bophanlamloi,
    },
  ];
}
