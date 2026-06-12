-- PARAMS:
-- @masp nvarchar
-- @tigia float
-- @tongdongia_vnd decimal OUTPUT
-- @tongkhoitinhche decimal OUTPUT


CREATE   PROCEDURE [dbo].[TINHGIA_NGUYENLIEU_GVA]
(
	@masp nvarchar(200),
	@tigia float = 25400,
	@tongdongia_vnd decimal(18, 2) OUT,
	@tongkhoitinhche decimal(18, 5) OUT
)
AS
BEGIN
--DECLARE @masp nvarchar(200);
--SET @masp = 'CRL-DW-5-03-F_AKZ010_AA';

DECLARE @id_nguyenlieu nvarchar(200) = '';
DECLARE @nguyenlieu nvarchar(200) = '';
DECLARE @dayy_tc decimal(18, 5) = 0;
DECLARE @rong_tc decimal(18, 5) = 0;
DECLARE @dai_tc decimal(18, 5) = 0;
DECLARE @soluong_tc int = 0;

SET @tongdongia_vnd = 0;
SET @tongkhoitinhche = 0;

DECLARE @dongia decimal(18,2) = 0;
DECLARE @loaitien nvarchar(50) = '';

DECLARE CUR CURSOR LOCAL FOR
	SELECT id_nguyenlieu, nguyenlieu, 
		dayy_tc, rong_tc, dai_tc, soluong_tc
	FROM tr_dinhmuc_govan
	WHERE masp = @masp
		AND nguyenlieu NOT IN ('', '0')
OPEN CUR
FETCH NEXT FROM CUR INTO @id_nguyenlieu, @nguyenlieu, @dayy_tc, @rong_tc, @dai_tc, @soluong_tc
WHILE @@FETCH_STATUS = 0
BEGIN
	DECLARE @sokhoiTC decimal(18, 10) = 0;
	SET @sokhoiTC = (@dayy_tc*@rong_tc*@dai_tc*@soluong_tc)/1000000000;

	SET @dongia = 0;
	SET @loaitien = '';
	--EXECUTE TR_DONGIA_NGUYENLIEU_GVA_FIND nguyenlieu,@dayy_tc,@dai_tc,@dongia OUTPUT,@loaitien OUTPUT;

	SELECT @dongia = dongia, @loaitien = loaitien
	FROM dbo.FN_DONGIA_NGUYENLIEU_GVA(@nguyenlieu, @dayy_tc, @dai_tc)

	

	IF @loaitien = 'USD'
		SET @dongia = @dongia * @tigia;

	SET @tongdongia_vnd = @tongdongia_vnd + (@dongia * @sokhoiTC);
	SET @tongkhoitinhche = @tongkhoitinhche + @sokhoiTC;

	PRINT CONCAT(@nguyenlieu, ' - ', @sokhoiTC,  ' - ', @tigia, ' - ', @dongia);

	FETCH NEXT FROM CUR INTO @id_nguyenlieu, @nguyenlieu, @dayy_tc, @rong_tc, @dai_tc, @soluong_tc
END
CLOSE CUR;
DEALLOCATE CUR;
	
--SELECT @tongdongia_vnd, @tongkhoitinhche
END


