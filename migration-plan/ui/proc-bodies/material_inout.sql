-- PARAMS:
-- @MAKHO nvarchar
-- @TUNGAY date
-- @DENNGAY date

CREATE PROC [dbo].[MATERIAL_INOUT] (@MAKHO     NVARCHAR (50),
                                   @TUNGAY    DATE,
                                   @DENNGAY   DATE)
AS
BEGIN
SELECT sophieu, ghichu2, mact, bengiao,
	donhang, trangthai, ngaythang, ngayphieu, makho, ghichu, dongia, RefType,
	sum (soluong) AS soluong
INTO #tblNhapXuat
FROM (
	SELECT a.sopn AS sophieu,
		b.ghichu as ghichu2,
		a.mavt AS mact,
		b.tenncc AS bengiao,
		a.slnhap AS soluong,
		N'Nhập kho' AS trangthai,
		CAST (b.ngaynhap AS DATE) AS ngaythang,
		CAST (b.ngayphieu AS DATE) AS ngayphieu,
		a.id_dathang AS donhang,
		b.makho,
		a.ghichu,
		a.gianhap as dongia,
		B.RefType
	FROM tr_ctphieunhap a
		INNER JOIN tr_phieunhap b ON a.sopn = b.sopn
	WHERE b.active = 1 AND A.soluong_du + A.slnhap > 0
	      AND B.makho = @MAKHO
	      AND CAST (b.ngaynhap AS DATE) BETWEEN @TUNGAY AND @DENNGAY
	UNION ALL
	SELECT a.phieuxuat,
		b.ghichu as ghichu2,
		a.mact,
		b.nguoinhan,
		a.soluong AS soluong_xuat,
		N'Xuất kho' AS trangthai,
		CAST (b.ngaytao AS DATE) AS ngaythang,
		CAST (b.ngaytao AS DATE) AS ngayphieu,
		A.lenhcapphat,
		b.makho,
		a.ghichu, a.giaxuat,
		B.RefType
	FROM tr_phieuxuat b 
		INNER JOIN tr_ctphieuxuat a ON a.phieuxuat = b.sopx
	WHERE b.active = 1 AND A.soluong > 0
	AND B.makho = @MAKHO
	AND CAST (b.ngaytao AS DATE) BETWEEN @TUNGAY AND @DENNGAY) A
GROUP BY sophieu, ghichu2, donhang, mact, bengiao, trangthai, ngaythang, ngayphieu, makho, ghichu, dongia, RefType


SELECT a.*,
       b.mota,
       b.quycach,
       b.mausac,
       b.dvt,
	   C.RefTypeName
FROM #tblNhapXuat a
	INNER JOIN tr_material b ON a.mact = b.idxuong
	LEFT JOIN tr_reftype C ON A.RefType = C.RefType
ORDER BY A.mact;
DROP TABLE #tblNhapXuat


	--WITH NHAPKHO AS (
	--	SELECT a.sopn AS sophieu,
	--		b.ghichu as ghichu2,
	--		a.mavt AS mact,
	--		b.tenncc AS bengiao,
	--		a.slnhap AS soluong,
	--		N'Nhập kho' AS trangthai,
	--		CAST (b.ngaynhap AS DATE) AS ngaythang,
	--		CAST (b.ngayphieu AS DATE) AS ngayphieu,
	--		a.id_dathang AS donhang,
	--		b.makho,
	--		a.ghichu,
	--		a.gianhap as dongia,
	--		C.RefTypeName
	--	FROM tr_ctphieunhap a
	--		INNER JOIN tr_phieunhap b ON a.sopn = b.sopn
	--		LEFT JOIN  tr_reftype C ON B.RefType = C.RefType
	--	WHERE b.active = 1 AND A.slnhap + A.soluong_du > 0
	--		AND B.makho = @MAKHO
	--		AND CAST (b.ngaynhap AS DATE) BETWEEN @TUNGAY AND @DENNGAY
	--),
	--XUATKHO AS (
	--	SELECT a.phieuxuat,
	--		b.ghichu as ghichu2,
	--		a.mact,
	--		b.nguoinhan,
	--		a.soluong AS soluong_xuat,
	--		N'Xuất kho' AS trangthai,
	--		CAST (b.ngaytao AS DATE) AS ngaythang,
	--		CAST (b.ngaytao AS DATE) AS ngayphieu,
	--		A.lenhcapphat,
	--		b.makho,
	--		a.ghichu, a.giaxuat,
	--		C.RefTypeName
	--	FROM tr_phieuxuat b 
	--		INNER JOIN tr_ctphieuxuat a ON a.phieuxuat = b.sopx
	--		LEFT JOIN tr_reftype C ON B.RefType = C.RefType
	--	WHERE b.active = 1 AND A.soluong > 0
	--		AND B.makho = @MAKHO
	--		AND CAST (b.ngaytao AS DATE) BETWEEN @TUNGAY AND @DENNGAY
	--)
	--SELECT A.*, B.mota, B.quycach, B.mausac, B.dvt
	--FROM (
	--	SELECT * FROM NHAPKHO
	--	UNION ALL
	--	SELECT * FROM XUATKHO
	--) A INNER JOIN tr_material B ON A.mact = B.mavt

END;


