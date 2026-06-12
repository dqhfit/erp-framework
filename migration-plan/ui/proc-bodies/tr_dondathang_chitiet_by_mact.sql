-- PARAMS:
-- @MACT nvarchar
-- @STATUS nvarchar


CREATE PROC [dbo].[TR_DONDATHANG_CHITIET_BY_MACT]
(
	@MACT NVARCHAR(200),
	@STATUS NVARCHAR(20)
)
AS
IF @STATUS = 'MATERIAL'
BEGIN
SELECT b.maddh, a.mancc, a.tenncc,
	CASE
		WHEN loaiddh = 'NKI' THEN N'Ngũ Kim'
		WHEN loaiddh = 'DGO' THEN N'Bao Bì'
		WHEN loaiddh = 'SON' THEN N'Sơn'
		WHEN loaiddh = 'GVA' THEN N'Gỗ ván'
		WHEN loaiddh = 'HTR' THEN N'Hàng trắng'
		WHEN loaiddh = 'OTHER' THEN N'Ngoài BOM'
       END AS loaiddh
	, ngaydat, ngaygiao
	, B.masp
	, b.chitiet, c.mota as tenchitiet, c.dvt
	, b.soluong, b.sl_danhan, b.sl_conlai
	, b.dongia
	, b.donhang
	, a.lan_sua
	, b.create_by
	, c.quycach, c.mausac
INTO #RESULT1
FROM  tr_dondathang a, tr_dondathang_chitiet b, tr_material c
WHERE a.maddh = b.maddh
	and b.chitiet = ISNULL(c.idxuong, c.mavt)
	--and a.pheduyet = '1' 
	and A.active = 1
	and b.chitiet LIKE @MACT;

	SELECT A.maddh
		, A.mancc
		, ISNULL(B.vendor_name, A.tenncc) AS tenncc
		, A.loaiddh
		, A.ngaydat, A.ngaygiao
		, A.masp
		, A.chitiet, A.tenchitiet, A.dvt
		, A.soluong, A.sl_danhan, A.sl_conlai
		, A.dongia
		, A.donhang
		, A.lan_sua
		, A.create_by
		, a.quycach, a.mausac
	--INTO #RESULT1_1
	FROM #RESULT1 A 
		LEFT JOIN tr_nhacc B ON A.mancc = B.vendor_id
	
	--SELECT A.*, B.dongia AS dongia_goc
	--	, (A.dongia - B.dongia) AS dongia_chenhlech
	--	, B.id
	--FROM #RESULT1_1 A
	--	LEFT JOIN tr_material_price B ON A.chitiet = B.mact AND A.mancc = B.mancc
	--ORDER BY A.maddh

END

IF @STATUS = 'CODE'
BEGIN
SELECT b.maddh, a.mancc, a.tenncc,
	CASE
		WHEN loaiddh = 'NKI' THEN N'Ngũ Kim'
		WHEN loaiddh = 'DGO' THEN N'Bao Bì'
		WHEN loaiddh = 'SON' THEN N'Sơn'
		WHEN loaiddh = 'GVA' THEN N'Gỗ ván'
		WHEN loaiddh = 'HTR' THEN N'Hàng trắng'
		WHEN loaiddh = 'OTHER' THEN N'Ngoài BOM'
       END AS loaiddh
	, ngaydat, ngaygiao
	, B.masp
	, b.chitiet, c.mota as tenchitiet, c.dvt
	, b.soluong, b.sl_danhan, b.sl_conlai
	, b.dongia
	, b.donhang
	, a.lan_sua
	, b.create_by
	, c.quycach, c.mausac
INTO #RESULT2
FROM  tr_dondathang a, tr_dondathang_chitiet b, tr_material c
WHERE a.maddh = b.maddh
	and b.chitiet = ISNULL(c.idxuong, c.mavt)
	--and a.pheduyet = '1' 
	and A.active = 1
	and b.maddh LIKE @MACT;

	SELECT A.maddh
		, A.mancc
		, ISNULL(B.vendor_name, A.tenncc) AS tenncc
		, A.loaiddh
		, A.ngaydat, A.ngaygiao
		, A.masp
		, A.chitiet, A.tenchitiet, A.dvt
		, A.soluong, A.sl_danhan, A.sl_conlai
		, A.dongia
		, A.donhang
		, A.lan_sua
		, A.create_by
		, a.quycach, a.mausac
	--INTO #RESULT2_1
	FROM #RESULT2 A 
		LEFT JOIN tr_nhacc B ON A.mancc = B.vendor_id;
	
	--SELECT A.*, B.dongia AS dongia_goc
	--	, (A.dongia - B.dongia) AS dongia_chenhlech
	--	, B.id
	--FROM #RESULT2_1 A
	--	LEFT JOIN tr_material_price B ON A.chitiet = B.mact AND A.mancc = B.mancc
	--ORDER BY A.maddh


END
IF @STATUS = 'NCC'
BEGIN
	SELECT b.maddh, a.mancc, a.tenncc,
	CASE
		WHEN loaiddh = 'NKI' THEN N'Ngũ Kim'
		WHEN loaiddh = 'DGO' THEN N'Bao Bì'
		WHEN loaiddh = 'SON' THEN N'Sơn'
		WHEN loaiddh = 'GVA' THEN N'Gỗ ván'
		WHEN loaiddh = 'HTR' THEN N'Hàng trắng'
		WHEN loaiddh = 'OTHER' THEN N'Ngoài BOM'
       END AS loaiddh
	, ngaydat, ngaygiao
	, B.masp
	, b.chitiet, c.mota as tenchitiet, c.dvt
	, b.soluong, b.sl_danhan, b.sl_conlai
	, b.dongia
	, b.donhang
	, a.lan_sua
	, b.create_by
	, c.quycach, c.mausac
INTO #RESULT3
FROM  tr_dondathang a, tr_dondathang_chitiet b, tr_material c
WHERE a.maddh = b.maddh
	and b.chitiet = ISNULL(c.idxuong, c.mavt)
	--and a.pheduyet = '1' 
	and A.active = 1
	and a.mancc = @MACT;

	SELECT A.maddh
		, A.mancc
		, ISNULL(B.vendor_name, A.tenncc) AS tenncc
		, A.loaiddh
		, A.ngaydat, A.ngaygiao
		, A.masp
		, A.chitiet, A.tenchitiet, A.dvt
		, A.soluong, A.sl_danhan, A.sl_conlai
		, A.dongia
		, A.donhang
		, A.lan_sua
		, A.create_by
		, a.quycach, a.mausac
	--INTO #RESULT2_1
	FROM #RESULT3 A 
		LEFT JOIN tr_nhacc B ON A.mancc = B.vendor_id;
END




