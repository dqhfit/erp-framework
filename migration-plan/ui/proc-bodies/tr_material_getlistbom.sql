-- PARAMS:
-- @MaCT nvarchar


CREATE PROC TR_MATERIAL_GETLISTBOM
(
    @MaCT NVARCHAR(200)
)
AS
SELECT A.*, B.tensp, B.mausac, B.hehang
FROM (
SELECT N'Ngũ Kim' AS [Type], masp, mavt, soluong, HWforWW, HWforPacking, ghichu
FROM tr_dinhmuc_ngukim
WHERE hoanthanh = 1 AND mavt <> '000' AND mavt = @MaCT
UNION ALL
SELECT N'Đóng Gói' AS [Type], masp, madonggoi, soluong, CAST(0 AS BIT) AS HWforWW, CAST(0 AS BIT) AS HWforPacking, ghichu
FROM tr_dinhmuc_donggoi
WHERE hoanthanh = 1 AND madonggoi <> '000' AND madonggoi = @MaCT
UNION ALL
SELECT N'Sơn' AS [Type], masp, mact, SUM(sl_sp) sl_sp, CAST(0 AS BIT) AS HWforWW, CAST(0 AS BIT) AS HWforPacking, ghichu
FROM tr_dinhmuc_son
WHERE hoanthanh = 1 AND mact <> '000' AND mact = @MaCT
GROUP BY masp, mact, ghichu
) A INNER JOIN tr_sanpham B ON A.masp = B.masp


