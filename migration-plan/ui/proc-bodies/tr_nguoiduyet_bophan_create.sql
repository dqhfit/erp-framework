-- PARAMS:
-- @id uniqueidentifier
-- @username nvarchar
-- @mabophan nvarchar
-- @phanloai nvarchar


CREATE   PROC TR_NGUOIDUYET_BOPHAN_CREATE(@id uniqueidentifier, @username nvarchar(50), @mabophan nvarchar(50), @phanloai nvarchar(50))
AS
BEGIN
	IF NOT EXISTS (SELECT 1 FROM tr_nguoiduyet_bophan WHERE username = @username AND mabophan = @mabophan AND phanloai = @phanloai) 
	BEGIN
		INSERT INTO tr_nguoiduyet_bophan (id, username, mabophan, phanloai)
		VALUES (@id, @username, @mabophan, @phanloai)
	END
	ELSE
	BEGIN
		RAISERROR(N'Người dùng này đã tồn tại', 16, 1);
	END
END

