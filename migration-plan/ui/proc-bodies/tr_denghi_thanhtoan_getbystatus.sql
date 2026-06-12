-- PARAMS:
-- @trangthai int
-- @bophan nvarchar


CREATE PROC [dbo].[TR_DENGHI_THANHTOAN_GETBYSTATUS](@trangthai INT ,@bophan nvarchar(20))
AS
BEGIN
	DECLARE @tenbophan nvarchar(200)

	SELECT @tenbophan = tenbophan
	FROM tr_bophan
	WHERE mabophan = @bophan

	DECLARE @TEPDINHKEM TABLE
	(
		id_sophieu uniqueidentifier,
		documentCount int
	)

	INSERT INTO @TEPDINHKEM (id_sophieu, documentCount)
	SELECT id_sophieu, COUNT(id_sophieu) AS documentCount FROM tr_denghi_thanhtoan_file GROUP BY id_sophieu

	IF @trangthai = 0
	BEGIN
		IF(@bophan = 'KTO' or @bophan = 'BGD')
		BEGIN
			SELECT A.*, B.documentCount 
			FROM tr_denghi_thanhtoan A LEFT JOIN @TEPDINHKEM B ON A.id = B.id_sophieu
			WHERE A.active = 1 AND ISNULL(A.nguoiduyet, '') = ''
		END
		ELSE
		BEGIN	
			SELECT A.*, B.documentCount
			FROM tr_denghi_thanhtoan A LEFT JOIN @TEPDINHKEM B ON A.id = B.id_sophieu
			WHERE A.active = 1 AND ISNULL(A.nguoiduyet, '') = '' AND A.bophan = @tenbophan
		END
	END
	ELSE IF @trangthai = 1
	BEGIN
		IF(@bophan = 'KTO' or @bophan = 'BGD')
		BEGIN
			SELECT A.*, B.documentCount 
			FROM tr_denghi_thanhtoan A LEFT JOIN @TEPDINHKEM B ON A.id = B.id_sophieu
			WHERE A.active = 1 AND ISNULL(A.nguoiduyet, '') <> ''
		END
		ELSE
		BEGIN	
			SELECT A.*, B.documentCount 
			FROM tr_denghi_thanhtoan A LEFT JOIN @TEPDINHKEM B ON A.id = B.id_sophieu
			WHERE A.active = 1 AND ISNULL(A.nguoiduyet, '') <> '' AND A.bophan = @tenbophan
		END
	END
	ELSE IF @trangthai = -1
	BEGIN
		SELECT A.*, B.documentCount 
		FROM tr_denghi_thanhtoan A LEFT JOIN @TEPDINHKEM B ON A.id = B.id_sophieu
		WHERE A.active = 0 AND A.bophan = @tenbophan
	END

END


