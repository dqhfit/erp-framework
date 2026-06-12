-- PARAMS:
-- @id uniqueidentifier
-- @ngaytao datetime
-- @nguoitao nvarchar
-- @card_no nvarchar OUTPUT


CREATE PROC [dbo].[TR_BAOCAO_HANGLOI_CREATE_PALLET]
(
	@id uniqueidentifier,
	@ngaytao datetime,
	@nguoitao nvarchar(50),
	@card_no nvarchar(50) OUT
)
AS
BEGIN
	SELECT * FROM tr_pallet
	-- 1. INSERT tr_pallet
	INSERT INTO tr_pallet
	(
		dondathang, masp, mahtr, stt, mact, tenct, nguyenlieu, dayy_tc, rong_tc, dai_tc, soluong_tc,
		soluong_donhang, soluong_can, sokhoi_tinhche, isCreateCard, active, hangbu,
		ngaytao, nguoitao, ghichu,
		veneer_matchinh, veneer_matphu, veneer_dan_canh,
		veneer_canhdai, veneer_canhngan, pcode
	)	
	SELECT A.donhang, A.masp1, A.masp, B.stt, A.mact, A.tenct, B.nguyenlieu, A.dayy, A.rong, A.dai, b.soluong_tc,
		1 AS soluong_donhang, 
		soluong_can = A.soluong, 
		sokhoi_tinhche = (A.dayy*A.rong*A.dai*A.soluong)/1000000000,
		CONVERT(BIT, 1) as isCreateCard, 
		CONVERT(BIT, 1) as active, 
		CONVERT(BIT, 1) as hangbu,
		@ngaytao as ngaytao, @nguoitao as nguoitao,
		CONCAT(COALESCE(B.ghichu, ''), CHAR(13), COALESCE(A.ghichu, '')) AS ghichu,
		B.veneer_matchinh, B.veneer_matphu, B.veneer_dan_canh,
		B.veneer_canhdai, B.veneer_canhngan, B.pcode
	FROM tr_baocao_hangloi A
		LEFT JOIN tr_dinhmuc_govan B ON A.masp1 = B.masp AND A.mact = B.mact
	WHERE A.id = @id

	-- 2. INSERT tr_pallet_card
	DECLARE @pallet_id int
	DECLARE @card_type nvarchar(5)
	DECLARE @soluong int
	--DECLARE @card_no nvarchar(50)
	DECLARE @card_seq int

	SET @pallet_id = SCOPE_IDENTITY();
	SET @card_type = 'D'
	IF @pallet_id > 0
	BEGIN
		SELECT @soluong = soluong_can FROM tr_pallet WHERE id = @pallet_id
		EXECUTE TR_PALLET_CARD_CREATE @pallet_id,@card_type,@soluong,@ngaytao,@nguoitao,@card_no OUTPUT,@card_seq OUTPUT;

		UPDATE tr_baocao_hangloi
		SET card_no = @card_no, isCreateCard = 1
		WHERE id = @id
	END
END

