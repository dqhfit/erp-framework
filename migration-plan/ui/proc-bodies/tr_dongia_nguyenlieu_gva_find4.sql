-- PARAMS:
-- @id_nguyenlieu nvarchar
-- @hehang nvarchar
-- @dayy float
-- @dai float


CREATE PROC [dbo].[TR_DONGIA_NGUYENLIEU_GVA_FIND4]
(
	@id_nguyenlieu nvarchar(200),
	@hehang nvarchar(200),
	@dayy float,
	@dai float
)
AS
BEGIN
	
	DECLARE @maxLength float;
	IF EXISTS (SELECT 1 FROM tr_dongia_nguyenlieu_gva WHERE hehang = @hehang AND (id_nguyenlieu = @id_nguyenlieu OR nguyenlieu = @id_nguyenlieu))
	BEGIN
		SELECT @maxLength = MAX(dai_den) 
		FROM tr_dongia_nguyenlieu_gva 
		WHERE (id_nguyenlieu = @id_nguyenlieu OR nguyenlieu = @id_nguyenlieu) AND dayy = @dayy AND hehang = @hehang

		IF @dai > @maxLength
		BEGIN
			SELECT TOP (1) *
			FROM tr_dongia_nguyenlieu_gva 
			WHERE (id_nguyenlieu = @id_nguyenlieu OR nguyenlieu = @id_nguyenlieu) AND dayy = @dayy AND hehang = @hehang
			ORDER BY dai_den DESC
		END
		ELSE
		BEGIN
			IF EXISTS (SELECT 1 FROM tr_dongia_nguyenlieu_gva 
						WHERE (id_nguyenlieu = @id_nguyenlieu OR nguyenlieu = @id_nguyenlieu) 
							AND dayy = @dayy AND (@dai >= dai_tu AND @dai < dai_den) AND hehang = @hehang)
			BEGIN
				SELECT TOP (1) *
				FROM tr_dongia_nguyenlieu_gva
				WHERE (id_nguyenlieu = @id_nguyenlieu OR nguyenlieu = @id_nguyenlieu)
					AND dayy = @dayy
					AND (@dai >= dai_tu AND @dai < dai_den)
					AND hehang = @hehang
			END
			ELSE
			BEGIN
				SELECT TOP (1) *
				FROM tr_dongia_nguyenlieu_gva
				WHERE (id_nguyenlieu = @id_nguyenlieu OR nguyenlieu = @id_nguyenlieu) AND hehang = @hehang
				ORDER BY dongia DESC
			END
		END
	END
	ELSE
	BEGIN
		SELECT @maxLength = MAX(dai_den) 
		FROM tr_dongia_nguyenlieu_gva 
		WHERE (id_nguyenlieu = @id_nguyenlieu OR nguyenlieu = @id_nguyenlieu) AND dayy = @dayy

		IF @dai > @maxLength
		BEGIN
			SELECT TOP (1) *
			FROM tr_dongia_nguyenlieu_gva 
			WHERE (id_nguyenlieu = @id_nguyenlieu OR nguyenlieu = @id_nguyenlieu) AND dayy = @dayy
			ORDER BY dai_den DESC
		END
		ELSE
		BEGIN
			IF EXISTS (SELECT 1 FROM tr_dongia_nguyenlieu_gva WHERE (id_nguyenlieu = @id_nguyenlieu OR nguyenlieu = @id_nguyenlieu) AND dayy = @dayy AND (@dai >= dai_tu AND @dai < dai_den))
			BEGIN
				SELECT TOP (1) *
				FROM tr_dongia_nguyenlieu_gva
				WHERE (id_nguyenlieu = @id_nguyenlieu OR nguyenlieu = @id_nguyenlieu)
					AND dayy = @dayy
					AND (@dai >= dai_tu AND @dai < dai_den)
			END
			ELSE
			BEGIN
				SELECT TOP (1) *
				FROM tr_dongia_nguyenlieu_gva
				WHERE (id_nguyenlieu = @id_nguyenlieu OR nguyenlieu = @id_nguyenlieu)
				ORDER BY dongia DESC
			END
		END
	END
	
END


