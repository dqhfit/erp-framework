-- PARAMS:
-- @TYPE nvarchar
-- @CODE nvarchar



CREATE PROC TR_TONKHO_SUM_GETBYPRICE
(
	@TYPE NVARCHAR(20),
	@CODE NVARCHAR(20)
)
AS

IF @TYPE = 'CODE'
BEGIN
	SELECT A.mavt, B.mota, B.quycach, B.mausac, B.dvt, A.soluong, B.dongia, B.loaitien, A.makho
	FROM tr_tonkho_sum A
		INNER JOIN tr_material B ON A.mavt = B.mavt
END
ELSE IF @TYPE = 'WHS'
BEGIN
	SELECT A.mavt, B.mota, B.quycach, B.mausac, B.dvt, A.soluong, B.dongia, B.loaitien, A.makho
	FROM tr_tonkho_sum A
		INNER JOIN tr_material B ON A.mavt = B.mavt
	WHERE A.makho = @CODE
END
