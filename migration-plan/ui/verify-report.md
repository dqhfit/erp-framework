# Verify runtime proc Tier D đọc — golden MSSQL vs port PG (prod)

Ngày chạy xem git log. Kết quả: **6 PASS / 7 FAIL / 2 ERROR** trên 15 case.

LƯU Ý: data PG là mirror (sync lag 15ph core / 2h heavy) — FAIL về số
row/giá trị có thể do DATA DRIFT tại thời điểm chạy, cần xét từng case.

| Proc | Case | KQ | Chi tiết |
|---|---|---|---|
| TR_ORDER_ISLOCK | is_lock=false | FAIL | rowCount lệch: MSSQL=1022 PG=0 |
| TR_ORDER_ISLOCK | is_lock=true | FAIL | rowCount lệch: MSSQL=1212 PG=0 |
| TR_DINHMUC_GOVAN_M3TOTAL | masp=YT004_BB001_YF | PASS | 3 row khớp (subset-match) |
| TINHGIA_NGUYENLIEU_GVA | masp=YT004_BB001_YF | FAIL | tongdongia_vnd: MSSQL=1417537.26 PG=0 ✗; tongkhoitinhche: MSSQL=0.12377 PG=0.12375381399999995 ✓ |
| TINHGIA_NGUYENLIEU_GVA2 | masp=YT004_BB001_YF | FAIL | tongdongia_vnd: MSSQL=1417537.26 PG=0 ✗; tongkhoitinhche: MSSQL=0.12377 PG=0.123753814 ✓ |
| TINHGIA_NGUYENLIEU_DGO | masp=YT004_BB001_YF | PASS | tongdonagia_vnd: MSSQL=71458 PG=71458 ✓ |
| TINHGIA_NGUYENLIEU_NKI | masp=YT004_BB001_YF | PASS | tongdonagia_vnd: MSSQL=360745 PG=360745 ✓ |
| TR_DINHMUC_NGUKIM_TOTALMAVT | masp=YT004_BB001_YF | PASS | 15 row khớp (subset-match) |
| TINHGIA_NGUYENLIEU_SON | masp=TS-FRVAWH_VAN001/VAT002_PKD | FAIL | tongdongia_sanpham: MSSQL=613816.33 PG=745423.1781116021 ✗; tongdongia_metvuong: MSSQL=158840.41 PG=201034.3470670391 ✗ |
| TR_LENHCAPPHAT_SUMBYMACT | lcp=LCP31122405 | FAIL | 5/5 row golden không tìm thấy bên PG; vd ["LCP31122405","NKI","AI","SPO-121.24-AURA BEDROOM","NBOVA0022","Bulon trục 2 đầu ren/ Hệ Mét, Đường kính 8","90","7 màu"] |
| TR_DINHMUC_LOCK_GET2 | masp_nhamay=SPA06-ST | FAIL | 1/1 row golden không tìm thấy bên PG; vd ["6F7C8A64-5303-489C-BA33-FF6DAA62C1B0","SPA06-ST_SPA001_ATE","NKI","false","2026-06-08","yenlinh"] |
| TR_PALLET_CARD_GETNGUOIDUYET | card=PCM26061109060280001 | PASS | 1 row khớp (subset-match) |
| TR_BAOCAO_CHUYENSON_GETDATA | ngay=2026-06-12 | ERROR | PG: Failed query: 
    SELECT
      "f_congdoan"::text AS congdoan,
      "f_madonhang"::text AS donhang,
      "f_masp1"::text AS masp,
      "f_mact"::text AS mact,
      "f_tenct"::text AS tenct,
      "f_dayy" AS dayy,
      "f_rong" AS rong,
      "f_dai" AS dai,
      SUM("f_soluong") AS soluong
    FROM "tr_trangthai_sanxuat"
    WHERE company_id = $1::uuid AND deleted_at IS NULL
      AND (nullif("f_ngaythang"::text, '')::timestamptz)::date = $2::date
      AND "f_congdoan"::text IN ($3, $4, $5, $6, $7, $8)
    GROUP BY "f_congdoan"::text, "f_madonhang"::text, "f_masp1"::text,
      "f_mact"::text, "f_tenct"::text, "f_dayy", "f_rong", "f_dai"
  
params: 00000000-0000-0000-0000-000000000001,2026-06-12,SON01-PROD,SCT01-PROD,SCT1-PROD,DG01-PROD,DG02-PROD,UV03-PROD |
| TR_DONDATHANG_SUMBYYEAR | year=2026 | ERROR | PG: Failed query: 
    SELECT
      "f_maddh"::text AS maddh,
      "f_loaiddh"::text AS loaiddh,
      "f_mancc"::text AS mancc,
      "f_tenncc"::text AS tenncc,
      "f_create_by"::text AS create_by,
      EXTRACT(MONTH FROM nullif("f_ngaydat"::text, '')::timestamptz)::int AS thang
    FROM "tr_dondathang"
    WHERE company_id = $1::uuid AND deleted_at IS NULL
      AND "f_active" = true
      AND nullif("f_pheduyet"::text, '')::boolean = true
      AND EXTRACT(YEAR FROM nullif("f_ngaydat"::text, '')::timestamptz) = $2
  
params: 00000000-0000-0000-0000-000000000001,2026 |
| TR_TINHGIA_BY_DDH | ddh=RAY-33361 | PASS | cả 2 rỗng (0 row) |