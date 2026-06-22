-- PARAMS:
-- @MADONDATHANG nvarchar

CREATE PROC [dbo].[LENHCAPPHAT_HANGTRANG] (@MADONDATHANG NVARCHAR(200))
AS
DECLARE @DATHANG_CHITIET TABLE
(
	DONHANG NVARCHAR(200),
	MASP NVARCHAR(200),
	CHITIET NVARCHAR(200),
	TENCHITIET NVARCHAR(MAX),
	SOLUONG_DATHANG DECIMAL(18,2)
);

INSERT INTO @DATHANG_CHITIET(DONHANG, MASP, CHITIET, TENCHITIET, SOLUONG_DATHANG)
SELECT b.donhang, B.masp, b.chitiet, b.tenchitiet, sum(b.soluong) soluong_dathang
FROM tr_dondathang a WITH(NOLOCK), tr_dondathang_chitiet b
WHERE a.maddh = b.maddh
	and a.loaiddh IN ('HTR', 'OTHER') 
	and a.pheduyet = 1 and a.trangthai <> '3'
	and a.maddh = @MADONDATHANG
GROUP BY b.donhang, B.masp, b.chitiet, b.tenchitiet;

--SELECT B.MASP, B.CHITIET AS mahtr, A.mact
--	, (A.soluong * B.SOLUONG_DATHANG) AS soluong
--	, B.SOLUONG_DATHANG AS soluong_dathang
--	, B.DONHANG
--INTO #NGUKIM
--FROM tr_bom_htr A
--	RIGHT JOIN @DATHANG_CHITIET B
--	ON A.mahtr = B.CHITIET
--WHERE A.hoanthanh = 1 AND A.phanloai = 'NKI'

SELECT B.MASP, B.CHITIET AS mahtr, A.mavt as mact
	, (A.soluong * B.SOLUONG_DATHANG) AS soluong
	, B.SOLUONG_DATHANG AS soluong_dathang
	, B.DONHANG
INTO #NGUKIM
FROM tr_dinhmuc_ngukim A
	RIGHT JOIN @DATHANG_CHITIET B ON A.masp = B.MASP
WHERE A.hoanthanh = 1 
  AND A.HWforWW = 1

SELECT A.MASP, B.nhom, A.mahtr, a.mact as mavt, B.mota, B.dvt, B.quycach, B.mausac, A.soluong, a.soluong_dathang, A.DONHANG
FROM #NGUKIM A
	INNER JOIN tr_material B
	ON A.mact = ISNULL(B.idxuong, B.mavt)
WHERE ISNULL(B.xoa, 'N') = 'N'
ORDER BY A.mact,b.nhom
