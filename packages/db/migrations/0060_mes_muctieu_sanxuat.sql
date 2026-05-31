-- 0059_mes_muctieu_sanxuat.sql
-- Module "Muc tieu san xuat" (MES production target) port tu DQHF WinForms.
-- 4 bang + 1 PG function tinh toan tong hop thay the SP TR_MUCTIEU_SANXUAT2_TINHTOAN.
-- Idempotent: CREATE TABLE/INDEX IF NOT EXISTS + CREATE OR REPLACE FUNCTION.

-- Bang v1: muc tieu don gian theo ngay / don hang / cong doan.
-- Tuong duong MSSQL TR_MUCTIEU_SANXUAT.
CREATE TABLE IF NOT EXISTS mes_muctieu_sanxuat (
  id            uuid        PRIMARY KEY DEFAULT uuidv7(),
  company_id    uuid        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  ngaythang     date        NOT NULL,
  ma_cong_doan  text        NOT NULL,
  don_hang      text        NOT NULL DEFAULT '',
  he_hang       text        NOT NULL DEFAULT '',
  muc_tieu      float8      NOT NULL DEFAULT 0,
  so_nguoi      int         NOT NULL DEFAULT 0,
  so_gio        float8      NOT NULL DEFAULT 8,
  nguoi_tao     text        NOT NULL DEFAULT '',
  ngay_tao      timestamp   NOT NULL DEFAULT now(),
  nguoi_sua     text        NOT NULL DEFAULT '',
  ngay_sua      timestamp   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mes_muctieu_sanxuat_company_ngay_idx
  ON mes_muctieu_sanxuat (company_id, ma_cong_doan, ngaythang);

-- Bang v2 header: tong hop thang theo muc thuong (1-4).
-- Tuong duong MSSQL TR_MUCTIEU_SANXUAT2.
-- col1..col25 la cac chi so tinh toan (xem SP TR_MUCTIEU_SANXUAT2_TINHTOAN).
CREATE TABLE IF NOT EXISTS mes_muctieu_sanxuat_thang (
  id              uuid    PRIMARY KEY DEFAULT uuidv7(),
  company_id      uuid    NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  nam             int     NOT NULL,
  thang           int     NOT NULL,
  ma_bo_phan      text    NOT NULL,
  muc_thuong      int     NOT NULL DEFAULT 1,  -- 1..4, bo thap = base
  so_nguoi        int     NOT NULL DEFAULT 0,
  so_ngay         float8  NOT NULL DEFAULT 0,  -- ngay lam viec (tru CN)
  phantram_tang   float8,                       -- % tang so voi muc truoc (null khi muc_thuong=1)
  -- Cot tinh toan (cung ten voi nguon de trace 1:1):
  col1   float8,  -- cont roi muc tieu khong TC
  col2   float8,  -- cont rap muc tieu khong TC
  col3   float8,  -- tong cont muc tieu khong TC = col1+col2
  col4   float8,  -- so gio muc tieu khong TC
  col5   float8,  -- so khoi muc tieu khong TC
  col6   float8,  -- ti le muc tieu (M3/8h), input cho muc_thuong=1
  col7   float8,  -- cont roi muc tieu co TC
  col8   float8,  -- cont rap muc tieu co TC
  col9   float8,  -- tong cont muc tieu co TC
  col10  float8,  -- so gio muc tieu co TC
  col11  float8,  -- so khoi muc tieu co TC
  col12  float8,  -- ti le muc tieu co TC
  col13  float8,  -- tong gio thuc te
  col14  float8,  -- so khoi thuc te (co dieu chinh phantram)
  col15  float8,  -- ti le thuc te
  col16  float8,  -- so khoi hoan thanh (SUM hoanthanh + col24)
  col17  float8,  -- ti le hoan thanh
  col18  text,    -- ket qua: 'Dat' hoac ''
  col19  float8,  -- so nguoi trung binh
  col20  float8,  -- tien thuong / nguoi (input)
  col21  float8,  -- tong tien thuong = col20 * col19
  col22  float8,  -- cont roi thuc te hoan thanh
  col23  float8,  -- cont rap thuc te hoan thanh
  col24  float8,  -- so khoi cong tru thu cong (input)
  col25  float8,  -- du tru
  updated_at      timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS mes_muctieu_sanxuat_thang_uk
  ON mes_muctieu_sanxuat_thang (company_id, nam, thang, ma_bo_phan, muc_thuong);

-- Bang v2 chi tiet: tung ngay trong thang.
-- Tuong duong MSSQL TR_MUCTIEU_SANXUAT2_CHITIET.
CREATE TABLE IF NOT EXISTS mes_muctieu_sanxuat_chitiet (
  id                          uuid    PRIMARY KEY DEFAULT uuidv7(),
  company_id                  uuid    NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  ma_cong_doan                text    NOT NULL,
  ngaythang                   date    NOT NULL,
  day_name                    text,   -- 'Mon'..'Sun' (tu ngaythang, luu san de SP doc)
  -- Muc tieu ke hoach (do user nhap):
  muc_tieu_so_gio             float8  NOT NULL DEFAULT 0,  -- so gio ke hoach (> 8 = co tang ca)
  muc_tieu_so_nguoi           int     NOT NULL DEFAULT 0,  -- lay tu header muc_thuong=1
  muc_tieu_tonggio_hc         float8  NOT NULL DEFAULT 0,  -- = IIF(CN, 0, songuoi*8)
  muc_tieu_tonggio_tc         float8  NOT NULL DEFAULT 0,  -- = IIF(CN, songuoi*8, songuoi*(sogio-8))
  muc_tieu_tonggio            float8  NOT NULL DEFAULT 0,  -- = _hc + _tc
  muc_tieu_sokhoi_theo_hc     float8  NOT NULL DEFAULT 0,  -- tinh boi tinhtoan
  muc_tieu_sokhoi_theo_tangca float8  NOT NULL DEFAULT 0,
  muc_tieu_sokhoi_trungbinh   float8  NOT NULL DEFAULT 0,
  -- Thuc te (do user nhap moi ngay):
  so_nguoi_hiendien_hc        int     NOT NULL DEFAULT 0,
  so_nguoi_hiendien_tc        int     NOT NULL DEFAULT 0,
  ve_giua_gio                 float8  NOT NULL DEFAULT 0,  -- gio ve giua gio (tru di)
  cont_roi                    float8  NOT NULL DEFAULT 0,
  cont_rap                    float8  NOT NULL DEFAULT 0,
  sokhoi_hoanthanh            float8  NOT NULL DEFAULT 0,  -- lay tu GetM3HoanThanh
  -- Tinh toan:
  tonggio                     float8  NOT NULL DEFAULT 0,  -- tong gio thuc te
  sokhoi                      float8  NOT NULL DEFAULT 0,  -- so khoi thuc te
  tile                        float8  NOT NULL DEFAULT 0,  -- ti le (= col6 neu sogio>0)
  tile_hoanthanh              float8  NOT NULL DEFAULT 0,  -- ti le hoan thanh
  gio_chenhlech               float8  NOT NULL DEFAULT 0,  -- muc_tieu_tonggio_hc - tonggio
  gio_canbu                   float8  NOT NULL DEFAULT 0   -- luy ke bu gio
);
CREATE UNIQUE INDEX IF NOT EXISTS mes_muctieu_sanxuat_chitiet_uk
  ON mes_muctieu_sanxuat_chitiet (company_id, ma_cong_doan, ngaythang);
CREATE INDEX IF NOT EXISTS mes_muctieu_sanxuat_chitiet_thang_idx
  ON mes_muctieu_sanxuat_chitiet (company_id, ma_cong_doan, EXTRACT(YEAR FROM ngaythang), EXTRACT(MONTH FROM ngaythang));

-- Bang bao cao hien dien v1 (dung song song voi v2 chitiet).
-- Tuong duong MSSQL TR_BAOCAO_HIENDIEN4.
CREATE TABLE IF NOT EXISTS mes_baocao_hien_dien (
  id              uuid      PRIMARY KEY DEFAULT uuidv7(),
  company_id      uuid      NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  ma_cong_doan    text      NOT NULL,
  ngaythang       date      NOT NULL,
  so_nguoi_hc     int       NOT NULL DEFAULT 0,
  so_nguoi_tc     int       NOT NULL DEFAULT 0,
  nguoi_tao       text      NOT NULL DEFAULT '',
  ngay_tao        timestamp NOT NULL DEFAULT now(),
  nguoi_sua       text      NOT NULL DEFAULT '',
  ngay_sua        timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS mes_baocao_hien_dien_uk
  ON mes_baocao_hien_dien (company_id, ma_cong_doan, ngaythang);

-- ============================================================
-- PG Function: mes_muctieu_tinhtoan
-- Port tu TR_MUCTIEU_SANXUAT2_TINHTOAN.
-- Tinh lai toan bo col1..col25 trong thang header + cap nhat chitiet.
-- Goi sau khi user luu xong chi tiet (saveChitiet).
-- ============================================================
CREATE OR REPLACE FUNCTION mes_muctieu_tinhtoan(
  p_company_id  uuid,
  p_nam         int,
  p_thang       int,
  p_mabophan    text
) RETURNS void
LANGUAGE plpgsql AS
$$
DECLARE
  v_songay_lamviec  int;
  v_muctieu_tonggio float8;
  v_songuoi         int;
  v_cont_rap        float8;
  v_tile_muc1       float8;
  v_gio_mt_hc       float8;
  v_tonggio_thucte  float8;
  v_sokhoi_mt1_hc   float8;
  v_sokhoi_tc       float8;
  v_tonggio_mt_kt1  float8;
  v_tongsokhoi_tt   float8;
  v_sokhoi_hoanthanh float8;
  v_cont_roi_ht     float8;
  v_cont_rap_ht     float8;
BEGIN
  -- 1. Lay so ngay lam viec (ngay co nhap gio muc tieu) va tong gio muc tieu
  SELECT
    COUNT(*)::int,
    COALESCE(SUM(muc_tieu_tonggio), 0)
  INTO v_songay_lamviec, v_muctieu_tonggio
  FROM mes_muctieu_sanxuat_chitiet
  WHERE company_id = p_company_id
    AND ma_cong_doan = p_mabophan
    AND EXTRACT(YEAR FROM ngaythang) = p_nam
    AND EXTRACT(MONTH FROM ngaythang) = p_thang
    AND muc_tieu_so_gio > 0;

  -- 2. Lay thong so tu header muc_thuong = 1
  SELECT so_nguoi, col2, col6
  INTO v_songuoi, v_cont_rap, v_tile_muc1
  FROM mes_muctieu_sanxuat_thang
  WHERE company_id = p_company_id
    AND nam = p_nam AND thang = p_thang
    AND ma_bo_phan = p_mabophan AND muc_thuong = 1;

  -- Khong co header muc 1 -> thoat
  IF NOT FOUND THEN RETURN; END IF;
  IF v_tile_muc1 IS NULL THEN v_tile_muc1 := 0; END IF;
  IF v_cont_rap  IS NULL THEN v_cont_rap  := 0; END IF;

  -- 3. Tong gio muc tieu HC va tong gio thuc te
  SELECT
    COALESCE(SUM(muc_tieu_tonggio_hc), 0),
    COALESCE(SUM(tonggio), 0)
  INTO v_gio_mt_hc, v_tonggio_thucte
  FROM mes_muctieu_sanxuat_chitiet
  WHERE company_id = p_company_id
    AND ma_cong_doan = p_mabophan
    AND EXTRACT(YEAR FROM ngaythang) = p_nam
    AND EXTRACT(MONTH FROM ngaythang) = p_thang;

  -- 4. So khoi muc tieu (khong tang ca, muc 1)
  v_sokhoi_mt1_hc := (v_tile_muc1 / 8.0) * v_gio_mt_hc;

  -- 5. Cap nhat header (tat ca muc_thuong)
  UPDATE mes_muctieu_sanxuat_thang
  SET
    so_ngay = v_songay_lamviec,
    col4    = v_gio_mt_hc,
    col10   = v_muctieu_tonggio,
    col13   = v_tonggio_thucte,
    col5    = CASE
                WHEN muc_thuong = 1 THEN v_sokhoi_mt1_hc
                ELSE v_sokhoi_mt1_hc + (phantram_tang * v_sokhoi_mt1_hc) / 100.0
              END,
    updated_at = now()
  WHERE company_id = p_company_id
    AND nam = p_nam AND thang = p_thang AND ma_bo_phan = p_mabophan;

  UPDATE mes_muctieu_sanxuat_thang
  SET col11 = CASE WHEN col4 = 0 THEN 0 ELSE col10 * (col5 / col4) END
  WHERE company_id = p_company_id
    AND nam = p_nam AND thang = p_thang AND ma_bo_phan = p_mabophan;

  UPDATE mes_muctieu_sanxuat_thang
  SET col6 = CASE
               WHEN muc_thuong = 1 THEN col6  -- giu nguyen (user input)
               ELSE CASE WHEN col4 = 0 THEN 0 ELSE col5 / col4 * 8.0 END
             END
  WHERE company_id = p_company_id
    AND nam = p_nam AND thang = p_thang AND ma_bo_phan = p_mabophan;

  UPDATE mes_muctieu_sanxuat_thang
  SET col1 = (col5 - col2 * 10.0) / 35.0,
      col3 = col1 + col2
  WHERE company_id = p_company_id
    AND nam = p_nam AND thang = p_thang AND ma_bo_phan = p_mabophan;

  -- 6. Cap nhat chitiet: sokhoi_theo_hc, sokhoi, tile_hoanthanh
  UPDATE mes_muctieu_sanxuat_chitiet
  SET muc_tieu_sokhoi_theo_hc = muc_tieu_tonggio_hc * (v_tile_muc1 / 8.0),
      sokhoi = (v_tile_muc1 / 8.0) * tonggio,
      tile_hoanthanh = CASE WHEN tonggio = 0 THEN 0 ELSE sokhoi_hoanthanh / tonggio * 8.0 END
  WHERE company_id = p_company_id
    AND ma_cong_doan = p_mabophan
    AND EXTRACT(YEAR FROM ngaythang) = p_nam
    AND EXTRACT(MONTH FROM ngaythang) = p_thang;

  -- 7. Lay muctieu_sokhoi_theo_tangca va muctieu_tonggio tong
  SELECT
    COALESCE(SUM(muc_tieu_sokhoi_theo_tangca), 0),
    COALESCE(SUM(muc_tieu_tonggio), 0)
  INTO v_sokhoi_tc, v_tonggio_mt_kt1
  FROM mes_muctieu_sanxuat_chitiet
  WHERE company_id = p_company_id
    AND ma_cong_doan = p_mabophan
    AND EXTRACT(YEAR FROM ngaythang) = p_nam
    AND EXTRACT(MONTH FROM ngaythang) = p_thang;

  -- 8. Cap nhat chitiet: sokhoi_trungbinh
  UPDATE mes_muctieu_sanxuat_chitiet
  SET muc_tieu_sokhoi_trungbinh =
    CASE WHEN v_tonggio_mt_kt1 = 0 THEN 0
         ELSE v_sokhoi_tc / v_tonggio_mt_kt1 *
              (CASE WHEN day_name <> 'Sun' THEN muc_tieu_so_nguoi * 8.0 ELSE 0 END)
    END
  WHERE company_id = p_company_id
    AND ma_cong_doan = p_mabophan
    AND EXTRACT(YEAR FROM ngaythang) = p_nam
    AND EXTRACT(MONTH FROM ngaythang) = p_thang;

  -- 9. Lay tong gio + khoi thuc te
  SELECT
    COALESCE(SUM(tonggio), 0),
    COALESCE(SUM(sokhoi), 0)
  INTO v_tonggio_thucte, v_tongsokhoi_tt
  FROM mes_muctieu_sanxuat_chitiet
  WHERE company_id = p_company_id
    AND ma_cong_doan = p_mabophan
    AND EXTRACT(YEAR FROM ngaythang) = p_nam
    AND EXTRACT(MONTH FROM ngaythang) = p_thang;

  -- 10. Cap nhat header: col7..col14
  UPDATE mes_muctieu_sanxuat_thang
  SET
    col7  = CASE WHEN col5 = 0 THEN 0 ELSE col1 * (col11 / col5) END,
    col8  = CASE WHEN col5 = 0 THEN 0 ELSE col2 * (col11 / col5) END,
    col9  = (CASE WHEN col5 = 0 THEN 0 ELSE col1 * (col11 / col5) END)
          + (CASE WHEN col5 = 0 THEN 0 ELSE col2 * (col11 / col5) END),
    col12 = CASE WHEN col10 = 0 THEN 0 ELSE col11 / col10 * 8.0 END,
    col14 = CASE WHEN muc_thuong = 1 THEN v_tongsokhoi_tt
                 ELSE v_tongsokhoi_tt + (phantram_tang * v_tongsokhoi_tt) / 100.0
            END
  WHERE company_id = p_company_id
    AND nam = p_nam AND thang = p_thang AND ma_bo_phan = p_mabophan;

  -- 11. Lay sokhoi hoan thanh + cont roi/rap tu chitiet
  SELECT
    COALESCE(SUM(sokhoi_hoanthanh), 0),
    COALESCE(SUM(cont_roi), 0),
    COALESCE(SUM(cont_rap), 0)
  INTO v_sokhoi_hoanthanh, v_cont_roi_ht, v_cont_rap_ht
  FROM mes_muctieu_sanxuat_chitiet
  WHERE company_id = p_company_id
    AND ma_cong_doan = p_mabophan
    AND EXTRACT(YEAR FROM ngaythang) = p_nam
    AND EXTRACT(MONTH FROM ngaythang) = p_thang;

  -- 12. Cap nhat header: col15..col23
  UPDATE mes_muctieu_sanxuat_thang
  SET
    col15 = CASE WHEN col13 = 0 THEN 0 ELSE col14 / col13 * 8.0 END,
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
  SET col18 = CASE
                WHEN COALESCE(col17, 0) = 0 THEN ''
                WHEN col17 >= col15 THEN 'Dat'
                ELSE ''
              END
  WHERE company_id = p_company_id
    AND nam = p_nam AND thang = p_thang AND ma_bo_phan = p_mabophan;

  -- 13. Cap nhat col19, col21 (so nguoi TB + tong tien thuong)
  UPDATE mes_muctieu_sanxuat_thang
  SET
    col19 = CASE WHEN so_ngay = 0 THEN 0 ELSE col13 / so_ngay / 8.0 END,
    col21 = col20 * CASE WHEN so_ngay = 0 THEN 0 ELSE col13 / so_ngay / 8.0 END
  WHERE company_id = p_company_id
    AND nam = p_nam AND thang = p_thang AND ma_bo_phan = p_mabophan;

  -- 14. Gio can bu luy ke (thay the cursor bang window function)
  -- Chi ghi vao row co so_nguoi_hiendien_hc > 0
  UPDATE mes_muctieu_sanxuat_chitiet AS c
  SET gio_canbu = s.cum_gio
  FROM (
    SELECT
      id,
      SUM(gio_chenhlech) OVER (
        ORDER BY ngaythang
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS cum_gio
    FROM mes_muctieu_sanxuat_chitiet
    WHERE company_id = p_company_id
      AND ma_cong_doan = p_mabophan
      AND EXTRACT(YEAR FROM ngaythang) = p_nam
      AND EXTRACT(MONTH FROM ngaythang) = p_thang
  ) s
  WHERE c.id = s.id
    AND c.company_id = p_company_id
    AND c.so_nguoi_hiendien_hc > 0;

END;
$$;
