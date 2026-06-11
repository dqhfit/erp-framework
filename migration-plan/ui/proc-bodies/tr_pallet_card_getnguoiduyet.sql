-- PARAMS:
-- @card_no nvarchar


CREATE PROC [dbo].[TR_PALLET_CARD_GETNGUOIDUYET]
(
	@card_no nvarchar(50)
	--@nguoiduyet nvarchar(200) OUT
)
AS
BEGIN
	DECLARE @tennguoiduyet nvarchar(200)
	DECLARE @tennguoitao nvarchar(200)
	DECLARE @card_type nvarchar(5)
	SELECT @card_type = card_type
	FROM tr_pallet_card A
	WHERE card_no = @card_no

	DECLARE @nguoiduyet1 nvarchar(50)
	DECLARE @chuky_nguoiduyet varbinary(max)

	DECLARE @nguoitao1 nvarchar(50)
	DECLARE @chuky_nguoitao varbinary(max)

	DECLARE @tinhtrangloi nvarchar(max);
	DECLARE @nguyennhanloi nvarchar(max);
	DECLARE @huongxuly nvarchar(max);
	DECLARE @bophanlamloi nvarchar(100);

	IF @card_type = 'D'
	BEGIN
		SELECT @nguoiduyet1 = nguoiduyet, 
			@nguoitao1 = nguoitao, 
			@tinhtrangloi = tinhtrang, 
			@nguyennhanloi = IIF(COALESCE(B.[Name], N'Khác') = N'Khác', nguyennhan, B.[Name]), 
			@huongxuly = huongxuly,
			@bophanlamloi = REPLACE(loc1.n_location, N'[Hoàn thành]', '')
		FROM tr_baocao_hangloi A 
			LEFT JOIN tr_tieuchuan_nguyennhan B ON A.nguyennhanloi = B.Id
			LEFT JOIN trtb_m_location loc1 ON loc1.c_location = A.bophanlamloi
		WHERE card_no = @card_no

		SELECT @tennguoiduyet = B.FullName, @chuky_nguoiduyet = A.hinhanh
		FROM tr_hinhanh A
			RIGHT JOIN SYS_USER B ON A.[name] = B.UserName
		WHERE A.phanloai = 'USER' AND B.UserName = @nguoiduyet1

		SELECT @tennguoitao = B.FullName, @chuky_nguoitao = A.hinhanh
		FROM tr_hinhanh A
			RIGHT JOIN SYS_USER B ON A.[name] = B.UserName
		WHERE A.phanloai = 'USER' AND B.UserName = @nguoitao1
	END
	ELSE
	BEGIN
		SET @tennguoiduyet = NULL;
	END

	SELECT @card_type AS card_type,
		@tinhtrangloi AS tinhtrangloi, @nguyennhanloi AS nguyennhanloi,
		@tennguoitao AS tennguoitao, 
		@nguoitao1 AS nguoitao, 
		@chuky_nguoitao AS chuky_nguoitao, 
		@tennguoiduyet AS tennguoiduyet, 
		@nguoiduyet1 AS nguoiduyet, 
		@chuky_nguoiduyet AS chuky_nguoiduyet,
		@huongxuly AS huongxuly,
		@bophanlamloi AS bophanlamloi
END

