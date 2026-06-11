-- PARAMS:
-- @masp nvarchar
-- @loaidinhmuc nvarchar
-- @isLock bit
-- @ngaysua datetime
-- @nguoisua nvarchar


CREATE PROC [dbo].[TR_DINHMUC_LOCK_CREATE]
(
	@masp nvarchar(200),
	@loaidinhmuc nvarchar(50),
	@isLock bit,
	@ngaysua datetime,
	@nguoisua nvarchar(50)
)
AS

DECLARE @COUNTER INT
IF @loaidinhmuc = 'GVA' GOTO DINHMUC_GOVAN_COUNT
IF @loaidinhmuc = 'NKI' GOTO DINHMUC_NGUKIM_COUNT
IF @loaidinhmuc = 'DGO' GOTO DINHMUC_DONGGOI_COUNT
IF @loaidinhmuc = 'SON' GOTO DINHMUC_SON_COUNT

DINHMUC_GOVAN_COUNT:
	SELECT @COUNTER = COUNT(id) FROM tr_dinhmuc_govan WHERE masp = @masp
DINHMUC_NGUKIM_COUNT:
	SELECT @COUNTER = COUNT(id) FROM tr_dinhmuc_ngukim WHERE masp = @masp
DINHMUC_DONGGOI_COUNT:
	SELECT @COUNTER = COUNT(id) FROM tr_dinhmuc_donggoi WHERE masp = @masp
DINHMUC_SON_COUNT:
	SELECT @COUNTER = COUNT(id) FROM tr_dinhmuc_son WHERE masp = @masp

IF @COUNTER > 0
BEGIN
	IF EXISTS (SELECT id FROM tr_dinhmuc_lock WHERE masp = @masp AND loaidinhmuc = @loaidinhmuc)
	BEGIN
		UPDATE tr_dinhmuc_lock
		SET isLock = @isLock,
			ngaysua = @ngaysua,
			nguoisua = @nguoisua
		WHERE masp = @masp AND loaidinhmuc = @loaidinhmuc
	END
	ELSE
	BEGIN
		INSERT INTO tr_dinhmuc_lock
		(
			id, 
			masp, 
			loaidinhmuc, 
			isLock,
			ngaysua,
			nguoisua
		)
		VALUES 
		(
			newid(), 
			@masp, 
			@loaidinhmuc, 
			@isLock,
			@ngaysua,
			@nguoisua
		)
	END
END



