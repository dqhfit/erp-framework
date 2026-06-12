-- PARAMS:
-- @idChiTiet2 nvarchar

CREATE PROCEDURE [dbo].[TR_DONDATHANG_CHITIET2_GETALL2]
(
	@idChiTiet2 nvarchar(200)
)
AS
BEGIN
	DECLARE @loaiddh nvarchar(50)
	SELECT @loaiddh = A.loaiddh FROM tr_dondathang A
		INNER JOIN tr_dondathang_chitiet2 B ON A.maddh = B.maddh
	WHERE B.idChiTiet2 = @idChiTiet2
	--SELECT @loaiddh = loaiddh FROM tr_dondathang
	--WHERE maddh = @maddh

	IF @loaiddh = 'PHOI'
	BEGIN
		SELECT A.*, NULL as mausac,
			mota = A.tenchitiet,
			quycach = CONCAT(A.dayy, ' * ', A.rong, ' * ', A.dai)
		FROM tr_dondathang_chitiet2 A
		WHERE A.idChiTiet2 = @idChiTiet2
	END
	ELSE
	BEGIN
		SELECT A.*, B.mota, B.quycach, B.mausac
		FROM tr_dondathang_chitiet2 A
			INNER JOIN tr_material B ON A.chitiet = B.mavt
		WHERE A.idChiTiet2 = @idChiTiet2
	END

	--SELECT A.*, B.mota, B.quycach, B.mausac
	--FROM tr_dondathang_chitiet2 A
	--	INNER JOIN tr_material B ON A.chitiet = B.mavt
	--WHERE A.maddh = @maddh
END

