-- 0061_mes_muctieu_fixes.sql
-- Fix 3 loi trong module mes_muctieu_sanxuat:
--
-- [1] col3 sai: SET col1=..., col3=col1+col2 trong cung 1 UPDATE ->
--     PostgreSQL doc ban col1 cu, khong phai vua tinh.
--     Sua bang inline lai cong thuc.
--
-- [2] gio_canbu window function thieu PARTITION BY -> nguy co cross-row
--     neu query plan khong dung. Them PARTITION BY company_id, ma_cong_doan.
--
-- [3] day_name la text thuong -> co the NULL hoac sai neu code bo qua.
--     Doi thanh GENERATED ALWAYS AS -> dam bao nhat quan, khong can set.
--
-- Idempotent: CREATE OR REPLACE FUNCTION + ALTER TABLE kiem tra truoc.

-- ── [3] day_name: doi sang generated column ──────────────────────────────────
-- Xoa cot cu (stored text) va them lai dang generated stored.
-- DROP + ADD trong 1 ALTER thi atomic.
ALTER TABLE mes_muctieu_sanxuat_chitiet
  DROP COLUMN IF EXISTS day_name,
  ADD COLUMN day_name TEXT GENERATED ALWAYS AS (
    CASE EXTRACT(DOW FROM ngaythang)::int
      WHEN 0 THEN 'Sun'
      WHEN 1 THEN 'Mon'
      WHEN 2 THEN 'Tue'
      WHEN 3 THEN 'Wed'
      WHEN 4 THEN 'Thu'
      WHEN 5 THEN 'Fri'
      ELSE       'Sat'
    END
  ) STORED;

-- ── [1] + [2] Sua lai ham mes_muctieu_tinhtoan ────────────────────────────────
CREATE OR REPLACE FUNCTION mes_muctieu_tinhtoan(
  p_company_id  uuid,
  p_nam         int,
  p_thang       int,
  p_mabophan    text
) RETURNS void
LANGUAGE plpgsql AS
$$
DECLARE
  v_songay_lamviec   int;
  v_muctieu_tonggio  float8;
  v_songuoi          int;
  v_cont_rap         float8;
  v_tile_muc1        float8;
  v_gio_mt_hc        float8;
  v_tonggio_thucte   float8;
  v_sokhoi_mt1_hc    float8;
  v_sokhoi_tc        float8;
  v_tonggio_mt_kt1   float8;
  v_tongsokhoi_tt    float8;
  v_sokhoi_hoanthanh float8;
  v_cont_roi_ht      float8;
  v_cont_rap_ht      float8;
