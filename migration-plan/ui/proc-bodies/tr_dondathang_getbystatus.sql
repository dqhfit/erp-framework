-- PARAMS:
-- @trangthai nvarchar

CREATE PROC [dbo].[TR_DONDATHANG_GETBYSTATUS](@trangthai NVARCHAR(50))
AS
BEGIN
	-- CANCEL: huỷ; FINISH: hoàn thành; NOTYET: chưa hoàn thành; ALL: tất cả
	IF @trangthai = 'CANCEL'
	BEGIN
		SELECT A.*, B.FullName AS tennguoitao
		FROM tr_dondathang A
		LEFT JOIN SYS_USER B ON A.create_by = B.UserName
		WHERE (A.trangthai = -1 OR A.pheduyet = -1) and A.active = 1
	END
	ELSE IF @trangthai = 'FINISH'
	BEGIN
		SELECT A.*, B.FullName AS tennguoitao
		FROM tr_dondathang A
		LEFT JOIN SYS_USER B ON A.create_by = B.UserName
		WHERE  A.trangthai = 3 AND A.pheduyet <> '-1' and A.active = 1
	END
	ELSE IF @trangthai = 'NOTYET'
	BEGIN
		SELECT A.*, B.FullName AS tennguoitao
		FROM tr_dondathang A
		LEFT JOIN SYS_USER B ON A.create_by = B.UserName
		WHERE A.trangthai IN ('0', '1', '2') 
		AND A.pheduyet <> '-1' and A.active = 1
	END
	ELSE IF @trangthai = 'ALL'
	BEGIN
		SELECT A.*, B.FullName AS tennguoitao
		FROM tr_dondathang A
		LEFT JOIN SYS_USER B ON A.create_by = B.UserName
		WHERE A.pheduyet <> '-1' and A.active = 1 
			--AND YEAR(A.ngaydat) >= YEAR(GETDATE())-1
	END
END

