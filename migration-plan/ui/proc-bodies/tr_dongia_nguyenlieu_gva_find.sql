-- PARAMS:
-- @id_nguyenlieu nvarchar
-- @dayy float
-- @dai float
-- @dongia decimal OUTPUT
-- @loaitien nvarchar OUTPUT


CREATE PROC [dbo].[TR_DONGIA_NGUYENLIEU_GVA_FIND]
(
	@id_nguyenlieu nvarchar(200),
	@dayy float,
	@dai float,
	@dongia decimal(18, 2) OUT,
	@loaitien nvarchar(50) OUT
)
AS
BEGIN

	DECLARE @maxLength float;
	SELECT @maxLength = MAX(dai_den) 
	FROM tr_dongia_nguyenlieu_gva 
	WHERE (id_nguyenlieu = @id_nguyenlieu OR nguyenlieu = @id_nguyenlieu) AND dayy = @dayy

	IF @dai > @maxLength
	BEGIN
		SELECT TOP (1) @dongia = dongia, @loaitien = loaitien
		FROM tr_dongia_nguyenlieu_gva 
		WHERE (id_nguyenlieu = @id_nguyenlieu OR nguyenlieu = @id_nguyenlieu) AND dayy = @dayy
		ORDER BY dai_den DESC
	END
	ELSE
	BEGIN
		SELECT @dongia = dongia, @loaitien = loaitien
		FROM tr_dongia_nguyenlieu_gva
		WHERE (id_nguyenlieu = @id_nguyenlieu OR nguyenlieu = @id_nguyenlieu)
			AND dayy = @dayy
			AND (@dai >= dai_tu AND @dai < dai_den)
	END
	
	IF @dongia IS NULL
	BEGIN
		SELECT TOP (1) @dongia = dongia, @loaitien = loaitien
		FROM tr_dongia_nguyenlieu_gva
		WHERE (id_nguyenlieu = @id_nguyenlieu OR nguyenlieu = @id_nguyenlieu)
		ORDER BY dongia DESC
	END
END


