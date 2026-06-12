-- PARAMS:
-- @MADDH nvarchar

CREATE PROC [dbo].[TR_DONDATHANG_CHITIET_GET2]
(
	@MADDH NVARCHAR(200)
)
AS
SELECT a.id, maddh, a.masp, chitiet
    , b.mota as tenchitiet
    , B.quycach, B.mausac, B.dvt
	, A.soluong
	, A.sl_danhan
	, A.sl_conlai
	--, A.sl_conlai AS sl_nhap
	, CAST('0' AS FLOAT) AS sl_nhap
	, CAST('0' AS FLOAT) AS sl_du
	, a.dongia
	, a.ghichu
	, a.donhang
FROM tr_dondathang_chitiet A, tr_material B
WHERE A.chitiet = ISNULL(B.idxuong, B.mavt)
	AND A.maddh = @MADDH
	AND a.active = 1
	AND B.xoa = 'N'


