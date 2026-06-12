-- PARAMS:
-- @mact nvarchar


CREATE PROC [dbo].[TR_TONGHOP_VATTU_YEUCAUXUAT_CHITIET](@mact nvarchar(200))
AS
BEGIN
DECLARE @SOLUONG_YEUCAU TABLE
(
	loaiphieu nvarchar(50),
	sophieu nvarchar(50),
	mact nvarchar(200),
	soluong_yeucau float,
	soluong_daphat float,
	ghichu nvarchar(max)
)

INSERT INTO @SOLUONG_YEUCAU(loaiphieu, sophieu, mact, soluong_yeucau, soluong_daphat, ghichu)
SELECT N'Yêu cầu xuất kho', A.sophieu, B.mact, 
	soluong, soluong_daphat, 
	A.mucdich
FROM tr_phieuyeucau A
	INNER JOIN tr_phieuyeucau_chitiet B ON A.id = B.phieuyeucau_id
WHERE A.active = 1 AND B.active = 1 AND ISNULL(A.BGD_CANCEL, 0) = 0
	AND A.IsFinish = 0 AND soluong - soluong_daphat > 0
	AND B.mact = @mact


INSERT INTO @SOLUONG_YEUCAU(loaiphieu, sophieu, mact, soluong_yeucau, soluong_daphat)
SELECT N'Lệnh cấp phát', A.LenhCapPhatID, 
	B.mavt, 
	soluong = SUM(B.soluong),
	soluong_daphat = SUM(B.soluong_daphat)
FROM tr_lenhcapphat_head A
	INNER JOIN tr_lenhcapphat B ON A.LenhCapPhatID = B.LenhCapPhatID
WHERE A.hoanthanh = 0 AND A.active = 1 AND B.soluong_conlai > 0
	AND B.mavt = @mact
GROUP BY A.LenhCapPhatID, B.mavt


SELECT A.loaiphieu, A.sophieu, B.nhom, 
	A.mact, B.mota, B.quycach, B.mausac, B.dvt,
	A.soluong_yeucau, A.soluong_daphat, 
	A.ghichu
FROM @SOLUONG_YEUCAU A
	INNER JOIN tr_material B ON A.mact = B.mavt
END

