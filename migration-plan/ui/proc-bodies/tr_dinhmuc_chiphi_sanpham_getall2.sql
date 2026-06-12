-- PARAMS:
-- @hehang nvarchar


CREATE PROC [dbo].[TR_DINHMUC_CHIPHI_SANPHAM_GETALL2](@hehang nvarchar(max))
AS
BEGIN
	SELECT A.*, B.tensp, B.hehang
	FROM tr_dinhmuc_chiphi_sanpham A
		INNER JOIN tr_sanpham B ON A.masp = B.masp
	WHERE B.hehang IN (SELECT LTRIM(RTRIM([value])) FROM string_split(@hehang, ','));

	SELECT B.* 
	FROM tr_dinhmuc_chiphi_sanpham A
		INNER JOIN tr_dinhmuc_chiphi_sanpham_govan B ON A.masp = B.masp
		INNER JOIN tr_sanpham C ON A.masp = C.masp
	WHERE C.hehang IN (SELECT LTRIM(RTRIM([value])) FROM string_split(@hehang, ','));
END



