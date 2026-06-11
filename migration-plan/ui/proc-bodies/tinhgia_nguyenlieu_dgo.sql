-- PARAMS:
-- @masp nvarchar
-- @tigia float
-- @tongdonagia_vnd decimal OUTPUT


CREATE PROC [dbo].[TINHGIA_NGUYENLIEU_DGO]
(
	@masp nvarchar(200),
	@tigia float = 25400,
	@tongdonagia_vnd decimal(18, 2) OUT
)
AS
BEGIN
--DECLARE @masp nvarchar(200) = 'CRL-DW-5-03-F_AKZ010_AA';
--DECLARE @tigia int = 25400;
SELECT @tongdonagia_vnd = SUM(
	CASE
		WHEN B.loaitien = 'USD' THEN A.soluong * B.dongia * @tigia ELSE A.soluong * B.dongia
	END)
FROM tr_dinhmuc_donggoi A
	INNER JOIN tr_material B ON A.madonggoi = B.mavt
WHERE A.masp = @masp
END
