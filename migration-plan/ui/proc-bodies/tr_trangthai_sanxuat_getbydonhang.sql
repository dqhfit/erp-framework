-- PARAMS:
-- @madonhang nvarchar
-- @congdoan nvarchar


CREATE PROC [dbo].[TR_TRANGTHAI_SANXUAT_GETBYDONHANG](@madonhang NVARCHAR(200), @congdoan NVARCHAR(10))
AS
BEGIN
	--IF @congdoan = 'ALL'
	--BEGIN
	--	SELECT A.*
	--	FROM tr_trangthai_sanxuat A
	--	WHERE madonhang = @madonhang
	--		AND ViTriMay IS NULL
	--END
	--ELSE
	--BEGIN
	--	SELECT A.*
	--	FROM tr_trangthai_sanxuat A
	--	WHERE madonhang = @madonhang
	--		AND congdoan = @congdoan
	--		AND ViTriMay IS NULL
	--	ORDER BY masp, masp1 
	--END
	--SET @madonhang = LTRIM(RTRIM(@madonhang))

	SELECT A.*,(((A.dai*A.rong*A.soluong) * ISNULL(case when A.somatuv = 0 then 1 end,1))/1000000) as m2
	FROM tr_trangthai_sanxuat A
	WHERE madonhang IN (SELECT LTRIM(RTRIM([value])) FROM string_split(@madonhang, ',')) AND A.congdoan = @congdoan
END


