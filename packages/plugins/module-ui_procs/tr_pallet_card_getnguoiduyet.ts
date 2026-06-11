import { sql } from "drizzle-orm";
import type { DB } from "@erp-framework/server/db";

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

  // Bước 1: lấy card_type từ bảng thật tr_pallet_card
  type CardRow = { card_type: string | null };
  const cardRows = await db.execute<CardRow>(sql`
    SELECT card_type
    FROM tr_pallet_card
    WHERE company_id = ${companyId}
      AND card_no   = ${args.card_no}
      AND deleted_at IS NULL
    LIMIT 1
  `);

  const card = (cardRows as unknown as CardRow[])[0];
  if (!card) return [];

  const cardType = card.card_type;

  // card_type != 'D': proc gốc gán tennguoiduyet = NULL, trả ngay
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

  // Bước 2 (card_type = 'D'): lấy thông tin hàng lỗi + chữ ký người duyệt/người tạo
  //
  // TODO: tr_baocao_hangloi CHƯA có trong mapping bảng.
  //       Proc gốc: SELECT nguoiduyet, nguoitao, tinhtrang, nguyennhan, huongxuly, bophanlamloi
  //                 FROM tr_baocao_hangloi WHERE card_no = @card_no
  //       JOIN tr_tieuchuan_nguyennhan B ON nguyennhanloi = B.Id
  //            → IIF(COALESCE(B.Name,'Khác')='Khác', nguyennhan, B.Name) AS nguyennhanloi
  //       JOIN trtb_m_location loc1 ON bophanlamloi = loc1.c_location
  //            → REPLACE(loc1.n_location, '[Hoàn thành]', '') AS bophanlamloi
  //
  // TODO: tr_hinhanh + SYS_USER CHƯA có trong mapping.
  //       Proc gốc lấy FullName + hinhanh (varbinary/ảnh chữ ký) cho cả nguoiduyet lẫn nguoitao:
  //         SELECT B.FullName, A.hinhanh
  //         FROM tr_hinhanh A RIGHT JOIN SYS_USER B ON A.name = B.UserName
  //         WHERE A.phanloai = 'USER' AND B.UserName = @nguoiduyet1 / @nguoitao1
  //       Trong PG: SYS_USER tương ứng bảng users (cột full_name/username), tr_hinhanh chưa rõ.
  //       chuky_nguoiduyet/chuky_nguoitao là binary (ảnh) → kiểu PG bytea hoặc text base64.
  //
  // Khi mapping được bổ sung, thay các null dưới đây bằng query thực tế.

  return [
    {
      card_type: "D",
      tinhtrangloi: null, // TODO: tr_baocao_hangloi.tinhtrang WHERE card_no = args.card_no
      nguyennhanloi: null, // TODO: IIF(tieuchuan.Name='Khác', nguyennhan, tieuchuan.Name)
      tennguoitao: null, // TODO: SYS_USER.FullName cho nguoitao của tr_baocao_hangloi
      nguoitao: null, // TODO: tr_baocao_hangloi.nguoitao
      chuky_nguoitao: null, // TODO: tr_hinhanh.hinhanh (base64/bytea) cho nguoitao
      tennguoiduyet: null, // TODO: SYS_USER.FullName cho nguoiduyet của tr_baocao_hangloi
      nguoiduyet: null, // TODO: tr_baocao_hangloi.nguoiduyet
      chuky_nguoiduyet: null, // TODO: tr_hinhanh.hinhanh (base64/bytea) cho nguoiduyet
      huongxuly: null, // TODO: tr_baocao_hangloi.huongxuly
      bophanlamloi: null, // TODO: REPLACE(trtb_m_location.n_location,'[Hoàn thành]','')
    },
  ];
}