BEGIN
  -- 1. So ngay lam viec (co nhap gio MT) + tong gio MT (co TC)
  SELECT COUNT(*)::int, COALESCE(SUM(muc_tieu_tonggio), 0)
  INTO   v_songay_lamviec, v_muctieu_tonggio
  FROM   mes_muctieu_sanxuat_chitiet
  WHERE  company_id   = p_company_id
    AND  ma_cong_doan = p_mabophan
    AND  EXTRACT(YEAR  FROM ngaythang) = p_nam
    AND  EXTRACT(MONTH FROM ngaythang) = p_thang
    AND  muc_tieu_so_gio > 0;

  -- 2. Thong so header muc_thuong = 1 (user input)
  SELECT so_nguoi, col2, col6
  INTO   v_songuoi, v_cont_rap, v_tile_muc1
  FROM   mes_muctieu_sanxuat_thang
  WHERE  company_id = p_company_id
    AND  nam        = p_nam
    AND  thang      = p_thang
    AND  ma_bo_phan = p_mabophan
    AND  muc_thuong = 1;

  IF NOT FOUND THEN RETURN; END IF;
  v_tile_muc1 := COALESCE(v_tile_muc1, 0);
  v_cont_rap  := COALESCE(v_cont_rap,  0);

  -- 3. Tong gio MT-HC + tong gio thuc te
  SELECT COALESCE(SUM(muc_tieu_tonggio_hc), 0),
         COALESCE(SUM(tonggio), 0)
  INTO   v_gio_mt_hc, v_tonggio_thucte
  FROM   mes_muctieu_sanxuat_chitiet
  WHERE  company_id   = p_company_id
    AND  ma_cong_doan = p_mabophan
    AND  EXTRACT(YEAR  FROM ngaythang) = p_nam
    AND  EXTRACT(MONTH FROM ngaythang) = p_thang;

  -- 4. So khoi MT muc 1 khong TC
  v_sokhoi_mt1_hc := (v_tile_muc1 / 8.0) * v_gio_mt_hc;

  -- 5a. Cap nhat header: so_ngay, col4, col5, col10, col13
  UPDATE mes_muctieu_sanxuat_thang
  SET so_ngay    = v_songay_lamviec,
      col4       = v_gio_mt_hc,
      col10      = v_muctieu_tonggio,
      col13      = v_tonggio_thucte,
      col5       = CASE muc_thuong
                     WHEN 1 THEN v_sokhoi_mt1_hc
                     ELSE        v_sokhoi_mt1_hc + (phantram_tang * v_sokhoi_mt1_hc) / 100.0
                   END,
      updated_at = now()
  WHERE company_id = p_company_id
    AND nam        = p_nam
    AND thang      = p_thang
    AND ma_bo_phan = p_mabophan;

  -- 5b. col11 = col10 * (col5 / col4)
  UPDATE mes_muctieu_sanxuat_thang
  SET col11 = CASE WHEN col4 = 0 THEN 0 ELSE col10 * (col5 / col4) END
  WHERE company_id = p_company_id
    AND nam = p_nam AND thang = p_thang AND ma_bo_phan = p_mabophan;

  -- 5c. col6: giu nguyen cho muc 1, tinh lai cho muc > 1
  UPDATE mes_muctieu_sanxuat_thang
  SET col6 = CASE muc_thuong
               WHEN 1 THEN col6
               ELSE CASE WHEN col4 = 0 THEN 0 ELSE col5 / col4 * 8.0 END
             END
  WHERE company_id = p_company_id
    AND nam = p_nam AND thang = p_thang AND ma_bo_phan = p_mabophan;

  -- 5d. [FIX #1] col1 va col3: hai bien rieng de tranh doc col1 cu cho col3
  --     Truoc bug: SET col1=expr, col3=col1+col2 -> col3 dung col1 cu.
  --     Sau fix: inline lai cong thuc cho col3 trong cung lenh SET.
  UPDATE mes_muctieu_sanxuat_thang
  SET col1 = (col5 - col2 * 10.0) / 35.0,
      col3 = (col5 - col2 * 10.0) / 35.0 + col2
  WHERE company_id = p_company_id
    AND nam = p_nam AND thang = p_thang AND ma_bo_phan = p_mabophan;

  -- 6. Cap nhat chitiet: sokhoi_theo_hc, sokhoi (tu tile MT), tile_hoanthanh
  UPDATE mes_muctieu_sanxuat_chitiet
  SET muc_tieu_sokhoi_theo_hc = muc_tieu_tonggio_hc * (v_tile_muc1 / 8.0),
      sokhoi       = (v_tile_muc1 / 8.0) * tonggio,
      tile_hoanthanh = CASE WHEN tonggio = 0 THEN 0
                            ELSE sokhoi_hoanthanh / tonggio * 8.0 END
  WHERE company_id   = p_company_id
    AND ma_cong_doan = p_mabophan
    AND EXTRACT(YEAR  FROM ngaythang) = p_nam
    AND EXTRACT(MONTH FROM ngaythang) = p_thang;

  -- 7. Lay tong sokhoi_theo_tangca + tong gio MT de tinh trung binh
  SELECT COALESCE(SUM(muc_tieu_sokhoi_theo_tangca), 0),
         COALESCE(SUM(muc_tieu_tonggio), 0)
  INTO   v_sokhoi_tc, v_tonggio_mt_kt1
  FROM   mes_muctieu_sanxuat_chitiet
  WHERE  company_id   = p_company_id
    AND  ma_cong_doan = p_mabophan
    AND  EXTRACT(YEAR  FROM ngaythang) = p_nam
    AND  EXTRACT(MONTH FROM ngaythang) = p_thang;

  -- 8. Cap nhat chitiet: sokhoi_trungbinh
  UPDATE mes_muctieu_sanxuat_chitiet
  SET muc_tieu_sokhoi_trungbinh =
        CASE WHEN v_tonggio_mt_kt1 = 0 THEN 0
             ELSE v_sokhoi_tc / v_tonggio_mt_kt1 *
                  (CASE WHEN day_name <> 'Sun' THEN muc_tieu_so_nguoi * 8.0 ELSE 0 END)
        END
  WHERE company_id   = p_company_id
    AND ma_cong_doan = p_mabophan
    AND EXTRACT(YEAR  FROM ngaythang) = p_nam
    AND EXTRACT(MONTH FROM ngaythang) = p_thang;

  -- 9. Lay tong gio + khoi thuc te (sau khi sokhoi da cap nhat o buoc 6)
  SELECT COALESCE(SUM(tonggio), 0), COALESCE(SUM(sokhoi), 0)
  INTO   v_tonggio_thucte, v_tongsokhoi_tt
  FROM   mes_muctieu_sanxuat_chitiet
  WHERE  company_id   = p_company_id
    AND  ma_cong_doan = p_mabophan
    AND  EXTRACT(YEAR  FROM ngaythang) = p_nam
    AND  EXTRACT(MONTH FROM ngaythang) = p_thang;

  -- 10. Cap nhat header: col7..col9, col12, col14
  UPDATE mes_muctieu_sanxuat_thang
  SET col7  = CASE WHEN col5 = 0 THEN 0 ELSE col1 * (col11 / col5) END,
      col8  = CASE WHEN col5 = 0 THEN 0 ELSE col2 * (col11 / col5) END,
      col9  = CASE WHEN col5 = 0 THEN 0
                   ELSE (col1 + col2) * (col11 / col5)
              END,
      col12 = CASE WHEN col10 = 0 THEN 0 ELSE col11 / col10 * 8.0 END,
      col14 = CASE muc_thuong
                WHEN 1 THEN v_tongsokhoi_tt
                ELSE        v_tongsokhoi_tt + (phantram_tang * v_tongsokhoi_tt) / 100.0
              END
  WHERE company_id = p_company_id
    AND nam = p_nam AND thang = p_thang AND ma_bo_phan = p_mabophan;

  -- 11. Lay sokhoi HT + cont tu chitiet
  SELECT COALESCE(SUM(sokhoi_hoanthanh), 0),
         COALESCE(SUM(cont_roi), 0),
         COALESCE(SUM(cont_rap), 0)
  INTO   v_sokhoi_hoanthanh, v_cont_roi_ht, v_cont_rap_ht
  FROM   mes_muctieu_sanxuat_chitiet
  WHERE  company_id   = p_company_id
    AND  ma_cong_doan = p_mabophan
    AND  EXTRACT(YEAR  FROM ngaythang) = p_nam
    AND  EXTRACT(MONTH FROM ngaythang) = p_thang;

  -- 12. Cap nhat header: col15..col18, col22, col23
  UPDATE mes_muctieu_sanxuat_thang
  SET col15 = CASE WHEN col13 = 0 THEN 0 ELSE col14 / col13 * 8.0 END,
      col16 = COALESCE(v_sokhoi_hoanthanh, 0) + COALESCE(col24, 0),
      col22 = v_cont_roi_ht,
      col23 = v_cont_rap_ht
  WHERE company_id = p_company_id
    AND nam = p_nam AND thang = p_thang AND ma_bo_phan = p_mabophan;

  UPDATE mes_muctieu_sanxuat_thang
  SET col17 = CASE WHEN col13 = 0 THEN 0 ELSE (col16 / col13) * 8.0 END
  WHERE company_id = p_company_id
    AND nam = p_nam AND thang = p_thang AND ma_bo_phan = p_mabophan;

  UPDATE mes_muctieu_sanxuat_thang
  SET col18 = CASE WHEN COALESCE(col17, 0) > 0 AND col17 >= col15 THEN 'Dat'
                   ELSE ''
              END
  WHERE company_id = p_company_id
    AND nam = p_nam AND thang = p_thang AND ma_bo_phan = p_mabophan;

  -- 13. Col19 (so nguoi TB) + col21 (tong tien thuong)
  UPDATE mes_muctieu_sanxuat_thang
  SET col19 = CASE WHEN so_ngay = 0 THEN 0 ELSE col13 / so_ngay / 8.0 END,
      col21 = col20 * CASE WHEN so_ngay = 0 THEN 0 ELSE col13 / so_ngay / 8.0 END
  WHERE company_id = p_company_id
    AND nam = p_nam AND thang = p_thang AND ma_bo_phan = p_mabophan;

  -- 14. [FIX #2] Gio can bu luy ke: them PARTITION BY de dam bao dung pham vi
  --     Cung reset gio_canbu = 0 cho row co so_nguoi_hiendien_hc = 0
  --     (tranh gia tri stale tu lan tinh truoc).
  UPDATE mes_muctieu_sanxuat_chitiet AS c
  SET gio_canbu = s.cum_gio
  FROM (
    SELECT
      id,
      SUM(gio_chenhlech) OVER (
        PARTITION BY company_id, ma_cong_doan
        ORDER BY ngaythang
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS cum_gio
    FROM mes_muctieu_sanxuat_chitiet
    WHERE company_id   = p_company_id
      AND ma_cong_doan = p_mabophan
      AND EXTRACT(YEAR  FROM ngaythang) = p_nam
      AND EXTRACT(MONTH FROM ngaythang) = p_thang
  ) s
  WHERE c.id           = s.id
    AND c.company_id   = p_company_id
    AND c.so_nguoi_hiendien_hc > 0;

  -- Reset gio_canbu cho row hom do khong co hien dien (tranh stale)
  UPDATE mes_muctieu_sanxuat_chitiet
  SET gio_canbu = 0
  WHERE company_id   = p_company_id
    AND ma_cong_doan = p_mabophan
    AND EXTRACT(YEAR  FROM ngaythang) = p_nam
    AND EXTRACT(MONTH FROM ngaythang) = p_thang
    AND so_nguoi_hiendien_hc = 0;

END;
$$;
