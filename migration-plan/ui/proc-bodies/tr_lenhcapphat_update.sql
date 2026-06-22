-- PARAMS:
-- @id nvarchar
-- @LenhCapPhat nvarchar
-- @MaSP nvarchar
-- @MaCT nvarchar
-- @SoLuongXuat decimal


CREATE PROC [dbo].[TR_LENHCAPPHAT_Update]
(
	@id NVARCHAR(200),
	@LenhCapPhat NVARCHAR(200),
	@MaSP NVARCHAR(MAX),
	@MaCT NVARCHAR(MAX),
	@SoLuongXuat DECIMAL(18,3)
)
AS
DECLARE @SOLUONG_YEUCAU DECIMAL(18,3);
DECLARE @SOLUONG_DAPHAT DECIMAL(18,3);
DECLARE @SOLUONG_CONLAI DECIMAL(18,3);

SELECT @SOLUONG_YEUCAU = soluong
	, @SOLUONG_DAPHAT = soluong_daphat
	, @SOLUONG_CONLAI = soluong_conlai
FROM tr_lenhcapphat WITH(NOLOCK)
WHERE ID = @id
--WHERE LenhCapPhatID = @LenhCapPhat AND mavt = @MaCT AND masp = @MaSP

SET @SOLUONG_DAPHAT = @SOLUONG_DAPHAT + @SoLuongXuat
SET @SOLUONG_CONLAI = @SOLUONG_YEUCAU - @SOLUONG_DAPHAT

IF @SOLUONG_CONLAI < 0
    SET @SOLUONG_CONLAI = 0

UPDATE tr_lenhcapphat
SET soluong_daphat = @SOLUONG_DAPHAT,
	soluong_conlai = @SOLUONG_CONLAI,
	capphat = CASE WHEN @SOLUONG_CONLAI <= 0 THEN 1 ELSE 0 END
WHERE ID = @id
--WHERE LenhCapPhatID = @LenhCapPhat AND mavt = @MaCT AND masp = @MaSP

