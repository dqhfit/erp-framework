-- PARAMS:
-- @MaSP nvarchar
-- @baoGiaID uniqueidentifier

CREATE PROC [dbo].[TR_BAOGIA_GOVAN_GET2] 
(
	@MaSP NVARCHAR (200),
	@baoGiaID UNIQUEIDENTIFIER = NULL
)
AS
--SELECT B.id,
--       B.trangso,
--       A.mact,
--       A.masp,
--       A.stt,
--       A.chitiet,
--       A.nguyenlieu,
--       B.danveneer,
--       B.veneer_canh,
--       B.loaiveneer,
--       A.dayy_tc,
--       A.rong_tc,
--       A.dai_tc,
--       mong = A.mong1 + A.mong2,
--       A.soluong_tc,
--       B.sldh,
--       m3 = A.m3_tc,
--       B.go_ngoai_a,
--       B.go_trong_b,
--       B.plywood_3,
--       B.plywood_5,
--       B.plywood_9,
--       B.plywood_12,
--       B.plywood_15,
--       B.plywood_18,
--       B.mdf_3,
--       B.mdf_4_5,
--       B.mdf_5,
--       B.mdf_9,
--       B.mdf_12,
--       B.mdf_15,
--       B.mdf_17,
--       B.mdf_18,
--       B.mdf_20,
--       B.mdf_25,
--       B.veneer_1_mat,
--       B.veneer_2_mat,
--       B.veneer_dan_canh,
--       B.mat_a,
--       B.mat_b,
--       B.mat_c,
--       ghichu = ISNULL(B.ghichu, A.ghichu),
--       B.caosu_03,
--       B.bachduong_03,
--       B.oak,
--       B.ash,
--       B.walnut_03,
--       B.veneer_matchinh,
--       B.veneer_matphu
--FROM tr_dinhmuc_govan A 
--LEFT JOIN tr_baogia_govan B ON A.masp = B.masp AND a.mact = b.mact
--WHERE A.masp = @MaSP

IF @baoGiaID IS NULL
BEGIN
	SELECT *
	FROM tr_baogia_govan
	WHERE masp = @MaSP AND baoGiaID IS NULL
END
ELSE
BEGIN
	SELECT * FROM tr_baogia_govan
	WHERE masp = @MaSP AND baoGiaID = @baoGiaID
END
