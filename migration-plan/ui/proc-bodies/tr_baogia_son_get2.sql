-- PARAMS:
-- @MaSP nvarchar
-- @baoGiaID uniqueidentifier

CREATE PROC [dbo].[TR_BAOGIA_SON_GET2] 
(
	@MaSP NVARCHAR (200),
	@baoGiaID UNIQUEIDENTIFIER = NULL
)
AS
IF @baoGiaID IS NULL
BEGIN
	SELECT A.masp,
		   A.matson,
		   CASE
			  WHEN A.matson = 'mattren' THEN N'Mặt trên'
			  WHEN A.matson = 'matduoi' THEN N'Mặt dưới'
			  WHEN A.matson = 'mattrai' THEN N'Mặt trái'
			  WHEN A.matson = 'matphai' THEN N'Mặt phải'
			  WHEN A.matson = 'mattruoc' THEN N'Mặt trước'
			  WHEN A.matson = 'matsau' THEN N'Mặt sau'
		   END AS [NAME],
		   A.kichthuoc as quycach,
		   A.dientich,
		   A.phantram_son,
		   A.dongia
	FROM tr_baogia_son A
	WHERE A.masp = @MaSP AND baoGiaID IS NULL
END
ELSE
BEGIN
	SELECT A.masp,
		   A.matson,
		   CASE
			  WHEN A.matson = 'mattren' THEN N'Mặt trên'
			  WHEN A.matson = 'matduoi' THEN N'Mặt dưới'
			  WHEN A.matson = 'mattrai' THEN N'Mặt trái'
			  WHEN A.matson = 'matphai' THEN N'Mặt phải'
			  WHEN A.matson = 'mattruoc' THEN N'Mặt trước'
			  WHEN A.matson = 'matsau' THEN N'Mặt sau'
		   END AS [NAME],
		   A.kichthuoc as quycach,
		   A.dientich,
		   A.phantram_son,
		   A.dongia
	FROM tr_baogia_son A
	WHERE A.masp = @MaSP AND baoGiaID = @baoGiaID
END
