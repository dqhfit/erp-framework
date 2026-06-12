-- PARAMS:
-- @loaidh nvarchar
-- @trangthai nvarchar


CREATE PROC TR_DONDATHANG_GETBYTYPE2(@loaidh nvarchar(50), @trangthai nvarchar(10))
AS
BEGIN
	-- CANCEL: huỷ; FINISH: hoàn thành; NOTYET: chưa hoàn thành; ALL: tất cả
	IF @trangthai = 'CANCEL'
	BEGIN
		SELECT * FROM tr_dondathang A
		WHERE A.loaiddh = @loaidh
			AND trangthai = -1 OR pheduyet = -1 and active = 1
	END
	ELSE IF @trangthai = 'FINISH'
	BEGIN
		SELECT * FROM tr_dondathang A
		WHERE A.loaiddh = @loaidh
			AND trangthai = 3 AND pheduyet <> '-1' AND active = 1
	END
	ELSE IF @trangthai = 'NOTYET'
	BEGIN
		SELECT * FROM tr_dondathang A
		WHERE A.loaiddh = @loaidh 
			AND trangthai IN ('0', '1', '2') AND pheduyet <> '-1' and active = 1
	END
END
