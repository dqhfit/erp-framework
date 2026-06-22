-- PARAMS:
-- @date date
-- @param nvarchar
-- @type nvarchar
-- @sophieu nvarchar OUTPUT


CREATE PROCEDURE TR_PHIEUXUAT_NEWID
(
	@date date,
	@param nvarchar(5),
	@type nvarchar(5),
	@sophieu nvarchar(50) OUT
)
AS
BEGIN
	DECLARE @COUNTER INT
	SELECT @COUNTER = COUNT(*) FROM tr_phieuxuat WHERE CAST(ngaytao AS DATE) = @date
	WHILE 1 = 1
	BEGIN
		SET @sophieu = @param + FORMAT(@date, 'ddMMyy') + FORMAT(@COUNTER + 1, 'D2') + @type;
		IF EXISTS (SELECT 1 FROM tr_phieuxuat WHERE sopx = @sophieu)
		BEGIN
			SET @COUNTER = @COUNTER + 1;
		END
		ELSE
		BEGIN
			BREAK;
		END
	END
END;

