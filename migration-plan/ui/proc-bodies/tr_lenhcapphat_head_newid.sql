-- PARAMS:
-- @sophieu nvarchar OUTPUT

CREATE PROC TR_LENHCAPPHAT_HEAD_NEWID(@sophieu nvarchar(50) OUT)
AS
BEGIN
	DECLARE @currentDate date = GETDATE();
	DECLARE @IDX INT;

	SELECT @IDX = COUNT(LenhCapPhatID) FROM tr_lenhcapphat_head
	WHERE CONVERT(date, ngaytao) = @currentDate

	WHILE 1 = 1
	BEGIN
		SET @sophieu = 'LCP' + FORMAT(@currentDate, 'ddMMyy') + FORMAT(@IDX + 1, 'D2');
		IF EXISTS (SELECT 1 FROM tr_lenhcapphat_head WHERE LenhCapPhatID = @sophieu)
		BEGIN
			SET @IDX = @IDX + 1;
		END
		ELSE
		BEGIN
			BREAK;
		END
	END
END

